import { useEffect, useRef, useState } from 'react';
import type { Track } from '../api';
import { useDialog } from '../context/dialog';
import { useLibrary } from '../context/library';
import { useToast } from '../context/toast';
import { ListPlusIcon, PlusIcon } from './icons';

/** Entrées « Ajouter à une playlist » : nouvelle playlist puis playlists existantes. */
export function PlaylistMenuItems({ track, onDone }: { track: Track; onDone: () => void }) {
  const { playlists, addToPlaylist, createPlaylist } = useLibrary();
  const dialog = useDialog();
  const toast = useToast();

  const run = (fn: () => Promise<unknown>) => async () => {
    onDone();
    try {
      await fn();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Action impossible');
    }
  };

  return (
    <>
      <div className="menu__label">Ajouter à une playlist</div>
      <button role="menuitem" onClick={run(async () => {
        const name = await dialog.prompt({ title: 'Nouvelle playlist', label: 'Nom', defaultValue: track.title, confirmLabel: 'Créer' });
        if (!name) return;
        const playlist = await createPlaylist(name);
        await addToPlaylist(playlist.id, track.id, playlist.name);
      })}>
        <PlusIcon size={16} /> Nouvelle playlist…
      </button>
      {playlists.map((p) => (
        <button key={p.id} role="menuitem" onClick={run(() => addToPlaylist(p.id, track.id))}>{p.name}</button>
      ))}
    </>
  );
}

/** Bouton compact « + » ouvrant la liste des playlists (barre du lecteur, panneau « En cours de lecture »). */
export function AddToPlaylistButton({ track, size = 18, direction = 'down' }: { track: Track; size?: number; direction?: 'up' | 'down' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="Ajouter à une playlist"
        title="Ajouter à une playlist" aria-expanded={open}>
        <ListPlusIcon size={size} />
      </button>
      {open && (
        <div className={`menu__panel ${direction === 'up' ? 'menu__panel--up' : ''}`} role="menu">
          <PlaylistMenuItems track={track} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
