import { Link, NavLink, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { BigPlayButton, Hero } from '../components/Hero';
import { HeartIcon, PlusIcon } from '../components/icons';
import { ErrorState, Loading } from '../components/States';
import { TrackList } from '../components/TrackList';
import { useLibrary } from '../context/library';
import { useAsync, useTitle } from '../hooks';
import { usePlayList } from './Album';

function Tabs() {
  return (
    <div className="tabs">
      <NavLink to="/library" end className="tab">Playlists</NavLink>
      <NavLink to="/library/liked" className="tab">Titres likés</NavLink>
    </div>
  );
}

export function LibraryPage() {
  useTitle('Bibliothèque');
  const { playlists, createPlaylist, favoriteIds } = useLibrary();
  const navigate = useNavigate();

  const create = async () => {
    const name = prompt('Nom de la playlist');
    if (!name?.trim()) return;
    const playlist = await createPlaylist(name.trim());
    navigate(`/playlist/${playlist.id}`);
  };

  return (
    <div className="page">
      <h1 className="page__title">Bibliothèque</h1>
      <Tabs />
      <div className="playlist-grid">
        <Link to="/library/liked" className="playlist-tile playlist-tile--liked">
          <HeartIcon size={28} filled />
          <strong>Titres likés</strong>
          <span>{favoriteIds.size} titre{favoriteIds.size > 1 ? 's' : ''}</span>
        </Link>
        {playlists.map((p) => (
          <Link key={p.id} to={`/playlist/${p.id}`} className="playlist-tile">
            <strong>{p.name}</strong>
            <span>{p.trackCount} titre{p.trackCount > 1 ? 's' : ''}{p.isPublic ? ' · publique' : ''}</span>
          </Link>
        ))}
        <button className="playlist-tile playlist-tile--new" onClick={create}>
          <PlusIcon size={28} />
          <strong>Nouvelle playlist</strong>
        </button>
      </div>
    </div>
  );
}

export function LikedPage() {
  useTitle('Titres likés');
  const { favoriteIds } = useLibrary();
  // Recharge quand le nombre de favoris change (like/unlike depuis la liste ou le lecteur).
  const { data, error, loading } = useAsync(() => api.favorites(), [favoriteIds.size]);
  const play = usePlayList(data ?? undefined);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState message={error ?? 'Erreur'} />;

  return (
    <div className="page">
      <Hero kind="Playlist" title="Titres likés"
        cover={<div className="liked-cover"><HeartIcon size={64} filled /></div>}
        meta={<span>{data.length} titre{data.length > 1 ? 's' : ''}</span>}>
        <BigPlayButton {...play} disabled={data.length === 0} />
      </Hero>
      <Tabs />
      <TrackList tracks={data} />
    </div>
  );
}
