import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type PlaylistSummary } from '../api';
import { useToast } from './toast';

type LibraryState = {
  favoriteIds: Set<string>;
  toggleFavorite: (trackId: string) => Promise<void>;
  playlists: PlaylistSummary[];
  reloadPlaylists: () => Promise<void>;
  createPlaylist: (name: string) => Promise<PlaylistSummary>;
  addToPlaylist: (playlistId: string, trackId: string, playlistName?: string) => Promise<void>;
};

const LibraryContext = createContext<LibraryState | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);

  const reloadPlaylists = useCallback(async () => setPlaylists(await api.playlists()), []);

  useEffect(() => {
    api.favoriteIds().then((ids) => setFavoriteIds(new Set(ids))).catch(() => undefined);
    reloadPlaylists().catch(() => undefined);
  }, [reloadPlaylists]);

  const toggleFavorite = useCallback(
    async (trackId: string) => {
      const liked = favoriteIds.has(trackId);
      // Mise à jour optimiste, annulée en cas d'erreur.
      const update = (add: boolean) =>
        setFavoriteIds((prev) => {
          const next = new Set(prev);
          if (add) next.add(trackId);
          else next.delete(trackId);
          return next;
        });
      update(!liked);
      try {
        await (liked ? api.removeFavorite(trackId) : api.addFavorite(trackId));
        toast(liked ? 'Retiré des titres likés' : 'Ajouté aux titres likés');
      } catch {
        update(liked);
        toast('Impossible de mettre à jour vos favoris');
      }
    },
    [favoriteIds, toast],
  );

  const value = useMemo<LibraryState>(
    () => ({
      favoriteIds,
      toggleFavorite,
      playlists,
      reloadPlaylists,
      createPlaylist: async (name) => {
        const playlist = await api.createPlaylist({ name });
        await reloadPlaylists();
        return playlist;
      },
      addToPlaylist: async (playlistId, trackId, playlistName) => {
        await api.addToPlaylist(playlistId, trackId);
        await reloadPlaylists();
        toast(`Ajouté à « ${playlistName ?? playlists.find((p) => p.id === playlistId)?.name ?? 'la playlist'} »`);
      },
    }),
    [favoriteIds, toggleFavorite, playlists, reloadPlaylists, toast],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary doit être utilisé dans <LibraryProvider>');
  return ctx;
}
