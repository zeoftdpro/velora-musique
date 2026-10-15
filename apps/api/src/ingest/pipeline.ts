import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { parseFile, type IAudioMetadata } from 'music-metadata';
import { db } from '../db/client.js';
import { albums, artists, genres, tracks } from '../db/schema.js';
import { slugify } from '../lib/slug.js';
import { storage } from '../lib/storage.js';
import { VARIANTS, type VariantName } from '../lib/variants.js';
import { runFfmpeg } from './ffmpeg.js';

export const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.aiff', '.wma']);
const SIDE_COVERS = ['cover.jpg', 'cover.jpeg', 'cover.png', 'folder.jpg', 'folder.png', 'front.jpg'];

/** Durée cible d'un segment HLS (secondes) : compromis entre démarrage rapide et nombre de requêtes. */
const SEGMENT_SECONDS = 6;
const ENCODED_VARIANTS = Object.keys(VARIANTS) as VariantName[];

export type IngestResult =
  | { status: 'ingested'; trackId: string; title: string }
  | { status: 'skipped'; trackId: string; title: string }
  | { status: 'failed'; file: string; error: string };

function hashFile(file: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

async function upsertGenre(name: string | undefined) {
  if (!name?.trim()) return null;
  const slug = slugify(name);
  await db.insert(genres).values({ name: name.trim(), slug }).onConflictDoNothing();
  const [g] = await db.select({ id: genres.id }).from(genres).where(eq(genres.slug, slug));
  return g?.id ?? null;
}

async function upsertArtist(name: string) {
  const slug = slugify(name);
  await db.insert(artists).values({ name, slug }).onConflictDoNothing();
  const [a] = await db.select({ id: artists.id }).from(artists).where(eq(artists.slug, slug));
  return a!.id;
}

async function upsertAlbum(title: string, artistId: string, genreId: number | null, releaseYear?: number) {
  await db.insert(albums).values({ title, artistId, genreId, releaseYear }).onConflictDoNothing();
  const [a] = await db
    .select({ id: albums.id, coverKey: albums.coverKey })
    .from(albums)
    .where(and(eq(albums.artistId, artistId), eq(albums.title, title)));
  return a!;
}

async function findCover(file: string, meta: IAudioMetadata) {
  const embedded = meta.common.picture?.[0];
  if (embedded) {
    const ext = embedded.format.includes('png') ? 'png' : 'jpg';
    return { data: Buffer.from(embedded.data), ext, contentType: embedded.format };
  }
  const dir = path.dirname(file);
  const entries = new Set((await readdir(dir)).map((e) => e.toLowerCase()));
  for (const candidate of SIDE_COVERS) {
    if (entries.has(candidate)) {
      const actual = (await readdir(dir)).find((e) => e.toLowerCase() === candidate)!;
      const ext = candidate.endsWith('png') ? 'png' : 'jpg';
      return { data: await readFile(path.join(dir, actual)), ext, contentType: ext === 'png' ? 'image/png' : 'image/jpeg' };
    }
  }
  return null;
}

/** Encode un fichier audio en HLS (AAC, segments MPEG-TS) pour une variante de débit. */
async function encodeVariant(input: string, outDir: string, variant: VariantName) {
  const dir = path.join(outDir, variant);
  await mkdir(dir, { recursive: true });
  await runFfmpeg([
    '-i', input,
    '-map', '0:a:0',
    '-vn',
    '-map_metadata', '-1',
    '-c:a', 'aac',
    '-b:a', variant,
    '-ar', '44100',
    '-ac', '2',
    '-f', 'hls',
    '-hls_time', String(SEGMENT_SECONDS),
    '-hls_playlist_type', 'vod',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', path.join(dir, 'seg_%04d.ts'),
    path.join(dir, 'index.m3u8'),
  ]);
  return dir;
}

async function uploadDir(localDir: string, prefix: string) {
  const files = await readdir(localDir);
  // Envois par lots pour ne pas saturer le stockage objet.
  for (let i = 0; i < files.length; i += 8) {
    await Promise.all(
      files.slice(i, i + 8).map(async (name) => {
        const contentType = name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
        await storage.put(`${prefix}/${name}`, await readFile(path.join(localDir, name)), contentType);
      }),
    );
  }
}

export async function ingestFile(file: string, opts: { force?: boolean } = {}): Promise<IngestResult> {
  const sourceHash = await hashFile(file);
  const [existing] = await db
    .select({ id: tracks.id, title: tracks.title, status: tracks.status })
    .from(tracks)
    .where(eq(tracks.sourceHash, sourceHash));
  if (existing?.status === 'ready' && !opts.force) return { status: 'skipped', trackId: existing.id, title: existing.title };

  const meta = await parseFile(file, { duration: true });
  const c = meta.common;
  const folder = path.basename(path.dirname(file));
  const title = c.title?.trim() || path.basename(file, path.extname(file)).replace(/^\d+[\s.-]+/, '');
  const artistName = (c.albumartist || c.artist)?.trim() || 'Artiste inconnu';
  const trackArtistName = c.artist?.trim() || artistName;
  const albumTitle = c.album?.trim() || folder || 'Single';

  const genreId = await upsertGenre(c.genre?.[0]);
  const albumArtistId = await upsertArtist(artistName);
  const trackArtistId = trackArtistName === artistName ? albumArtistId : await upsertArtist(trackArtistName);
  const album = await upsertAlbum(albumTitle, albumArtistId, genreId, c.year);

  if (!album.coverKey) {
    const cover = await findCover(file, meta);
    if (cover) {
      const coverKey = `covers/albums/${album.id}.${cover.ext}`;
      await storage.put(coverKey, cover.data, cover.contentType);
      await db.update(albums).set({ coverKey }).where(eq(albums.id, album.id));
    }
  }

  const values = {
    title,
    albumId: album.id,
    artistId: trackArtistId,
    genreId,
    discNumber: c.disk?.no ?? 1,
    trackNumber: c.track?.no ?? null,
    durationMs: Math.round((meta.format.duration ?? 0) * 1000),
    status: 'processing' as const,
    sourceHash,
  };
  const [track] = existing
    ? await db.update(tracks).set(values).where(eq(tracks.id, existing.id)).returning({ id: tracks.id })
    : await db.insert(tracks).values(values).returning({ id: tracks.id });
  const trackId = track!.id;

  const workDir = await mkdtemp(path.join(os.tmpdir(), 'velora-hls-'));
  try {
    const hlsPrefix = `tracks/${trackId}`;
    for (const variant of ENCODED_VARIANTS) {
      const dir = await encodeVariant(file, workDir, variant);
      await uploadDir(dir, `${hlsPrefix}/${variant}`);
    }
    await db
      .update(tracks)
      .set({ hlsPrefix, variants: ENCODED_VARIANTS, status: 'ready' })
      .where(eq(tracks.id, trackId));
    return { status: 'ingested', trackId, title };
  } catch (err) {
    await db.update(tracks).set({ status: 'failed' }).where(eq(tracks.id, trackId));
    throw err;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function collectAudioFiles(target: string): Promise<string[]> {
  const entries = await readdir(target, { withFileTypes: true, recursive: true }).catch(() => null);
  if (!entries) return AUDIO_EXTENSIONS.has(path.extname(target).toLowerCase()) ? [target] : [];
  return entries
    .filter((e) => e.isFile() && AUDIO_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(e.parentPath, e.name))
    .sort();
}
