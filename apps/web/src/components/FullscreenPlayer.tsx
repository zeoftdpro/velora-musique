import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type LyricLine, type Lyrics } from '../api';
import { useLibrary } from '../context/library';
import { usePlayer, useProgress, useVideoSlot } from '../context/player';
import { useAsync, useCoverColor, useMediaQuery } from '../hooks';
import { AddToPlaylistButton } from './AddToPlaylist';
import { Cover } from './Cover';
import {
  DownIcon, HeartIcon, LyricsIcon, MaximizeIcon, MinimizeIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, RepeatIcon, ShuffleIcon, VolumeIcon,
} from './icons';
import { SeekBar } from './PlayerBar';

const MEDIA_KEY = 'velora.fullscreenMedia';
const NARROW = '(max-width: 860px)';

function readMedia(): 'cover' | 'video' {
  try {
    return localStorage.getItem(MEDIA_KEY) === 'cover' ? 'cover' : 'video';
  } catch {
    return 'video';
  }
}

/**
 * Lecteur plein écran, comme celui de Liner : fond animé aux couleurs de la pochette, pochette ou clip YouTube,
 * commandes, et paroles synchronisées qui s'allument mot à mot.
 */
export function FullscreenPlayer() {
  const { nowPlayingOpen, current } = usePlayer();
  if (!nowPlayingOpen || !current) return null;
  return <FullscreenView />;
}

function FullscreenView() {
  const {
    current, playing, loading, toggle, next, prev, shuffle, toggleShuffle, repeat, cycleRepeat, volume, muted, setVolume, toggleMute,
    setNowPlayingOpen, videoCaptions, setVideoCaptions,
  } = usePlayer();
  const track = current!;
  const { favoriteIds, toggleFavorite } = useLibrary();
  const narrow = useMediaQuery(NARROW);
  const tint = useCoverColor(track.album.coverUrl, track.title);
  const { data: lyrics, loading: lyricsLoading, error: lyricsError, reload: reloadLyrics } = useAsync(() => api.lyrics(track.id), [track.id]);
  const [media, setMedia] = useState(readMedia);
  const [mobileView, setMobileView] = useState<'player' | 'lyrics'>('player');
  const [lyricsHidden, setLyricsHidden] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement));
  // Décalage des paroles estimées (ms, positif : plus tard), remis à zéro à chaque titre.
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [track.id]);
  const videoSlot = useVideoSlot();

  const isYoutube = track.source === 'youtube';
  const showVideo = isYoutube && media === 'video';
  const showLyrics = narrow ? mobileView === 'lyrics' : !lyricsHidden;
  const liked = favoriteIds.has(track.id);

  const close = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    setNowPlayingOpen(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.fullscreenElement && setNowPlayingOpen(false);
    const onFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [setNowPlayingOpen]);

  const chooseMedia = (value: 'cover' | 'video') => {
    setMedia(value);
    try {
      localStorage.setItem(MEDIA_KEY, value);
    } catch {
      /* stockage indisponible */
    }
  };
  // Toute la page passe en plein écran : le clip YouTube, superposé depuis l'extérieur du lecteur, reste visible.
  const toggleFullscreen = () =>
    document.fullscreenElement ? void document.exitFullscreen().catch(() => {}) : void document.documentElement.requestFullscreen().catch(() => {});

  const controls = (
    <div className="fs-controls">
      <button className={`icon-btn ${shuffle ? 'is-on' : ''}`} onClick={toggleShuffle} aria-label="Lecture aléatoire" aria-pressed={shuffle}><ShuffleIcon size={20} /></button>
      <button className="icon-btn" onClick={prev} aria-label="Précédent"><PrevIcon size={24} /></button>
      <button className={`fs-controls__play ${loading ? 'is-loading' : ''}`} onClick={toggle} aria-label={playing ? 'Pause' : 'Lecture'}>
        {playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
      </button>
      <button className="icon-btn" onClick={next} aria-label="Suivant"><NextIcon size={24} /></button>
      <button className={`icon-btn ${repeat !== 'off' ? 'is-on' : ''}`} onClick={cycleRepeat} aria-label="Répéter"><RepeatIcon size={20} one={repeat === 'one'} /></button>
    </div>
  );

  return (
    <div className="fs" role="dialog" aria-modal="true" aria-label="Lecture en cours" style={{ '--tint': tint } as React.CSSProperties}>
      <div className="fs__bg" aria-hidden>
        {track.album.coverUrl && <><img src={track.album.coverUrl} alt="" /><img src={track.album.coverUrl} alt="" /></>}
      </div>

      <header className="fs__top">
        <button className="fs__btn" onClick={close} aria-label="Fermer le lecteur plein écran" title="Fermer (Échap)"><DownIcon size={22} /></button>
        <div className="fs__top-actions">
          {isYoutube && (
            <div className="segmented segmented--glass" role="radiogroup" aria-label="Afficher">
              <button role="radio" aria-checked={media === 'cover'} onClick={() => chooseMedia('cover')}>Pochette</button>
              <button role="radio" aria-checked={media === 'video'} onClick={() => chooseMedia('video')}>Clip</button>
            </div>
          )}
          {showVideo && (
            <button className={`fs__btn fs__btn--text ${videoCaptions ? 'is-on' : ''}`} onClick={() => setVideoCaptions(!videoCaptions)}
              aria-pressed={videoCaptions} aria-label="Sous-titres de la vidéo" title="Sous-titres de la vidéo">CC</button>
          )}
          {narrow ? (
            <button className={`fs__btn ${mobileView === 'lyrics' ? 'is-on' : ''}`} onClick={() => setMobileView((v) => (v === 'lyrics' ? 'player' : 'lyrics'))}
              aria-label="Paroles" aria-pressed={mobileView === 'lyrics'}><LyricsIcon size={20} /></button>
          ) : (
            <>
              <button className={`fs__btn ${showLyrics ? 'is-on' : ''}`} onClick={() => setLyricsHidden((h) => !h)} aria-label="Paroles" aria-pressed={showLyrics} title="Paroles">
                <LyricsIcon size={20} />
              </button>
              <button className="fs__btn" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'} title={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}>
                {isFullscreen ? <MinimizeIcon size={20} /> : <MaximizeIcon size={20} />}
              </button>
            </>
          )}
        </div>
      </header>

      <div className={`fs__body ${showLyrics ? '' : 'fs__body--solo'} ${narrow && showLyrics ? 'fs__body--lyrics' : ''}`}>
        <section className={`fs__player ${narrow && showLyrics ? 'fs__player--compact' : ''}`}>
          <div className={`fs__media ${showVideo ? 'fs__media--video' : ''}`}>
            {/* Emplacement du clip : le lecteur YouTube vient s'y superposer ; masqué, il rend la place à la pochette. */}
            <div className="fs__video" ref={videoSlot} hidden={!showVideo} />
            {!showVideo && <Cover src={track.album.coverUrl} alt={track.album.title} />}
          </div>
          <div className="fs__info">
            <div className="fs__titles">
              <Link to={`/album/${track.album.id}`} onClick={close} className="fs__title">{track.title}</Link>
              <Link to={`/artist/${track.artist.id}`} onClick={close} className="fs__artist">{track.artist.name}</Link>
            </div>
            <AddToPlaylistButton track={track} size={20} direction="up" />
            <button className={`icon-btn ${liked ? 'is-active' : ''}`} onClick={() => toggleFavorite(track.id)} aria-label="J'aime" aria-pressed={liked}>
              <HeartIcon size={20} filled={liked} />
            </button>
          </div>
          <SeekBar />
          {controls}
          <div className="fs__volume">
            <button className="icon-btn" onClick={toggleMute} aria-label={muted ? 'Réactiver le son' : 'Couper le son'}><VolumeIcon level={muted ? 0 : volume} size={18} /></button>
            <input className="range" type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume} aria-label="Volume"
              onChange={(e) => setVolume(Number(e.target.value))} style={{ '--fill': `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties} />
          </div>
          {lyrics?.estimated && showLyrics && (
            // Aucune version synchronisée n'existe : l'horodatage est deviné, on peut le caler à l'oreille.
            <div className="fs__offset">
              <span>Synchro estimée</span>
              <button onClick={() => setOffset((o) => o - 1000)} aria-label="Paroles plus tôt">− 1 s</button>
              <output>{offset === 0 ? '0 s' : `${offset > 0 ? '+' : '−'}${Math.abs(offset / 1000)} s`}</output>
              <button onClick={() => setOffset((o) => o + 1000)} aria-label="Paroles plus tard">+ 1 s</button>
            </div>
          )}
        </section>

        {showLyrics && (
          <section className="fs__lyrics" aria-label="Paroles">
            <LyricsBody lyrics={lyrics} loading={lyricsLoading} failed={Boolean(lyricsError || lyrics?.unavailable)} onRetry={reloadLyrics} offset={offset}
              onShowCaptions={isYoutube ? () => { chooseMedia('video'); setVideoCaptions(true); if (narrow) setMobileView('player'); } : undefined}
              captionsOn={showVideo && videoCaptions} />
          </section>
        )}
      </div>
    </div>
  );
}

function LyricsBody({ lyrics, loading, failed, onRetry, offset, onShowCaptions, captionsOn }: {
  /** Titre YouTube : afficher ses sous-titres sur le clip quand aucune parole n'existe. */
  onShowCaptions?: () => void;
  captionsOn: boolean;
  lyrics: Lyrics | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  offset: number;
}) {
  if (loading) return <p className="fs-lyrics__empty">Recherche des paroles…</p>;
  if (failed) {
    return (
      <div className="fs-lyrics__empty">
        <p>Le service de paroles ne répond pas pour le moment.</p>
        <div className="fs-lyrics__actions">
          <button className="btn fs-lyrics__retry" onClick={onRetry}>Réessayer</button>
          {onShowCaptions && !captionsOn && (
            <button className="btn fs-lyrics__retry" onClick={onShowCaptions}>Afficher les sous-titres de la vidéo</button>
          )}
        </div>
      </div>
    );
  }
  if (lyrics?.synced) return <SyncedLyrics lines={lyrics.synced} offset={offset} />;
  if (lyrics?.plain) {
    return (
      <div className="fs-lyrics fs-lyrics--plain">
        <p className="fs-lyrics__note">Paroles non synchronisées</p>
        {lyrics.plain.split('\n').map((l, i) => <p key={i}>{l || ' '}</p>)}
      </div>
    );
  }
  if (onShowCaptions) {
    return (
      <div className="fs-lyrics__empty">
        <p>Aucune base de paroles ne connaît ce titre.</p>
        {captionsOn ? (
          <p className="fs-lyrics__hint">Les sous-titres de la vidéo s’affichent sur le clip, quand YouTube en propose.</p>
        ) : (
          <button className="btn fs-lyrics__retry" onClick={onShowCaptions}>Afficher les sous-titres de la vidéo</button>
        )}
      </div>
    );
  }
  return <p className="fs-lyrics__empty">Pas de paroles pour ce titre.</p>;
}

type Word = { text: string; start: number; end: number };

/**
 * Découpe une ligne en mots horodatés. Sans horodatage mot à mot (cas le plus courant), la durée chantée est
 * estimée d'après la longueur de la ligne, puis répartie entre les mots selon leur nombre de lettres.
 */
function wordTimings(line: LyricLine, nextTime: number | undefined): Word[] {
  if (line.words?.length) {
    return line.words.map((w, i, all) => ({
      text: w.text.trim(),
      start: w.time,
      end: w.end ?? all[i + 1]?.time ?? Math.min(nextTime ?? w.time + 1200, w.time + 1500),
    }));
  }
  const words = line.text.split(/\s+/).filter(Boolean);
  const letters = words.reduce((n, w) => n + w.length, 0) || 1;
  const gap = (nextTime ?? line.time + 5000) - line.time;
  // Une longue pause instrumentale après la ligne ne doit pas l'étirer : ~11 lettres chantées par seconde.
  const sung = Math.max(400, Math.min(gap * 0.92, 700 + letters * 90));
  let at = line.time;
  return words.map((text) => {
    const span = (text.length / letters) * sung;
    const word = { text, start: at, end: at + span };
    at += span;
    return word;
  });
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function SyncedLyrics({ lines, offset }: { lines: LyricLine[]; offset: number }) {
  const { seek, playing } = usePlayer();
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const { currentTime } = useProgress();
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLOListElement>(null);
  const userScrollAt = useRef(0);
  const timings = useMemo(() => lines.map((l, i) => wordTimings(l, lines[i + 1]?.time)), [lines]);

  // Position extrapolée entre deux mises à jour du lecteur (toutes les ~250 ms) : le remplissage reste fluide.
  const clock = useRef({ t: currentTime, at: performance.now(), playing });
  useEffect(() => {
    clock.current = { t: currentTime, at: performance.now(), playing };
  }, [currentTime, playing]);

  useEffect(() => {
    let raf = 0;
    let shown = -2;
    const tick = () => {
      const c = clock.current;
      const now = (c.playing ? c.t + (performance.now() - c.at) / 1000 : c.t) * 1000 + 120 - offsetRef.current;
      let i = -1;
      while (i + 1 < lines.length && lines[i + 1]!.time <= now) i++;
      if (i !== shown) {
        shown = i;
        setActive(i);
      }
      const words = listRef.current?.children[i]?.querySelectorAll<HTMLElement>('[data-w]');
      timings[i]?.forEach((w, j) => words?.[j]?.style.setProperty('--p', clamp01((now - w.start) / (w.end - w.start)).toFixed(3)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lines, timings]);

  // La ligne chantée reste centrée, sauf si l'on vient de faire défiler les paroles soi-même.
  useEffect(() => {
    if (Date.now() - userScrollAt.current < 3000) return;
    const line = listRef.current?.children[Math.max(active, 0)] as HTMLElement | undefined;
    line?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active]);

  const markUserScroll = () => (userScrollAt.current = Date.now());

  return (
    <ol className="fs-lyrics" ref={listRef} onWheel={markUserScroll} onTouchMove={markUserScroll}>
      {lines.map((line, i) => (
        <li key={i} className={i === active ? 'is-active' : i < active ? 'is-past' : ''}>
          <button onClick={() => seek(Math.max(0, line.time + offset) / 1000)}>
            {line.text ? (
              timings[i]!.map((w, j) => <span key={j} data-w="">{w.text} </span>)
            ) : (
              <span className="fs-lyrics__dots" aria-label="Pause musicale"><i /><i /><i /></span>
            )}
          </button>
        </li>
      ))}
    </ol>
  );
}
