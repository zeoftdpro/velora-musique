import { and, eq, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { albums, artists, genres, tracks } from '../db/schema.js';
import { assetUrl } from '../lib/storage.js';

/** Colonnes sélectionnées pour exposer un titre avec son artiste, son album et son genre. */
export const trackColumns = {
  id: tracks.id,
  title: tracks.title,
  durationMs: tracks.durationMs,
  trackNumber: tracks.trackNumber,
  discNumber: tracks.discNumber,
  artistId: artists.id,
  artistName: artists.name,
  albumId: albums.id,
  albumTitle: albums.title,
  albumCoverKey: albums.coverKey,
  genreName: genres.name,
  genreSlug: genres.slug,
  externalId: tracks.externalId,
};

type TrackRow = {
  id: string;
  title: string;
  durationMs: number;
  trackNumber: number | null;
  discNumber: number;
  artistId: string;
  artistName: string;
  albumId: string;
  albumTitle: string;
  albumCoverKey: string | null;
  genreName: string | null;
  genreSlug: string | null;
  externalId: string | null;
};

const sourceOf = (externalId: string | null) =>
  externalId?.startsWith('youtube:') ? ('youtube' as const) : externalId?.startsWith('jamendo:') ? ('jamendo' as const) : ('local' as const);

export function toTrackDto(row: TrackRow) {
  return {
    id: row.id,
    title: row.title,
    durationMs: row.durationMs,
    trackNumber: row.trackNumber,
    discNumber: row.discNumber,
    artist: { id: row.artistId, name: row.artistName },
    album: { id: row.albumId, title: row.albumTitle, coverUrl: assetUrl(row.albumCoverKey) },
    genre: row.genreName ? { name: row.genreName, slug: row.genreSlug } : null,
    source: sourceOf(row.externalId),
  };
}
export type TrackDto = ReturnType<typeof toTrackDto>;

/** Requête de base : titres prêts à la lecture, avec jointures catalogue. */
export function selectTracks(where?: SQL) {
  return db
    .select(trackColumns)
    .from(tracks)
    .innerJoin(artists, eq(artists.id, tracks.artistId))
    .innerJoin(albums, eq(albums.id, tracks.albumId))
    .leftJoin(genres, eq(genres.id, tracks.genreId))
    .where(where ? and(eq(tracks.status, 'ready'), where) : eq(tracks.status, 'ready'))
    .$dynamic();
}

export const albumColumns = {
  id: albums.id,
  title: albums.title,
  releaseYear: albums.releaseYear,
  coverKey: albums.coverKey,
  artistId: artists.id,
  artistName: artists.name,
  genreName: genres.name,
  genreSlug: genres.slug,
  externalId: albums.externalId,
};

type AlbumRow = {
  id: string;
  title: string;
  releaseYear: number | null;
  coverKey: string | null;
  artistId: string;
  artistName: string;
  genreName: string | null;
  genreSlug: string | null;
};

export function toAlbumDto(row: AlbumRow) {
  return {
    id: row.id,
    title: row.title,
    releaseYear: row.releaseYear,
    coverUrl: assetUrl(row.coverKey),
    artist: { id: row.artistId, name: row.artistName },
    genre: row.genreName ? { name: row.genreName, slug: row.genreSlug } : null,
  };
}

export function selectAlbums(where?: SQL) {
  const q = db
    .select(albumColumns)
    .from(albums)
    .innerJoin(artists, eq(artists.id, albums.artistId))
    .leftJoin(genres, eq(genres.id, albums.genreId));
  return (where ? q.where(where) : q).$dynamic();
}

export function toArtistDto(row: { id: string; name: string; imageKey: string | null; bio?: string | null }) {
  return { id: row.id, name: row.name, bio: row.bio ?? null, imageUrl: assetUrl(row.imageKey) };
}
