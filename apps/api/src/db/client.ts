import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config.js';
import * as schema from './schema.js';

// Pooler Supabase en mode « transaction » (port 6543) : fait pour le serverless, une connexion n'est occupée que
// le temps d'une requête (le mode « session », port 5432, plafonne à 15 clients et sature avec plusieurs instances
// Vercel). Ce mode ne garde pas les requêtes préparées : on les désactive.
const transactionPooler = new URL(env.DATABASE_URL).port === '6543';
// idle_timeout : sur Vercel, une instance inactive rend ses connexions au pooler Supabase (nombre limité).
export const sqlClient = postgres(env.DATABASE_URL, {
  max: env.DB_POOL_MAX,
  idle_timeout: 20,
  prepare: !transactionPooler,
  onnotice: () => {},
});
export const db = drizzle(sqlClient, { schema });
export type Db = typeof db;
