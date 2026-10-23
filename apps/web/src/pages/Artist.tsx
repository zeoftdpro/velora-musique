import { useParams } from 'react-router-dom';
import { api } from '../api';
import { AlbumCard, Grid } from '../components/Cards';
import { BigPlayButton, Hero, ShareButton } from '../components/Hero';
import { ErrorState, Loading } from '../components/States';
import { TrackList } from '../components/TrackList';
import { useAsync, useCoverColor, useTitle } from '../hooks';
import { shareUrls } from '../share';
import { usePlayList } from './Album';

export function ArtistPage() {
  const { id } = useParams();
  const { data: artist, error, loading } = useAsync(() => api.artist(id!), [id]);
  useTitle(artist?.name);
  const play = usePlayList(artist?.topTracks);
  const image = artist ? artist.imageUrl ?? artist.albums[0]?.coverUrl ?? null : null;
  const tint = useCoverColor(image, artist?.name ?? '');

  if (loading && !artist) return <Loading />;
  if (error || !artist) return <ErrorState message={error ?? 'Artiste introuvable'} />;

  return (
    <div className="page page--tinted" style={{ '--tint': tint } as React.CSSProperties}>
      <Hero kind="Artiste" title={artist.name} round backdrop={image}
        cover={{ src: image, alt: artist.name }}
        meta={<span>{artist.albums.length} album{artist.albums.length > 1 ? 's' : ''}</span>}>
        <BigPlayButton {...play} disabled={artist.topTracks.length === 0} />
        <ShareButton
          data={{ title: artist.name, text: `Écoute ${artist.name} sur Velora`, url: shareUrls.artist(artist.id) }}
          blocked={artist.topTracks.some((t) => t.uploaded) ? 'Artiste de vos musiques téléversées : il reste privé et ne peut pas être partagé' : undefined} />
      </Hero>
      {artist.bio && <p className="bio">{artist.bio}</p>}

      <section className="section">
        <h2 className="section__title">Populaires</h2>
        <TrackList tracks={artist.topTracks} />
      </section>
      <section className="section">
        <h2 className="section__title">Discographie</h2>
        <Grid>{artist.albums.map((a) => <AlbumCard key={a.id} album={a} />)}</Grid>
      </section>
    </div>
  );
}
