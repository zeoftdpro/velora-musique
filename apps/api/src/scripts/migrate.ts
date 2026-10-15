import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sqlClient } from '../db/client.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

await migrate(db, { migrationsFolder });
console.log('Migrations appliquées.');
await sqlClient.end();
