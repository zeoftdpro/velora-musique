import { and, asc, count, desc, eq, gt, max, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { albums, artists, genres, playlists, playlistTracks, tracks } from '../db/schema.js';
import { forbidden, HttpError, notFound } from '../lib/errors.js';
import { IdParams, parse } from '../lib/validation.js';
import { toTrackDto, trackColumns } from '../services/catalog.js';

const PlaylistBody = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullish(),
  isPublic: z.boolean().optional(),
});
const AddTrackBody = z.object({ trackId: z.string().uuid() });
const ItemParams = z.object({ id: z.string().uuid(), itemId: z.string().uuid() });
const MoveBody = z.object({ position: z.number().int().min(0) });

// Plafonds par compte : largement au-delà d'un usage normal, ils empêchent de remplir la base à la chaîne.
const MAX_PLAYLISTS = 300;
const MAX_PLAYLIST_TRACKS = 5000;

export default async function playlistRoutes(app: FastifyInstance) {
  async function loadOwned(id: string, userId: string) {
    const [playlist] = await db.select().from(playlists).where(eq(playlists.id, id));
    if (!playlist) throw notFound('Playlist');
    if (playlist.ownerId !== userId) throw forbidden('Cette playlist ne vous appartient pas');
    return playlist;
  }

  const touch = (id: string) => db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, id));

  app.get('/playlists', { preHandler: app.authenticate }, async (req) => {
    return db
      .select({
        id: playlists.id,
        name: playlists.name,
        description: playlists.description,
        isPublic: playlists.isPublic,
        updatedAt: playlists.updatedAt,
        trackCount: count(playlistTracks.id),
      })
      .from(playlists)
      .leftJoin(playlistTracks, eq(playlistTracks.playlistId, playlists.id))
      .where(eq(playlists.ownerId, req.user.sub))
      .groupBy(playlists.id)
      .orderBy(desc(playlists.updatedAt));
  });

  app.post('/playlists', { preHandler: app.authenticate }, async (req, reply) => {
    const body = parse(PlaylistBody, req.body);
    const [owned] = await db.select({ n: count() }).from(playlists).where(eq(playlists.ownerId, req.user.sub));
    if ((owned?.n ?? 0) >= MAX_PLAYLISTS) throw new HttpError(422, `Limite de ${MAX_PLAYLISTS} playlists atteinte`, 'LIMIT_REACHED');
    const [playlist] = await db
      .insert(playlists)
      .values({ ownerId: req.user.sub, name: body.name, description: body.description ?? null, isPublic: body.isPublic ?? false })
      .returning();
    reply.code(201);
    return { ...playlist, tracks: [] };
  });

  // Lecture : propriétaire, ou n'importe qui si la playlist est publique.
  app.get('/playlists/:id', { preHandler: app.optionalAuth }, async (req) => {
    const { id } = parse(IdParams, req.params);
    const [playlist] = await db
      .select()
      .from(playlists)
      .where(and(eq(playlists.id, id), or(eq(playlists.isPublic, true), eq(playlists.ownerId, req.user?.sub ?? sql`null`))));
    if (!playlist) throw notFound('Playlist');

    const rows = await db
      .select({ ...trackColumns, itemId: playlistTracks.id })
      .from(playlistTracks)
      .innerJoin(tracks, eq(tracks.id, playlistTracks.trackId))
      .innerJoin(artists, eq(artists.id, tracks.artistId))
      .innerJoin(albums, eq(albums.id, tracks.albumId))
      .leftJoin(genres, eq(genres.id, tracks.genreId))
      .where(and(eq(playlistTracks.playlistId, id), eq(tracks.status, 'ready')))
      .orderBy(asc(playlistTracks.position));
    return {
      ...playlist,
      isOwner: playlist.ownerId === req.user?.sub,
      tracks: rows.map((r) => ({ ...toTrackDto(r), itemId: r.itemId })),
    };
  });

  app.patch('/playlists/:id', { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(PlaylistBody.partial(), req.body);
    await loadOwned(id, req.user.sub);
    const [playlist] = await db
      .update(playlists)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(playlists.id, id))
      .returning();
    return playlist;
  });

  app.delete('/playlists/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    await loadOwned(id, req.user.sub);
    await db.delete(playlists).where(eq(playlists.id, id));
    reply.code(204);
  });

  app.post('/playlists/:id/tracks', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const { trackId } = parse(AddTrackBody, req.body);
    await loadOwned(id, req.user.sub);
    const [track] = await db.select({ id: tracks.id }).from(tracks).where(eq(tracks.id, trackId));
    if (!track) throw notFound('Titre');

    const item = await db.transaction(async (tx) => {
      const [last] = await tx
        .select({ position: max(playlistTracks.position), n: count() })
        .from(playlistTracks)
        .where(eq(playlistTracks.playlistId, id));
      if ((last?.n ?? 0) >= MAX_PLAYLIST_TRACKS) {
        throw new HttpError(422, `Une playlist ne peut pas dépasser ${MAX_PLAYLIST_TRACKS} titres`, 'LIMIT_REACHED');
      }
      const [inserted] = await tx
        .insert(playlistTracks)
        .values({ playlistId: id, trackId, position: (last?.position ?? -1) + 1 })
        .returning();
      return inserted;
    });
    await touch(id);
    reply.code(201);
    return item;
  });

  app.delete('/playlists/:id/tracks/:itemId', { preHandler: app.authenticate }, async (req, reply) => {
    const { id, itemId } = parse(ItemParams, req.params);
    await loadOwned(id, req.user.sub);
    await db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(playlistTracks)
        .where(and(eq(playlistTracks.id, itemId), eq(playlistTracks.playlistId, id)))
        .returning();
      if (!removed) throw notFound('Élément de playlist');
      // Referme le trou laissé dans l'ordre.
      await tx
        .update(playlistTracks)
        .set({ position: sql`${playlistTracks.position} - 1` })
        .where(and(eq(playlistTracks.playlistId, id), gt(playlistTracks.position, removed.position)));
    });
    await touch(id);
    reply.code(204);
  });

  // Déplace un élément à une nouvelle position (glisser-déposer).
  app.patch('/playlists/:id/tracks/:itemId', { preHandler: app.authenticate }, async (req, reply) => {
    const { id, itemId } = parse(ItemParams, req.params);
    const { position } = parse(MoveBody, req.body);
    await loadOwned(id, req.user.sub);
    await db.transaction(async (tx) => {
      const items = await tx
        .select({ id: playlistTracks.id })
        .from(playlistTracks)
        .where(eq(playlistTracks.playlistId, id))
        .orderBy(asc(playlistTracks.position));
      const from = items.findIndex((i) => i.id === itemId);
      if (from === -1) throw notFound('Élément de playlist');
      const [moved] = items.splice(from, 1);
      items.splice(Math.min(position, items.length), 0, moved!);
      for (const [index, item] of items.entries()) {
        await tx.update(playlistTracks).set({ position: index }).where(eq(playlistTracks.id, item.id));
      }
    });
    await touch(id);
    reply.code(204);
  });
}
