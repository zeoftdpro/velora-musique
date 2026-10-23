import { and, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { Meilisearch } from 'meilisearch';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { albums, artists, genres, tracks } from '../db/schema.js';
import { selectAlbums, selectTracks, toAlbumDto, toArtistDto, toTrackDto, visibleTo } from './catalog.js';
import { searchJamendo } from './jamendo.js';
import { searchYoutube, YoutubeQuotaError } from './youtube.js';

/**
 * Recherche plein texte. Meilisearch indexe titres, albums et artistes pour une autocomplétion
 * tolérante aux fautes ; si MEILI_HOST n'est pas configuré (ou injoignable), on retombe sur un ILIKE PostgreSQL.
 * Les résultats sont complétés par le catalogue Jamendo quand JAMENDO_CLIENT_ID est renseigné.
 */
export const meili = env.MEILI_HOST ? new Meilisearch({ host: env.MEILI_HOST, apiKey: env.MEILI_API_KEY }) : null;

const INDEX = { tracks: 'tracks', albums: 'albums', artists: 'artists' } as const;

export async function configureIndexes() {
  if (!meili) return;
  const tasks = await Promise.all([
    meili.index(INDEX.tracks).updateSettings({
      searchableAttributes: ['title', 'artistName', 'albumTitle'],
      filterableAttributes: ['genreSlug', 'artistId', 'albumId'],
    }),
    meili.index(INDEX.albums).updateSettings({
      searchableAttributes: ['title', 'artistName'],
      filterableAttributes: ['genreSlug', 'artistId'],
    }),
    meili.index(INDEX.artists).updateSettings({ searchableAttributes: ['name'] }),
  ]);
  await Promise.all(tasks.map((t) => meili!.tasks.waitForTask(t.taskUid)));
}

/** (Ré)indexe les titres donnés, ainsi que leurs albums et artistes. Sans argument : tout le catalogue. */
export async function indexCatalog(trackIds?: string[]) {
  if (!meili) return;
  const trackRows = await selectTracks(trackIds ? inArray(tracks.id, trackIds) : undefined);
  if (trackRows.length === 0) return;

  const albumIds = [...new Set(trackRows.map((t) => t.albumId))];
  const artistIds = [...new Set(trackRows.map((t) => t.artistId))];
  const albumRows = await selectAlbums(inArray(albums.id, albumIds));
  const artistRows = await db.select().from(artists).where(inArray(artists.id, artistIds));

  const tasks = await Promise.all([
    meili.index(INDEX.tracks).addDocuments(
      trackRows.map((t) => ({
        id: t.id,
        title: t.title,
        artistId: t.artistId,
        artistName: t.artistName,
        albumId: t.albumId,
        albumTitle: t.albumTitle,
        genreSlug: t.genreSlug,
      })),
      { primaryKey: 'id' },
    ),
    meili.index(INDEX.albums).addDocuments(
      albumRows.map((a) => ({ id: a.id, title: a.title, artistId: a.artistId, artistName: a.artistName, genreSlug: a.genreSlug })),
      { primaryKey: 'id' },
    ),
    meili.index(INDEX.artists).addDocuments(
      artistRows.map((a) => ({ id: a.id, name: a.name })),
      { primaryKey: 'id' },
    ),
  ]);
  await Promise.all(tasks.map((t) => meili!.tasks.waitForTask(t.taskUid)));
}

/** Échappe une valeur pour un filtre Meilisearch. */
const quote = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

type SearchOptions = { genre?: string; limit: number; /** Inclut aussi les musiques téléversées par ce compte. */ viewerId?: string };

export async function search(q: string, opts: SearchOptions) {
  const [local, jamendoIds] = await Promise.all([
    searchLocal(q, opts),
    // Le catalogue externe est un complément : en cas d'indisponibilité, on renvoie les résultats locaux.
    searchJamendo(q, opts).catch((error: Error) => {
      console.warn('Recherche Jamendo impossible :', error.message);
      return [] as string[];
    }),
  ]);

  // Les résultats sont réhydratés depuis PostgreSQL (source de vérité), dans l'ordre de pertinence.
  const byOrder = <T extends { id: string }>(rows: T[], order: string[]) =>
    order.map((id) => rows.find((r) => r.id === id)).filter((r): r is T => Boolean(r));
  const unique = (ids: string[]) => [...new Set(ids)];

  const trackIds = unique([...local.tracks, ...jamendoIds]);
  const trackRows = byOrder(trackIds.length ? await selectTracks(inArray(tracks.id, trackIds), opts.viewerId) : [], trackIds);

  // Les albums et artistes des titres Jamendo complètent ceux trouvés localement.
  const external = trackRows.filter((t) => jamendoIds.includes(t.id));
  const albumIds = unique([...local.albums, ...external.map((t) => t.albumId)]).slice(0, 10);
  const artistIds = unique([...local.artists, ...external.map((t) => t.artistId)]).slice(0, 10);
  const [albumRows, artistRows] = await Promise.all([
    albumIds.length ? selectAlbums(inArray(albums.id, albumIds), opts.viewerId) : [],
    artistIds.length ? db.select().from(artists).where(and(inArray(artists.id, artistIds), visibleTo(artists.ownerId, opts.viewerId))) : [],
  ]);

  return {
    tracks: trackRows.map(toTrackDto),
    albums: byOrder(albumRows, albumIds).map(toAlbumDto),
    // Le filtre de genre ne s'applique pas aux artistes.
    artists: opts.genre ? [] : byOrder(artistRows, artistIds).map(toArtistDto),
  };
}

/**
 * Recherche « partout » sur YouTube (via YouTube Music), séparée de la recherche principale : plus lente,
 * le client ne la déclenche qu'une fois la saisie stabilisée.
 */
export async function searchWeb(q: string, limit: number) {
  try {
    const ids = await searchYoutube(q, limit);
    const rows = ids.length ? await selectTracks(inArray(tracks.id, ids)) : [];
    const tracksInOrder = ids.map((id) => rows.find((r) => r.id === id)).filter((r) => r !== undefined);
    return { status: 'ok' as const, tracks: tracksInOrder.map(toTrackDto) };
  } catch (error) {
    if (error instanceof YoutubeQuotaError) return { status: 'quota' as const, tracks: [] };
    console.warn('Recherche YouTube impossible :', (error as Error).message);
    return { status: 'error' as const, tracks: [] };
  }
}

async function searchLocal(q: string, opts: SearchOptions) {
  if (!meili) return searchPostgres(q, opts);
  try {
    return await searchMeili(q, opts);
  } catch (error) {
    console.warn('Meilisearch indisponible, recherche PostgreSQL :', (error as Error).message);
    return searchPostgres(q, opts);
  }
}

async function searchMeili(q: string, { genre, limit }: { genre?: string; limit: number }) {
  const filter = genre ? `genreSlug = ${quote(genre)}` : undefined;
  const { results } = await meili!.multiSearch({
    queries: [
      { indexUid: INDEX.tracks, q, limit, filter, attributesToRetrieve: ['id'] },
      { indexUid: INDEX.albums, q, limit: Math.min(limit, 10), filter, attributesToRetrieve: ['id'] },
      { indexUid: INDEX.artists, q, limit: Math.min(limit, 10), attributesToRetrieve: ['id'] },
    ],
  });
  const idsOf = (i: number) => (results[i]?.hits ?? []).map((h) => String(h.id));
  return { tracks: idsOf(0), albums: idsOf(1), artists: idsOf(2) };
}

async function searchPostgres(q: string, { genre, limit, viewerId }: SearchOptions) {
  const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const genreFilter = genre ? sql`${genres.slug} = ${genre}` : undefined;

  const trackRows = await selectTracks(
    and(or(ilike(tracks.title, pattern), ilike(artists.name, pattern), ilike(albums.title, pattern)), genreFilter),
    viewerId,
  ).limit(limit);
  const albumRows = await selectAlbums(and(or(ilike(albums.title, pattern), ilike(artists.name, pattern)), genreFilter), viewerId).limit(
    Math.min(limit, 10),
  );
  const artistRows = await db
    .select({ id: artists.id })
    .from(artists)
    .where(and(ilike(artists.name, pattern), visibleTo(artists.ownerId, viewerId)))
    .limit(Math.min(limit, 10));

  return {
    tracks: trackRows.map((r) => r.id),
    albums: albumRows.map((r) => r.id),
    artists: artistRows.map((r) => r.id),
  };
}

export async function genreBySlug(slug: string) {
  const [g] = await db.select().from(genres).where(eq(genres.slug, slug));
  return g;
}
