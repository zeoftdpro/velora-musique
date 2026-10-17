import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { searchCache } from '../db/schema.js';

const inflight = new Map<string, Promise<string[]>>();
const normalize = (rawQuery: string) => rawQuery.trim().toLowerCase().replace(/\s+/g, ' ');

/** Vrai si cette recherche est déjà en cache (donc gratuite en quota). */
export async function isCached(provider: string, rawQuery: string, ttlMs: number) {
  const [hit] = await db
    .select({ createdAt: searchCache.createdAt })
    .from(searchCache)
    .where(and(eq(searchCache.provider, provider), eq(searchCache.query, normalize(rawQuery))));
  return Boolean(hit && Date.now() - hit.createdAt.getTime() < ttlMs);
}

/**
 * Mémorise en base les ids de titres renvoyés par une recherche externe, pendant `ttlMs`.
 * Les requêtes identiques simultanées partagent le même appel (double rendu React, frappe rapide…).
 */
export function cachedSearch(provider: string, rawQuery: string, ttlMs: number, run: () => Promise<string[]>) {
  const query = normalize(rawQuery);
  const key = `${provider}:${query}`;
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    const [hit] = await db
      .select()
      .from(searchCache)
      .where(and(eq(searchCache.provider, provider), eq(searchCache.query, query)));
    if (hit && Date.now() - hit.createdAt.getTime() < ttlMs) return hit.trackIds;

    const trackIds = await run();
    await db
      .insert(searchCache)
      .values({ provider, query, trackIds })
      .onConflictDoUpdate({ target: [searchCache.provider, searchCache.query], set: { trackIds, createdAt: new Date() } });
    return trackIds;
  })().finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}
