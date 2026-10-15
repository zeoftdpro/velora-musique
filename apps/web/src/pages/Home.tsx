import { Link } from 'react-router-dom';
import { api, type Album, type Artist, type Track } from '../api';
import { AlbumCard, ArtistCard, GenreTiles, Grid } from '../components/Cards';
import { Cover } from '../components/Cover';
import { PlayIcon, SearchIcon } from '../components/icons';
import { ErrorState, Loading } from '../components/States';
import { useAuth } from '../context/auth';
import { usePlayer } from '../context/player';
import { useAsync, useTitle } from '../hooks';

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return 'Bonne nuit';
  if (h < 18) return 'Bonjour';
  return 'Bonsoir';
}

const uniqueBy = <T,>(items: T[], key: (item: T) => string) => items.filter((x, i) => items.findIndex((y) => key(y) === key(x)) === i);

export function HomePage() {
  useTitle(undefined);
  const { user } = useAuth();
  const { playQueue } = usePlayer();
  // Le catalogue « local » exclut les titres mis en cache par les recherches YouTube/Jamendo :
  // ceux-ci n'apparaissent sur l'accueil qu'une fois écoutés (section « Écoutés récemment »).
  const { data, error, loading } = useAsync(
    () => Promise.all([api.albums({ limit: 12, source: 'local' }), api.artists('local'), api.genres(), api.history()]),
    [],
  );

  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error ?? 'Erreur'} />;
  const [albums, localArtists, genres, history] = data;

  // L'historique peut contenir plusieurs écoutes du même titre.
  const recent = uniqueBy(history, (t) => t.id);
  const recentAlbums: Album[] = uniqueBy(recent, (t) => t.album.id).map((t) => ({
    id: t.album.id, title: t.album.title, coverUrl: t.album.coverUrl, releaseYear: null, artist: t.artist, genre: t.genre,
  }));
  const recentArtists: Artist[] = uniqueBy(recent, (t) => t.artist.id).map((t) => ({
    id: t.artist.id, name: t.artist.name, bio: null, imageUrl: t.album.coverUrl,
  }));
  const artists = uniqueBy([...recentArtists, ...localArtists], (a) => a.id).slice(0, 12);
  const browsable = genres.filter((g) => g.trackCount > 0);

  return (
    <div className="page">
      <h1 className="page__title">{greeting()}, {user?.displayName}</h1>

      {recent.length > 0 ? (
        <section className="section section--first">
          <div className="quick-grid">
            {recent.slice(0, 6).map((track, i) => <QuickTile key={track.id} track={track} onPlay={() => playQueue(recent, i)} />)}
          </div>
        </section>
      ) : (
        <Link to="/search" className="search-cta">
          <span className="search-cta__icon"><SearchIcon size={26} /></span>
          <span>
            <strong>Trouvez n’importe quel titre</strong>
            <span className="muted">Artistes, albums, morceaux : votre catalogue et tout YouTube.</span>
          </span>
        </Link>
      )}

      {recentAlbums.length > 0 && (
        <section className="section">
          <h2 className="section__title">Écoutés récemment</h2>
          <Grid>{recentAlbums.slice(0, 12).map((a) => <AlbumCard key={a.id} album={a} />)}</Grid>
        </section>
      )}

      <section className="section">
        <h2 className="section__title">Votre catalogue</h2>
        {albums.length === 0 ? (
          <div className="empty-catalog">
            <p>Aucun titre importé pour l’instant.</p>
            <p className="muted">Générez des titres de démo puis lancez l'ingestion :</p>
            <code>npm run demo:generate &amp;&amp; npm run ingest -- music/demo</code>
          </div>
        ) : (
          <Grid>{albums.map((a) => <AlbumCard key={a.id} album={a} />)}</Grid>
        )}
      </section>

      {browsable.length > 0 && (
        <section className="section">
          <h2 className="section__title">Parcourir par genre</h2>
          <GenreTiles genres={browsable} />
        </section>
      )}

      {artists.length > 0 && (
        <section className="section">
          <h2 className="section__title">Artistes</h2>
          <Grid>{artists.map((a) => <ArtistCard key={a.id} artist={a} />)}</Grid>
        </section>
      )}
    </div>
  );
}

function QuickTile({ track, onPlay }: { track: Track; onPlay: () => void }) {
  return (
    <div className="quick-tile">
      <Cover src={track.album.coverUrl} alt={track.album.title} size={56} />
      <Link to={`/album/${track.album.id}`} className="quick-tile__title">{track.title}</Link>
      <button className="quick-tile__play" onClick={onPlay} aria-label={`Lire ${track.title}`}><PlayIcon size={18} /></button>
    </div>
  );
}
