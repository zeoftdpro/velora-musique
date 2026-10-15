import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config.js';
import * as schema from './schema.js';

export const sqlClient = postgres(env.DATABASE_URL, { max: env.DB_POOL_MAX, onnotice: () => {} });
export const db = drizzle(sqlClient, { schema });
export type Db = typeof db;
