/**
 * Paroles synchronisées : LRCLIB (base libre et gratuite, sans clé), puis NetEase ; à défaut, le texte brut
 * est synchronisé par estimation. Les réponses sont gardées en mémoire, le CDN prend le relais pour les titres publics.
 */
const API = 'https://lrclib.net/api';
const HEADERS = { 'user-agent': 'Velora (https://velora-musique.vercel.app)' };
const CACHE_MAX = 500;

/** `words` : horodatage mot à mot, quand la source le fournit (LRC « enrichi » : `<00:12.34>mot`). */
export type LyricLine = { time: number; text: string; words?: { time: number; text: string }[] };
/** `unavailable` : LRCLIB n'a pas répondu (réessayer plus tard), à distinguer de « pas de paroles ». */
/** `estimated` : horodatage deviné à partir du texte brut (aucune source synchronisée trouvée). */
export type Lyrics = { synced: LyricLine[] | null; plain: string | null; unavailable?: boolean; estimated?: boolean };
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

// ---------- NetEase Cloud Music : seconde source de paroles synchronisées (API web publique, sans clé). ----------

const NETEASE = 'https://music.163.com/api';
const NETEASE_HEADERS = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', referer: 'https://music.163.com/' };
// Lignes de crédits ajoutées par NetEase en tête des paroles (« 作词 : … », « Producer: … »).
const CREDIT = /^(作词|作曲|编曲|制作|混音|母带|监制|出品|和声|吉他|贝斯|鼓|录音|词|曲|lyricist|composer|producer|arranger|written by|prod)\s*[:：]/i;

const normalize = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function neteaseJson<T>(path: string, params: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetch(`${NETEASE}/${path}?${new URLSearchParams(params)}`, { headers: NETEASE_HEADERS, signal: AbortSignal.timeout(6000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

type NeteaseSong = { id: number; name: string; duration: number; artists: { name: string }[] };

/** Paroles synchronisées NetEase du morceau, s'il est retrouvé avec le bon artiste et la bonne durée. */
async function neteaseSynced(title: string, artist: string, seconds: number): Promise<LyricLine[] | null> {
  const search = await neteaseJson<{ result?: { songs?: NeteaseSong[] } }>('search/get', { s: `${title} ${artist}`, type: '1', limit: '10' });
  const wantedArtist = normalize(artist);
  const wantedTitle = normalize(title);
  const song = search?.result?.songs?.find(
    (s) =>
      s.artists.some((a) => normalize(a.name).includes(wantedArtist) || wantedArtist.includes(normalize(a.name))) &&
      (normalize(s.name).includes(wantedTitle) || wantedTitle.includes(normalize(s.name))) &&
      (!seconds || Math.abs(s.duration / 1000 - seconds) <= 6),
  );
  if (!song) return null;
  const lyric = await neteaseJson<{ lrc?: { lyric?: string } }>('song/lyric', { id: String(song.id), lv: '1', kv: '1', tv: '-1' });
  const lines = parseLrc(lyric?.lrc?.lyric ?? '').filter((l) => !CREDIT.test(l.text));
  // Paroles non horodatées (tout à 0) ou trop courtes : inutilisables.
  const sung = lines.filter((l) => l.text);
  if (sung.length < 4 || new Set(sung.map((l) => l.time)).size < sung.length / 2) return null;
  return lines;
}

// ---------- Dernier recours : synchronisation estimée du texte brut ----------

/**
 * Répartit les lignes du texte brut sur la durée du morceau, au prorata de leur longueur, avec une pause entre
 * les couplets. Approximatif (l'introduction est devinée) : l'interface permet de décaler les paroles.
 */
export function estimateSync(plain: string, durationMs: number): LyricLine[] {
  const parts: { text: string; weight: number }[] = [];
  for (const raw of plain.split(/\r?\n/)) {
    const text = raw.trim();
    if (text) parts.push({ text, weight: text.length + 8 });
    else if (parts.length && parts.at(-1)!.text) parts.push({ text: '', weight: 22 });
  }
  while (parts.length && !parts.at(-1)!.text) parts.pop();
  const total = parts.reduce((n, p) => n + p.weight, 0) || 1;
  const start = Math.min(15_000, Math.max(4_000, durationMs * 0.05));
  const end = durationMs - Math.min(15_000, Math.max(5_000, durationMs * 0.06));
  const span = Math.max(end - start, 1);
  let at = start;
  return parts.map((p) => {
    const line = { time: Math.round(at), text: p.text };
    at += (p.weight / total) * span;
    return line;
  });
}

export async function findLyrics(track: { title: string; artist: string; album: string; durationMs: number }): Promise<Lyrics> {
  const key = `${track.artist}|${track.title}|${Math.round(track.durationMs / 1000)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const title = cleanTitle(track.title) || track.title;
  const artist = mainArtist(track.artist);
  const seconds = Math.round(track.durationMs / 1000);
  let record: LrclibRecord | null = null;
  let lrclibDown = false;
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
    lrclibDown = true;
  }

  let lyrics = toLyrics(record);
  if (!lyrics.synced && !record?.instrumental) {
    // 4. Seconde source (NetEase), puis synchronisation estimée du texte brut.
    const netease = await neteaseSynced(title, artist, seconds);
    if (netease) lyrics = { synced: netease, plain: lyrics.plain };
    else if (lyrics.plain && track.durationMs) lyrics = { synced: estimateSync(lyrics.plain, track.durationMs), plain: lyrics.plain, estimated: true };
  }
  // LRCLIB injoignable et rien d'autre : on le dit, sans mémoriser l'échec (la prochaine demande réessaiera).
  if (lrclibDown) return lyrics.synced || lyrics.plain ? lyrics : { synced: null, plain: null, unavailable: true };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, lyrics);
  return lyrics;
}
