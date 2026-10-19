import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDuration, type Track } from '../api';
import { useLibrary } from '../context/library';
import { usePlayer } from '../context/player';
import { useToast } from '../context/toast';
import { Cover } from './Cover';
import { PlaylistMenuItems } from './AddToPlaylist';
import { DownIcon, HeartIcon, MoreIcon, NextIcon, PauseIcon, PlayIcon, QueueIcon, TrashIcon, UpIcon } from './icons';

type Row = Track & { itemId?: string };

type Props = {
  tracks: Row[];
  showAlbum?: boolean;
  showCover?: boolean;
  /** Décalage de numérotation, quand une liste prolonge une autre (« Plus de titres »). */
  offset?: number;
  /** Actions propres aux playlists dont l'utilisateur est propriétaire. */
  onRemove?: (track: Row) => void;
  /** Libellé de l'action de retrait (« Retirer de la playlist » par défaut). */
  removeLabel?: string;
  onMove?: (track: Row, delta: -1 | 1) => void;
};

export function TrackList({ tracks, showAlbum = true, showCover = true, offset = 0, onRemove, removeLabel, onMove }: Props) {
  const { current, playing, playQueue, toggle } = usePlayer();
  const { favoriteIds, toggleFavorite } = useLibrary();

  if (tracks.length === 0) return <p className="muted empty">Aucun titre pour le moment.</p>;

  return (
    <ol className={`tracklist ${showAlbum ? '' : 'tracklist--no-album'}`}>
      {tracks.map((track, i) => {
        const isCurrent = current?.id === track.id;
        const liked = favoriteIds.has(track.id);
        const onPlay = () => (isCurrent ? toggle() : playQueue(tracks, i));
        return (
          <li key={track.itemId ?? track.id} className={`track ${isCurrent ? 'track--current' : ''}`} onDoubleClick={onPlay}>
            <button className="track__index" onClick={onPlay} aria-label={isCurrent && playing ? 'Pause' : `Lire ${track.title}`}>
              <span className="track__num">{isCurrent && playing ? <span className="eq" aria-hidden><i /><i /><i /></span> : offset + i + 1}</span>
              <span className="track__playicon">{isCurrent && playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}</span>
            </button>
            <div className="track__main">
              {showCover && <Cover src={track.album.coverUrl} alt={track.album.title} size={40} />}
              <div className="track__text">
                <span className="track__title-row">
                  <span className="track__title">{track.title}</span>
                  {track.source !== 'local' && (
                    <span className={`source-pill source-pill--${track.source}`}>{track.source === 'youtube' ? 'YouTube' : 'Jamendo'}</span>
                  )}
                </span>
                <Link className="track__artist" to={`/artist/${track.artist.id}`}>{track.artist.name}</Link>
              </div>
            </div>
            {showAlbum && (
              <Link className="track__album" to={`/album/${track.album.id}`}>{track.album.title}</Link>
            )}
            <button className={`icon-btn track__like ${liked ? 'is-active' : ''}`} onClick={() => toggleFavorite(track.id)}
              aria-label={liked ? 'Retirer des titres likés' : 'Ajouter aux titres likés'} aria-pressed={liked}>
              <HeartIcon size={18} filled={liked} />
            </button>
            <span className="track__duration">{formatDuration(track.durationMs)}</span>
            <TrackMenu track={track} index={i} count={tracks.length} onRemove={onRemove} removeLabel={removeLabel} onMove={onMove} />
          </li>
        );
      })}
    </ol>
  );
}

function TrackMenu({ track, index, count, onRemove, removeLabel = 'Retirer de la playlist', onMove }: { track: Row; index: number; count: number } & Pick<Props, 'onRemove' | 'removeLabel' | 'onMove'>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { playNext, addToQueue } = usePlayer();
  const toast = useToast();

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

  const run = (fn: () => unknown) => async () => {
    setOpen(false);
    try {
      await fn();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Action impossible');
    }
  };

  return (
    <div className="menu" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="Plus d'options" aria-expanded={open}>
        <MoreIcon size={18} />
      </button>
      {open && (
        <div className="menu__panel" role="menu">
          <button role="menuitem" onClick={run(() => { playNext(track); toast('Sera lu juste après'); })}>
            <NextIcon size={16} /> Lire ensuite
          </button>
          <button role="menuitem" onClick={run(() => { addToQueue(track); toast('Ajouté à la file d’attente'); })}>
            <QueueIcon size={16} /> Ajouter à la file d’attente
          </button>
          <div className="menu__sep" />
          <PlaylistMenuItems track={track} onDone={() => setOpen(false)} />
          {(onMove || onRemove) && <div className="menu__sep" />}
          {onMove && index > 0 && (
            <button role="menuitem" onClick={run(() => onMove(track, -1))}><UpIcon size={16} /> Monter</button>
          )}
          {onMove && index < count - 1 && (
            <button role="menuitem" onClick={run(() => onMove(track, 1))}><DownIcon size={16} /> Descendre</button>
          )}
          {onRemove && (
            <button role="menuitem" className="danger" onClick={run(() => onRemove(track))}><TrashIcon size={16} /> {removeLabel}</button>
          )}
        </div>
      )}
    </div>
  );
}
