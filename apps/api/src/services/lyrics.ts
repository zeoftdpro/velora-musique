/**
 * Paroles synchronisées : Deezer (mot à mot le plus souvent), LRCLIB, NetEase ; à défaut, le texte brut (Deezer,
 * LRCLIB, Genius) est synchronisé par estimation. Les réponses sont gardées en mémoire, le CDN prend le relais pour les titres publics.
 */
import { ytMusicLyrics } from './ytmusic.js';

const API = 'https://lrclib.net/api';
const HEADERS = { 'user-agent': 'Velora (https://velora-musique.vercel.app)' };
const CACHE_MAX = 500;

/** `words` : horodatage mot à mot, quand la source le fournit (LRC « enrichi » : `<00:12.34>mot`). */
export type LyricLine = { time: number; text: string; words?: { time: number; end?: number; text: string }[] };
/** `unavailable` : LRCLIB n'a pas répondu (réessayer plus tard), à distinguer de « pas de paroles ». */
/** `estimated` : horodatage deviné à partir du texte brut (aucune source synchronisée trouvée). */
export type Lyrics = { synced: LyricLine[] | null; plain: string | null; unavailable?: boolean; estimated?: boolean };
type LrclibRecord = { duration: number; instrumental: boolean; plainLyrics: string | null; syncedLyrics: string | null };

const cache = new Map<string, { lyrics: Lyrics; expires: number }>();
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
      const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
      if (res.status === 404) return null;
      if (res.ok) return (await res.json()) as T;
      if (res.status < 500 && res.status !== 429) return null;
    } catch {
      /* réseau, délai dépassé : on réessaie */
    }
    if (attempt >= 2) throw new Unavailable('LRCLIB ne répond pas');
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
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

/** Les sources de secours signalent leurs pannes (exception), à ne pas confondre avec « pas de paroles » (null). */
async function neteaseJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${NETEASE}/${path}?${new URLSearchParams(params)}`, { headers: NETEASE_HEADERS, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`NetEase HTTP ${res.status}`);
  return (await res.json()) as T;
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

// ---------- Genius : texte brut, très fourni en rap francophone (recherche publique du site, sans clé). ----------

// En-têtes d'un vrai navigateur : Genius filtre les requêtes qui n'en ont pas.
const GENIUS_HEADERS = {
  'user-agent': NETEASE_HEADERS['user-agent'],
  accept: 'application/json, text/plain, */*',
  'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
  referer: 'https://genius.com/',
};

/** Position de la balise </div> qui ferme un élément dont le contenu commence à `start`. */
function closingDiv(html: string, start: number) {
  let depth = 1;
  const tags = /<\/?div\b[^>]*>/g;
  tags.lastIndex = start;
  for (let t = tags.exec(html); t; t = tags.exec(html)) {
    depth += t[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return { index: t.index, end: t.index + t[0].length };
  }
  return { index: html.length, end: html.length };
}

/** Contenu de chaque élément ouvert par `opening` (balises <div> imbriquées comprises). */
function divContents(html: string, opening: RegExp) {
  return [...html.matchAll(opening)].map((m) => html.slice(m.index! + m[0].length, closingDiv(html, m.index! + m[0].length).index));
}

/** Retire les éléments ouverts par `opening`, avec tout leur contenu. */
function stripDivs(html: string, opening: RegExp) {
  let out = html;
  for (let m = out.match(opening); m?.index !== undefined; m = out.match(opening)) {
    out = out.slice(0, m.index) + out.slice(closingDiv(out, m.index + m[0].length).end);
  }
  return out;
}

const decodeHtml = (s: string) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, e: string) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[e]!);

/**
 * Paroles d'un morceau Genius depuis son fichier d'intégration (embed.js, prévu pour être chargé par d'autres
 * sites) : `document.write(JSON.parse('…'))`, une chaîne JavaScript qui contient du JSON, qui contient le HTML.
 */
async function geniusEmbedLyrics(songId: number): Promise<string | null> {
  const res = await fetch(`https://genius.com/songs/${songId}/embed.js`, { headers: GENIUS_HEADERS, signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Genius (intégration) HTTP ${res.status}`);
  const literal = (await res.text()).match(/JSON\.parse\('((?:[^'\\]|\\.)*)'\)/)?.[1];
  if (!literal) return null;
  const html = JSON.parse(literal.replace(/\\(.)/g, '$1')) as string;
  return divContents(html, /<div class="rg_embed_body">/g)[0] ?? null;
}

async function geniusPlain(title: string, artist: string): Promise<string | null> {
  const res = await fetch(`https://genius.com/api/search/song?${new URLSearchParams({ q: `${artist} ${title}`, per_page: '5' })}`, {
    headers: GENIUS_HEADERS,
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`Genius (recherche) HTTP ${res.status}`);
  const found = (await res.json()) as { response?: { sections?: { hits?: { result: { id: number; title: string; url: string; primary_artist?: { name: string } } }[] }[] } };
  const wantedArtist = normalize(artist);
  const wantedTitle = normalize(title);
  const candidates = (found.response?.sections?.[0]?.hits ?? [])
    .map((h) => h.result)
    .filter((r) => {
      const a = normalize(r.primary_artist?.name ?? '');
      const t = normalize(r.title);
      return (a.includes(wantedArtist) || wantedArtist.includes(a)) && (t.includes(wantedTitle) || wantedTitle.includes(t));
    });
  // Plusieurs versions (« Freestyle (2022) », « Freestyle (2025) ») : le titre exact d'abord.
  const song = candidates.find((r) => normalize(r.title) === wantedTitle) ?? candidates[0];
  if (!song) return null;
  // Fichier d'intégration d'abord (léger, moins filtré que les pages), sinon la page du morceau.
  let body = await geniusEmbedLyrics(song.id).catch(() => null);
  if (!body) {
    const page = await fetch(song.url, { headers: GENIUS_HEADERS, signal: AbortSignal.timeout(8000) });
    if (page.status === 404) return null;
    if (!page.ok) throw new Error(`Genius (page) HTTP ${page.status}`);
    body = divContents(await page.text(), /<div[^>]*data-lyrics-container="true"[^>]*>/g)
      // En-tête (contributeurs, traductions) que Genius place dans le premier bloc.
      .map((block) => stripDivs(block, /<div[^>]*data-exclude-from-selection="true"[^>]*>/))
      .join('\n');
  }
  // Le fichier d'intégration met un saut de ligne après chaque <br> : un seul retour à la ligne au total.
  const text = body.replace(/<br\s*\/?>\n?/g, '\n').replace(/<[^>]+>/g, '');
  const lines = decodeHtml(text)
    .split('\n')
    .map((l) => l.trim())
    // Repères de structure (« [Couplet 1] », « [Refrain] ») : remplacés par une pause entre les parties.
    .map((l) => (/^\[.*\]$/.test(l) ? '' : l));
  const plain = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return plain.split('\n').filter(Boolean).length >= 4 ? plain : null;
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

// ---------- Deezer : paroles synchronisées, souvent mot à mot (jeton anonyme du site, sans compte). ----------

const DEEZER_HEADERS = { 'user-agent': NETEASE_HEADERS['user-agent'] };
let deezerJwt: { token: string; expires: number } | null = null;

async function deezerToken() {
  if (deezerJwt && deezerJwt.expires > Date.now()) return deezerJwt.token;
  const res = await fetch('https://auth.deezer.com/login/anonymous?jo=p&rto=c&i=c', { headers: DEEZER_HEADERS, signal: AbortSignal.timeout(5000) });
  const { jwt } = (await res.json()) as { jwt?: string };
  if (!jwt) throw new Error('jeton Deezer refusé');
  // Expiration lue dans le jeton ; on le renouvelle une minute avant.
  const exp = Number(JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString() || '{}').exp) || 0;
  deezerJwt = { token: jwt, expires: exp ? exp * 1000 - 60_000 : Date.now() + 30 * 60_000 };
  return jwt;
}

const DEEZER_QUERY = `query GetLyrics($trackId: String!) {
  track(trackId: $trackId) {
    lyrics {
      text
      synchronizedLines { line milliseconds duration }
      synchronizedWordByWordLines { start end words { start end word } }
    }
  }
}`;

type DeezerLyrics = {
  text: string | null;
  synchronizedLines: { line: string; milliseconds: number; duration: number }[] | null;
  synchronizedWordByWordLines: { start: number; end: number; words: { start: number; end: number; word: string }[] }[] | null;
};

/** Une pause (points animés) quand la voix s'arrête plus de 6 s entre deux lignes. */
function withPauses(lines: (LyricLine & { end: number })[]): LyricLine[] {
  const out: LyricLine[] = [];
  lines.forEach((line, i) => {
    out.push({ time: line.time, text: line.text, ...(line.words ? { words: line.words } : {}) });
    const next = lines[i + 1];
    if (next && next.time - line.end > 6000) out.push({ time: line.end + 400, text: '' });
  });
  return out;
}

/** Paroles Deezer du morceau (même artiste, même titre). `shift` : écart de durée avec la version jouée (ms). */
async function deezerLyrics(title: string, artist: string, seconds: number): Promise<{ synced: LyricLine[] | null; plain: string | null; shift: number } | null> {
  try {
    type Hit = { id: number; title: string; duration: number; artist: { name: string } };
    const search = async (q: string) =>
      ((await (await fetch(`https://api.deezer.com/search?${new URLSearchParams({ q, limit: '10' })}`, { signal: AbortSignal.timeout(5000) })).json()) as { data?: Hit[] }).data ?? [];
    const wantedArtist = normalize(artist);
    const wantedTitle = normalize(title);
    const matches = (h: Hit) => {
      const a = normalize(h.artist.name);
      const t = normalize(h.title.replace(/\s*[([](feat|ft|with|avec)\.?\s[^)\]]*[)\]]/gi, ''));
      return (a.includes(wantedArtist) || wantedArtist.includes(a)) && (t.includes(wantedTitle) || wantedTitle.includes(t));
    };
    let hits = (await search(`artist:"${artist}" track:"${title}"`)).filter(matches);
    if (hits.length === 0) hits = (await search(`${artist} ${title}`)).filter(matches);
    // Version la plus proche en durée de celle qu'on joue (album, single, clip…).
    const hit = hits.sort((a, b) => Math.abs(a.duration - seconds) - Math.abs(b.duration - seconds))[0];
    if (!hit) return null;

    const res = await fetch('https://pipe.deezer.com/api', {
      method: 'POST',
      headers: { ...DEEZER_HEADERS, 'content-type': 'application/json', authorization: `Bearer ${await deezerToken()}` },
      body: JSON.stringify({ operationName: 'GetLyrics', variables: { trackId: String(hit.id) }, query: DEEZER_QUERY }),
      signal: AbortSignal.timeout(6000),
    });
    const lyrics = ((await res.json()) as { data?: { track?: { lyrics?: DeezerLyrics | null } } }).data?.track?.lyrics;
    if (!lyrics) return null;

    const byWord = lyrics.synchronizedWordByWordLines?.filter((l) => l.words.length) ?? [];
    const byLine = lyrics.synchronizedLines?.filter((l) => l.line.trim()) ?? [];
    const synced = byWord.length
      ? withPauses(byWord.map((l) => ({
          time: l.start,
          end: l.end,
          text: l.words.map((w) => w.word).join(' '),
          words: l.words.map((w) => ({ time: w.start, end: w.end, text: w.word })),
        })))
      : byLine.length
        ? withPauses(byLine.map((l) => ({ time: l.milliseconds, end: l.milliseconds + l.duration, text: l.line })))
        : null;
    return { synced, plain: lyrics.text?.trim() || null, shift: seconds ? (seconds - hit.duration) * 1000 : 0 };
  } catch (error) {
    throw new Error(`Deezer : ${(error as Error).message}`);
  }
}

/** Décale toutes les lignes (et leurs mots) de `ms`. */
const shiftLines = (lines: LyricLine[], ms: number): LyricLine[] =>
  lines.map((l) => ({
    time: Math.max(0, l.time + ms),
    text: l.text,
    ...(l.words ? { words: l.words.map((w) => ({ time: Math.max(0, w.time + ms), end: w.end === undefined ? undefined : Math.max(0, w.end + ms), text: w.text })) } : {}),
  }));

/** LRCLIB : correspondance exacte (titre, artiste, album, durée), puis recherche par champs, puis recherche libre. */
async function lrclibLookup(title: string, artist: string, album: string, seconds: number) {
  let record: LrclibRecord | null = null;
  try {
    record = await get<LrclibRecord>('get', {
      track_name: title,
      artist_name: artist,
      album_name: album,
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
    return { record, down: false };
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error;
    return { record, down: true };
  }
}

// Écart de durée au-delà duquel la version Deezer n'est pas celle qu'on joue (clip avec intro, version longue…).
const SAME_VERSION_MS = 4000;

/** `videoId` : vidéo YouTube jouée, pour les paroles que YouTube Music associe à cette vidéo précise. */
export async function findLyrics(
  track: { title: string; artist: string; album: string; durationMs: number; videoId?: string | null },
  { refresh = false } = {},
): Promise<Lyrics> {
  const key = `${track.artist}|${track.title}|${Math.round(track.durationMs / 1000)}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now() && !refresh) return hit.lyrics;

  const title = cleanTitle(track.title) || track.title;
  const artist = mainArtist(track.artist);
  const seconds = Math.round(track.durationMs / 1000);
  // Toutes les sources sont interrogées en parallèle : un titre absent de toutes les bases ne fait pas attendre
  // la somme des délais. Une source en panne compte comme « rien trouvé », mais on s'en souvient : sans paroles
  // au final, la réponse dira « indisponible » (à réessayer) plutôt que « pas de paroles ».
  let sourceFailed = false;
  const soft = <T,>(promise: Promise<T>) =>
    promise.catch((error: Error) => {
      sourceFailed = true;
      console.warn('Source de paroles en panne :', error.message);
      return null;
    });
  const deezerPromise = soft(deezerLyrics(title, artist, seconds));
  const neteasePromise = soft(neteaseSynced(title, artist, seconds));
  const geniusPromise = soft(geniusPlain(title, artist));
  const ytmPromise = track.videoId ? soft(ytMusicLyrics(track.videoId)) : Promise.resolve(null);
  const [deezer, lrclib, ytm] = await Promise.all([deezerPromise, lrclibLookup(title, artist, track.album, seconds), ytmPromise]);
  const { record } = lrclib;
  const lrc = toLyrics(record);

  let lyrics: Lyrics;
  if (deezer?.synced && Math.abs(deezer.shift) <= SAME_VERSION_MS) {
    // 1. Deezer, même version : synchronisation à la voix, souvent mot à mot.
    lyrics = { synced: deezer.synced, plain: deezer.plain ?? lrc.plain };
  } else if (ytm?.synced) {
    // 2. YouTube Music : paroles horodatées associées à la vidéo jouée elle-même.
    lyrics = { synced: ytm.synced, plain: ytm.plain };
  } else if (lrc.synced) {
    // 3. LRCLIB (choisie au plus près de la durée jouée).
    lyrics = lrc;
  } else {
    const netease = record?.instrumental ? null : await neteasePromise;
    if (netease) {
      // 4. NetEase (durée vérifiée).
      lyrics = { synced: netease, plain: lrc.plain };
    } else if (deezer?.synced) {
      // 5. Deezer, autre version (souvent un clip avec une intro) : on décale de l'écart de durée, réglable à l'oreille.
      lyrics = { synced: shiftLines(deezer.synced, deezer.shift), plain: deezer.plain, estimated: true };
    } else {
      // 6. Texte brut (Deezer, YouTube Music, LRCLIB, Genius) synchronisé par estimation.
      const plain = record?.instrumental ? null : deezer?.plain ?? ytm?.plain ?? lrc.plain ?? (await geniusPromise);
      lyrics = plain && track.durationMs ? { synced: estimateSync(plain, track.durationMs), plain, estimated: true } : { synced: null, plain: null };
    }
  }

  const found = Boolean(lyrics.synced || lyrics.plain);
  // Une source en panne et rien ailleurs : on le dit, sans mémoriser l'échec (la prochaine demande réessaiera).
  if (!found && (lrclib.down || sourceFailed)) return { synced: null, plain: null, unavailable: true };
  // Paroles trouvées : gardées 6 h. Rien trouvé : 10 min seulement (une base peut les ajouter, ou un raté passager).
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { lyrics, expires: Date.now() + (found && !lrclib.down && !sourceFailed ? 6 * 3600_000 : 10 * 60_000) });
  return lyrics;
}
