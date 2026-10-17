import { useEffect, useState } from 'react';

/** Événement `beforeinstallprompt` (Chrome, Edge, Android) : non standard, donc absent des types du DOM. */
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Enregistre le service worker et capte la proposition d'installation dès le démarrage. */
export function setupPwa() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    });
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // On affiche notre propre bouton « Installer l'appli ».
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

declare global {
  interface Window {
    /** Exposé par l'appli Windows (apps/desktop/preload.cjs). */
    veloraDesktop?: { isDesktop: boolean; platform: string };
  }
}

export const isDesktopApp = () => window.veloraDesktop?.isDesktop === true;

export const isStandalone = () =>
  isDesktopApp() ||
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isWindows = () => /windows/i.test(navigator.userAgent);
const isAndroid = () => /android/i.test(navigator.userAgent);

/** Installateur Windows : release GitHub en production, sinon celui copié par `npm run desktop:dist`. */
export const DESKTOP_DOWNLOAD_URL = (import.meta.env.VITE_DESKTOP_DOWNLOAD_URL as string | undefined) ?? '/downloads/Velora-Setup.exe';

/** Appli Android (.apk) : release GitHub en production, sinon celle copiée par `npm run android:dist`. */
export const ANDROID_DOWNLOAD_URL = (import.meta.env.VITE_ANDROID_DOWNLOAD_URL as string | undefined) ?? '/downloads/Velora.apk';

// Vérifié une seule fois par fichier : il n'existe que si l'installateur a été construit et publié.
const downloadChecks = new Map<string, Promise<boolean>>();
function checkDownload(url: string) {
  // Autre origine (release GitHub) : pas de vérification possible sans CORS, on fait confiance à l'URL configurée.
  if (new URL(url, window.location.href).origin !== window.location.origin) return Promise.resolve(true);
  let check = downloadChecks.get(url);
  if (!check) {
    check = fetch(url, { method: 'HEAD' })
      // Un hébergeur de SPA renvoie index.html pour un fichier absent : on exige un binaire.
      .then((res) => res.ok && !(res.headers.get('content-type') ?? '').includes('text/html'))
      .catch(() => false);
    downloadChecks.set(url, check);
  }
  return check;
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Navigateur utilisé sur iPhone/iPad : l'ajout à l'écran d'accueil se fait depuis le menu Partager de Safari,
 * Chrome, Firefox ou Edge (iOS 16.4+), mais pas depuis l'appli Google ni les navigateurs intégrés (Instagram…).
 */
export type IosBrowser = 'safari' | 'chrome' | 'firefox' | 'edge' | 'google' | 'inapp';
function iosBrowser(): IosBrowser {
  const ua = navigator.userAgent;
  if (/CriOS/.test(ua)) return 'chrome';
  if (/FxiOS/.test(ua)) return 'firefox';
  if (/EdgiOS/.test(ua)) return 'edge';
  if (/GSA\//.test(ua)) return 'google';
  // Les vues web intégrées aux applis n'ont pas le jeton « Safari/ ».
  if (/Safari\//.test(ua) && !/FBAN|FBAV|Instagram|Snapchat|TikTok|LinkedInApp|Line\//.test(ua)) return 'safari';
  return 'inapp';
}

/**
 * État de l'installation : `prompt` déclenche la boîte de dialogue native (Chrome/Edge/Android) ;
 * sur iPhone/iPad, l'installation se fait à la main depuis le menu Partager de Safari.
 */
export function useInstall() {
  const [, rerender] = useState(0);
  const [download, setDownload] = useState<{ desktop?: string; android?: string }>({});
  useEffect(() => {
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);

  const installed = isStandalone();
  useEffect(() => {
    const platform = isWindows() ? 'desktop' : isAndroid() ? 'android' : null;
    if (installed || !platform) return;
    const url = platform === 'desktop' ? DESKTOP_DOWNLOAD_URL : ANDROID_DOWNLOAD_URL;
    let cancelled = false;
    void checkDownload(url).then((ok) => !cancelled && ok && setDownload({ [platform]: url }));
    return () => {
      cancelled = true;
    };
  }, [installed]);

  return {
    installed,
    desktopApp: isDesktopApp(),
    /** Lien de téléchargement de l'installateur Windows (.exe), s'il est disponible. */
    desktopDownload: download.desktop ?? null,
    /** Lien de téléchargement de l'appli Android (.apk), s'il est disponible. */
    androidDownload: download.android ?? null,
    canPrompt: !installed && deferred !== null,
    /** Téléphone ou tablette : la bannière d'installation n'est proposée que là. */
    mobile: isIos() || isAndroid(),
    /** Sur iPhone/iPad non installé : navigateur utilisé, pour adapter les étapes d'installation. */
    ios: !installed && isIos() ? iosBrowser() : null,
    prompt: async () => {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      notify();
    },
  };
}
