/**
 * Chargement de l'API IFrame de YouTube (lecteur officiel intégré). Types réduits à ce que Velora utilise.
 * https://developers.google.com/youtube/iframe_api_reference
 */
export type YTPlayer = {
  loadVideoById(videoId: string): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getVideoLoadedFraction(): number;
  getPlayerState(): number;
  destroy(): void;
  // Module « captions » (sous-titres) : présent dans l'API IFrame, mais non documenté.
  loadModule(module: 'captions'): void;
  unloadModule(module: 'captions'): void;
  getOption(module: 'captions', option: 'tracklist'): { languageCode: string; kind?: string }[] | undefined;
  setOption(module: 'captions', option: 'track' | 'fontSize', value: unknown): void;
};

type YTNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      width?: string | number;
      height?: string | number;
      videoId?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export const YT_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

/** Codes d'erreur du lecteur : 2 = id invalide, 5 = erreur HTML5, 100 = vidéo supprimée, 101/150 = intégration refusée. */
export const YT_UNPLAYABLE = new Set([2, 5, 100, 101, 150]);

let apiPromise: Promise<YTNamespace> | null = null;

export function loadYouTubeApi(): Promise<YTNamespace> {
  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error('Impossible de charger le lecteur YouTube'));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}
