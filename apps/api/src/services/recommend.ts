import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { artists, favorites, playHistory, tracks } from '../db/schema.js';
import { slugify } from '../lib/slug.js';
import { selectTracks, toTrackDto, type TrackDto } from './catalog.js';
import { relatedArtists } from './deezer.js';
import { isYoutubeSearchCached, searchYoutube, youtubeEnabled } from './youtube.js';

/**
 * Recommandations : profil de goût (écoutes et likes, pondérés par leur ancienneté) croisé avec plusieurs
 * sources de titres candidats, chacune normalisée puis pondérée :
 *  - filtrage collaboratif : ce qu'écoutent les autres utilisateurs qui écoutent les mêmes titres ;
 *  - mêmes artistes, artistes proches (Deezer), mêmes genres ;
 *  - titres populaires sur Velora, en dernier recours.
 * Les artistes proches absents du catalogue sont cherchés sur YouTube, dans la limite d'un budget de quota.
 */
const DAY = 86_400_000;
const PLAY_HALF_LIFE_DAYS = 21;
const LIKE_HALF_LIFE_DAYS = 120;
// Une recherche YouTube consomme ~1 % du quota quotidien : les recommandations n'en utilisent qu'une petite part.
const YT_SEARCHES_PER_REQUEST = 2;
const YT_SEARCHES_PER_DAY = 25;
const YT_LIMIT = 15; // même taille que la recherche web : les deux partagent le cache
const MIN_TRACKS_PER_ARTIST = 4;
const FOR_YOU_TTL_MS = 15 * 60_000;

type ArtistWeight = { id: string; name: string; weight: number };
type Profile = {
  artists: ArtistWeight[];
  genres: { id: number; weight: number }[];
  /** Titres les plus marquants du profil, points de départ du filtrage collaboratif. */
  seeds: string[];
  /** Écoutés récemment ou likés : déjà connus, donc pas re-proposés. */
  known: Set<string>;
};

async function profileOf(userId: string): Promise<Profile> {
  const columns = { trackId: tracks.id, artistId: artists.id, artistName: artists.name, genreId: tracks.genreId };
  const [plays, likes] = await Promise.all([
    db
      .select({ ...columns, at: playHistory.playedAt })
      .from(playHistory)
      .innerJoin(tracks, eq(tracks.id, playHistory.trackId))
      .innerJoin(artists, eq(artists.id, tracks.artistId))
      .where(eq(playHistory.userId, userId))
      .orderBy(desc(playHistory.playedAt))
      .limit(400),
    db
      .select({ ...columns, at: favorites.createdAt })
      .from(favorites)
      .innerJoin(tracks, eq(tracks.id, favorites.trackId))
      .innerJoin(artists, eq(artists.id, tracks.artistId))
      .where(eq(favorites.userId, userId))
      .limit(500),
  ]);

  const now = Date.now();
  const decay = (at: Date, halfLifeDays: number) => 0.5 ** ((now - at.getTime()) / DAY / halfLifeDays);
  const artistW = new Map<string, ArtistWeight>();
  const genreW = new Map<number, number>();
  const trackW = new Map<string, number>();
  const add = (row: (typeof plays)[number], weight: number) => {
    const a = artistW.get(row.artistId) ?? { id: row.artistId, name: row.artistName, weight: 0 };
    a.weight += weight;
    artistW.set(row.artistId, a);
    if (row.genreId !== null) genreW.set(row.genreId, (genreW.get(row.genreId) ?? 0) + weight);
    trackW.set(row.trackId, (trackW.get(row.trackId) ?? 0) + weight);
  };
  for (const p of plays) add(p, decay(p.at, PLAY_HALF_LIFE_DAYS));
  for (const l of likes) add(l, 3 * decay(l.at, LIKE_HALF_LIFE_DAYS));

  const byWeight = <T extends { weight: number }>(items: T[]) => items.sort((a, b) => b.weight - a.weight);
  return {
    artists: byWeight([...artistW.values()]),
    genres: byWeight([...genreW].map(([id, weight]) => ({ id, weight }))),
    seeds: [...trackW].sort((a, b) => b[1] - a[1]).slice(0, 50).map(([id]) => id),
    known: new Set([...plays.filter((p) => now - p.at.getTime() < 14 * DAY).map((p) => p.trackId), ...likes.map((l) => l.trackId)]),
  };
}

/** Scores cumulés par titre ; chaque source est ramenée à [0, 1] puis multipliée par son poids. */
class Scores {
  private scores = new Map<string, number>();
  add(entries: { id: string; score: number }[], weight: number, { normalize = true } = {}) {
    const max = normalize ? Math.max(0, ...entries.map((e) => e.score)) : 1;
    if (max <= 0) return;
    for (const { id, score } of entries) this.scores.set(id, (this.scores.get(id) ?? 0) + (score / max) * weight);
  }
  ranked(exclude: Set<string>) {
    return [...this.scores].filter(([id]) => !exclude.has(id)).sort((a, b) => b[1] - a[1]);
  }
}

/**
 * Titres écoutés par les utilisateurs qui ont écouté les mêmes titres. Chaque voisin compte selon sa similarité
 * cosinus (titres en commun / √(taille des deux historiques)) : un voisin éclectique ou un seul titre partagé pèse
 * peu. Scores absolus dans [0, 1], à ne pas renormaliser (sinon un unique voisin lointain dominerait).
 */
async function collaborative(seeds: string[], userId: string) {
  if (seeds.length === 0) return [];
  const seedList = sql.join(seeds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await db.execute<{ id: string; score: number }>(sql`
    with neighbours as (
      select ph.user_id, count(distinct ph.track_id)::float8 as overlap
      from play_history ph
      where ph.track_id in (${seedList}) and ph.user_id <> ${userId}
      group by ph.user_id
      order by overlap desc
      limit 50
    ),
    heard as (
      select distinct ph.user_id, ph.track_id
      from play_history ph join neighbours n on n.user_id = ph.user_id
    ),
    similarity as (
      select n.user_id, n.overlap / sqrt(count(*) * ${seeds.length}::float8) as sim
      from neighbours n join heard h on h.user_id = n.user_id
      group by n.user_id, n.overlap
    )
    select h.track_id as id, least(1, sum(s.sim))::float8 as score
    from heard h join similarity s on s.user_id = h.user_id
    group by h.track_id
    order by score desc
    limit 150`);
  return [...rows];
}

/** Titres des artistes donnés, chacun avec le poids de son artiste. */
async function byArtists(weights: Map<string, number>) {
  if (weights.size === 0) return [];
  const rows = await db
    .select({ id: tracks.id, artistId: tracks.artistId })
    .from(tracks)
    .where(and(eq(tracks.status, 'ready'), inArray(tracks.artistId, [...weights.keys()])))
    .limit(600);
  return rows.map((r) => ({ id: r.id, score: weights.get(r.artistId) ?? 0 }));
}

async function byGenres(genres: { id: number; weight: number }[]) {
  if (genres.length === 0) return [];
  const weights = new Map(genres.map((g) => [g.id, g.weight]));
  const rows = await db
    .select({ id: tracks.id, genreId: tracks.genreId })
    .from(tracks)
    .where(and(eq(tracks.status, 'ready'), inArray(tracks.genreId, [...weights.keys()])))
    .orderBy(sql`random()`)
    .limit(200);
  return rows.map((r) => ({ id: r.id, score: weights.get(r.genreId!) ?? 0 }));
}

/** Titres les plus écoutés sur Velora ces 30 derniers jours. */
async function popular() {
  const rows = await db
    .select({ id: playHistory.trackId, score: sql<number>`count(*)::float8` })
    .from(playHistory)
    .where(gt(playHistory.playedAt, new Date(Date.now() - 30 * DAY)))
    .groupBy(playHistory.trackId)
    .orderBy(desc(sql`count(*)`))
    .limit(100);
  return rows;
}

let ytBudget = { day: '', used: 0 };

/** Vrai si `candidate` désigne l'artiste `name`, éventuellement parmi d'autres (« A x B », « A & B »). */
function sameArtist(candidate: string, name: string) {
  return `-${slugify(candidate)}-`.includes(`-${slugify(name)}-`);
}

/**
 * Artistes proches (Deezer) des artistes donnés, retrouvés dans le catalogue. Ceux qui y ont trop peu de titres
 * sont cherchés sur YouTube : gratuitement si la recherche est en cache, sinon dans la limite du budget.
 */
async function relatedTracks(sources: ArtistWeight[]) {
  const related = new Map<string, { name: string; weight: number }>();
  const lists = await Promise.all(sources.map((a) => relatedArtists(a.name)));
  sources.forEach((source, i) => {
    lists[i]!.forEach((name, rank) => {
      const key = name.toLowerCase();
      const weight = source.weight * (1 - rank / 12);
      if ((related.get(key)?.weight ?? 0) < weight) related.set(key, { name, weight });
    });
  });
  // Les artistes déjà écoutés ont leur propre source (mêmes artistes) : ici, on cherche la découverte.
  for (const s of sources) related.delete(s.name.toLowerCase());
  if (related.size === 0) return [];

  const known = await db
    .select({ id: artists.id, name: artists.name, trackCount: sql<number>`count(${tracks.id})::int` })
    .from(artists)
    .leftJoin(tracks, and(eq(tracks.artistId, artists.id), eq(tracks.status, 'ready')))
    .where(inArray(sql`lower(${artists.name})`, [...related.keys()]))
    .groupBy(artists.id);
  const trackCount = new Map<string, number>();
  for (const a of known) trackCount.set(a.name.toLowerCase(), (trackCount.get(a.name.toLowerCase()) ?? 0) + a.trackCount);

  const results = await byArtists(new Map(known.map((a) => [a.id, related.get(a.name.toLowerCase())!.weight])));

  if (youtubeEnabled) {
    const today = new Date().toISOString().slice(0, 10);
    if (ytBudget.day !== today) ytBudget = { day: today, used: 0 };
    let spent = 0;
    const missing = [...related.values()]
      .filter((r) => (trackCount.get(r.name.toLowerCase()) ?? 0) < MIN_TRACKS_PER_ARTIST)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 6);
    for (const artist of missing) {
      try {
        const cached = await isYoutubeSearchCached(artist.name, YT_LIMIT);
        if (!cached) {
          if (spent >= YT_SEARCHES_PER_REQUEST || ytBudget.used >= YT_SEARCHES_PER_DAY) continue;
          spent++;
          ytBudget.used++;
        }
        const ids = await searchYoutube(artist.name, YT_LIMIT);
        // Un nom court ou courant (« ROK ») ramène d'autres artistes : on ne garde que les siens (featurings compris).
        const byArtist = ids.length
          ? new Map((await db.select({ id: tracks.id, name: artists.name }).from(tracks).innerJoin(artists, eq(artists.id, tracks.artistId)).where(inArray(tracks.id, ids))).map((r) => [r.id, r.name]))
          : new Map<string, string>();
        const own = ids.filter((id) => sameArtist(byArtist.get(id) ?? '', artist.name));
        results.push(...own.map((id, rank) => ({ id, score: artist.weight * (1 - rank / (YT_LIMIT * 2)) })));
      } catch (error) {
        console.warn(`Recherche YouTube « ${artist.name} » impossible :`, (error as Error).message);
        break; // quota épuisé ou panne : inutile d'insister
      }
    }
  }
  return results;
}

/**
 * Charge les titres les mieux classés, avec un peu de hasard (le mix change d'une fois sur l'autre) et au plus
 * `perArtist` titres par artiste tant que la liste peut être remplie autrement.
 */
async function pick(ranked: [string, number][], limit: number, perArtist: number): Promise<TrackDto[]> {
  const top = ranked.slice(0, limit * 5);
  if (top.length === 0) return [];
  const score = new Map(top.map(([id, s]) => [id, s * (0.8 + Math.random() * 0.4)]));
  const rows = (await selectTracks(inArray(tracks.id, [...score.keys()]))).sort((a, b) => score.get(b.id)! - score.get(a.id)!);

  const chosen: typeof rows = [];
  const perArtistCount = new Map<string, number>();
  const leftovers: typeof rows = [];
  for (const row of rows) {
    if (chosen.length >= limit) break;
    const n = perArtistCount.get(row.artistId) ?? 0;
    if (n < perArtist) {
      chosen.push(row);
      perArtistCount.set(row.artistId, n + 1);
    } else {
      leftovers.push(row);
    }
  }
  chosen.push(...leftovers.slice(0, limit - chosen.length));

  // Évite deux titres du même artiste à la suite quand c'est possible.
  const spread: typeof rows = [];
  while (chosen.length) {
    const i = chosen.findIndex((r) => r.artistId !== spread.at(-1)?.artistId);
    spread.push(...chosen.splice(Math.max(0, i), 1));
  }
  return spread.map(toTrackDto);
}

const forYouCache = new Map<string, { at: number; result: { tracks: TrackDto[]; basedOn: string[] } }>();

/** « Pour vous » : titres à découvrir d'après tout le profil d'écoute. Vide tant que l'utilisateur n'a rien écouté. */
export async function recommendationsFor(userId: string, limit: number) {
  const hit = forYouCache.get(userId);
  if (hit && Date.now() - hit.at < FOR_YOU_TTL_MS) return hit.result;

  const profile = await profileOf(userId);
  if (profile.artists.length === 0) return { tracks: [], basedOn: [] };

  const topArtists = profile.artists.slice(0, 10);
  const scores = new Scores();
  const [collab, sameArtists, related, genre, pop] = await Promise.all([
    collaborative(profile.seeds, userId),
    byArtists(new Map(topArtists.map((a) => [a.id, a.weight]))),
    relatedTracks(profile.artists.slice(0, 3)),
    byGenres(profile.genres.slice(0, 3)),
    popular(),
  ]);
  scores.add(collab, 1, { normalize: false });
  scores.add(related, 0.9);
  scores.add(sameArtists, 0.6);
  scores.add(genre, 0.3);
  scores.add(pop, 0.1);

  const result = {
    tracks: await pick(scores.ranked(profile.known), limit, 2),
    basedOn: profile.artists.slice(0, 3).map((a) => a.name),
  };
  forYouCache.set(userId, { at: Date.now(), result });
  return result;
}

/**
 * Lecture automatique : titres à enchaîner après `seedId` (la file d'attente est terminée). Proches du titre en
 * cours d'abord, puis du profil de l'utilisateur ; `exclude` écarte ce qui est déjà dans la file.
 */
export async function radioAfter(userId: string, seedId: string, exclude: string[], limit: number) {
  const [seed] = await db
    .select({ id: tracks.id, artistId: artists.id, artistName: artists.name, genreId: tracks.genreId })
    .from(tracks)
    .innerJoin(artists, eq(artists.id, tracks.artistId))
    .where(eq(tracks.id, seedId));
  if (!seed) return [];

  const profile = await profileOf(userId);
  const seedArtist = { id: seed.artistId, name: seed.artistName, weight: 1 };
  const profileArtists = profile.artists.filter((a) => a.id !== seed.artistId).slice(0, 2);
  const maxWeight = profile.artists[0]?.weight ?? 1;
  // Artistes du profil ramenés sous l'artiste du titre en cours : la radio reste proche de ce qu'on écoute.
  const scaled = profileArtists.map((a) => ({ ...a, weight: (a.weight / maxWeight) * 0.5 }));

  const scores = new Scores();
  const [collab, sameArtist, related, genre, mine, pop] = await Promise.all([
    collaborative([seed.id], userId),
    byArtists(new Map([[seed.artistId, 1]])),
    relatedTracks([seedArtist, ...scaled]),
    seed.genreId !== null ? byGenres([{ id: seed.genreId, weight: 1 }]) : Promise.resolve([]),
    byArtists(new Map(profile.artists.slice(0, 8).map((a) => [a.id, a.weight]))),
    popular(),
  ]);
  scores.add(collab, 1, { normalize: false });
  scores.add(related, 0.9);
  scores.add(sameArtist, 0.6);
  scores.add(genre, 0.4);
  scores.add(mine, 0.3);
  scores.add(pop, 0.1);

  // Écoutés dans les 6 dernières heures : on évite de rejouer la même séance.
  const recent = await db
    .select({ id: playHistory.trackId })
    .from(playHistory)
    .where(and(eq(playHistory.userId, userId), gt(playHistory.playedAt, new Date(Date.now() - 6 * 3600_000))));
  const excluded = new Set([seed.id, ...exclude, ...recent.map((r) => r.id)]);
  return pick(scores.ranked(excluded), limit, 2);
}
