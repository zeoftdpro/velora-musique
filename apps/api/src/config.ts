import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

// Le fichier .env vit à la racine du monorepo.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
loadDotenv({ path: path.join(repoRoot, '.env'), quiet: true });

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const EnvSchema = z.object({
  // Render, Railway… imposent le port via PORT.
  API_PORT: z.coerce.number().int().default(Number(process.env.PORT) || 4000),
  // Sur Render, l'adresse publique du service est fournie automatiquement (RENDER_EXTERNAL_URL).
  PUBLIC_API_URL: z.string().url().default(process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:4000'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET doit faire au moins 16 caractères'),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  DATABASE_URL: z.string().default('postgres://velora:velora@localhost:5432/velora'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  MEILI_HOST: optionalString,
  MEILI_API_KEY: optionalString,

  STORAGE_DRIVER: z.enum(['s3', 'local']).default('s3'),
  LOCAL_STORAGE_DIR: z.string().default('./storage'),
  S3_ENDPOINT: optionalString,
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('velora'),
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: z.preprocess((v) => v === 'true' || v === true, z.boolean()).default(false),
  PUBLIC_ASSETS_URL: optionalString,

  CLOUDFRONT_DOMAIN: optionalString,
  CLOUDFRONT_KEY_PAIR_ID: optionalString,
  CLOUDFRONT_PRIVATE_KEY_PATH: optionalString,

  STREAM_URL_TTL_SECONDS: z.coerce.number().int().positive().default(14400),

  FFMPEG_PATH: optionalString,

  JAMENDO_CLIENT_ID: optionalString,
  YOUTUBE_API_KEY: optionalString,
  // Pays pour lequel les vidéos doivent être lisibles (ISO 3166-1 alpha-2).
  YOUTUBE_REGION_CODE: z.string().length(2).default('FR'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Configuration invalide :');
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export const paths = {
  repoRoot,
  localStorageDir: path.resolve(repoRoot, env.LOCAL_STORAGE_DIR),
};
