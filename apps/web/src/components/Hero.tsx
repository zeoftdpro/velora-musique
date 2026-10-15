import type { ReactNode } from 'react';
import { Cover } from './Cover';
import { PauseIcon, PlayIcon } from './icons';

export function Hero({ kind, title, cover, round, meta, children }: {
  kind: string;
  title: string;
  cover: { src: string | null; alt: string } | ReactNode;
  round?: boolean;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  const isCoverData = cover !== null && typeof cover === 'object' && 'alt' in (cover as object);
  return (
    <header className="hero">
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

export function BigPlayButton({ playing, onClick, disabled }: { playing: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="big-play" onClick={onClick} disabled={disabled} aria-label={playing ? 'Pause' : 'Lecture'}>
      {playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
    </button>
  );
}
