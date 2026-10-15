import { useState } from 'react';
import { MusicIcon } from './icons';

/** Teinte (0–359) dérivée d'un texte : couleur stable pour un même titre, artiste ou genre. */
export function hueOf(text: string) {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return hash;
}

/** Pochette avec repli dégradé (couleur dérivée du titre) si l'image est absente ou en erreur. */
export function Cover({ src, alt, size, round }: { src: string | null; alt: string; size?: number; round?: boolean }) {
  const [failed, setFailed] = useState(false);
  const style = size ? { width: size, height: size } : undefined;
  const className = `cover ${round ? 'cover--round' : ''}`;

  if (!src || failed) {
    const hash = hueOf(alt);
    return (
      <div className={`${className} cover--fallback`} style={{ ...style, background: `linear-gradient(135deg, hsl(${hash} 55% 35%), hsl(${(hash + 60) % 360} 60% 20%))` }} aria-label={alt} role="img">
        <MusicIcon size={size ? Math.max(16, size / 3) : 32} />
      </div>
    );
  }
  return <img className={className} style={style} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}
