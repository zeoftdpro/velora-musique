import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { paths } from '../config.js';
import { db } from '../db/client.js';
import { albums, artists, playlists, tracks } from '../db/schema.js';
import { IdParams, parse } from '../lib/validation.js';
import { assetUrl } from '../lib/storage.js';
import { selectAlbums, selectTracks, visibleTo } from '../services/catalog.js';

/** Page de l'application construite (apps/web/dist), incluse dans la fonction Vercel. */
const APP_PAGE = path.join(paths.repoRoot, 'apps/web/dist/index.html');
let appPage: Promise<string> | null = null;

type Preview = { title: string; description: string; image: string | null; type: string };

const formatDuration = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}`;
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Liens partagés (/track/…, /album/…, /artist/…, /playlist/…) : la page de l'application, enrichie des balises
 * Open Graph lues par WhatsApp, Messenger, Discord, iMessage… pour afficher la pochette et le titre dans l'aperçu.
 * L'application démarre ensuite normalement sur la bonne page. Seul le catalogue public est décrit : une musique
 * téléversée ou une playlist privée donne un aperçu générique.
 */
export default async function shareRoutes(app: FastifyInstance) {
  const origin = (req: FastifyRequest) => `${req.protocol}://${req.host}`;

  async function send(req: FastifyRequest, reply: FastifyReply, kind: string, preview: Preview | undefined) {
    appPage ??= readFile(APP_PAGE, 'utf8').catch((err) => {
      appPage = null;
      throw err;
    });
    let html = await appPage;
    if (preview) {
      const url = `${origin(req)}${req.url.replace(/^\/share/, '')}`;
      const image = preview.image ? new URL(preview.image, origin(req)).href : `${origin(req)}/icons/icon-512.png`;
      const tags = [
        ['og:site_name', 'Velora'],
        ['og:type', preview.type],
        ['og:title', preview.title],
        ['og:description', preview.description],
        ['og:url', url],
        ['og:image', image],
      ]
        .map(([p, c]) => `<meta property="${p}" content="${escapeHtml(c!)}" />`)
        .concat(`<meta name="twitter:card" content="summary" />`)
        .join('\n    ');
      html = html
        .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(`${preview.title} · Velora`)}</title>`)
        .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${escapeHtml(preview.description)}" />`)
        .replace('</head>', `  ${tags}\n  </head>`);
    }
    // Courte mise en cache par le CDN : les robots d'aperçu demandent souvent la même page plusieurs fois.
    return reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'public, max-age=0, s-maxage=300')
      .header('x-velora-share', kind)
      .send(html);
  }

  app.get('/share/track/:id', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const [t] = await selectTracks(eq(tracks.id, id));
    return send(req, reply, 'track', t && {
      title: `${t.title} · ${t.artistName}`,
      description: `Écoute « ${t.title} » de ${t.artistName}${t.albumTitle !== t.title ? ` (${t.albumTitle})` : ''} sur Velora · ${formatDuration(t.durationMs)}`,
      image: assetUrl(t.albumCoverKey),
      type: 'music.song',
    });
  });

  app.get('/share/album/:id', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const [a] = await selectAlbums(eq(albums.id, id));
    return send(req, reply, 'album', a && {
      title: `${a.title} · ${a.artistName}`,
      description: `Écoute l'album « ${a.title} » de ${a.artistName}${a.releaseYear ? ` (${a.releaseYear})` : ''} sur Velora`,
      image: assetUrl(a.coverKey),
      type: 'music.album',
    });
  });

  app.get('/share/artist/:id', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const [a] = await db.select().from(artists).where(and(eq(artists.id, id), visibleTo(artists.ownerId)));
    return send(req, reply, 'artist', a && {
      title: a.name,
      description: `Écoute ${a.name} sur Velora`,
      image: assetUrl(a.imageKey),
      type: 'profile',
    });
  });

  app.get('/share/playlist/:id', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const [p] = await db.select().from(playlists).where(and(eq(playlists.id, id), eq(playlists.isPublic, true)));
    return send(req, reply, 'playlist', p && {
      title: p.name,
      description: p.description ?? `Écoute la playlist « ${p.name} » sur Velora`,
      image: null,
      type: 'music.playlist',
    });
  });
}
