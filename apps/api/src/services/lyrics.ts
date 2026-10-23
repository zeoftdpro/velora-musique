/**
 * Paroles via LRCLIB (base libre et gratuite, sans clé) : synchronisées à la ligne quand elles existent,
 * sinon le texte brut. Les réponses sont gardées en mémoire, le CDN prend le relais pour les titres publics.
 */
const API = 'https://lrclib.net/api';
const HEADERS = { 'user-agent': 'Velora (https://velora-musique.vercel.app)' };
const CACHE_MAX = 500;

export type Lyrics = { synced: { time: number; text: string }[] | null; plain: string | null };
type LrclibRecord = { duration: number; instrumental: boolean; plainLyrics: string | null; syncedLyrics: string | null };

const cache = new Map<string, Lyrics>();

/** « [01:23.45] texte » → { time: 83450, text } ; les lignes vides (pauses) sont gardées. */
function parseLrc(lrc: string) {
  const lines: { time: number; text: string }[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (stamps.length === 0) continue;
    const text = raw.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '').trim();
    for (const s of stamps) lines.push({ time: Math.round((Number(s[1]) * 60 + Number(s[2])) * 1000), text });
  }
  return lines.sort((a, b) => a.time - b.time);
}

// Mentions qui empêchent LRCLIB de reconnaître le titre : « (feat. X) », « (Remastered 2011) », « - Radio Edit »…
const cleanTitle = (t: string) =>
  t.replace(/\s*[([](feat|ft|with)\.?\s[^)\]]*[)\]]/gi, '').replace(/\s*[([][^)\]]*\b(remaster(ed)?|version|edit|live)\b[^)\]]*[)\]]/gi, '').replace(/\s+-\s+.*\b(remaster(ed)?|edit|version)\b.*$/i, '').trim();

async function get<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function toLyrics(record: LrclibRecord | null | undefined): Lyrics {
  if (!record || record.instrumental) return { synced: null, plain: null };
  const synced = record.syncedLyrics ? parseLrc(record.syncedLyrics) : [];
  return { synced: synced.length ? synced : null, plain: record.plainLyrics?.trim() || null };
}

export async function findLyrics(track: { title: string; artist: string; album: string; durationMs: number }): Promise<Lyrics> {
  const key = `${track.artist}|${track.title}|${Math.round(track.durationMs / 1000)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const title = cleanTitle(track.title);
  const seconds = Math.round(track.durationMs / 1000);
  let record = await get<LrclibRecord>('get', {
    track_name: title,
    artist_name: track.artist,
    album_name: track.album,
    ...(seconds ? { duration: String(seconds) } : {}),
  });
  if (!record) {
    // Recherche plus souple : la version la plus proche en durée, synchronisée de préférence.
    const results = (await get<LrclibRecord[]>('search', { track_name: title, artist_name: track.artist })) ?? [];
    const close = results.filter((r) => !seconds || Math.abs(r.duration - seconds) <= 4);
    record = close.find((r) => r.syncedLyrics) ?? close.find((r) => r.plainLyrics) ?? null;
  }
  const lyrics = toLyrics(record);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, lyrics);
  return lyrics;
}
