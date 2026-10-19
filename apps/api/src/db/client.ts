import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config.js';
import * as schema from './schema.js';

// idle_timeout : sur Vercel, une instance inactive rend ses connexions au pooler Supabase (nombre limité).
export const sqlClient = postgres(env.DATABASE_URL, { max: env.DB_POOL_MAX, idle_timeout: 30, onnotice: () => {} });
export const db = drizzle(sqlClient, { schema });
export type Db = typeof db;
