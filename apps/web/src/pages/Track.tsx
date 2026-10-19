import { useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatDuration } from '../api';
import { BigPlayButton, Hero, ShareButton } from '../components/Hero';
import { HeartIcon } from '../components/icons';
import { ErrorState, Loading } from '../components/States';
import { TrackList } from '../components/TrackList';
import { useLibrary } from '../context/library';
import { usePlayer } from '../context/player';
import { useAsync, useCoverColor, useTitle } from '../hooks';
import { shareUrls } from '../share';

/**
 * Page d'un titre, ouverte par un lien partagé (velora-musique.vercel.app/track/…) : la musique se lance dès
 * l'arrivée, puis la lecture automatique enchaîne sur des titres proches.
 */
export function TrackPage() {
  const { id } = useParams();
  const { data: track, error, loading } = useAsync(() => api.track(id!), [id]);
  const { data: artist } = useAsync(() => (track ? api.artist(track.artist.id) : Promise.resolve(null)), [track?.artist.id]);
  useTitle(track?.title);
  const tint = useCoverColor(track?.album.coverUrl, track?.title ?? '');
  const { current, playing, playQueue, toggle } = usePlayer();
  const { favoriteIds, toggleFavorite } = useLibrary();

  // Lancement automatique, une seule fois par titre. Si le navigateur bloque le son sans geste de l'utilisateur,
  // le titre reste prêt dans le lecteur : un appui sur Lecture suffit.
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (!track || started.current === track.id) return;
    started.current = track.id;
    if (current?.id !== track.id) playQueue([track], 0);
  }, [track, current, playQueue]);

  if (loading && !track) return <Loading />;
  if (error || !track) {
    return <ErrorState message="Ce titre est introuvable : il a peut-être été supprimé, ou c’est une musique privée." />;
  }

  const isCurrent = current?.id === track.id;
  const liked = favoriteIds.has(track.id);
  const more = (artist?.topTracks ?? []).filter((t) => t.id !== track.id).slice(0, 8);

  return (
    <div className="page page--tinted" style={{ '--tint': tint } as React.CSSProperties}>
      <Hero kind="Titre" title={track.title} cover={{ src: track.album.coverUrl, alt: track.album.title }}
        meta={<>
          <Link to={`/artist/${track.artist.id}`} className="strong">{track.artist.name}</Link>
          <Link to={`/album/${track.album.id}`}>{track.album.title}</Link>
          <span>{formatDuration(track.durationMs)}</span>
        </>}>
        <BigPlayButton playing={isCurrent && playing} onClick={() => (isCurrent ? toggle() : playQueue([track], 0))} />
        <button className={`icon-btn ${liked ? 'is-active' : ''}`} onClick={() => toggleFavorite(track.id)}
          aria-label={liked ? 'Retirer des titres likés' : 'Ajouter aux titres likés'} aria-pressed={liked}>
          <HeartIcon filled={liked} />
        </button>
        <ShareButton
          data={{ title: `${track.title} · ${track.artist.name}`, text: `Écoute « ${track.title} » de ${track.artist.name} sur Velora`, url: shareUrls.track(track.id) }}
          blocked={track.uploaded ? 'Musique téléversée : elle reste privée et ne peut pas être partagée' : undefined} />
      </Hero>

      {more.length > 0 && (
        <section className="section">
          <h2 className="section__title">Plus de {track.artist.name}</h2>
          <TrackList tracks={more} />
        </section>
      )}
    </div>
  );
}
