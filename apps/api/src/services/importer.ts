import { HttpError } from '../lib/errors.js';
import { cachedSearch } from '../lib/search-cache.js';
import { cleanTitle, embeddableIds, upsertVideos, type Parsed } from './youtube.js';
import { browsePlaylist, searchYtMusic, type YtmTrack } from './ytmusic.js';

/**
 * Import de playlists, albums et titres depuis un lien Spotify, Deezer, Apple Music ou YouTube.
 * 1. `readSource` lit la liste des morceaux sur la page publique du service (aucun compte requis).
 * 2. `matchTracks` retrouve chaque morceau sur YouTube Music et l'ajoute au catalogue (lecture par le lecteur
 *    YouTube intégré, comme les autres titres YouTube). Les correspondances sont mises en cache.
 */
export const MAX_IMPORT_TRACKS = 500;
const MATCH_CACHE_TTL_MS = 7 * 24 * 3600_000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export type Provider = 'spotify' | 'deezer' | 'apple' | 'youtube';
export type SourceTrack = { title: string; artists: string[]; album: string | null; durationMs: number; coverUrl: string | null; videoId?: string };
export type ImportSource = { provider: Provider; kind: 'playlist' | 'album' | 'track'; name: string; coverUrl: string | null; tracks: SourceTrack[]; truncated: boolean };

const unsupported = () =>
  new HttpError(422, 'Lien non reconnu : collez le lien d’une playlist, d’un album ou d’un titre Spotify, Deezer, Apple Music ou YouTube', 'UNSUPPORTED_URL');
const unreadable = (service: string) =>
  new HttpError(422, `Impossible de lire ce lien ${service} : vérifiez qu’il est public`, 'SOURCE_UNREADABLE');

async function fetchText(url: string) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, 'accept-language': 'fr-FR,fr;q=0.9' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { text: await res.text(), url: res.url };
}

/** Liens courts (spotify.link, link.deezer.com, deezer.page.link…) : on suit la redirection. */
async function expand(url: URL) {
  if (!/^(spotify\.link|link\.deezer\.com|deezer\.page\.link)$/.test(url.hostname)) return url;
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(10_000) });
  const final = new URL(res.url);
  // Deezer renvoie parfois vers une page intermédiaire qui contient le vrai lien.
  if (/deezer/.test(final.hostname) && !/\/(playlist|album|track)\//.test(final.pathname)) {
    const link = (await res.text()).match(/https:\/\/www\.deezer\.com\/[a-z]{2}\/(playlist|album|track)\/\d+/)?.[0];
    if (link) return new URL(link);
  }
  return final;
}

export async function readSource(rawUrl: string): Promise<ImportSource> {
  let url: URL;
  try {
    url = await expand(new URL(rawUrl.trim()));
  } catch {
    throw unsupported();
  }
  const host = url.hostname.replace(/^(www|m|open|play)\./, '');

  if (host === 'spotify.com') {
    const m = url.pathname.match(/\/(playlist|album|track)\/([A-Za-z0-9]{22})/);
    if (!m) throw unsupported();
    return spotify(m[1] as 'playlist' | 'album' | 'track', m[2]!);
  }
  if (host === 'deezer.com') {
    const m = url.pathname.match(/\/(playlist|album|track)\/(\d+)/);
    if (!m) throw unsupported();
    return deezer(m[1] as 'playlist' | 'album' | 'track', m[2]!);
  }
  if (host === 'music.apple.com') {
    if (!/\/(playlist|album)\//.test(url.pathname)) throw unsupported();
    return apple(url);
  }
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const list = url.searchParams.get('list');
    if (!list || !/^[\w-]{10,}$/.test(list)) {
      throw new HttpError(422, 'Pour YouTube, collez le lien d’une playlist (il contient « list= »)', 'UNSUPPORTED_URL');
    }
    return youtube(list);
  }
  throw unsupported();
}

// ---------- Spotify : le lecteur intégré (« embed ») publie la liste des titres sans authentification. ----------

type SpotifyImage = { url: string; maxWidth?: number; width?: number };
type SpotifyEntity = {
  type: string;
  name: string;
  subtitle?: string;
  duration?: number;
  artists?: { name: string }[];
  coverArt?: { sources?: SpotifyImage[] };
  visualIdentity?: { image?: SpotifyImage[] };
  trackList?: { title: string; subtitle: string; duration: number }[];
};

const largest = (images: SpotifyImage[] | undefined) =>
  [...(images ?? [])].sort((a, b) => (b.maxWidth ?? b.width ?? 0) - (a.maxWidth ?? a.width ?? 0))[0]?.url ?? null;

async function spotify(kind: 'playlist' | 'album' | 'track', id: string): Promise<ImportSource> {
  let entity: SpotifyEntity;
  try {
    const { text } = await fetchText(`https://open.spotify.com/embed/${kind}/${id}`);
    const json = text.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s)?.[1];
    entity = JSON.parse(json!).props.pageProps.state.data.entity;
    if (!entity?.name) throw new Error('vide');
  } catch {
    throw unreadable('Spotify');
  }
  const coverUrl = largest(entity.coverArt?.sources) ?? largest(entity.visualIdentity?.image);
  const splitArtists = (s: string) => s.split(/,\s*/).map((a) => a.trim()).filter(Boolean);

  if (kind === 'track') {
    return {
      provider: 'spotify', kind, name: entity.name, coverUrl, truncated: false,
      tracks: [{ title: entity.name, artists: entity.artists?.map((a) => a.name) ?? [], album: null, durationMs: entity.duration ?? 0, coverUrl }],
    };
  }
  const list = entity.trackList ?? [];
  return {
    provider: 'spotify',
    kind,
    name: entity.name,
    coverUrl,
    // Le lecteur intégré de Spotify ne présente que les 100 premiers titres.
    truncated: list.length >= 100,
    tracks: list.map((t) => ({
      title: t.title,
      artists: splitArtists(t.subtitle),
      album: kind === 'album' ? entity.name : null,
      durationMs: t.duration,
      coverUrl: kind === 'album' ? coverUrl : null,
    })),
  };
}

// ---------- Deezer : API publique, sans clé. ----------

type DeezerTrack = { title: string; duration: number; artist: { name: string }; album?: { title: string; cover_xl?: string } };

async function deezerGet<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.deezer.com${path}`, { signal: AbortSignal.timeout(10_000) });
  const body = (await res.json()) as T & { error?: unknown };
  if (!res.ok || body.error) throw unreadable('Deezer');
  return body;
}

async function deezer(kind: 'playlist' | 'album' | 'track', id: string): Promise<ImportSource> {
  const toSource = (t: DeezerTrack, album?: { title: string; cover: string | null }): SourceTrack => ({
    title: t.title,
    artists: [t.artist.name],
    album: album?.title ?? t.album?.title ?? null,
    durationMs: t.duration * 1000,
    coverUrl: album?.cover ?? t.album?.cover_xl ?? null,
  });

  if (kind === 'track') {
    const t = await deezerGet<DeezerTrack>(`/track/${id}`);
    return { provider: 'deezer', kind, name: t.title, coverUrl: t.album?.cover_xl ?? null, truncated: false, tracks: [toSource(t)] };
  }
  if (kind === 'album') {
    const a = await deezerGet<{ title: string; cover_xl: string; tracks: { data: DeezerTrack[] } }>(`/album/${id}`);
    const album = { title: a.title, cover: a.cover_xl };
    return { provider: 'deezer', kind, name: a.title, coverUrl: a.cover_xl, truncated: false, tracks: a.tracks.data.map((t) => toSource(t, album)) };
  }
  const p = await deezerGet<{ title: string; picture_xl: string; nb_tracks: number }>(`/playlist/${id}`);
  const tracks: SourceTrack[] = [];
  while (tracks.length < Math.min(p.nb_tracks, MAX_IMPORT_TRACKS)) {
    const page = await deezerGet<{ data: DeezerTrack[] }>(`/playlist/${id}/tracks?index=${tracks.length}&limit=100`);
    if (page.data.length === 0) break;
    tracks.push(...page.data.map((t) => toSource(t)));
  }
  return { provider: 'deezer', kind, name: p.title, coverUrl: p.picture_xl, truncated: p.nb_tracks > MAX_IMPORT_TRACKS, tracks: tracks.slice(0, MAX_IMPORT_TRACKS) };
}

// ---------- Apple Music : la page publique embarque ses données (JSON « serialized-server-data »). ----------

type AppleArtwork = { dictionary?: { url?: string } };
type AppleItem = { title?: string; duration?: number; artwork?: AppleArtwork; subtitleLinks?: { title: string }[]; artistName?: string };

const appleCover = (art: AppleArtwork | undefined) => art?.dictionary?.url?.replace('{w}x{h}', '600x600').replace('{f}', 'jpg') ?? null;

async function apple(url: URL): Promise<ImportSource> {
  let sections: { itemKind: string; items: AppleItem[] }[];
  try {
    const { text } = await fetchText(url.toString());
    const json = text.match(/<script type="application\/json" id="serialized-server-data">(.+?)<\/script>/s)?.[1];
    const parsed = JSON.parse(json!);
    sections = (parsed.data?.[0] ?? parsed[0]).data.sections;
  } catch {
    throw unreadable('Apple Music');
  }
  const header = sections.find((s) => s.itemKind === 'containerDetailHeaderLockup')?.items[0];
  const items = sections.filter((s) => s.itemKind === 'trackLockup').flatMap((s) => s.items);
  if (!header?.title || items.length === 0) throw unreadable('Apple Music');

  const isAlbum = url.pathname.includes('/album/');
  const coverUrl = appleCover(header.artwork);
  const headerArtists = header.subtitleLinks?.map((l) => l.title) ?? [];
  let tracks: SourceTrack[] = items.map((t) => ({
    title: t.title ?? '',
    artists: t.subtitleLinks?.map((l) => l.title) ?? (t.artistName ? [t.artistName] : headerArtists),
    album: isAlbum ? header.title! : null,
    durationMs: t.duration ?? 0,
    coverUrl: appleCover(t.artwork) ?? (isAlbum ? coverUrl : null),
  }));
  // Lien vers un titre précis d'un album (« ?i=<id> ») : ce seul titre.
  const single = isAlbum && url.searchParams.get('i');
  if (single) {
    const index = (items as { contentDescriptor?: { identifiers?: { storeAdamID?: string } } }[])
      .findIndex((t) => t.contentDescriptor?.identifiers?.storeAdamID === single);
    if (index >= 0) tracks = [tracks[index]!];
  }
  return {
    provider: 'apple',
    kind: single && tracks.length === 1 ? 'track' : isAlbum ? 'album' : 'playlist',
    name: single && tracks.length === 1 ? tracks[0]!.title : header.title,
    coverUrl,
    truncated: false,
    tracks: tracks.filter((t) => t.title).slice(0, MAX_IMPORT_TRACKS),
  };
}

// ---------- YouTube : les vidéos sont déjà connues, pas besoin de les chercher. ----------

async function youtube(list: string): Promise<ImportSource> {
  let playlist: Awaited<ReturnType<typeof browsePlaylist>>;
  try {
    playlist = await browsePlaylist(list, MAX_IMPORT_TRACKS + 1);
  } catch {
    throw unreadable('YouTube');
  }
  if (playlist.tracks.length === 0) throw unreadable('YouTube');
  return {
    provider: 'youtube',
    kind: 'playlist',
    name: playlist.name ?? 'Playlist YouTube',
    coverUrl: playlist.cover,
    truncated: playlist.tracks.length > MAX_IMPORT_TRACKS,
    tracks: playlist.tracks.slice(0, MAX_IMPORT_TRACKS).map((t) => ({
      title: t.title, artists: t.artists, album: t.album, durationMs: t.durationMs, coverUrl: t.cover, videoId: t.videoId,
    })),
  };
}

// ---------- Correspondance avec YouTube Music ----------

/** Forme comparable d'un titre ou d'un nom : sans accents, ponctuation, « feat. », mentions de version. */
function normalize(s: string) {
  return s
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[([](?:feat|ft|with|avec)\.?\s[^)\]]*[)\]]/g, ' ')
    .replace(/\s(?:feat|ft)\.?\s.*$/, ' ')
    .replace(/\s-\s.*\b(remaster(?:ed)?|version|edit|mono|stereo|mix)\b.*$/, ' ')
    .replace(/[([][^)\]]*\b(remaster(?:ed)?|version|edit|mono|stereo)\b[^)\]]*[)\]]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
const tokens = (s: string) => new Set(normalize(s).split(' ').filter(Boolean));

function similarity(a: string, b: string) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  const shared = [...ta].filter((t) => tb.has(t)).length;
  return shared / Math.max(ta.size, tb.size);
}

// Versions qu'on ne veut pas à la place de l'originale (sauf si l'originale en est une).
const VARIANTS = ['live', 'remix', 'acoustic', 'acoustique', 'cover', 'karaoke', 'instrumental', 'sped', 'slowed', 'nightcore', 'reverb', '8d'];

function score(source: SourceTrack, candidate: YtmTrack, rank: number) {
  const titleSim = similarity(source.title, candidate.title);
  const sourceArtists = source.artists.map(normalize).filter(Boolean);
  const candidateArtists = normalize(candidate.artists.join(' '));
  const artistSim = sourceArtists.length === 0 ? 0.5
    : sourceArtists.some((a) => candidateArtists.includes(a) || a.includes(candidateArtists)) ? 1
    : Math.max(...source.artists.map((a) => similarity(a, candidate.artists.join(' '))));
  const sourceWords = tokens(source.title);
  const candidateWords = tokens(candidate.title);
  const variant = VARIANTS.some((w) => candidateWords.has(w) && !sourceWords.has(w));

  let s = titleSim * 3 + artistSim * 2 - rank * 0.1;
  if (source.durationMs && candidate.durationMs) {
    const diff = Math.abs(source.durationMs - candidate.durationMs) / 1000;
    s += diff <= 3 ? 1 : diff <= 8 ? 0.5 : diff <= 20 ? 0 : -1.5;
  }
  if (variant) s -= 2.5;
  const acceptable = titleSim >= 0.5 && artistSim >= 0.5 && s >= 3.5;
  return { s, acceptable };
}

/** Meilleurs candidats YouTube Music pour un morceau, du plus probable au moins probable. */
async function candidates(track: SourceTrack, songsOnly: boolean): Promise<YtmTrack[]> {
  const query = `${track.title.replace(/\s[-–]\s.*$/, '')} ${track.artists.slice(0, 2).join(' ')}`.trim();
  return (await searchYtMusic(query, songsOnly ? 'songs' : 'all'))
    .map((c, i) => ({ c, ...score(track, c, i) }))
    .filter((x) => x.acceptable)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c)
    .slice(0, 3);
}

/** Meilleure version lisible dans le lecteur intégré : piste officielle, sinon clip (certains labels bloquent l'une ou l'autre). */
async function bestMatch(track: SourceTrack): Promise<YtmTrack | null> {
  for (const songsOnly of [true, false]) {
    const found = await candidates(track, songsOnly);
    if (found.length === 0) continue;
    const allowed = await embeddableIds(found.map((c) => c.videoId));
    const best = found.find((c) => !allowed || allowed.has(c.videoId));
    if (best) return best;
  }
  return null;
}

// Miniature 4:3 des clips (bandes noires) : la version 16:9, recadrée proprement en carré par l'interface.
const cleanCover = (url: string | null) => url?.replace(/^https:\/\/i\.ytimg\.com\/vi\/([\w-]{11})\/.*$/, 'https://i.ytimg.com/vi/$1/mqdefault.jpg') ?? null;

function toParsed(t: YtmTrack, source?: SourceTrack): Parsed {
  const [artist = 'Artiste inconnu', ...featured] = t.artists;
  // Le titre du service d'origine est le plus propre (YouTube Music traduit « feat. » en « avec »…).
  const title = source?.title
    ?? (featured.length && !/\b(feat|ft|with|avec)\b/i.test(t.title) ? `${t.title} (feat. ${featured.join(', ')})` : t.title);
  return {
    videoId: t.videoId,
    title,
    artist,
    album: t.album ?? source?.album ?? null,
    year: null,
    // Pochette du service d'origine si elle est connue : souvent plus nette que la miniature YouTube.
    cover: source?.coverUrl ?? cleanCover(t.cover),
    durationMs: t.durationMs || source?.durationMs || 0,
    score: 0,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!);
      }
    }),
  );
  return results;
}

const cacheKey = (t: SourceTrack) => `${t.artists[0] ?? ''}|${t.title}|${Math.round(t.durationMs / 1000)}`;

/** Retrouve et enregistre les morceaux ; renvoie l'id local de chacun (null si introuvable), dans l'ordre. */
export async function matchTracks(items: SourceTrack[]): Promise<(string | null)[]> {
  // Vidéos déjà identifiées (playlist YouTube) : enregistrement direct.
  const direct = items.filter((t) => t.videoId);
  const directIds = new Map<string, string>();
  if (direct.length) {
    const parsed = direct.map((t) =>
      toParsed({ videoId: t.videoId!, title: cleanTitle(t.title), artists: t.artists, album: t.album, durationMs: t.durationMs, cover: t.coverUrl }),
    );
    try {
      // Un id par élément, dans l'ordre (une vidéo présente deux fois reçoit deux fois le même id).
      const ids = await upsertVideos(parsed);
      parsed.forEach((p, i) => ids[i] && directIds.set(p.videoId, ids[i]!));
    } catch {
      // Un élément refusé ne doit pas faire échouer tout le lot : on les reprend un par un.
      for (const p of parsed) {
        const [id] = await upsertVideos([p]).catch(() => []);
        if (id) directIds.set(p.videoId, id);
      }
    }
  }

  return mapLimit(items, 4, async (track) => {
    if (track.videoId) return directIds.get(track.videoId) ?? null;
    try {
      const [id] = await cachedSearch('ytmusic-match', cacheKey(track), MATCH_CACHE_TTL_MS, async () => {
        const best = await bestMatch(track);
        return best ? upsertVideos([toParsed(best, track)]) : [];
      });
      return id ?? null;
    } catch {
      return null;
    }
  });
}
