import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Cover } from '../components/Cover';
import { usePlayer, useProgress } from '../context/player';
import { useAsync, useCoverColor, useTitle } from '../hooks';

/** Paroles du titre en cours, synchronisées : la ligne chantée s'allume et reste centrée ; un clic y amène la lecture. */
export function LyricsPage() {
  const { current, seek } = usePlayer();
  const { currentTime } = useProgress();
  useTitle(current ? `Paroles · ${current.title}` : 'Paroles');
  const tint = useCoverColor(current?.album.coverUrl, current?.title ?? '');
  const { data: lyrics, loading } = useAsync(() => (current ? api.lyrics(current.id) : Promise.resolve(null)), [current?.id]);
  const listRef = useRef<HTMLOListElement>(null);

  const synced = lyrics?.synced ?? null;
  // Petite avance : la ligne s'allume au moment où elle commence vraiment à être chantée.
  const now = currentTime * 1000 + 250;
  let active = -1;
  if (synced) for (let i = 0; i < synced.length && synced[i]!.time <= now; i++) active = i;

  useEffect(() => {
    const line = listRef.current?.children[active] as HTMLElement | undefined;
    line?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active]);

  return (
    <div className="lyrics" style={{ '--tint': tint } as React.CSSProperties}>
      {current ? (
        <>
          <header className="lyrics__head">
            <Cover src={current.album.coverUrl} alt={current.album.title} size={56} />
            <div>
              <strong>{current.title}</strong>
              <Link to={`/artist/${current.artist.id}`}>{current.artist.name}</Link>
            </div>
          </header>
          {loading && !lyrics ? (
            <p className="lyrics__empty">Recherche des paroles…</p>
          ) : synced ? (
            <ol className="lyrics__lines" ref={listRef}>
              {synced.map((line, i) => (
                <li key={i} className={i === active ? 'is-active' : i < active ? 'is-past' : ''}>
                  <button onClick={() => seek(line.time / 1000)}>{line.text || '♪'}</button>
                </li>
              ))}
            </ol>
          ) : lyrics?.plain ? (
            <div className="lyrics__plain">
              <p className="lyrics__note">Paroles non synchronisées</p>
              {lyrics.plain.split('\n').map((l, i) => <p key={i}>{l || ' '}</p>)}
            </div>
          ) : (
            <p className="lyrics__empty">Pas de paroles pour ce titre.</p>
          )}
          <p className="lyrics__credit">Paroles : LRCLIB</p>
        </>
      ) : (
        <p className="lyrics__empty">Lancez un titre pour afficher ses paroles.</p>
      )}
    </div>
  );
}
