/**
 * Paroles via LRCLIB (base libre et gratuite, sans clé) : synchronisées à la ligne quand elles existent,
 * sinon le texte brut. Les réponses sont gardées en mémoire, le CDN prend le relais pour les titres publics.
 */
const API = 'https://lrclib.net/api';
const HEADERS = { 'user-agent': 'Velora (https://velora-musique.vercel.app)' };
const CACHE_MAX = 500;

/** `words` : horodatage mot à mot, quand la source le fournit (LRC « enrichi » : `<00:12.34>mot`). */
export type LyricLine = { time: number; text: string; words?: { time: number; text: string }[] };
/** `unavailable` : LRCLIB n'a pas répondu (réessayer plus tard), à distinguer de « pas de paroles ». */
export type Lyrics = { synced: LyricLine[] | null; plain: string | null; unavailable?: boolean };
type LrclibRecord = { duration: number; instrumental: boolean; plainLyrics: string | null; syncedLyrics: string | null };

const cache = new Map<string, Lyrics>();
const toMs = (min: string, sec: string) => Math.round((Number(min) * 60 + Number(sec)) * 1000);

/** « [01:23.45] texte » → { time: 83450, text } ; les lignes vides (pauses) sont gardées. */
function parseLrc(lrc: string) {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (stamps.length === 0) continue;
    const body = raw.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '');
    const words = [...body.matchAll(/<(\d+):(\d+(?:\.\d+)?)>([^<]*)/g)]
      .map((m) => ({ time: toMs(m[1]!, m[2]!), text: m[3]! }))
      .filter((w) => w.text.trim());
    const text = body.replace(/<\d+:\d+(?:\.\d+)?>/g, '').replace(/\s+/g, ' ').trim();
    for (const s of stamps) lines.push({ time: toMs(s[1]!, s[2]!), text, ...(words.length ? { words } : {}) });
  }
  return lines.sort((a, b) => a.time - b.time);
}

// Mentions qui empêchent LRCLIB de reconnaître le titre : « (feat. X) », « // Clip Officiel // 2022 », « - Radio Edit »…
const cleanTitle = (t: string) =>
  t
    .replace(/\s*\/\/.*$/, '')
    .replace(/\s*[([](feat|ft|with|avec)\.?\s[^)\]]*[)\]]/gi, '')
    .replace(/\s+(feat|ft)\.?\s.*$/i, '')
    .replace(/\s*[([][^)\]]*\b(remaster(ed)?|version|edit|live|clip|officiel|official|audio|video|vidéo|lyrics?|paroles)\b[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+.*\b(remaster(ed)?|edit|version)\b.*$/i, '')
    .trim();

// « The Weeknd, JENNIE & Lily Rose Depp » : LRCLIB connaît le titre sous l'artiste principal.
const mainArtist = (a: string) => a.split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\bet\b)\s*/i)[0]!.trim() || a;

class Unavailable extends Error {}

/** Appel LRCLIB ; ses erreurs passagères (503 fréquents) sont retentées deux fois. */
async function get<T>(path: string, params: Record<string, string>): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { headers: HEADERS, signal: AbortSignal.timeout(6000) });
      if (res.status === 404) return null;
      if (res.ok) return (await res.json()) as T;
      if (res.status < 500 && res.status !== 429) return null;
    } catch {
      /* réseau, délai dépassé : on réessaie */
    }
    if (attempt >= 2) throw new Unavailable('LRCLIB ne répond pas');
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
}

function toLyrics(record: LrclibRecord | null | undefined): Lyrics {
  if (!record || record.instrumental) return { synced: null, plain: null };
  const synced = record.syncedLyrics ? parseLrc(record.syncedLyrics) : [];
  return { synced: synced.length ? synced : null, plain: record.plainLyrics?.trim() || null };
}

/** Parmi des résultats de recherche, la version la plus proche en durée, synchronisée de préférence. */
function closest(results: LrclibRecord[], seconds: number) {
  const usable = results.filter((r) => !r.instrumental && (r.syncedLyrics || r.plainLyrics));
  for (const tolerance of [3, 8]) {
    const near = usable
      .filter((r) => !seconds || Math.abs(r.duration - seconds) <= tolerance)
      .sort((a, b) => Math.abs(a.duration - seconds) - Math.abs(b.duration - seconds));
    const pick = near.find((r) => r.syncedLyrics) ?? near[0];
    if (pick) return pick;
  }
  return null;
}

export async function findLyrics(track: { title: string; artist: string; album: string; durationMs: number }): Promise<Lyrics> {
  const key = `${track.artist}|${track.title}|${Math.round(track.durationMs / 1000)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const title = cleanTitle(track.title) || track.title;
  const artist = mainArtist(track.artist);
  const seconds = Math.round(track.durationMs / 1000);
  let record: LrclibRecord | null = null;
  try {
    // 1. Correspondance exacte (titre, artiste, album, durée) ; 2. recherche par champs ; 3. recherche libre.
    record = await get<LrclibRecord>('get', {
      track_name: title,
      artist_name: artist,
      album_name: track.album,
      ...(seconds ? { duration: String(seconds) } : {}),
    });
    // Tant qu'on n'a pas de version synchronisée, on cherche plus loin (en gardant le texte brut déjà trouvé).
    const better = (current: LrclibRecord | null, found: LrclibRecord | null) =>
      found && (found.syncedLyrics || !current?.plainLyrics) ? found : current;
    if (!record?.syncedLyrics) {
      record = better(record, closest((await get<LrclibRecord[]>('search', { track_name: title, artist_name: artist })) ?? [], seconds));
    }
    if (!record?.syncedLyrics) {
      record = better(record, closest((await get<LrclibRecord[]>('search', { q: `${artist} ${title}` })) ?? [], seconds));
    }
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error;
    // Service indisponible en cours de route : ce qui a déjà été trouvé (texte brut) vaut mieux que rien ;
    // rien n'est mémorisé, la prochaine demande réessaiera.
    if (record?.syncedLyrics || record?.plainLyrics) return toLyrics(record);
    return { synced: null, plain: null, unavailable: true };
  }
  const lyrics = toLyrics(record);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, lyrics);
  return lyrics;
}
