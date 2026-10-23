import { useSyncExternalStore } from 'react';
import { api, ApiError, type ImportSource, type SourceTrack, type Track } from './api';

/**
 * Import par lien (Spotify, Deezer, Apple Music, YouTube). L'état vit hors des composants : l'import continue
 * si l'on quitte la page, et la page le retrouve en y revenant.
 */
export type ImportJob = {
  status: 'idle' | 'reading' | 'ready' | 'importing' | 'done' | 'error';
  source: ImportSource | null;
  playlistId: string | null;
  /** Morceaux traités (trouvés ou non). */
  processed: number;
  found: Track[];
  missing: SourceTrack[];
  error: string | null;
};

export const PROVIDER_NAMES: Record<ImportSource['provider'], string> = {
  spotify: 'Spotify',
  deezer: 'Deezer',
  apple: 'Apple Music',
  youtube: 'YouTube',
};

const BATCH = 10;
const IDLE: ImportJob = { status: 'idle', source: null, playlistId: null, processed: 0, found: [], missing: [], error: null };

let job: ImportJob = IDLE;
let runId = 0;
const listeners = new Set<() => void>();

function set(patch: Partial<ImportJob>) {
  job = { ...job, ...patch };
  listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useImportJob = () => useSyncExternalStore(subscribe, () => job);

const message = (err: unknown) => (err instanceof ApiError || err instanceof Error ? err.message : 'Import impossible');

/** Étape 1 : lecture du lien. */
export async function readLink(url: string) {
  const id = ++runId;
  set({ ...IDLE, status: 'reading' });
  try {
    const source = await api.importPreview(url);
    if (id === runId) set({ status: 'ready', source });
  } catch (err) {
    if (id === runId) set({ status: 'error', error: message(err) });
  }
}

/**
 * Étape 2 : crée la playlist (sauf pour un titre seul) puis envoie les morceaux par lots.
 * `onPlaylistChange` : la bibliothèque se met à jour dès la création, puis à la fin.
 */
export async function runImport(name: string, onPlaylistChange: () => void) {
  const source = job.source;
  if (!source || job.status !== 'ready') return;
  const id = ++runId;
  set({ status: 'importing', processed: 0, found: [], missing: [], error: null });
  try {
    let playlistId: string | undefined;
    if (source.kind !== 'track') {
      const playlist = await api.createPlaylist({ name: name.trim() || source.name, description: `Importée depuis ${PROVIDER_NAMES[source.provider]}` });
      playlistId = playlist.id;
      set({ playlistId });
      onPlaylistChange();
    }
    for (let i = 0; i < source.tracks.length; i += BATCH) {
      if (id !== runId) return;
      const batch = source.tracks.slice(i, i + BATCH);
      const { results } = await api.importMatch(batch, playlistId);
      if (id !== runId) return;
      set({
        processed: job.processed + batch.length,
        found: [...job.found, ...results.filter((t): t is Track => t !== null)],
        missing: [...job.missing, ...batch.filter((_, j) => !results[j])],
      });
    }
    set({ status: 'done' });
  } catch (err) {
    if (id === runId) set({ status: 'error', error: message(err) });
  } finally {
    if (source.kind !== 'track') onPlaylistChange();
  }
}

export function resetImport() {
  runId++;
  set(IDLE);
}
