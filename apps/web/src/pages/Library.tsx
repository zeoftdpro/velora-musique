import { Link, NavLink, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { BigPlayButton, Hero } from '../components/Hero';
import { HeartIcon, MusicIcon, PlusIcon, UploadIcon } from '../components/icons';
import { ErrorState, Loading } from '../components/States';
import { TrackList } from '../components/TrackList';
import { useDialog } from '../context/dialog';
import { useLibrary } from '../context/library';
import { useUploads } from '../context/uploads';
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
  const { pickFiles } = useUploads();
  const navigate = useNavigate();
  const dialog = useDialog();

  const create = async () => {
    const name = await dialog.prompt({ title: 'Nouvelle playlist', label: 'Nom', confirmLabel: 'Créer' });
    if (!name) return;
    const playlist = await createPlaylist(name);
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
          <Link key={p.id} to={`/playlist/${p.id}`} className={`playlist-tile ${p.kind === 'uploads' ? 'playlist-tile--uploads' : ''}`}>
            {p.kind === 'uploads' && <MusicIcon size={28} />}
            <strong>{p.name}</strong>
            <span>{p.trackCount} titre{p.trackCount > 1 ? 's' : ''}{p.isPublic ? ' · publique' : ''}</span>
          </Link>
        ))}
        <button className="playlist-tile playlist-tile--new" onClick={pickFiles}>
          <UploadIcon size={28} />
          <strong>Téléverser des musiques</strong>
          <span>MP3, M4A, FLAC… depuis ce téléphone ou cet ordinateur</span>
        </button>
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
