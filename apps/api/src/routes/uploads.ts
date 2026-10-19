import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { and, count, eq, max } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import mime from 'mime-types';
import { z } from 'zod';
import { db } from '../db/client.js';
import { playlists, playlistTracks, tracks } from '../db/schema.js';
import { HttpError, notFound } from '../lib/errors.js';
import { parse } from '../lib/validation.js';
import { storage } from '../lib/storage.js';
import { AUDIO_EXTENSIONS, ingestFile } from '../ingest/pipeline.js';
import { selectTracks, toTrackDto } from '../services/catalog.js';
import { countUploads, deleteUploadedTrack, MAX_UPLOAD_BYTES, MAX_UPLOADS_PER_USER, uploadsPlaylist } from '../services/uploads.js';

const StartBody = z.object({
  fileName: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
});
const CompleteBody = z.object({ fileName: z.string().trim().min(1).max(255) });
// Identifiant d'envoi : uuid + extension d'origine (le fichier reste reconnaissable par ffmpeg).
const UploadParams = z.object({ id: z.string().regex(/^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/, 'Envoi inconnu') });
const TrackParams = z.object({ id: z.string().uuid() });

const MB = 1024 * 1024;
const uploadKey = (userId: string, id: string) => `uploads/${userId}/${id}`;

/**
 * Musiques téléversées. Le navigateur envoie le fichier directement au stockage (URL signée, sans limite de taille
 * côté API), puis demande son traitement : lecture des métadonnées, pochette, encodage HLS, ajout à la catégorie
 * « Musiques téléversées ». Ces titres restent privés : visibles et écoutables par leur seul propriétaire.
 */
export default async function uploadRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.post('/uploads', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const { fileName, size } = parse(StartBody, req.body);
    const ext = path.extname(fileName).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(ext)) {
      throw new HttpError(415, 'Format non pris en charge (MP3, M4A, FLAC, WAV, OGG, OPUS, AAC…)', 'UNSUPPORTED_FORMAT');
    }
    if (size > MAX_UPLOAD_BYTES) throw new HttpError(413, `Fichier trop lourd (${MAX_UPLOAD_BYTES / MB} Mo maximum)`, 'TOO_LARGE');
    if ((await countUploads(req.user.sub)) >= MAX_UPLOADS_PER_USER) {
      throw new HttpError(422, `Limite de ${MAX_UPLOADS_PER_USER} musiques téléversées atteinte`, 'LIMIT_REACHED');
    }
    const id = `${randomUUID()}${ext}`;
    const contentType = mime.lookup(ext) || 'application/octet-stream';
    const uploadUrl = await storage.signedUploadUrl(uploadKey(req.user.sub, id), contentType, 15 * 60);
    return { id, uploadUrl, contentType };
  });

  // Traitement : jusqu'à une minute pour un long fichier (encodage). Limité pour protéger le serveur.
  app.post('/uploads/:id/complete', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { id } = parse(UploadParams, req.params);
    const { fileName } = parse(CompleteBody, req.body);
    const userId = req.user.sub;
    const key = uploadKey(userId, id);

    const data = await storage.getBuffer(key).catch(() => null);
    if (!data) throw notFound('Fichier envoyé');
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'velora-upload-'));
    try {
      // L'URL signée ne borne pas la taille : on vérifie après coup.
      if (data.length > MAX_UPLOAD_BYTES) throw new HttpError(413, `Fichier trop lourd (${MAX_UPLOAD_BYTES / MB} Mo maximum)`, 'TOO_LARGE');
      const file = path.join(workDir, `source${path.extname(id)}`);
      await writeFile(file, data);

      let trackId: string;
      try {
        ({ trackId } = await ingestFile(file, { ownerId: userId, originalName: fileName }) as { trackId: string });
      } catch (err) {
        req.log.warn({ err }, 'Téléversement illisible');
        // Titre « failed » laissé par l'ingestion (avec son album et son artiste) : sans intérêt pour l'utilisateur.
        const failed = await db.select({ id: tracks.id }).from(tracks).where(and(eq(tracks.ownerId, userId), eq(tracks.status, 'failed')));
        for (const t of failed) await deleteUploadedTrack(t.id, userId);
        throw new HttpError(422, 'Ce fichier audio est illisible ou endommagé', 'UNREADABLE');
      }

      const playlistId = await uploadsPlaylist(userId);
      await db.transaction(async (tx) => {
        const [present] = await tx
          .select({ n: count() })
          .from(playlistTracks)
          .where(and(eq(playlistTracks.playlistId, playlistId), eq(playlistTracks.trackId, trackId)));
        if ((present?.n ?? 0) > 0) return; // même fichier envoyé deux fois
        const [last] = await tx.select({ position: max(playlistTracks.position) }).from(playlistTracks).where(eq(playlistTracks.playlistId, playlistId));
        await tx.insert(playlistTracks).values({ playlistId, trackId, position: (last?.position ?? -1) + 1 });
        await tx.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, playlistId));
      });

      const [row] = await selectTracks(eq(tracks.id, trackId), userId);
      return { playlistId, track: row ? toTrackDto(row) : null };
    } finally {
      await rm(workDir, { recursive: true, force: true });
      await storage.remove(key).catch(() => undefined);
    }
  });

  // Suppression définitive d'une musique téléversée (fichiers compris).
  app.delete('/uploads/tracks/:id', async (req, reply) => {
    const { id } = parse(TrackParams, req.params);
    if (!(await deleteUploadedTrack(id, req.user.sub))) throw notFound('Titre');
    reply.code(204);
  });
}
