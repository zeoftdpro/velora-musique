import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { env, paths } from '../config.js';

/**
 * PostgreSQL local sans Docker : lance un serveur embarqué configuré d'après DATABASE_URL,
 * crée la base au premier démarrage et applique les migrations. Le serveur vit tant que ce script tourne.
 */
const url = new URL(env.DATABASE_URL);
const database = decodeURIComponent(url.pathname.slice(1)) || 'velora';
const databaseDir = path.join(paths.repoRoot, '.pgdata');
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

// Base hébergée (Supabase…) : rien à lancer, on applique seulement les migrations.
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  const sqlClient = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  await migrate(drizzle(sqlClient), { migrationsFolder });
  await sqlClient.end();
  console.log(`Base distante (${url.hostname}) : migrations appliquées, aucun serveur local à lancer.`);
  process.exit(0);
}

const pg = new EmbeddedPostgres({
  databaseDir,
  port: Number(url.port || 5432),
  user: decodeURIComponent(url.username) || 'postgres',
  password: decodeURIComponent(url.password) || 'postgres',
  authMethod: 'scram-sha-256',
  persistent: true,
  onLog: () => {},
});

if (!existsSync(path.join(databaseDir, 'PG_VERSION'))) {
  console.log(`Initialisation du cluster PostgreSQL dans ${databaseDir}…`);
  await pg.initialise();
}
await pg.start();

try {
  await pg.createDatabase(database);
} catch (error) {
  if (!String((error as Error).message).includes('already exists')) throw error;
}

const sqlClient = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
await migrate(drizzle(sqlClient), { migrationsFolder });
await sqlClient.end();

console.log(`PostgreSQL prêt sur le port ${url.port || 5432} (base "${database}"). Ctrl+C pour arrêter.`);

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
