import { sql } from 'drizzle-orm';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { albums, artists, tracks } from '../db/schema.js';
import { cachedSearch } from '../lib/search-cache.js';

/**
 * Catalogue externe Jamendo (musique libre, morceaux complets en MP3).
 * Les titres trouvés sont enregistrés dans le catalogue local (colonne `external_id`) : favoris, playlists
 * et historique fonctionnent ainsi comme pour les titres ingérés ; seule la lecture diffère (MP3 direct, sans HLS).
 */
const API = 'https://api.jamendo.com/v3.0';
const SEARCH_TTL_MS = 6 * 3600_000;
const SYNC_TTL_MS = 60 * 60_000;

export const jamendoEnabled = Boolean(env.JAMENDO_CLIENT_ID);

type JamendoTrack = {
  id: string;
  name: string;
  duration: number;
  position: number;
  artist_id: string;
  artist_name: string;
  album_id: string;
  album_name: string;
  album_image: string;
  image: string;
  releasedate: string;
  audio: string;
};

async function fetchTracks(params: Record<string, string>): Promise<JamendoTrack[]> {
  const url = new URL(`${API}/tracks/`);
  url.search = new URLSearchParams({
    client_id: env.JAMENDO_CLIENT_ID!,
    format: 'json',
    audioformat: 'mp32',
    imagesize: '500',
    ...params,
  }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Jamendo HTTP ${res.status}`);
  const body = (await res.json()) as { headers: { status: string; error_message?: string }; results: JamendoTrack[] };
  if (body.headers.status !== 'success') throw new Error(`Jamendo : ${body.headers.error_message ?? 'erreur inconnue'}`);
  return body.results;
}

const uniqueBy = <T>(items: T[], key: (item: T) => string) => [...new Map(items.map((i) => [key(i), i])).values()];
// Certains singles n'ont pas d'album : on leur crée un album portant le titre du morceau.
const albumKey = (t: JamendoTrack) => (t.album_id && t.album_id !== '0' ? `jamendo:${t.album_id}` : `jamendo:track-${t.id}`);

/** Enregistre (ou met à jour) les titres Jamendo avec leurs artistes et albums ; renvoie les ids locaux dans l'ordre. */
async function upsertTracks(items: JamendoTrack[]): Promise<string[]> {
  const playable = items.filter((t) => t.audio);
  if (playable.length === 0) return [];

  const artistRows = await db
    .insert(artists)
    .values(
      uniqueBy(playable, (t) => t.artist_id).map((t) => ({
        name: t.artist_name,
        slug: `jamendo-${t.artist_id}`,
        externalId: `jamendo:${t.artist_id}`,
      })),
    )
    .onConflictDoUpdate({ target: artists.externalId, set: { name: sql`excluded.name` } })
    .returning({ id: artists.id, externalId: artists.externalId });
  const artistId = new Map(artistRows.map((a) => [a.externalId, a.id]));

  // Clé de conflit (artiste, titre) : un single portant le nom d'un album existant rejoint cet album.
  const albumTitle = (t: JamendoTrack) => (albumKey(t).includes('track-') ? t.name : t.album_name || t.name);
  const albumRef = (t: JamendoTrack) => `${artistId.get(`jamendo:${t.artist_id}`)}|${albumTitle(t)}`;
  const albumRows = await db
    .insert(albums)
    .values(
      uniqueBy(playable, albumRef).map((t) => ({
        title: albumTitle(t),
        artistId: artistId.get(`jamendo:${t.artist_id}`)!,
        releaseYear: Number.parseInt(t.releasedate, 10) || null,
        coverKey: t.album_image || t.image || null,
        externalId: albumKey(t),
      })),
    )
    .onConflictDoUpdate({ target: [albums.artistId, albums.title], set: { coverKey: sql`excluded.cover_key` } })
    .returning({ id: albums.id, artistId: albums.artistId, title: albums.title });
  const albumId = new Map(albumRows.map((a) => [`${a.artistId}|${a.title}`, a.id]));

  const trackRows = await db
    .insert(tracks)
    .values(
      uniqueBy(playable, (t) => t.id).map((t) => ({
        title: t.name,
        albumId: albumId.get(albumRef(t))!,
        artistId: artistId.get(`jamendo:${t.artist_id}`)!,
        trackNumber: t.position || null,
        durationMs: Math.round(t.duration * 1000),
        status: 'ready' as const,
        sourceHash: `jamendo:${t.id}`,
        externalId: `jamendo:${t.id}`,
        audioUrl: t.audio,
      })),
    )
    .onConflictDoUpdate({ target: tracks.externalId, set: { title: sql`excluded.title`, audioUrl: sql`excluded.audio_url` } })
    .returning({ id: tracks.id, externalId: tracks.externalId });
  const trackId = new Map(trackRows.map((t) => [t.externalId, t.id]));

  return playable.map((t) => trackId.get(`jamendo:${t.id}`)).filter((id): id is string => Boolean(id));
}

/** Recherche sur Jamendo (mise en cache) ; renvoie les ids locaux des titres trouvés, par pertinence. */
export async function searchJamendo(q: string, { genre, limit }: { genre?: string; limit: number }): Promise<string[]> {
  if (!jamendoEnabled || (q.length < 2 && !genre)) return [];

  const params: Record<string, string> = { limit: String(limit) };
  if (q) params.search = q;
  else params.order = 'popularity_total';
  if (genre) params.tags = genre;

  return cachedSearch('jamendo', `${q}|${genre ?? ''}|${limit}`, SEARCH_TTL_MS, async () => upsertTracks(await fetchTracks(params)));
}

const lastSync = new Map<string, number>();

/**
 * Complète un album ou un artiste Jamendo (la recherche n'en ramène que quelques titres).
 * Sans effet pour le catalogue local ; les échecs sont journalisés sans bloquer la page.
 */
export async function syncFromJamendo(kind: 'album' | 'artist', externalId: string | null) {
  const id = externalId?.match(/^jamendo:(\d+)$/)?.[1];
  if (!jamendoEnabled || !id) return;

  const key = `${kind}:${id}`;
  const last = lastSync.get(key);
  if (last && Date.now() - last < SYNC_TTL_MS) return;
  lastSync.set(key, Date.now());
  try {
    await upsertTracks(await fetchTracks({ [`${kind}_id`]: id, limit: '50' }));
  } catch (error) {
    lastSync.delete(key);
    console.warn(`Synchronisation Jamendo (${key}) impossible :`, (error as Error).message);
  }
}
