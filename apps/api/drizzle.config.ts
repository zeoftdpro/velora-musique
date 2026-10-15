import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit s'exécute depuis apps/api ; le .env est à la racine du monorepo.
config({ path: '../../.env', quiet: true });

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://velora:velora@localhost:5432/velora' },
});
