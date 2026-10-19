import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { playHistory, tracks } from '../db/schema.js';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import { storage } from '../lib/storage.js';
import { IdParams, parse } from '../lib/validation.js';
import { availableVariants, VARIANTS, type VariantName } from '../lib/variants.js';
import type { StreamTokenPayload } from '../plugins/auth.js';
import { visibleTo } from '../services/catalog.js';
import { videoIdOf } from '../services/youtube.js';

// Cache mémoire des playlists de média (immuables une fois encodées).
const mediaPlaylistCache = new Map<string, string>();
async function loadMediaPlaylist(key: string) {
  let text = mediaPlaylistCache.get(key);
  if (!text) {
    text = await storage.getText(key);
    if (mediaPlaylistCache.size > 2000) mediaPlaylistCache.clear();
    mediaPlaylistCache.set(key, text);
  }
  return text;
}

const StreamParams = z.object({ trackId: z.string().uuid(), variant: z.string().optional() });
const StreamQuery = z.object({ token: z.string().min(1) });

function sendPlaylist(reply: FastifyReply, body: string) {
  return reply
    .header('content-type', 'application/vnd.apple.mpegurl')
    .header('cache-control', 'private, no-store')
    .send(body);
}

export default async function streamRoutes(app: FastifyInstance) {
  /**
   * Point d'entrée de lecture : vérifie le JWT, enregistre l'écoute et renvoie l'URL du flux HLS.
   * Le jeton de flux (court, lié au titre) est passé en query string : il fonctionne aussi avec
   * le lecteur HLS natif de Safari/iOS qui ne permet pas d'ajouter d'en-tête Authorization.
   */
  app.post('/tracks/:id/play', { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(IdParams, req.params);
    const [track] = await db
      .select({ id: tracks.id, variants: tracks.variants, audioUrl: tracks.audioUrl, externalId: tracks.externalId })
      .from(tracks)
      .where(and(eq(tracks.id, id), eq(tracks.status, 'ready'), visibleTo(tracks.ownerId, req.user.sub)));
    if (!track) throw notFound('Titre');

    // Titre YouTube : lu par le lecteur YouTube officiel intégré côté client, à partir de l'id de la vidéo.
    const videoId = videoIdOf(track.externalId);
    if (videoId) {
      await db.insert(playHistory).values({ userId: req.user.sub, trackId: id });
      return {
        trackId: id,
        streamUrl: `https://www.youtube.com/watch?v=${videoId}`,
        format: 'youtube' as const,
        videoId,
        qualities: [],
        expiresIn: env.STREAM_URL_TTL_SECONDS,
      };
    }

    // Titre Jamendo : MP3 servi par Jamendo, en VBR haute qualité (mp32).
    if (track.audioUrl) {
      await db.insert(playHistory).values({ userId: req.user.sub, trackId: id });
      return {
        trackId: id,
        streamUrl: track.audioUrl.replace(/format=mp3\d/, 'format=mp32'),
        format: 'mp3' as const,
        qualities: ['mp32'],
        expiresIn: env.STREAM_URL_TTL_SECONDS,
      };
    }

    const variants = availableVariants(track.variants);
    if (variants.length === 0) throw notFound('Titre');

    await db.insert(playHistory).values({ userId: req.user.sub, trackId: id });

    const payload: StreamTokenPayload = { sub: req.user.sub, tid: id, typ: 'stream' };
    const token = app.jwt.sign(payload, { expiresIn: env.STREAM_URL_TTL_SECONDS });
    return {
      trackId: id,
      streamUrl: `${env.PUBLIC_API_URL}/stream/${id}/master.m3u8?token=${encodeURIComponent(token)}`,
      format: 'hls' as const,
      qualities: variants,
      expiresIn: env.STREAM_URL_TTL_SECONDS,
    };
  });

  async function verifyStreamToken(trackId: string, token: string) {
    let payload: StreamTokenPayload;
    try {
      payload = app.jwt.verify<StreamTokenPayload>(token);
    } catch {
      throw unauthorized('Lien de lecture expiré');
    }
    if (payload.typ !== 'stream' || payload.tid !== trackId) throw forbidden();
    const [track] = await db
      .select({ hlsPrefix: tracks.hlsPrefix, variants: tracks.variants })
      .from(tracks)
      .where(and(eq(tracks.id, trackId), eq(tracks.status, 'ready')));
    if (!track?.hlsPrefix) throw notFound('Titre');
    return { payload, track: { hlsPrefix: track.hlsPrefix, variants: availableVariants(track.variants) } };
  }

  // Playlist maîtresse : liste les qualités disponibles ; le lecteur choisit selon le débit (ABR).
  app.get('/stream/:trackId/master.m3u8', async (req, reply) => {
    const { trackId } = parse(StreamParams, req.params);
    const { token } = parse(StreamQuery, req.query);
    const { track } = await verifyStreamToken(trackId, token);

    const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
    for (const v of track.variants) {
      lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${VARIANTS[v].bandwidth},CODECS="mp4a.40.2"`);
      lines.push(`${v}.m3u8?token=${encodeURIComponent(token)}`);
    }
    return sendPlaylist(reply, lines.join('\n') + '\n');
  });

  // Playlist de média : chaque segment est réécrit en URL signée (S3 pré-signée ou CloudFront).
  app.get('/stream/:trackId/:variant', async (req, reply) => {
    const { trackId, variant: file } = parse(StreamParams, req.params);
    const { token } = parse(StreamQuery, req.query);
    const variant = file?.replace(/\.m3u8$/, '');
    const { track } = await verifyStreamToken(trackId, token);
    if (!variant || !track.variants.includes(variant as VariantName)) {
      throw notFound('Qualité');
    }

    const base = `${track.hlsPrefix}/${variant}`;
    const source = await loadMediaPlaylist(`${base}/index.m3u8`);
    const signed = await Promise.all(
      source.split(/\r?\n/).map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        return storage.signedUrl(`${base}/${trimmed}`, env.STREAM_URL_TTL_SECONDS);
      }),
    );
    return sendPlaylist(reply, signed.join('\n'));
  });
}
