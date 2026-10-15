import { Link, useParams } from 'react-router-dom';
import { api, formatDuration, type Track } from '../api';
import { BigPlayButton, Hero } from '../components/Hero';
import { ErrorState, Loading } from '../components/States';
import { TrackList } from '../components/TrackList';
import { usePlayer } from '../context/player';
import { useAsync, useCoverColor, useTitle } from '../hooks';

/** Lit une liste de titres, ou met en pause si elle est déjà en cours de lecture. */
export function usePlayList(tracks: Track[] | undefined) {
  const { current, playing, playQueue, toggle, queue } = usePlayer();
  const active = Boolean(
    current && tracks?.length && queue.length === tracks.length && queue.every((t, i) => t.id === tracks[i]?.id),
  );
  return {
    playing: active && playing,
    onClick: () => (active ? toggle() : tracks && playQueue(tracks, 0)),
  };
}

export function AlbumPage() {
  const { id } = useParams();
  const { data: album, error, loading } = useAsync(() => api.album(id!), [id]);
  useTitle(album?.title);
  const play = usePlayList(album?.tracks);
  const tint = useCoverColor(album?.coverUrl, album?.title ?? '');

  if (loading && !album) return <Loading />;
  if (error || !album) return <ErrorState message={error ?? 'Album introuvable'} />;
  const total = album.tracks.reduce((s, t) => s + t.durationMs, 0);

  return (
    <div className="page page--tinted" style={{ '--tint': tint } as React.CSSProperties}>
      <Hero kind="Album" title={album.title} cover={{ src: album.coverUrl, alt: album.title }}
        meta={<>
          <Link to={`/artist/${album.artist.id}`} className="strong">{album.artist.name}</Link>
          {album.releaseYear && <span>{album.releaseYear}</span>}
          {album.genre && <Link to={`/search?genre=${album.genre.slug}`}>{album.genre.name}</Link>}
          <span>{album.tracks.length} titres, {formatDuration(total)}</span>
        </>}>
        <BigPlayButton {...play} disabled={album.tracks.length === 0} />
      </Hero>
      <TrackList tracks={album.tracks} showAlbum={false} showCover={false} />
    </div>
  );
}
