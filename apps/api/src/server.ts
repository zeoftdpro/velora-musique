import { buildApp } from './app.js';
import { env } from './config.js';
import { sqlClient } from './db/client.js';
import { configureIndexes } from './services/search.js';

const app = await buildApp();

await configureIndexes().catch((err) => app.log.warn({ err }, 'Meilisearch indisponible : la recherche sera dégradée'));

const shutdown = async () => {
  await app.close();
  await sqlClient.end({ timeout: 5 });
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
