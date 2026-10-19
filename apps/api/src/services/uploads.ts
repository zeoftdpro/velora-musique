import { and, count, eq, notExists } from 'drizzle-orm';
import { db } from '../db/client.js';
import { albums, artists, playlists, tracks } from '../db/schema.js';
import { storage } from '../lib/storage.js';

/** Taille maximale d'un fichier téléversé (limite par fichier du stockage Supabase gratuit). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Plafond par compte : l'espace de stockage gratuit (1 Go) est partagé par tous. */
export const MAX_UPLOADS_PER_USER = 300;
export const UPLOADS_PLAYLIST_NAME = 'Musiques téléversées';

export async function countUploads(userId: string) {
  const [row] = await db.select({ n: count() }).from(tracks).where(eq(tracks.ownerId, userId));
  return row?.n ?? 0;
}

/** Catégorie « Musiques téléversées » du compte, créée au premier envoi (renommable ensuite). */
export async function uploadsPlaylist(userId: string) {
  await db
    .insert(playlists)
    .values({ ownerId: userId, name: UPLOADS_PLAYLIST_NAME, kind: 'uploads' })
    .onConflictDoNothing();
  const [playlist] = await db
    .select({ id: playlists.id })
    .from(playlists)
    .where(and(eq(playlists.ownerId, userId), eq(playlists.kind, 'uploads')));
  return playlist!.id;
}

/**
 * Supprime définitivement une musique téléversée : fichiers audio, puis album et artiste s'ils sont devenus vides.
 * Renvoie false si le titre n'existe pas ou n'appartient pas à `ownerId`.
 */
export async function deleteUploadedTrack(trackId: string, ownerId: string) {
  const [track] = await db
    .delete(tracks)
    .where(and(eq(tracks.id, trackId), eq(tracks.ownerId, ownerId)))
    .returning({ albumId: tracks.albumId, artistId: tracks.artistId, hlsPrefix: tracks.hlsPrefix });
  if (!track) return false;

  const [album] = await db
    .delete(albums)
    .where(and(eq(albums.id, track.albumId), eq(albums.ownerId, ownerId), notExists(db.select().from(tracks).where(eq(tracks.albumId, track.albumId)))))
    .returning({ coverKey: albums.coverKey, artistId: albums.artistId });
  // Artiste du titre, et artiste de l'album s'il est différent (featuring, compilation).
  for (const artistId of new Set([track.artistId, album?.artistId].filter((id) => id !== undefined))) {
    await db
      .delete(artists)
      .where(
        and(
          eq(artists.id, artistId),
          eq(artists.ownerId, ownerId),
          notExists(db.select().from(tracks).where(eq(tracks.artistId, artistId))),
          notExists(db.select().from(albums).where(eq(albums.artistId, artistId))),
        ),
      );
  }

  // La base fait foi : un fichier orphelin dans le stockage n'empêche pas la suppression.
  await Promise.all([
    track.hlsPrefix ? storage.remove(`${track.hlsPrefix}/`) : undefined,
    album?.coverKey && !/^https?:/.test(album.coverKey) ? storage.remove(album.coverKey) : undefined,
  ]).catch((err: Error) => console.warn('Nettoyage du stockage incomplet :', err.message));
  return true;
}
