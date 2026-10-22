import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDuration } from '../api';
import { useLibrary } from '../context/library';
import { usePlayer, useProgress } from '../context/player';
import { Cover } from './Cover';
import { PANEL_MEDIA, useMediaQuery } from '../hooks';
import { AddToPlaylistButton } from './AddToPlaylist';
import { HeartIcon, NextIcon, PanelIcon, PauseIcon, PlayIcon, PrevIcon, RepeatIcon, ShuffleIcon, VideoIcon, VolumeIcon } from './icons';

export function PlayerBar() {
  const {
    current, playing, loading, toggle, next, prev, volume, muted, setVolume, toggleMute, quality, queue, index,
    videoHidden, toggleVideo, shuffle, toggleShuffle, repeat, cycleRepeat, panelOpen, togglePanel, videoInPanel,
    playlistChain, queueSource,
  } = usePlayer();
  // Fin de la file : « suivant » reste possible si la file boucle ou si une autre playlist va s'enchaîner.
  const hasNext = index < queue.length - 1 || repeat === 'all' || (playlistChain && queueSource?.kind === 'playlist');
  const { favoriteIds, toggleFavorite } = useLibrary();
  const wide = useMediaQuery(PANEL_MEDIA);
  const repeatLabel = repeat === 'off' ? 'Répéter : désactivé' : repeat === 'all' ? 'Répéter : toute la file' : 'Répéter : ce titre';

  return (
    <footer className={`player ${current ? '' : 'player--idle'}`} aria-label="Lecteur">
      <div className="player__now">
        {current ? (
          <>
            <Cover src={current.album.coverUrl} alt={current.album.title} size={56} />
            <div className="player__meta">
              <Link to={`/album/${current.album.id}`} className="player__title">{current.title}</Link>
              <Link to={`/artist/${current.artist.id}`} className="player__artist">{current.artist.name}</Link>
            </div>
            <button className={`icon-btn ${favoriteIds.has(current.id) ? 'is-active' : ''}`} onClick={() => toggleFavorite(current.id)}
              aria-label="J'aime" aria-pressed={favoriteIds.has(current.id)}>
              <HeartIcon size={18} filled={favoriteIds.has(current.id)} />
            </button>
            <AddToPlaylistButton track={current} direction="up" />
          </>
        ) : (
          <span className="muted player__idle">Choisissez un titre pour lancer la lecture</span>
        )}
      </div>

      <div className="player__center">
        <div className="player__controls">
          <button className={`icon-btn player__mode ${shuffle ? 'is-on' : ''}`} onClick={toggleShuffle}
            aria-label="Lecture aléatoire" aria-pressed={shuffle} title={shuffle ? 'Lecture aléatoire : activée' : 'Lecture aléatoire'}>
            <ShuffleIcon size={18} />
          </button>
          <button className="icon-btn" onClick={prev} disabled={!current} aria-label="Précédent"><PrevIcon /></button>
          <button className={`player__toggle ${loading ? 'is-loading' : ''}`} onClick={toggle} disabled={!current} aria-label={playing ? 'Pause' : 'Lecture'}>
            {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
          </button>
          <button className="icon-btn" onClick={next} disabled={!current || !hasNext} aria-label="Suivant"><NextIcon /></button>
          <button className={`icon-btn player__mode ${repeat !== 'off' ? 'is-on' : ''}`} onClick={cycleRepeat}
            aria-label={repeatLabel} title={repeatLabel}>
            <RepeatIcon size={18} one={repeat === 'one'} />
          </button>
        </div>
        <SeekBar />
      </div>

      <div className="player__side">
        {current?.source === 'youtube' && !videoInPanel && (
          <button className={`icon-btn ${videoHidden ? '' : 'is-active'}`} onClick={toggleVideo}
            aria-label={videoHidden ? 'Afficher la vidéo' : 'Masquer la vidéo'} aria-pressed={!videoHidden} title={videoHidden ? 'Afficher la vidéo' : 'Masquer la vidéo'}>
            <VideoIcon size={18} />
          </button>
        )}
        {quality && <span className="badge" title="Source ou qualité du flux en cours">{quality}</span>}
        {wide && (
          <button className={`icon-btn ${panelOpen ? 'is-on' : ''}`} onClick={togglePanel}
            aria-label="Panneau « En cours de lecture »" aria-pressed={panelOpen} title="En cours de lecture">
            <PanelIcon size={18} />
          </button>
        )}
        <button className="icon-btn" onClick={toggleMute} aria-label={muted ? 'Réactiver le son' : 'Couper le son'}>
          <VolumeIcon level={muted ? 0 : volume} />
        </button>
        <input className="range range--volume" type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume}
          onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume"
          style={{ '--fill': `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties} />
      </div>
    </footer>
  );
}

function SeekBar() {
  const { seek, current } = usePlayer();
  const { currentTime, duration, buffered } = useProgress();
  // Pendant le glissement, on affiche la position visée sans interrompre la lecture.
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? currentTime;
  const pct = duration ? (shown / duration) * 100 : 0;

  return (
    <div className="seek">
      <span className="seek__time">{formatDuration(shown * 1000)}</span>
      <input className="range" type="range" min={0} max={duration || 1} step={0.1} value={shown} disabled={!current}
        aria-label="Position de lecture"
        style={{ '--fill': `${pct}%`, '--buffer': `${duration ? (buffered / duration) * 100 : 0}%` } as React.CSSProperties}
        onChange={(e) => setDragging(Number(e.target.value))}
        onPointerUp={() => { if (dragging !== null) seek(dragging); setDragging(null); }}
        onKeyUp={() => { if (dragging !== null) seek(dragging); setDragging(null); }} />
      <span className="seek__time">{formatDuration(duration * 1000)}</span>
    </div>
  );
}
