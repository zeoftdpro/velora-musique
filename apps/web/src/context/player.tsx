// Build « light » de hls.js : sans sous-titres ni DRM, inutiles pour un flux audio.
import Hls from 'hls.js/light';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, type Track } from '../api';
import { EyeOffIcon, MaximizeIcon, MinimizeIcon } from '../components/icons';
import { loadYouTubeApi, YT_STATE, YT_UNPLAYABLE, type YTPlayer } from '../youtube';
import { useToast } from './toast';

type PlayerState = {
  queue: Track[];
  index: number;
  current: Track | null;
  playing: boolean;
  loading: boolean;
  volume: number;
  muted: boolean;
  quality: string | null;
  /** Vidéo YouTube masquée : le son continue, le mini-lecteur n'est plus affiché. */
  videoHidden: boolean;
  toggleVideo: () => void;
  /** Lecture aléatoire : mélange les titres suivants (l'ordre d'origine est restauré à la désactivation). */
  shuffle: boolean;
  toggleShuffle: () => void;
  repeat: Repeat;
  cycleRepeat: () => void;
  /** Lecture automatique : à la fin de la file, des titres recommandés sont ajoutés et enchaînés. */
  autoplay: boolean;
  toggleAutoplay: () => void;
  /** Panneau « En cours de lecture » (à droite, sur grand écran). */
  panelOpen: boolean;
  togglePanel: () => void;
  /** Emplacement du clip YouTube dans le panneau (ref callback) ; le lecteur vient s'y superposer. */
  registerVideoSlot: (el: HTMLElement | null) => void;
  videoInPanel: boolean;
  playQueue: (tracks: Track[], startIndex?: number) => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  jumpTo: (index: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
};

type Progress = { currentTime: number; duration: number; buffered: number };

/** Moteur de lecture : élément audio (HLS ou MP3) ou lecteur YouTube officiel intégré. */
type Engine = 'audio' | 'youtube';
export type Repeat = 'off' | 'all' | 'one';
type SlotRect = { top: number; left: number; width: number; height: number };

const PlayerContext = createContext<PlayerState | null>(null);
// Contexte séparé pour la progression : évite de re-rendre toute l'app à chaque `timeupdate`.
const ProgressContext = createContext<Progress>({ currentTime: 0, duration: 0, buffered: 0 });

const VOLUME_KEY = 'velora.volume';
const DOCK_KEY = 'velora.ytDock';
const VIDEO_HIDDEN_KEY = 'velora.ytHidden';
const SHUFFLE_KEY = 'velora.shuffle';
const REPEAT_KEY = 'velora.repeat';
const PANEL_KEY = 'velora.panel';
const AUTOPLAY_KEY = 'velora.autoplay';

function readStored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : on ignore */
  }
}

/** Mélange de Fisher-Yates (copie). */
function shuffled<T>(items: T[]) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function readStoredVideoHidden() {
  try {
    return localStorage.getItem(VIDEO_HIDDEN_KEY) !== 'false'; // masquée par défaut
  } catch {
    return true;
  }
}

/**
 * Téléphone (navigateur, appli Android, écran d'accueil iPhone) : le système met en pause les vidéos dès que l'appli
 * passe en arrière-plan ou que l'écran s'éteint. Les titres YouTube ne peuvent donc pas y être lus : on les passe
 * pour enchaîner sur le suivant, qui lui est lu par l'élément audio et continue écran éteint.
 */
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const isBackground = () => IS_MOBILE && document.visibilityState === 'hidden';
/** Titres YouTube passés d'affilée au maximum, pour ne pas boucler sur une file qui n'en contient que. */
const MAX_BACKGROUND_SKIPS = 15;

/** Position de lecture affichée sur l'écran verrouillé et dans la notification du téléphone. */
function reportPosition(position: number, duration: number) {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!Number.isFinite(duration) || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({ duration, position: Math.min(Math.max(0, position), duration), playbackRate: 1 });
  } catch {
    /* valeurs refusées par le navigateur : sans conséquence */
  }
}

/** Tailles du mini-lecteur YouTube ; « compact » correspond au minimum autorisé par YouTube (200 × 200 px). */
const DOCK_SIZES = ['compact', 'normal', 'large'] as const;
type DockSize = (typeof DOCK_SIZES)[number];

function readStoredDockSize(): DockSize {
  try {
    const v = localStorage.getItem(DOCK_KEY);
    return DOCK_SIZES.includes(v as DockSize) ? (v as DockSize) : 'normal';
  } catch {
    return 'normal';
  }
}

function readStoredVolume() {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.8;
  } catch {
    return 0.8;
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const audioRef = useRef<HTMLAudioElement>(null as unknown as HTMLAudioElement);
  if (!audioRef.current) audioRef.current = new Audio();
  const hlsRef = useRef<Hls | null>(null);
  const loadId = useRef(0);
  const ytRef = useRef<YTPlayer | null>(null);
  const ytPromise = useRef<Promise<YTPlayer> | null>(null);
  const ytMountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine>('audio');
  const [engine, setEngineState] = useState<Engine>('audio');
  const [dockSize, setDockSizeState] = useState<DockSize>(readStoredDockSize);
  const [videoHidden, setVideoHidden] = useState(readStoredVideoHidden);
  const [shuffle, setShuffle] = useState(() => readStored(SHUFFLE_KEY) === 'true');
  const [repeat, setRepeat] = useState<Repeat>(() => {
    const v = readStored(REPEAT_KEY);
    return v === 'all' || v === 'one' ? v : 'off';
  });
  const [panelOpen, setPanelOpen] = useState(() => readStored(PANEL_KEY) !== 'false');
  const [autoplay, setAutoplay] = useState(() => readStored(AUTOPLAY_KEY) !== 'false');
  // Suggestions demandées pour le dernier titre de la file (une seule fois par titre).
  const radioRef = useRef<{ seed: string; promise: Promise<Track[]> } | null>(null);
  const [videoSlot, setVideoSlot] = useState<HTMLElement | null>(null);
  const [slotRect, setSlotRect] = useState<SlotRect | null>(null);
  // Ordre d'origine de la file, conservé pendant la lecture aléatoire.
  const originalQueue = useRef<Track[] | null>(null);

  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [volume, setVolumeState] = useState(readStoredVolume);
  const [muted, setMuted] = useState(false);
  const [quality, setQuality] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>({ currentTime: 0, duration: 0, buffered: 0 });

  const current = queue[index] ?? null;

  // Valeurs courantes lues par les callbacks du lecteur YouTube, créés une seule fois.
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const nextRef = useRef<() => void>(() => undefined);
  const endedRef = useRef<() => void>(() => undefined);
  // Pause demandée par l'utilisateur (bouton, écran verrouillé) : à distinguer d'une pause imposée par le système.
  const userPausedRef = useRef(false);
  const backgroundSkips = useRef(0);

  /** Arrière-plan sur téléphone : passe un titre YouTube illisible et enchaîne sur le suivant. */
  const skipInBackground = () => {
    if (backgroundSkips.current >= MAX_BACKGROUND_SKIPS) return false;
    backgroundSkips.current++;
    nextRef.current();
    return true;
  };

  const isYouTube = () => engineRef.current === 'youtube';
  const setEngine = useCallback((e: Engine) => {
    engineRef.current = e;
    setEngineState(e);
  }, []);

  const stopAudio = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const audio = audioRef.current;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }, []);

  /** Crée le lecteur YouTube à la première lecture d'un titre YouTube, puis le réutilise. */
  const getYouTubePlayer = useCallback(() => {
    ytPromise.current ??= loadYouTubeApi()
      .then(
        (YT) =>
          new Promise<YTPlayer>((resolve) => {
            // Le lecteur remplace l'élément fourni par une iframe : on lui confie un nœud que React ne gère pas.
            const host = document.createElement('div');
            ytMountRef.current!.appendChild(host);
            new YT.Player(host, {
              width: '100%',
              height: '100%',
              playerVars: { autoplay: 1, playsinline: 1, rel: 0, origin: window.location.origin },
              events: {
                onReady: ({ target }) => {
                  target.setVolume(Math.round(volumeRef.current * 100));
                  if (mutedRef.current) target.mute();
                  ytRef.current = target;
                  resolve(target);
                },
                onStateChange: ({ data }) => {
                  if (engineRef.current !== 'youtube') return;
                  if (data === YT_STATE.PLAYING) {
                    backgroundSkips.current = 0;
                    setPlaying(true);
                    setLoading(false);
                  } else if (data === YT_STATE.PAUSED || data === YT_STATE.CUED) {
                    setPlaying(false);
                    setLoading(false);
                    // Mise en pause par le téléphone (écran éteint, autre appli) : on continue avec le titre suivant.
                    if (data === YT_STATE.PAUSED && isBackground() && !userPausedRef.current) skipInBackground();
                  } else if (data === YT_STATE.BUFFERING) {
                    setLoading(true);
                  } else if (data === YT_STATE.ENDED) {
                    setPlaying(false);
                    endedRef.current();
                  }
                },
                onError: ({ data }) => {
                  if (engineRef.current !== 'youtube') return;
                  setPlaying(false);
                  setLoading(false);
                  if (YT_UNPLAYABLE.has(data)) {
                    toastRef.current('Cette vidéo ne peut pas être lue dans Velora');
                    nextRef.current();
                  } else {
                    toastRef.current('Lecture YouTube impossible');
                  }
                },
              },
            });
          }),
      )
      .catch((err: unknown) => {
        ytPromise.current = null;
        throw err;
      });
    return ytPromise.current;
  }, []);

  /** Récupère une URL de flux signée auprès de l'API et branche le flux HLS sur l'élément audio. */
  const load = useCallback(
    async (track: Track) => {
      const audio = audioRef.current;
      const id = ++loadId.current;
      userPausedRef.current = false;
      setLoading(true);
      setProgress({ currentTime: 0, duration: track.durationMs / 1000, buffered: 0 });
      try {
        const { streamUrl, format, videoId } = await api.play(track.id);
        if (id !== loadId.current) return; // Un autre titre a été lancé entre-temps.

        if (format === 'youtube' && videoId) {
          // Écran éteint sur téléphone : la vidéo ne démarrerait pas, on passe au titre suivant.
          if (isBackground() && skipInBackground()) return;
          stopAudio();
          setEngine('youtube');
          setQuality('YouTube');
          const player = await getYouTubePlayer();
          if (id !== loadId.current) return;
          player.loadVideoById(videoId); // L'état (lecture, chargement, fin) arrive ensuite par onStateChange.
          return;
        }

        ytRef.current?.stopVideo();
        setEngine('audio');
        hlsRef.current?.destroy();
        hlsRef.current = null;
        if (format === 'mp3') {
          // Titre d'un catalogue externe (Jamendo) : fichier MP3 lu directement.
          audio.src = streamUrl;
          setQuality('MP3');
        } else if (Hls.isSupported()) {
          const hls = new Hls({ maxBufferLength: 30 });
          hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
            const level = hls.levels[data.level];
            setQuality(level ? `${Math.round(level.bitrate / 1000)} kbit/s` : null);
          });
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (!data.fatal) return;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
            else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            else toast('Lecture impossible pour ce titre');
          });
          hls.loadSource(streamUrl);
          hls.attachMedia(audio);
          hlsRef.current = hls;
        } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
          // Safari / iOS : lecteur HLS natif.
          audio.src = streamUrl;
          setQuality(null);
        } else {
          throw new Error('HLS non supporté par ce navigateur');
        }
        await audio.play();
      } catch (err) {
        if (id !== loadId.current) return;
        setPlaying(false);
        setLoading(false);
        if (err instanceof DOMException && err.name === 'NotAllowedError') return; // autoplay bloqué
        toast(err instanceof ApiError || err instanceof Error ? err.message : 'Lecture impossible');
      } finally {
        if (id === loadId.current && engineRef.current === 'audio') setLoading(false);
      }
    },
    [toast, stopAudio, setEngine, getYouTubePlayer],
  );

  const playAt = useCallback(
    (tracks: Track[], i: number) => {
      const track = tracks[i];
      if (!track) return;
      setQueue(tracks);
      setIndex(i);
      void load(track);
    },
    [load],
  );

  const playQueue = useCallback(
    (tracks: Track[], startIndex = 0) => {
      const start = tracks[startIndex];
      if (shuffle && start) {
        originalQueue.current = tracks;
        playAt([start, ...shuffled(tracks.filter((_, i) => i !== startIndex))], 0);
      } else {
        originalQueue.current = null;
        playAt(tracks, startIndex);
      }
    },
    [playAt, shuffle],
  );

  /** Insère juste après le titre en cours (en retirant un éventuel doublon plus loin dans la file). */
  const playNext = useCallback(
    (track: Track) => {
      if (!current) return playQueue([track]);
      if (track.id === current.id) return;
      setQueue((q) => {
        const rest = q.filter((t, i) => i > index && t.id !== track.id);
        return [...q.slice(0, index + 1), track, ...rest];
      });
      if (originalQueue.current) originalQueue.current = [...originalQueue.current.filter((t) => t.id !== track.id), track];
    },
    [current, index, playQueue],
  );

  const addToQueue = useCallback(
    (track: Track) => {
      if (!current) return playQueue([track]);
      if (track.id === current.id) return;
      setQueue((q) => [...q.filter((t, i) => i <= index || t.id !== track.id), track]);
      if (originalQueue.current) originalQueue.current = [...originalQueue.current.filter((t) => t.id !== track.id), track];
    },
    [current, index, playQueue],
  );

  const jumpTo = useCallback((i: number) => playAt(queue, i), [playAt, queue]);

  // Commandes communes aux deux moteurs de lecture.
  const currentTime = useCallback(() => (isYouTube() ? ytRef.current?.getCurrentTime() ?? 0 : audioRef.current.currentTime), []);
  const pause = useCallback(() => {
    userPausedRef.current = true;
    if (isYouTube()) ytRef.current?.pauseVideo();
    else audioRef.current.pause();
  }, []);
  const resume = useCallback(() => {
    userPausedRef.current = false;
    if (isYouTube()) ytRef.current?.playVideo();
    else void audioRef.current.play().catch(() => undefined);
  }, []);
  const seek = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    const target = Math.max(0, seconds);
    if (isYouTube()) {
      ytRef.current?.seekTo(target, true);
      setProgress((p) => ({ ...p, currentTime: target }));
    } else {
      audioRef.current.currentTime = target;
    }
  }, []);

  const next = useCallback(() => {
    if (index + 1 < queue.length) playAt(queue, index + 1);
    else if (repeat === 'all' && queue.length > 0) playAt(queue, 0);
    else if (autoplay && current && radioRef.current?.seed === current.id) {
      // Suggestions encore en route (titre passé tout de suite) : on enchaîne dès leur arrivée.
      const id = loadId.current;
      void radioRef.current.promise.then((added) => {
        if (id !== loadId.current) return; // l'utilisateur a lancé autre chose entre-temps
        if (added.length > 0) playAt([...queue, ...added], index + 1);
        else {
          pause();
          seek(0);
        }
      });
    } else {
      pause();
      seek(0);
    }
  }, [index, queue, playAt, pause, seek, repeat, autoplay, current]);
  nextRef.current = next;

  // Fin naturelle d'un titre : « répéter le titre » le relance, sinon on passe au suivant.
  endedRef.current = () => {
    if (repeat === 'one') {
      seek(0);
      resume();
    } else {
      next();
    }
  };

  const toggleShuffle = useCallback(() => {
    const enable = !shuffle;
    setShuffle(enable);
    store(SHUFFLE_KEY, String(enable));
    if (!current) return;
    if (enable) {
      originalQueue.current = queue;
      setQueue([current, ...shuffled(queue.filter((_, i) => i !== index))]);
      setIndex(0);
    } else if (originalQueue.current) {
      const original = originalQueue.current;
      originalQueue.current = null;
      setQueue(original);
      setIndex(Math.max(0, original.findIndex((t) => t.id === current.id)));
    }
  }, [shuffle, current, queue, index]);

  // Dernier titre de la file : on demande des suggestions pour la suite, ajoutées en fin de file.
  useEffect(() => {
    if (!autoplay || repeat !== 'off' || !current || index !== queue.length - 1) return;
    if (radioRef.current?.seed === current.id) return;
    const exclude = queue.slice(-100).map((t) => t.id);
    const seed = current.id;
    const promise = api
      .radio(seed, exclude)
      .then((found) => found.filter((t) => !exclude.includes(t.id)).map((t) => ({ ...t, suggested: true })))
      .catch(() => [] as Track[]);
    radioRef.current = { seed, promise };
    void promise.then((added) => {
      if (radioRef.current?.promise !== promise || added.length === 0) return;
      // Seulement si la file n'a pas changé de fin entre-temps (titres ajoutés à la main…).
      setQueue((q) => (q.at(-1)?.id === seed ? [...q, ...added] : q));
      if (originalQueue.current?.at(-1)?.id === seed) originalQueue.current = [...originalQueue.current, ...added];
    });
  }, [autoplay, repeat, current, index, queue]);

  const toggleAutoplay = useCallback(() => {
    const enable = !autoplay;
    setAutoplay(enable);
    store(AUTOPLAY_KEY, String(enable));
    if (!enable) radioRef.current = null;
  }, [autoplay]);

  const cycleRepeat = useCallback(() => {
    const nextMode: Repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
    setRepeat(nextMode);
    store(REPEAT_KEY, nextMode);
  }, [repeat]);

  const togglePanel = useCallback(() => {
    const open = !panelOpen;
    setPanelOpen(open);
    store(PANEL_KEY, String(open));
  }, [panelOpen]);

  const prev = useCallback(() => {
    // Comme sur la plupart des lecteurs : on revient au début si le titre a commencé depuis plus de 3 s.
    if (currentTime() > 3 || index <= 0) seek(0);
    else playAt(queue, index - 1);
  }, [index, queue, playAt, currentTime, seek]);

  const toggle = useCallback(() => {
    if (!current) return;
    const state = ytRef.current?.getPlayerState();
    const paused = isYouTube() ? state !== YT_STATE.PLAYING && state !== YT_STATE.BUFFERING : audioRef.current.paused;
    if (paused) resume();
    else pause();
  }, [current, pause, resume]);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolumeState(clamped);
    setMuted(clamped === 0);
    try {
      localStorage.setItem(VOLUME_KEY, String(clamped || 0.8));
    } catch {
      /* stockage indisponible : on ignore */
    }
  }, []);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  const toggleVideo = useCallback(() => {
    setVideoHidden((hidden) => {
      try {
        localStorage.setItem(VIDEO_HIDDEN_KEY, String(!hidden));
      } catch {
        /* stockage indisponible : on ignore */
      }
      return !hidden;
    });
  }, []);

  const resizeDock = useCallback((step: -1 | 1) => {
    setDockSizeState((size) => {
      const nextSize = DOCK_SIZES[Math.min(DOCK_SIZES.length - 1, Math.max(0, DOCK_SIZES.indexOf(size) + step))]!;
      try {
        localStorage.setItem(DOCK_KEY, nextSize);
      } catch {
        /* stockage indisponible : on ignore */
      }
      return nextSize;
    });
  }, []);

  // Synchronisation volume → élément audio et lecteur YouTube.
  useEffect(() => {
    audioRef.current.volume = volume;
    audioRef.current.muted = muted;
    const yt = ytRef.current;
    if (yt) {
      yt.setVolume(Math.round(volume * 100));
      if (muted) yt.mute();
      else yt.unMute();
    }
  }, [volume, muted]);

  // Le clip YouTube se superpose à son emplacement dans le panneau : déplacer l'iframe dans le DOM la
  // rechargerait et couperait la lecture, on suit donc la position de l'emplacement.
  useEffect(() => {
    if (!videoSlot) {
      setSlotRect(null);
      return;
    }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = videoSlot.getBoundingClientRect();
        setSlotRect(r.width > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(videoSlot);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [videoSlot]);

  // Le lecteur YouTube n'émet pas d'événement de progression : on l'interroge pendant qu'il est actif.
  useEffect(() => {
    if (engine !== 'youtube') return;
    const timer = setInterval(() => {
      const yt = ytRef.current;
      if (!yt) return;
      const duration = yt.getDuration() || 0;
      reportPosition(yt.getCurrentTime() || 0, duration);
      setProgress((p) => ({
        currentTime: yt.getCurrentTime() || 0,
        duration: duration > 0 ? duration : p.duration,
        buffered: (yt.getVideoLoadedFraction() || 0) * duration,
      }));
    }, 250);
    return () => clearInterval(timer);
  }, [engine]);

  // Événements de l'élément audio (ignorés pendant une lecture YouTube).
  useEffect(() => {
    const audio = audioRef.current;
    const ifAudio = (handler: () => void) => () => {
      if (engineRef.current === 'audio') handler();
    };
    const onTime = ifAudio(() => {
      const end = audio.buffered.length ? audio.buffered.end(audio.buffered.length - 1) : 0;
      reportPosition(audio.currentTime, audio.duration);
      setProgress((p) => ({
        currentTime: audio.currentTime,
        duration: Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : p.duration,
        buffered: end,
      }));
    });
    const onPlay = ifAudio(() => setPlaying(true));
    const onPause = ifAudio(() => setPlaying(false));
    const onEnded = ifAudio(() => endedRef.current());
    const onWaiting = ifAudio(() => setLoading(true));
    const onPlaying = ifAudio(() => {
      backgroundSkips.current = 0;
      setLoading(false);
    });
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('durationchange', onTime);
    audio.addEventListener('progress', onTime);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('durationchange', onTime);
      audio.removeEventListener('progress', onTime);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
    };
  }, []);

  // Media Session API : contrôles depuis l'écran verrouillé, les touches multimédia et le centre de contrôle
  // de l'OS — la lecture continue en arrière-plan.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist.name,
      album: current.album.title,
      // Sans pochette (souvent le cas d'une musique téléversée) : l'icône de Velora dans la notification.
      artwork: current.album.coverUrl
        ? [{ src: current.album.coverUrl, sizes: '640x640', type: 'image/jpeg' }]
        : [{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', resume],
      ['pause', pause],
      ['previoustrack', prev],
      ['nexttrack', next],
      ['seekto', (d) => d.seekTime !== undefined && seek(d.seekTime)],
      ['seekbackward', (d) => seek(currentTime() - (d.seekOffset ?? 10))],
      ['seekforward', (d) => seek(currentTime() + (d.seekOffset ?? 10))],
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        /* action non supportée */
      }
    }
  }, [current, next, prev, seek, pause, resume, currentTime]);

  useEffect(() => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }, [playing]);

  // Raccourci clavier : espace = lecture/pause (hors champs de saisie).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.code !== 'Space' || ['INPUT', 'TEXTAREA', 'BUTTON'].includes(target.tagName) || target.isContentEditable) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  useEffect(
    () => () => {
      hlsRef.current?.destroy();
      ytRef.current?.destroy();
      ytRef.current = null;
      ytPromise.current = null;
    },
    [],
  );

  const value = useMemo<PlayerState>(
    () => ({
      queue, index, current, playing, loading, volume, muted, quality, videoHidden,
      shuffle, repeat, autoplay, panelOpen, videoInPanel: slotRect !== null, registerVideoSlot: setVideoSlot,
      playQueue, playNext, addToQueue, jumpTo, toggle, next, prev, seek, setVolume, toggleMute, toggleVideo,
      toggleShuffle, cycleRepeat, toggleAutoplay, togglePanel,
    }),
    [queue, index, current, playing, loading, volume, muted, quality, videoHidden, shuffle, repeat, autoplay, panelOpen, slotRect,
      playQueue, playNext, addToQueue, jumpTo, toggle, next, prev, seek, setVolume, toggleMute, toggleVideo,
      toggleShuffle, cycleRepeat, toggleAutoplay, togglePanel],
  );

  // Panneau ouvert avec un emplacement visible : le clip s'y affiche (quel que soit le réglage « vidéo masquée »).
  const inPanel = slotRect !== null;

  return (
    <PlayerContext.Provider value={value}>
      <ProgressContext.Provider value={progress}>
        {children}
        {/* Lecteur YouTube intégré. Masquer la vidéo (option par défaut) garde l'iframe active pour le son ;
            les conditions de l'API YouTube demandent un lecteur visible : à réévaluer avant une mise en ligne publique. */}
        <div
          className={`yt-dock ${inPanel ? 'yt-dock--panel' : `yt-dock--${dockSize}`} ${engine === 'youtube' && current ? 'yt-dock--visible' : ''} ${!inPanel && videoHidden ? 'yt-dock--hidden' : ''}`}
          style={inPanel && slotRect ? { top: slotRect.top, left: slotRect.left, width: slotRect.width, height: slotRect.height } : undefined}
          aria-hidden={engine !== 'youtube' || (!inPanel && videoHidden)}>
          {!inPanel && <div className="yt-dock__bar">
            <span className="yt-dock__label">YouTube</span>
            <button className="icon-btn" onClick={toggleVideo} aria-label="Masquer la vidéo">
              <EyeOffIcon size={16} />
            </button>
            <button className="icon-btn" onClick={() => resizeDock(-1)} disabled={dockSize === 'compact'} aria-label="Réduire la vidéo">
              <MinimizeIcon size={16} />
            </button>
            <button className="icon-btn" onClick={() => resizeDock(1)} disabled={dockSize === 'large'} aria-label="Agrandir la vidéo">
              <MaximizeIcon size={16} />
            </button>
          </div>}
          <div ref={ytMountRef} className="yt-dock__frame" />
        </div>
      </ProgressContext.Provider>
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer doit être utilisé dans <PlayerProvider>');
  return ctx;
}

export const useProgress = () => useContext(ProgressContext);
