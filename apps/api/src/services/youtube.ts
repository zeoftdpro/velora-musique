import { sql } from 'drizzle-orm';
import { env } from '../config.js';
import { db } from '../db/client.js';
import { albums, artists, tracks } from '../db/schema.js';
import { cachedSearch, isCached } from '../lib/search-cache.js';
import { slugify } from '../lib/slug.js';
import { searchYtMusic, type YtmTrack } from './ytmusic.js';

/**
 * Catalogue YouTube : recherche via la YouTube Data API v3, lecture via le lecteur YouTube officiel intégré
 * côté client (aucun flux audio n'est extrait ni relayé par l'API, conformément aux conditions de YouTube).
 * Les vidéos retenues sont enregistrées dans le catalogue local (`external_id = 'youtube:<videoId>'`) pour
 * fonctionner avec les favoris, playlists et l'historique.
 *
 * Quota : une recherche coûte ~101 unités sur 10 000 par jour ; les résultats sont donc mis en cache 24 h.
 */
const API = 'https://www.googleapis.com/youtube/v3';
const CACHE_TTL_MS = 24 * 3600_000;
const MIN_DURATION_S = 45;
const MAX_DURATION_S = 15 * 60;

export const youtubeEnabled = Boolean(env.YOUTUBE_API_KEY);
export class YoutubeQuotaError extends Error {}

let quotaBlockedUntil = 0;

/** Le quota YouTube est remis à zéro à minuit, heure du Pacifique. */
function nextQuotaReset() {
  const now = new Date();
  const la = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const elapsed = la.getHours() * 3600 + la.getMinutes() * 60 + la.getSeconds();
  return now.getTime() + (24 * 3600 - elapsed) * 1000;
}

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  if (Date.now() < quotaBlockedUntil) throw new YoutubeQuotaError('Quota YouTube épuisé pour aujourd’hui');
  const url = new URL(`${API}/${path}`);
  url.search = new URLSearchParams({ key: env.YOUTUBE_API_KEY!, ...params }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  const body = (await res.json()) as T & { error?: { message?: string; errors?: { reason?: string }[] } };
  if (!res.ok) {
    const reason = body.error?.errors?.[0]?.reason;
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
      quotaBlockedUntil = nextQuotaReset();
      throw new YoutubeQuotaError('Quota YouTube épuisé pour aujourd’hui');
    }
    throw new Error(`YouTube HTTP ${res.status} : ${body.error?.message ?? 'erreur inconnue'}`);
  }
  return body;
}

type Thumb = { url: string };
type Video = {
  id: string;
  snippet: {
    title: string;
    description: string;
    channelTitle: string;
    liveBroadcastContent: string;
    thumbnails: Partial<Record<'default' | 'medium' | 'high' | 'standard' | 'maxres', Thumb>>;
  };
  contentDetails: { duration: string };
  status: { embeddable: boolean; privacyStatus: string };
};

export type Parsed = { videoId: string; title: string; artist: string; album: string | null; year: number | null; cover: string | null; durationMs: number; score: number };

const decodeEntities = (s: string) =>
  s.replace(/&(amp|quot|#39|apos|lt|gt);/g, (_, e: string) => ({ amp: '&', quot: '"', '#39': "'", apos: "'", lt: '<', gt: '>' })[e]!);

function parseDuration(iso: string) {
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const [, d = '0', h = '0', min = '0', s = '0'] = m;
  return ((Number(d) * 24 + Number(h)) * 60 + Number(min)) * 60 + Number(s);
}

// Mentions parasites entre parenthèses/crochets : « (Official Video) », « [Clip Officiel] », « (Lyrics) »…
const BRACKET_NOISE =
  /\s*[([【][^)\]】]*\b(official|officiel(?:le)?|vid[eé]o|clip|audio|lyrics?|paroles|visuali[sz]er|hd|hq|4k|mv|m\/v)\b[^)\]】]*[)\]】]/gi;
export const cleanTitle = (t: string) =>
  t.replace(BRACKET_NOISE, '').replace(/\s+[|｜].*$/, '').replace(/\s{2,}/g, ' ').trim();

/**
 * Déduit artiste, titre et album d'une vidéo.
 * Les pistes « Topic » (générées par YouTube pour les labels) portent des métadonnées fiables dans la description :
 *   Provided to YouTube by <label>\n\n<titre> · <artiste> · <invité>\n\n<album>\n\n℗ …\n\nReleased on: AAAA-MM-JJ
 */
function parseMeta(video: Video): Pick<Parsed, 'title' | 'artist' | 'album' | 'year'> {
  const rawTitle = decodeEntities(video.snippet.title);
  const channel = video.snippet.channelTitle;
  const description = video.snippet.description ?? '';

  if (description.startsWith('Provided to YouTube by')) {
    const blocks = description.split(/\r?\n\s*\r?\n/).map((b) => b.trim());
    const [title, ...credited] = (blocks[1] ?? '').split(' · ').map((s) => s.trim());
    const year = Number(description.match(/Released on: (\d{4})/)?.[1]) || null;
    if (title && credited[0]) {
      const featured = credited.slice(1, 3);
      return {
        artist: credited[0],
        title: featured.length && !/feat/i.test(title) ? `${title} (feat. ${featured.join(', ')})` : title,
        album: blocks[2] && !blocks[2].startsWith('℗') ? blocks[2] : null,
        year,
      };
    }
  }

  const topic = channel.match(/^(.+) - Topic$/);
  if (topic) return { artist: topic[1]!.trim(), title: cleanTitle(rawTitle), album: null, year: null };

  const dashed = cleanTitle(rawTitle).match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dashed) {
    const [main, feat] = dashed[1]!.split(/\s+(?:ft\.?|feat\.?|featuring)\s+/i);
    const title = dashed[2]!.trim();
    return { artist: main!.trim(), title: feat ? `${title} (feat. ${feat.trim()})` : title, album: null, year: null };
  }
  const artist = channel.replace(/\s*VEVO$/i, '').replace(/\s*(official|officiel)$/i, '').trim();
  return { artist: artist || channel, title: cleanTitle(rawTitle), album: null, year: null };
}

// Versions rarement voulues, sauf si la recherche les demande explicitement.
const VARIANT_WORDS = ['live', 'cover', 'karaoke', 'remix', 'reaction', 'instrumental', 'instru', 'type beat', 'typebeat', 'flip', 'slowed', 'sped up', 'speed up', 'nightcore', '8d', 'lyrics', 'paroles', 'traduction', 'translation', 'tutorial'];

/** Classement : pistes officielles (Topic, VEVO, « official audio ») en tête, versions alternatives en queue. */
function score(video: Video, rank: number, query: string) {
  const title = video.snippet.title.toLowerCase();
  const channel = video.snippet.channelTitle;
  const q = query.toLowerCase();
  let s = -rank * 0.2;
  if (/ - Topic$/.test(channel) || video.snippet.description?.startsWith('Provided to YouTube by')) s += 4;
  if (/vevo$/i.test(channel)) s += 1.5;
  if (/official (audio|video|music video)|clip officiel|audio officiel/.test(title)) s += 1.5;
  if (VARIANT_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(title) && !q.includes(w))) s -= 4;
  return s;
}

function bestThumbnail(t: Video['snippet']['thumbnails']) {
  // Formats 16:9 sans bandes noires : une pochette carrée centrée (pistes Topic) reste nette une fois recadrée.
  return (t.maxres ?? t.medium ?? t.high ?? t.default)?.url ?? null;
}

async function fetchVideos(query: string, limit: number): Promise<Parsed[]> {
  const search = await get<{ items: { id: { videoId?: string } }[] }>('search', {
    part: 'id',
    type: 'video',
    q: query,
    maxResults: '25',
    videoCategoryId: '10',
    videoEmbeddable: 'true',
    videoSyndicated: 'true',
    regionCode: env.YOUTUBE_REGION_CODE,
  });
  const ids = search.items.map((i) => i.id.videoId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];

  const details = await get<{ items: Video[] }>('videos', { part: 'snippet,contentDetails,status', id: ids.join(',') });
  const byId = new Map(details.items.map((v) => [v.id, v]));

  const parsed = ids
    .map((id, rank) => ({ video: byId.get(id), rank }))
    .filter((x): x is { video: Video; rank: number } => {
      const v = x.video;
      if (!v || !v.status.embeddable || v.status.privacyStatus !== 'public' || v.snippet.liveBroadcastContent !== 'none') return false;
      const d = parseDuration(v.contentDetails.duration);
      return d >= MIN_DURATION_S && d <= MAX_DURATION_S;
    })
    .map(({ video, rank }) => ({
      videoId: video.id,
      ...parseMeta(video),
      cover: bestThumbnail(video.snippet.thumbnails),
      durationMs: parseDuration(video.contentDetails.duration) * 1000,
      score: score(video, rank, query),
    }))
    .sort((a, b) => b.score - a.score);

  // Une seule vidéo par morceau (clip, audio, paroles…) : on garde la mieux classée.
  return uniqueBy(parsed, (p) => `${slugify(p.artist)}|${slugify(p.title)}`).slice(0, limit);
}

/** Dédoublonne en gardant la première occurrence, c.-à-d. la mieux classée. */
function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Enregistre les vidéos (artistes, albums, titres) ; renvoie les ids locaux dans l'ordre de classement. */
export async function upsertVideos(items: Parsed[]): Promise<string[]> {
  if (items.length === 0) return [];
  const artistKey = (p: Parsed) => slugify(p.artist);

  const artistRows = await db
    .insert(artists)
    .values(uniqueBy(items, artistKey).map((p) => ({ name: p.artist, slug: `youtube-${artistKey(p)}`, externalId: `youtube:artist:${artistKey(p)}` })))
    .onConflictDoUpdate({ target: artists.externalId, set: { name: sql`${artists.name}` } })
    .returning({ id: artists.id, externalId: artists.externalId });
  const artistId = new Map(artistRows.map((a) => [a.externalId, a.id]));
  const artistOf = (p: Parsed) => artistId.get(`youtube:artist:${artistKey(p)}`)!;

  // Sans album connu, le titre forme un single ; plusieurs vidéos d'un même morceau partagent l'album.
  const albumTitle = (p: Parsed) => p.album ?? p.title;
  const albumRef = (p: Parsed) => `${artistOf(p)}|${albumTitle(p)}`;
  const albumRows = await db
    .insert(albums)
    .values(
      uniqueBy(items, albumRef).map((p) => ({
        title: albumTitle(p),
        artistId: artistOf(p),
        releaseYear: p.year,
        coverKey: p.cover,
        externalId: p.album ? `youtube:album:${artistKey(p)}:${slugify(p.album)}` : `youtube:${p.videoId}`,
      })),
    )
    .onConflictDoUpdate({
      target: [albums.artistId, albums.title],
      set: { coverKey: sql`coalesce(${albums.coverKey}, excluded.cover_key)`, releaseYear: sql`coalesce(${albums.releaseYear}, excluded.release_year)` },
    })
    .returning({ id: albums.id, artistId: albums.artistId, title: albums.title });
  const albumId = new Map(albumRows.map((a) => [`${a.artistId}|${a.title}`, a.id]));

  const trackRows = await db
    .insert(tracks)
    .values(
      uniqueBy(items, (p) => p.videoId).map((p) => ({
        title: p.title,
        albumId: albumId.get(albumRef(p))!,
        artistId: artistOf(p),
        durationMs: p.durationMs,
        status: 'ready' as const,
        sourceHash: `youtube:${p.videoId}`,
        externalId: `youtube:${p.videoId}`,
      })),
    )
    .onConflictDoUpdate({ target: tracks.externalId, set: { durationMs: sql`excluded.duration_ms` } })
    .returning({ id: tracks.id, externalId: tracks.externalId });
  const trackId = new Map(trackRows.map((t) => [t.externalId, t.id]));

  return items.map((p) => trackId.get(`youtube:${p.videoId}`)).filter((id): id is string => Boolean(id));
}

const SEARCH_PROVIDER = 'ytmusic';

/** Recherche YouTube (mise en cache 24 h) ; renvoie les ids locaux des titres trouvés. */
export async function searchYoutube(query: string, limit: number): Promise<string[]> {
  return cachedSearch(SEARCH_PROVIDER, `${query}|${limit}`, CACHE_TTL_MS, async () => {
    let found: Parsed[];
    try {
      found = await searchViaYtMusic(query, limit);
    } catch (error) {
      // YouTube Music indisponible (API non officielle) : repli sur la Data API, limitée par son quota.
      if (!youtubeEnabled) throw error;
      console.warn('Recherche YouTube Music impossible, repli sur la Data API :', (error as Error).message);
      found = await fetchVideos(query, limit);
    }
    return upsertEach(found);
  });
}

/** Comme upsertVideos, mais un titre refusé par la base n'empêche pas d'enregistrer les autres. */
async function upsertEach(items: Parsed[]) {
  try {
    return await upsertVideos(items);
  } catch {
    const ids: string[] = [];
    for (const item of items) ids.push(...(await upsertVideos([item]).catch(() => [])));
    return ids;
  }
}

/** Vrai si `searchYoutube(query, limit)` serait servie par le cache. */
export const isYoutubeSearchCached = (query: string, limit: number) => isCached(SEARCH_PROVIDER, `${query}|${limit}`, CACHE_TTL_MS);

/**
 * Recherche sur YouTube Music, sans quota : les titres officiels d'abord (albums, singles), puis les vidéos
 * (clips, lives, sons publiés par des chaînes), pour trouver aussi ce qui n'existe qu'en vidéo.
 */
async function searchViaYtMusic(query: string, limit: number): Promise<Parsed[]> {
  const [songs, videos] = await Promise.all([searchYtMusic(query, 'songs'), searchYtMusic(query, 'videos').catch(() => [])]);
  const playable = (t: YtmTrack) => t.durationMs >= MIN_DURATION_S * 1000 && t.durationMs <= MAX_DURATION_S * 1000;
  const candidates = [
    ...songs.filter(playable).map((t, rank) => ({ p: fromYtMusic(t), rank, penalty: 0 })),
    // Vidéos : derrière les pistes officielles à pertinence égale, et plus encore celles publiées par une chaîne
    // quelconque (reprises, « type beats »…) plutôt que par l'artiste.
    ...videos.filter(playable).map((t, rank) => ({ p: fromYtMusic(t), rank, penalty: t.artistLinked ? 4 : 6 })),
  ];
  // Pertinence : un titre absent des pistes officielles mais présent en clip (« Au DD ») doit remonter en tête.
  const ranked = candidates
    .map((c) => ({ ...c, relevance: relevance(query, c.p) - c.penalty - c.rank * 0.05 }))
    .sort((a, b) => b.relevance - a.relevance)
    .map((c) => c.p);
  const parsed = uniqueBy(ranked, (p) => `${slugify(p.artist)}|${slugify(p.title)}`).slice(0, limit + Math.ceil(limit / 2));
  // Vidéos dont le propriétaire interdit la lecture hors de YouTube : inutile de les proposer.
  const allowed = await embeddableIds(parsed.map((p) => p.videoId));
  return allowed ? parsed.filter((p) => allowed.has(p.videoId)) : parsed;
}

const words = (s: string) => slugify(s).split('-').filter(Boolean);

// Mentions des vidéos amateurs (instrus « type beat », parodies, traductions…), en plus des versions alternatives.
const AMATEUR_WORDS = ['free', 'beat', 'prod', 'parodie', 'parody', 'traducida', 'subtitulada', 'mashup', 'ai'];

/**
 * Pertinence d'un résultat : part des mots recherchés présents dans « artiste + titre », titre exact, artiste
 * demandé, et pénalité pour les versions non demandées (remix, paroles, instru…).
 */
function relevance(query: string, p: Parsed) {
  const asked = words(query);
  const found = new Set(words(`${p.artist} ${p.title}`));
  const coverage = asked.filter((w) => found.has(w)).length / (asked.length || 1);
  const titleWords = words(p.title);
  const exactTitle = titleWords.length > 0 && titleWords.every((w) => asked.includes(w));
  const artistWords = words(p.artist);
  const artistAsked = artistWords.length > 0 && artistWords.every((w) => asked.includes(w));
  const q = query.toLowerCase();
  // L'artiste compte aussi : une chaîne amateur se retrouve en artiste (« (FREE) PLK — Demain »).
  const text = `${p.artist} ${p.title}`.toLowerCase();
  const variant = [...VARIANT_WORDS, ...AMATEUR_WORDS].some((w) => new RegExp(`\\b${w}\\b`).test(text) && !q.includes(w));
  return coverage * 10 + (exactTitle ? 3 : 0) + (artistAsked ? 2 : 0) - (variant ? 8 : 0);
}

/** Résultat YouTube Music → titre du catalogue. Un clip s'intitule souvent « Artiste - Titre (Official Video) ». */
function fromYtMusic(t: YtmTrack): Parsed {
  let [artist = 'Artiste inconnu', ...featured] = t.artists;
  let title = cleanTitle(decodeEntities(t.title));
  const dashed = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dashed) {
    const named = dashed[1]!.split(/\s+(?:ft\.?|feat\.?|featuring|x|&)\s+/i)[0]!.trim();
    const sameArtist = slugify(named).includes(slugify(artist)) || slugify(artist).includes(slugify(named));
    // Vidéo publiée par une chaîne quelconque : l'artiste est celui du titre, pas la chaîne.
    if (sameArtist || !t.artistLinked) {
      if (!t.artistLinked) artist = named;
      title = dashed[2]!.trim();
    }
  }
  if (featured.length && !/\b(feat|ft|with|avec)\b/i.test(title)) title = `${title} (feat. ${featured.join(', ')})`;
  return {
    videoId: t.videoId,
    title,
    artist,
    album: t.album,
    year: null,
    // Miniature 4:3 des clips (bandes noires) : la version 16:9, recadrée proprement en carré par l'interface.
    cover: t.cover?.replace(/^https:\/\/i\.ytimg\.com\/vi\/([\w-]{11})\/.*$/, 'https://i.ytimg.com/vi/$1/mqdefault.jpg') ?? null,
    durationMs: t.durationMs,
    score: 0,
  };
}

export const videoIdOf = (externalId: string | null) => externalId?.match(/^youtube:([\w-]{11})$/)?.[1] ?? null;

/**
 * Parmi ces vidéos, celles que leur propriétaire autorise dans un lecteur intégré (1 unité de quota pour 50 vidéos).
 * Sans clé ou quota épuisé : null, on les suppose lisibles (le lecteur passe de toute façon les vidéos bloquées).
 */
export async function embeddableIds(ids: string[]): Promise<Set<string> | null> {
  if (!youtubeEnabled || ids.length === 0) return null;
  try {
    const found = new Set<string>();
    for (let i = 0; i < ids.length; i += 50) {
      const { items } = await get<{ items: { id: string; status: { embeddable: boolean; privacyStatus: string } }[] }>('videos', {
        part: 'status',
        id: ids.slice(i, i + 50).join(','),
      });
      for (const v of items) if (v.status.embeddable && v.status.privacyStatus !== 'private') found.add(v.id);
    }
    return found;
  } catch {
    return null;
  }
}
