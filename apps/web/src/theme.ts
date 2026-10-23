import { useEffect, useState } from 'react';

/** Thème sombre (par défaut), clair, ou celui du système. Choix mémorisé dans le navigateur. */
export type ThemeChoice = 'light' | 'dark' | 'system';

// Nouvelle clé : le thème clair, un temps proposé par défaut, ne reste pas mémorisé chez ceux qui ne l'ont pas choisi.
const KEY = 'velora.themeChoice';
const DARK_QUERY = '(prefers-color-scheme: dark)';
// Couleur du cadre autour des panneaux : barre d'état du téléphone et barre de titre de l'appli installée.
const FRAME = { light: '#0e1120', dark: '#000000' } as const;

function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'system' ? v : 'dark';
  } catch {
    return 'dark';
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
  const choose = (next: ThemeChoice) => {
    setChoice(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* stockage indisponible : le choix vaut pour cette visite */
    }
  };
  useEffect(() => applyTheme(choice), [choice]);
  return [choice, choose] as const;
}
