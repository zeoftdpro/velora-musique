import type { ReactNode } from 'react';
import { Cover } from './Cover';
import { useToast } from '../context/toast';
import { useShare } from '../share';
import { PauseIcon, PlayIcon, ShareIcon } from './icons';

export function Hero({ kind, title, cover, round, meta, backdrop, children }: {
  kind: string;
  title: string;
  cover: { src: string | null; alt: string } | ReactNode;
  round?: boolean;
  meta?: ReactNode;
  /** Image floutée en fond de l'en-tête (page artiste). */
  backdrop?: string | null;
  children?: ReactNode;
}) {
  const isCoverData = cover !== null && typeof cover === 'object' && 'alt' in (cover as object);
  return (
    <header className="hero">
      {backdrop && <div className="hero__backdrop" style={{ '--backdrop-img': `url("${backdrop}")` } as React.CSSProperties} aria-hidden />}
      <div className="hero__art">
        {isCoverData ? <Cover src={(cover as { src: string | null }).src} alt={(cover as { alt: string }).alt} round={round} /> : (cover as ReactNode)}
      </div>
      <div className="hero__text">
        <span className="hero__kind">{kind}</span>
        <h1 className="hero__title">{title}</h1>
        {meta && <div className="hero__meta">{meta}</div>}
      </div>
      {children && <div className="hero__actions">{children}</div>}
    </header>
  );
}

/** Bouton « Partager » d'une page (album, artiste, playlist, titre). `blocked` : raison pour laquelle on ne peut pas. */
export function ShareButton({ data, blocked }: { data: { title: string; text: string; url: string }; blocked?: string }) {
  const share = useShare();
  const toast = useToast();
  return (
    <button className="icon-btn" onClick={() => (blocked ? toast(blocked) : share(data))} aria-label="Partager" title="Partager">
      <ShareIcon />
    </button>
  );
}

export function BigPlayButton({ playing, onClick, disabled }: { playing: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="big-play" onClick={onClick} disabled={disabled} aria-label={playing ? 'Pause' : 'Lecture'}>
      {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />} {playing ? 'Pause' : 'Lecture'}
    </button>
  );
}
