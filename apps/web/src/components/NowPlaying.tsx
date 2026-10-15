import { Link } from 'react-router-dom';
import { formatDuration } from '../api';
import { useLibrary } from '../context/library';
import { usePlayer } from '../context/player';
import { AddToPlaylistButton } from './AddToPlaylist';
import { Cover } from './Cover';
import { CloseIcon, HeartIcon } from './icons';

const UP_NEXT_COUNT = 10;

/** Panneau « En cours de lecture », à droite (comme Spotify) : clip YouTube ou pochette, infos et file d'attente. */
export function NowPlayingPanel() {
  const { current, queue, index, togglePanel, registerVideoSlot, jumpTo } = usePlayer();
  const { favoriteIds, toggleFavorite } = useLibrary();

  if (!current) {
    return (
      <aside className="np" aria-label="En cours de lecture">
        <header className="np__head">
          <span>En cours de lecture</span>
          <button className="icon-btn" onClick={togglePanel} aria-label="Fermer le panneau"><CloseIcon size={18} /></button>
        </header>
        <p className="muted np__empty">Lancez un titre : sa pochette, ou son clip pour les titres YouTube, s’affichera ici.</p>
      </aside>
    );
  }

  const liked = favoriteIds.has(current.id);
  const upNext = queue.slice(index + 1, index + 1 + UP_NEXT_COUNT);

  return (
    <aside className="np" aria-label="En cours de lecture">
      <header className="np__head">
        <Link to={`/album/${current.album.id}`} className="np__context">{current.album.title}</Link>
        <button className="icon-btn" onClick={togglePanel} aria-label="Fermer le panneau"><CloseIcon size={18} /></button>
      </header>

      {current.source === 'youtube' ? (
        // Emplacement du clip : le lecteur YouTube (géré par PlayerProvider) vient s'y superposer.
        <div className="np__video" ref={registerVideoSlot} />
      ) : (
        <div className="np__art"><Cover src={current.album.coverUrl} alt={current.album.title} /></div>
      )}

      <div className="np__info">
        <div className="np__titles">
          <Link to={`/album/${current.album.id}`} className="np__title">{current.title}</Link>
          <Link to={`/artist/${current.artist.id}`} className="np__artist">{current.artist.name}</Link>
        </div>
        <AddToPlaylistButton track={current} size={20} />
        <button className={`icon-btn ${liked ? 'is-active' : ''}`} onClick={() => toggleFavorite(current.id)}
          aria-label={liked ? 'Retirer des titres likés' : 'Ajouter aux titres likés'} aria-pressed={liked}>
          <HeartIcon size={20} filled={liked} />
        </button>
      </div>

      <section className="np__queue">
        <h3 className="np__queue-title">À suivre</h3>
        {upNext.length === 0 ? (
          <p className="muted small">Fin de la file d’attente. Ajoutez des titres avec « Ajouter à la file d’attente ».</p>
        ) : (
          <ol className="np__list">
            {upNext.map((track, i) => (
              <li key={`${track.id}-${i}`}>
                <button className="np__item" onClick={() => jumpTo(index + 1 + i)} aria-label={`Lire ${track.title}`}>
                  <Cover src={track.album.coverUrl} alt={track.album.title} size={40} />
                  <span className="np__item-text">
                    <span className="np__item-title">{track.title}</span>
                    <span className="np__item-artist">{track.artist.name}</span>
                  </span>
                  <span className="np__item-duration">{formatDuration(track.durationMs)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
