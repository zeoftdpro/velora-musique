import { useEffect, useState } from 'react';

/** Thème clair (par défaut), sombre, ou celui du système. Choix mémorisé dans le navigateur. */
export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'velora.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
// Couleur du cadre autour des panneaux : barre d'état du téléphone et barre de titre de l'appli installée.
const FRAME = { light: '#0e1120', dark: '#000000' } as const;

function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'system' ? v : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(choice: ThemeChoice) {
  const resolved = choice === 'system' ? (matchMedia(DARK_QUERY).matches ? 'dark' : 'light') : choice;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', FRAME[resolved]);
}

/** À appeler avant le premier rendu ; suit ensuite les changements du système si le thème est « système ». */
export function initTheme() {
  applyTheme(readTheme());
  matchMedia(DARK_QUERY).addEventListener('change', () => readTheme() === 'system' && applyTheme('system'));
}

export function useTheme() {
  const [choice, setChoice] = useState(readTheme);
  useEffect(() => {
    applyTheme(choice);
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      /* stockage indisponible : le choix vaut pour cette visite */
    }
  }, [choice]);
  return [choice, setChoice] as const;
}
