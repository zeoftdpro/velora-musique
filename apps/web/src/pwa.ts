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

/** Installateur Windows : release GitHub en production, sinon celui copié par `npm run desktop:dist`. */
export const DESKTOP_DOWNLOAD_URL = (import.meta.env.VITE_DESKTOP_DOWNLOAD_URL as string | undefined) ?? '/downloads/Velora-Setup.exe';

// Vérifié une seule fois : le fichier n'existe que si l'installateur a été construit et publié.
let desktopCheck: Promise<boolean> | null = null;
function checkDesktopDownload() {
  desktopCheck ??= fetch(DESKTOP_DOWNLOAD_URL, { method: 'HEAD' })
    // Un hébergeur de SPA renvoie index.html pour un fichier absent : on exige un binaire.
    .then((res) => res.ok && !(res.headers.get('content-type') ?? '').includes('text/html'))
    .catch(() => DESKTOP_DOWNLOAD_URL.startsWith('http')); // autre origine sans CORS : on fait confiance à l'URL configurée
  return desktopCheck;
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * État de l'installation : `prompt` déclenche la boîte de dialogue native (Chrome/Edge/Android) ;
 * sur iPhone/iPad, l'installation se fait à la main depuis le menu Partager de Safari.
 */
export function useInstall() {
  const [, rerender] = useState(0);
  const [desktopAvailable, setDesktopAvailable] = useState(false);
  useEffect(() => {
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);

  const installed = isStandalone();
  useEffect(() => {
    if (installed || !isWindows()) return;
    let cancelled = false;
    void checkDesktopDownload().then((ok) => !cancelled && setDesktopAvailable(ok));
    return () => {
      cancelled = true;
    };
  }, [installed]);

  return {
    installed,
    desktopApp: isDesktopApp(),
    /** Lien de téléchargement de l'installateur Windows (.exe), s'il est disponible. */
    desktopDownload: desktopAvailable ? DESKTOP_DOWNLOAD_URL : null,
    canPrompt: !installed && deferred !== null,
    iosHint: !installed && deferred === null && isIos(),
    prompt: async () => {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      notify();
    },
  };
}
