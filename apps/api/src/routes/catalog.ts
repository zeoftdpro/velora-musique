import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/client.js';
import { albums, artists, genres, playHistory, tracks } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { IdParams, Pagination, parse } from '../lib/validation.js';
import { selectAlbums, selectTracks, toAlbumDto, toArtistDto, toTrackDto, visibleTo } from '../services/catalog.js';
import { syncFromJamendo } from '../services/jamendo.js';
import { findLyrics } from '../services/lyrics.js';
import { search, searchWeb } from '../services/search.js';

// `source=local` : uniquement le catalogue ingéré, sans les titres mis en cache depuis YouTube ou Jamendo.
const SourceFilter = Pagination.extend({ source: z.enum(['local', 'all']).default('all') });
const GenreFilter = SourceFilter.extend({ genre: z.string().max(80).optional() });
const WebSearchQuery = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(25).default(15),
});
const SearchQuery = z.object({
  q: z.string().trim().max(120).default(''),
  genre: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export default async function catalogRoutes(app: FastifyInstance) {
  app.get('/genres', async () => {
    return db
      .select({ id: genres.id, name: genres.name, slug: genres.slug, trackCount: count(tracks.id) })
      .from(genres)
      .leftJoin(tracks, sql`${tracks.genreId} = ${genres.id} and ${tracks.status} = 'ready' and ${tracks.ownerId} is null`)
      .groupBy(genres.id)
      .orderBy(asc(genres.name));
  });

  app.get('/albums', async (req) => {
    const { limit, offset, genre, source } = parse(GenreFilter, req.query);
    const rows = await selectAlbums(and(genre ? eq(genres.slug, genre) : undefined, source === 'local' ? isNull(albums.externalId) : undefined))
      .orderBy(desc(albums.createdAt))
      .limit(limit)
      .offset(offset);
    return rows.map(toAlbumDto);
  });

  // Connexion facultative : le propriétaire voit aussi les albums de ses musiques téléversées.
  app.get('/albums/:id', { preHandler: app.optionalAuth }, async (req) => {
    const { id } = parse(IdParams, req.params);
    const viewer = req.user?.sub;
    const [album] = await selectAlbums(eq(albums.id, id), viewer);
    if (!album) throw notFound('Album');
    await syncFromJamendo('album', album.externalId);
    const trackRows = await selectTracks(eq(tracks.albumId, id), viewer).orderBy(asc(tracks.discNumber), asc(tracks.trackNumber), asc(tracks.title));
    return { ...toAlbumDto(album), tracks: trackRows.map(toTrackDto) };
  });

  app.get('/artists', async (req) => {
    const { limit, offset, source } = parse(SourceFilter, req.query);
    const rows = await db
      .select()
      .from(artists)
      .where(and(isNull(artists.ownerId), source === 'local' ? isNull(artists.externalId) : undefined))
      .orderBy(asc(artists.name))
      .limit(limit)
      .offset(offset);
    return rows.map(toArtistDto);
  });

  app.get('/artists/:id', { preHandler: app.optionalAuth }, async (req) => {
    const { id } = parse(IdParams, req.params);
    const viewer = req.user?.sub;
    const [artist] = await db.select().from(artists).where(and(eq(artists.id, id), visibleTo(artists.ownerId, viewer)));
    if (!artist) throw notFound('Artiste');
    await syncFromJamendo('artist', artist.externalId);

    const [albumRows, topTracks] = await Promise.all([
      selectAlbums(eq(albums.artistId, id), viewer).orderBy(desc(albums.releaseYear)),
      // Titres les plus écoutés de l'artiste.
      selectTracks(eq(tracks.artistId, id), viewer)
        .leftJoin(playHistory, eq(playHistory.trackId, tracks.id))
        .groupBy(tracks.id, artists.id, albums.id, genres.id)
        .orderBy(desc(count(playHistory.id)), asc(tracks.title))
        .limit(10),
    ]);
    return { ...toArtistDto(artist), albums: albumRows.map(toAlbumDto), topTracks: topTracks.map(toTrackDto) };
  });

  app.get('/tracks', async (req) => {
    const { limit, offset, genre } = parse(GenreFilter, req.query);
    const rows = await selectTracks(genre ? eq(genres.slug, genre) : undefined)
      .orderBy(desc(tracks.createdAt))
      .limit(limit)
      .offset(offset);
    return rows.map(toTrackDto);
  });

  app.get('/tracks/:id', { preHandler: app.optionalAuth }, async (req) => {
    const { id } = parse(IdParams, req.params);
    const [row] = await selectTracks(eq(tracks.id, id), req.user?.sub);
    if (!row) throw notFound('Titre');
    return toTrackDto(row);
  });

  app.get('/tracks/:id/lyrics', { preHandler: app.optionalAuth }, async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const [row] = await selectTracks(eq(tracks.id, id), req.user?.sub);
    if (!row) throw notFound('Titre');
    const lyrics = await findLyrics({ title: row.title, artist: row.artistName, album: row.albumTitle, durationMs: row.durationMs });
    // Titres publics : mêmes paroles pour tout le monde, le CDN peut les garder.
    // Service indisponible : rien en cache, la prochaine demande réessaiera. Rien de trouvé : cache court.
    const found = Boolean(lyrics.synced || lyrics.plain);
    reply.header(
      'cache-control',
      lyrics.unavailable ? 'no-store' : row.ownerId ? 'private, max-age=3600' : found ? 'public, max-age=3600, s-maxage=86400' : 'public, max-age=600, s-maxage=3600',
    );
    return lyrics;
  });

  app.get('/search', { preHandler: app.optionalAuth }, async (req) => {
    const { q, genre, limit } = parse(SearchQuery, req.query);
    if (!q && !genre) return { tracks: [], albums: [], artists: [] };
    return search(q, { genre, limit, viewerId: req.user?.sub });
  });

  // Réservé aux utilisateurs connectés et limité : chaque requête non mise en cache consomme du quota YouTube.
  app.get(
    '/search/web',
    { preHandler: app.authenticate, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const { q, limit } = parse(WebSearchQuery, req.query);
      return searchWeb(q, limit);
    },
  );
}
