/**
 * Ingestion audio : `npm run ingest -- <dossier|fichier> [--force] [--concurrency=2]`
 * Lit les tags (titre, artiste, album, genre, pochette), encode en HLS (AAC 64k/128k/256k),
 * envoie segments et pochettes vers le stockage objet, puis indexe le catalogue dans Meilisearch.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { sqlClient } from '../db/client.js';
import { collectAudioFiles, ingestFile, type IngestResult } from '../ingest/pipeline.js';
import { configureIndexes, indexCatalog } from '../services/search.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    force: { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '2' },
  },
});

if (positionals.length === 0) {
  console.error('Usage : npm run ingest -- <dossier|fichier> [--force] [--concurrency=2]');
  process.exit(1);
}

// npm exécute le script depuis apps/api : on résout les chemins relatifs par rapport au dossier d'appel.
const cwd = process.env.INIT_CWD ?? process.cwd();
const files = (await Promise.all(positionals.map((p) => collectAudioFiles(path.resolve(cwd, p))))).flat();
if (files.length === 0) {
  console.error('Aucun fichier audio trouvé.');
  process.exit(1);
}

console.log(`${files.length} fichier(s) à traiter…`);
const concurrency = Math.max(1, Number(values.concurrency) || 1);
const results: IngestResult[] = [];
let next = 0;

async function worker() {
  while (next < files.length) {
    const file = files[next++]!;
    const label = path.relative(cwd, file);
    try {
      const result = await ingestFile(file, { force: values.force });
      results.push(result);
      console.log(`${result.status === 'skipped' ? '↷ déjà présent' : '✓ ingéré     '}  ${label}`);
    } catch (err) {
      // Les erreurs Drizzle (« Failed query… ») portent la cause réelle (connexion, contrainte…) dans `cause`.
      const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : '';
      const error = (err instanceof Error ? err.message : String(err)) + cause;
      results.push({ status: 'failed', file, error });
      console.error(`✗ échec        ${label}\n    ${error}`);
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

const ingested = results.filter((r) => r.status === 'ingested').map((r) => (r as { trackId: string }).trackId);
if (ingested.length > 0) {
  try {
    await configureIndexes();
    await indexCatalog(ingested);
    console.log('Index de recherche mis à jour.');
  } catch (err) {
    console.warn(`Indexation ignorée (Meilisearch indisponible ?) : ${(err as Error).message}`);
  }
}

const count = (s: IngestResult['status']) => results.filter((r) => r.status === s).length;
console.log(`\nTerminé : ${count('ingested')} ingéré(s), ${count('skipped')} ignoré(s), ${count('failed')} échec(s).`);
await sqlClient.end();
process.exit(count('failed') > 0 ? 1 : 0);
