import { useCallback, useEffect, useState } from 'react';
import { hueOf } from './components/Cover';

/** Charge une ressource asynchrone et la recharge quand `deps` change. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload, setData };
}

export function useDebounced<T>(value: T, delay = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function useTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · Velora` : 'Velora';
  }, [title]);
}

/**
 * Couleur dominante d'une pochette, pour teinter l'en-tête des pages album et artiste.
 * Repli sur une teinte dérivée du nom si l'image est absente ou servie sans en-têtes CORS.
 */
export function useCoverColor(src: string | null | undefined, seed: string) {
  const fallback = `hsl(${hueOf(seed)} 45% 30%)`;
  const [color, setColor] = useState(fallback);

  useEffect(() => {
    setColor(fallback);
    if (!src) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      try {
        const size = 24;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        // Moyenne pondérée par la saturation : les pixels colorés comptent plus que le noir, le blanc et le gris.
        let r = 0, g = 0, b = 0, total = 0;
        for (let i = 0; i < data.length; i += 4) {
          const [R, G, B] = [data[i]!, data[i + 1]!, data[i + 2]!];
          const weight = Math.max(R, G, B) - Math.min(R, G, B) + 10;
          r += R * weight; g += G * weight; b += B * weight; total += weight;
        }
        setColor(toPleasantHsl(r / total, g / total, b / total));
      } catch {
        /* image « tainted » (pas de CORS) : on garde la teinte de repli */
      }
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, fallback]);

  return color;
}

/** Convertit en HSL en bornant saturation et luminosité, pour un fond sombre lisible avec du texte blanc. */
function toPleasantHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return `hsl(${Math.round((h * 60 + 360) % 360)} ${Math.round(clamp(s, 0.25, 0.65) * 100)}% ${Math.round(clamp(l, 0.22, 0.36) * 100)}%)`;
}

const RECENT_KEY = 'velora.recentSearches';

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

/** Recherches récentes, mémorisées dans le navigateur. */
export function useRecentSearches() {
  const [items, setItems] = useState(readRecent);
  const persist = (next: string[]) => {
    setItems(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* stockage indisponible : on ignore */
    }
  };
  const add = useCallback((query: string) => {
    const q = query.trim();
    if (q.length < 2) return;
    // Une saisie qui en prolonge une autre (« nov » → « nova ») la remplace.
    const lower = q.toLowerCase();
    persist([q, ...readRecent().filter((x) => !lower.startsWith(x.toLowerCase()) && x.toLowerCase() !== lower)].slice(0, 8));
  }, []);
  const remove = useCallback((query: string) => persist(readRecent().filter((x) => x !== query)), []);
  const clear = useCallback(() => persist([]), []);
  return { items, add, remove, clear };
}
