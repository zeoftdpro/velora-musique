import { Link } from 'react-router-dom';
import { api, type Album, type Artist, type Genre } from '../api';
import { usePlayer } from '../context/player';
import { Cover, hueOf } from './Cover';
import { PlayIcon } from './icons';

export function AlbumCard({ album }: { album: Album }) {
  const { playQueue } = usePlayer();
  const playAlbum = async (e: React.MouseEvent) => {
    e.preventDefault();
    const detail = await api.album(album.id);
    playQueue(detail.tracks, 0);
  };
  return (
    <Link to={`/album/${album.id}`} className="card">
      <div className="card__art">
        <Cover src={album.coverUrl} alt={album.title} />
        <button className="card__play" onClick={playAlbum} aria-label={`Lire ${album.title}`}>
          <PlayIcon size={22} />
        </button>
      </div>
      <div className="card__title">{album.title}</div>
      <div className="card__subtitle">
        {album.releaseYear ? `${album.releaseYear} · ` : ''}
        {album.artist.name}
      </div>
    </Link>
  );
}

export function ArtistCard({ artist }: { artist: Artist }) {
  return (
    <Link to={`/artist/${artist.id}`} className="card card--artist">
      <div className="card__art">
        <Cover src={artist.imageUrl} alt={artist.name} round />
      </div>
      <div className="card__title">{artist.name}</div>
      <div className="card__subtitle">Artiste</div>
    </Link>
  );
}

export function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid">{children}</div>;
}

export function GenreTile({ genre }: { genre: Genre }) {
  return (
    <Link to={`/search?genre=${genre.slug}`} className="genre-tile" style={{ '--hue': hueOf(genre.name) } as React.CSSProperties}>
      <span className="genre-tile__name">{genre.name}</span>
      <span className="genre-tile__count">{genre.trackCount} titre{genre.trackCount > 1 ? 's' : ''}</span>
    </Link>
  );
}

export function GenreTiles({ genres }: { genres: Genre[] }) {
  return <div className="genre-tiles">{genres.map((g) => <GenreTile key={g.id} genre={g} />)}</div>;
}
