import { sqlClient } from '../db/client.js';
import { configureIndexes, indexCatalog, meili } from '../services/search.js';

if (!meili) {
  console.error('MEILI_HOST non configuré : rien à indexer.');
  process.exit(1);
}
await configureIndexes();
await indexCatalog();
console.log('Catalogue réindexé.');
await sqlClient.end();
