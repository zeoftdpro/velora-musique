import { slugify } from '../lib/slug.js';

/**
 * API publique de Deezer (sans clé) : sert uniquement à connaître les artistes proches d'un artiste, pour les
 * recommandations. Aucun son n'en provient ; les titres proposés sont ensuite cherchés dans le catalogue Velora.
 */
const API = 'https://api.deezer.com';
const CACHE_TTL_MS = 7 * 24 * 3600_000;

const cache = new Map<string, { at: number; names: string[] }>();

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Deezer HTTP ${res.status}`);
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (body.error) throw new Error(`Deezer : ${body.error.message ?? 'erreur inconnue'}`);
  return body;
}

/** Noms des artistes proches (du plus au moins proche) ; liste vide si l'artiste est inconnu ou en cas d'erreur. */
export async function relatedArtists(name: string, limit = 8): Promise<string[]> {
  const key = slugify(name);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.names.slice(0, limit);

  try {
    const search = await get<{ data: { id: number; name: string }[] }>(`/search/artist?${new URLSearchParams({ q: name, limit: '3' })}`);
    // Homonymes et noms approximatifs (artistes déduits des titres YouTube) : on exige une correspondance nette.
    const artist = search.data.find((a) => slugify(a.name) === key) ?? search.data.find((a) => slugify(a.name).includes(key) || key.includes(slugify(a.name)));
    const names = artist ? (await get<{ data: { name: string }[] }>(`/artist/${artist.id}/related?limit=20`)).data.map((a) => a.name) : [];
    cache.set(key, { at: Date.now(), names });
    return names.slice(0, limit);
  } catch (error) {
    console.warn(`Artistes proches de « ${name} » indisponibles :`, (error as Error).message);
    return [];
  }
}
