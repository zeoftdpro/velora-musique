import { and, count, eq, inArray, max } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { playlists, playlistTracks, tracks } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { parse } from '../lib/validation.js';
import { selectTracks, toTrackDto } from '../services/catalog.js';
import { matchTracks, readSource } from '../services/importer.js';

const PreviewBody = z.object({ url: z.string().trim().url('Lien invalide').max(2000) });
const MatchBody = z.object({
  /** Playlist qui reçoit les titres trouvés ; absente pour un titre seul (simple écoute). */
  playlistId: z.string().uuid().optional(),
  tracks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        artists: z.array(z.string().trim().max(200)).max(20),
        album: z.string().trim().max(300).nullable(),
        durationMs: z.number().int().min(0).max(24 * 3600_000),
        coverUrl: z.string().url().max(1000).nullable(),
        videoId: z.string().regex(/^[\w-]{11}$/).optional(),
      }),
    )
    .min(1)
    .max(10),
});

const MAX_PLAYLIST_TRACKS = 5000;

/**
 * Import depuis un lien (Spotify, Deezer, Apple Music, YouTube). Le navigateur lit d'abord la source (`preview`),
 * crée la playlist, puis envoie les morceaux par lots de 10 (`match`) : chaque requête reste courte et
 * l'interface affiche la progression.
 */
export default async function importRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.post('/imports/preview', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { url } = parse(PreviewBody, req.body);
    return readSource(url);
  });

  app.post('/imports/match', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(MatchBody, req.body);
    const [playlist] = body.playlistId
      ? await db
          .select({ id: playlists.id, kind: playlists.kind })
          .from(playlists)
          .where(and(eq(playlists.id, body.playlistId), eq(playlists.ownerId, req.user.sub)))
      : [null];
    if (body.playlistId && !playlist) throw notFound('Playlist');
    if (playlist?.kind === 'uploads') throw new HttpError(409, 'Cette catégorie ne reçoit que vos fichiers téléversés', 'UPLOADS_PLAYLIST');

    const ids = await matchTracks(body.tracks);
    const found = ids.filter((id): id is string => id !== null);
    if (playlist && found.length) {
      await db.transaction(async (tx) => {
        const [last] = await tx
          .select({ position: max(playlistTracks.position), n: count() })
          .from(playlistTracks)
          .where(eq(playlistTracks.playlistId, playlist.id));
        if ((last?.n ?? 0) + found.length > MAX_PLAYLIST_TRACKS) {
          throw new HttpError(422, `Une playlist ne peut pas dépasser ${MAX_PLAYLIST_TRACKS} titres`, 'LIMIT_REACHED');
        }
        const start = (last?.position ?? -1) + 1;
        await tx.insert(playlistTracks).values(found.map((trackId, i) => ({ playlistId: playlist.id, trackId, position: start + i })));
      });
      await db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, playlist.id));
    }

    const rows = found.length ? await selectTracks(inArray(tracks.id, found), req.user.sub) : [];
    const byId = new Map(rows.map((r) => [r.id, toTrackDto(r)]));
    return { results: ids.map((id) => (id ? byId.get(id) ?? null : null)) };
  });
}
