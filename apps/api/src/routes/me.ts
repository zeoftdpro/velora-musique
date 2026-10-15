import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { favorites, playHistory, tracks, users } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { IdParams, Pagination, parse } from '../lib/validation.js';
import { publicUser } from '../services/auth.js';
import { selectTracks, toTrackDto } from '../services/catalog.js';

const UpdateProfile = z.object({ displayName: z.string().trim().min(1).max(60) });

export default async function meRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/me', async (req) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.user.sub));
    if (!user) throw notFound('Utilisateur');
    return publicUser(user);
  });

  app.patch('/me', async (req) => {
    const body = parse(UpdateProfile, req.body);
    const [user] = await db.update(users).set(body).where(eq(users.id, req.user.sub)).returning();
    if (!user) throw notFound('Utilisateur');
    return publicUser(user);
  });

  // --- Favoris ---------------------------------------------------------------

  app.get('/me/favorites', async (req) => {
    const { limit, offset } = parse(Pagination, req.query);
    const rows = await selectTracks()
      .innerJoin(favorites, and(eq(favorites.trackId, tracks.id), eq(favorites.userId, req.user.sub)))
      .orderBy(desc(favorites.createdAt))
      .limit(limit)
      .offset(offset);
    return rows.map(toTrackDto);
  });

  app.get('/me/favorites/ids', async (req) => {
    const rows = await db.select({ id: favorites.trackId }).from(favorites).where(eq(favorites.userId, req.user.sub));
    return rows.map((r) => r.id);
  });

  app.put('/me/favorites/:id', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const [track] = await db.select({ id: tracks.id }).from(tracks).where(eq(tracks.id, id));
    if (!track) throw notFound('Titre');
    await db.insert(favorites).values({ userId: req.user.sub, trackId: id }).onConflictDoNothing();
    reply.code(204);
  });

  app.delete('/me/favorites/:id', async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    await db.delete(favorites).where(and(eq(favorites.userId, req.user.sub), eq(favorites.trackId, id)));
    reply.code(204);
  });

  // --- Historique -------------------------------------------------------------

  app.get('/me/history', async (req) => {
    const { limit } = parse(Pagination, req.query);
    const rows = await selectTracks()
      .innerJoin(playHistory, and(eq(playHistory.trackId, tracks.id), eq(playHistory.userId, req.user.sub)))
      .orderBy(desc(playHistory.playedAt))
      .limit(limit);
    return rows.map(toTrackDto);
  });
}
