import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const trackStatusEnum = pgEnum('track_status', ['processing', 'ready', 'failed']);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Utilisateurs & abonnements
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  // Nullable pour accueillir plus tard les comptes OAuth sans mot de passe.
  passwordHash: text('password_hash'),
  displayName: text('display_name').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('users_email_unique').on(sql`lower(${t.email})`)]);

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('refresh_tokens_hash_unique').on(t.tokenHash), index('refresh_tokens_user_idx').on(t.userId)]);

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export const genres = pgTable('genres', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
});

export const artists = pgTable('artists', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  bio: text('bio'),
  imageKey: text('image_key'),
  // Identifiant dans un catalogue externe, ex. 'jamendo:1234' ; null pour le catalogue local.
  externalId: text('external_id').unique(),
  createdAt: createdAt(),
});

export const albums = pgTable('albums', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  artistId: uuid('artist_id').notNull().references(() => artists.id, { onDelete: 'cascade' }),
  genreId: integer('genre_id').references(() => genres.id, { onDelete: 'set null' }),
  releaseYear: integer('release_year'),
  // Clé de stockage, ou URL absolue pour une pochette hébergée par un catalogue externe.
  coverKey: text('cover_key'),
  externalId: text('external_id').unique(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('albums_artist_title_unique').on(t.artistId, t.title),
  index('albums_genre_idx').on(t.genreId),
]);

export const tracks = pgTable('tracks', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  albumId: uuid('album_id').notNull().references(() => albums.id, { onDelete: 'cascade' }),
  artistId: uuid('artist_id').notNull().references(() => artists.id, { onDelete: 'cascade' }),
  genreId: integer('genre_id').references(() => genres.id, { onDelete: 'set null' }),
  discNumber: integer('disc_number').notNull().default(1),
  trackNumber: integer('track_number'),
  durationMs: integer('duration_ms').notNull().default(0),
  // Préfixe de stockage des rendus HLS : <hlsPrefix>/<variante>/index.m3u8
  hlsPrefix: text('hls_prefix'),
  // Variantes encodées disponibles, ex. ['128k', '256k']
  variants: text('variants').array().notNull().default(sql`'{}'::text[]`),
  status: trackStatusEnum('status').notNull().default('processing'),
  externalId: text('external_id').unique(),
  // Titre externe : URL MP3 lue directement par le lecteur, sans rendu HLS.
  audioUrl: text('audio_url'),
  // Empreinte SHA-256 du fichier source : rend l'ingestion idempotente.
  sourceHash: text('source_hash').notNull().unique(),
  createdAt: createdAt(),
}, (t) => [
  index('tracks_album_idx').on(t.albumId, t.discNumber, t.trackNumber),
  index('tracks_artist_idx').on(t.artistId),
  index('tracks_genre_idx').on(t.genreId),
]);

// ---------------------------------------------------------------------------
// Bibliothèque utilisateur
// ---------------------------------------------------------------------------

export const playlists = pgTable('playlists', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  isPublic: boolean('is_public').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('playlists_owner_idx').on(t.ownerId)]);

export const playlistTracks = pgTable('playlist_tracks', {
  id: uuid('id').primaryKey().defaultRandom(),
  playlistId: uuid('playlist_id').notNull().references(() => playlists.id, { onDelete: 'cascade' }),
  trackId: uuid('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('playlist_tracks_order_idx').on(t.playlistId, t.position)]);

export const favorites = pgTable('favorites', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  trackId: uuid('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.trackId] })]);

// Historique d'écoute : base du futur système de recommandation (filtrage collaboratif).
export const playHistory = pgTable('play_history', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  trackId: uuid('track_id').notNull().references(() => tracks.id, { onDelete: 'cascade' }),
  playedAt: timestamp('played_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('play_history_user_idx').on(t.userId, t.playedAt)]);

// Cache des recherches sur les catalogues externes : économise les quotas d'API (YouTube : ~100 recherches/jour).
export const searchCache = pgTable('search_cache', {
  provider: text('provider').notNull(),
  query: text('query').notNull(),
  trackIds: uuid('track_ids').array().notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.provider, t.query] })]);

export type User = typeof users.$inferSelect;
