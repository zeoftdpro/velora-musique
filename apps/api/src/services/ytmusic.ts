import { env } from '../config.js';

/**
 * Client minimal de l'API interne de YouTube Music (« Innertube »), celle qu'utilise music.youtube.com.
 * Contrairement à la YouTube Data API, elle n'a pas de quota : elle sert à retrouver les morceaux d'une playlist
 * importée (Spotify, Deezer…) et à lire les playlists YouTube. La lecture passe toujours par le lecteur YouTube
 * officiel intégré : seuls des identifiants de vidéo et des métadonnées sont récupérés ici.
 */
const ORIGIN = 'https://music.youtube.com';
const CLIENT = { clientName: 'WEB_REMIX', clientVersion: '1.20241023.01.00', hl: 'fr', gl: env.YOUTUBE_REGION_CODE };
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
// Filtres de la recherche : « Titres » (pistes officielles des albums et singles) et « Vidéos » (clips, lives, chaînes).
const FILTERS = { songs: 'EgWKAQIIAWoQEAMQBBAJEAoQBRAREBAQFQ%3D%3D', videos: 'EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D' } as const;
export type SearchFilter = keyof typeof FILTERS | 'all';

export type YtmTrack = {
  videoId: string;
  title: string;
  artists: string[];
  album: string | null;
  durationMs: number;
  cover: string | null;
  /** Artistes reliés à leur page YouTube Music ; sinon, c'est le nom de la chaîne qui a publié la vidéo. */
  artistLinked?: boolean;
};

async function call(endpoint: 'search' | 'browse', body: Record<string, unknown>) {
  const res = await fetch(`${ORIGIN}/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT, origin: ORIGIN, referer: `${ORIGIN}/` },
    body: JSON.stringify({ context: { client: CLIENT }, ...body }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`YouTube Music HTTP ${res.status}`);
  return res.json() as Promise<unknown>;
}

type Run = { text: string; navigationEndpoint?: { browseEndpoint?: { browseEndpointContextSupportedConfigs?: { browseEndpointContextMusicConfig?: { pageType?: string } } } } };
type ColumnText = { text?: { runs?: Run[] } };
type ListItem = {
  flexColumns?: { musicResponsiveListItemFlexColumnRenderer: ColumnText }[];
  fixedColumns?: { musicResponsiveListItemFixedColumnRenderer: ColumnText }[];
  playlistItemData?: { videoId?: string };
  overlay?: { musicItemThumbnailOverlayRenderer?: { content?: { musicPlayButtonRenderer?: { playNavigationEndpoint?: { watchEndpoint?: { videoId?: string } } } } } };
  thumbnail?: { musicThumbnailRenderer?: { thumbnail?: { thumbnails?: { url: string; width: number }[] } } };
};

const DURATION = /^(\d+:)?\d{1,2}:\d{2}$/;
const toMs = (d: string) => d.split(':').reduce((s, part) => s * 60 + Number(part), 0) * 1000;
const pageType = (run: Run) => run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;

/** Pochette en grand : les miniatures carrées de YouTube Music se redimensionnent par leur suffixe d'URL. */
function bigCover(item: ListItem) {
  const thumbs = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? [];
  const url = thumbs.at(-1)?.url;
  if (!url) return null;
  return /googleusercontent\.com/.test(url) ? url.replace(/=w\d+-h\d+/, '=w544-h544') : url;
}

/**
 * Une ligne de résultat (recherche ou playlist). Colonnes : titre, puis « artistes • album • durée » dans la
 * recherche, ou artistes / album / durée dans des colonnes séparées pour une playlist.
 */
function parseItem(item: ListItem): YtmTrack | null {
  const videoId = item.playlistItemData?.videoId ?? item.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
  const columns = item.flexColumns?.map((c) => c.musicResponsiveListItemFlexColumnRenderer.text?.runs ?? []) ?? [];
  const title = columns[0]?.map((r) => r.text).join('').trim();
  if (!videoId || !title) return null;

  const runs = [...columns.slice(1).flat(), ...(item.fixedColumns?.flatMap((c) => c.musicResponsiveListItemFixedColumnRenderer.text?.runs ?? []) ?? [])];
  const artists = runs.filter((r) => pageType(r) === 'MUSIC_PAGE_TYPE_ARTIST').map((r) => r.text.trim());
  const album = runs.find((r) => pageType(r) === 'MUSIC_PAGE_TYPE_ALBUM')?.text.trim() ?? null;
  const duration = runs.map((r) => r.text.trim()).find((t) => DURATION.test(t));
  // Vidéo d'une chaîne sans page artiste : le premier segment du sous-titre est le nom de la chaîne.
  const fallbackArtist = columns[1]?.map((r) => r.text).join('').split(' • ')[0]?.trim();
  return {
    videoId,
    title,
    artists: artists.length ? artists : fallbackArtist ? [fallbackArtist] : [],
    artistLinked: artists.length > 0,
    album,
    durationMs: duration ? toMs(duration) : 0,
    cover: bigCover(item),
  };
}

/** Parcourt la réponse et renvoie toutes les lignes de morceaux, dans l'ordre. */
function collectItems(node: unknown, out: ListItem[] = []): ListItem[] {
  if (Array.isArray(node)) {
    for (const child of node) collectItems(child, out);
  } else if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (record.musicResponsiveListItemRenderer) out.push(record.musicResponsiveListItemRenderer as ListItem);
    else for (const value of Object.values(record)) collectItems(value, out);
  }
  return out;
}

/** Première valeur portant cette clé, en profondeur. */
function findKey(node: unknown, key: string): unknown {
  if (!node || typeof node !== 'object') return undefined;
  if (!Array.isArray(node) && key in node) return (node as Record<string, unknown>)[key];
  for (const value of Object.values(node)) {
    const found = findKey(value, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findContinuation(node: unknown): string | null {
  const text = JSON.stringify(node);
  return text.match(/"continuationCommand":\{"token":"([^"]+)"/)?.[1] ?? text.match(/"nextContinuationData":\{"continuation":"([^"]+)"/)?.[1] ?? null;
}

/** Recherche YouTube Music : titres officiels (par défaut), vidéos, ou tout. */
export async function searchYtMusic(query: string, filter: SearchFilter = 'songs'): Promise<YtmTrack[]> {
  const data = await call('search', { query, ...(filter !== 'all' ? { params: FILTERS[filter] } : {}) });
  return collectItems(data).map(parseItem).filter((t): t is YtmTrack => t !== null);
}

/** Contenu d'une playlist YouTube / YouTube Music (jusqu'à `limit` titres). */
export async function browsePlaylist(playlistId: string, limit: number) {
  const first = await call('browse', { browseId: `VL${playlistId}` });
  const header = findKey(first, 'musicResponsiveHeaderRenderer') as
    | { title?: { runs?: Run[] }; thumbnail?: ListItem['thumbnail'] }
    | undefined;
  const name = header?.title?.runs?.map((r) => r.text).join('') || null;
  const cover = header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at(-1)?.url ?? null;

  const tracks = collectItems(first).map(parseItem).filter((t): t is YtmTrack => t !== null);
  let token = findContinuation(first);
  for (let page = 0; token && tracks.length < limit && page < 10; page++) {
    const next = await call('browse', { continuation: token });
    tracks.push(...collectItems(next).map(parseItem).filter((t): t is YtmTrack => t !== null));
    token = findContinuation(next);
  }
  return { name, cover, tracks: tracks.slice(0, limit) };
}
