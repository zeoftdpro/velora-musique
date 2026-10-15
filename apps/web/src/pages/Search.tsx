import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Album, type Artist, type SearchResults, type Track } from '../api';
import { AlbumCard, ArtistCard, GenreTiles, Grid } from '../components/Cards';
import { Cover } from '../components/Cover';
import { PlayIcon, SearchIcon } from '../components/icons';
import { ErrorState, Loading } from '../components/States';
import { TrackList } from '../components/TrackList';
import { usePlayer } from '../context/player';
import { useAsync, useDebounced, useRecentSearches, useTitle } from '../hooks';

const TOP_COUNT = 5;

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

type Best =
  | { kind: 'artist'; artist: Artist; cover: string | null }
  | { kind: 'track'; track: Track; index: number }
  | { kind: 'album'; album: Album };

/** Meilleur résultat : l'artiste si son nom correspond à la saisie, sinon le premier titre, sinon le premier album. */
function pickBest(q: string, r: SearchResults | null, tracks: Track[]): Best | null {
  const nq = normalize(q);
  // Les artistes des titres YouTube comptent aussi : à la première recherche, ils ne sont pas encore dans le catalogue.
  const fromTracks: Artist[] = tracks.map((t) => ({ id: t.artist.id, name: t.artist.name, bio: null, imageUrl: null }));
  const matches = (a: Artist) => normalize(a.name) === nq || (nq.length >= 3 && normalize(a.name).startsWith(nq));
  const artist = r?.artists.find(matches) ?? fromTracks.find(matches);
  if (artist) {
    const cover = artist.imageUrl ?? tracks.find((t) => t.artist.id === artist.id)?.album.coverUrl ?? null;
    return { kind: 'artist', artist, cover };
  }
  if (tracks[0]) return { kind: 'track', track: tracks[0], index: 0 };
  if (r?.albums[0]) return { kind: 'album', album: r.albums[0] };
  return null;
}

export function SearchPage() {
  useTitle('Rechercher');
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const genre = params.get('genre') ?? undefined;
  const debouncedQ = useDebounced(q.trim(), 180);
  const recent = useRecentSearches();

  const genres = useAsync(() => api.genres(), []);
  const results = useAsync(
    () => (debouncedQ || genre ? api.search(debouncedQ, genre) : Promise.resolve(null)),
    [debouncedQ, genre],
  );
  // Recherche YouTube : plus lente et soumise à un quota, elle n'est lancée qu'une fois la saisie stabilisée.
  const webQ = useDebounced(q.trim(), 700);
  const web = useAsync(() => (webQ.length >= 3 ? api.searchWeb(webQ) : Promise.resolve(null)), [webQ]);
  const webSettled = webQ.length >= 3 && webQ === q.trim();
  const webTracks = useMemo(() => (webSettled ? web.data?.tracks ?? [] : []), [webSettled, web.data]);

  const update = (next: { q?: string; genre?: string | null }) => {
    const p = new URLSearchParams(params);
    if (next.q !== undefined) (next.q ? p.set('q', next.q) : p.delete('q'));
    if (next.genre !== undefined) (next.genre ? p.set('genre', next.genre) : p.delete('genre'));
    setParams(p, { replace: true });
  };

  const r = results.data;
  // Catalogue local d'abord, puis YouTube ; un titre déjà présent (mis en cache) n'apparaît qu'une fois.
  const tracks = useMemo(() => {
    const all = [...(r?.tracks ?? []), ...webTracks];
    return all.filter((t, i) => all.findIndex((x) => x.id === t.id) === i);
  }, [r, webTracks]);
  const best = debouncedQ ? pickBest(debouncedQ, r, tracks) : null;
  const webPending = webQ.length >= 3 && web.data?.status !== 'disabled' && (!webSettled || web.loading);
  const empty = r && tracks.length + r.albums.length + r.artists.length === 0 && !webPending;

  // Mémorise la recherche une fois la saisie stabilisée et des résultats trouvés.
  const { add } = recent;
  useEffect(() => {
    if (webSettled && tracks.length > 0) add(webQ);
  }, [webSettled, webQ, tracks.length, add]);

  const browsable = genres.data?.filter((g) => g.trackCount > 0) ?? [];

  return (
    <div className="page">
      <div className="searchbar">
        <SearchIcon />
        <input autoFocus type="search" placeholder="Que voulez-vous écouter ?" value={q}
          onChange={(e) => update({ q: e.target.value })} aria-label="Rechercher" />
      </div>

      {browsable.length > 0 && (debouncedQ || genre) && (
        <div className="chips chips--filters" role="group" aria-label="Filtrer par genre">
          <button className={`chip ${!genre ? 'chip--active' : ''}`} onClick={() => update({ genre: null })}>Tous</button>
          {browsable.map((g) => (
            <button key={g.id} className={`chip ${genre === g.slug ? 'chip--active' : ''}`}
              onClick={() => update({ genre: genre === g.slug ? null : g.slug })}>{g.name}</button>
          ))}
        </div>
      )}

      {!debouncedQ && !genre && (
        <>
          {recent.items.length > 0 && (
            <section className="section">
              <div className="section__head">
                <h2 className="section__title">Recherches récentes</h2>
                <button className="link-btn" onClick={recent.clear}>Effacer</button>
              </div>
              <div className="chips">
                {recent.items.map((item) => (
                  <span key={item} className="chip chip--removable">
                    <button onClick={() => update({ q: item })}>{item}</button>
                    <button className="chip__remove" onClick={() => recent.remove(item)} aria-label={`Retirer « ${item} »`}>×</button>
                  </span>
                ))}
              </div>
            </section>
          )}
          {browsable.length > 0 && (
            <section className="section">
              <h2 className="section__title">Parcourir</h2>
              <GenreTiles genres={browsable} />
            </section>
          )}
        </>
      )}

      {results.error && <ErrorState message={results.error} />}
      {results.loading && !r && (debouncedQ || genre) && <Loading />}
      {empty && <p className="muted section">Aucun résultat pour « {debouncedQ} ».</p>}

      {(best || tracks.length > 0) && (
        <div className="search-top section">
          {best && (
            <section>
              <h2 className="section__title">Meilleur résultat</h2>
              <BestResult best={best} tracks={tracks} />
            </section>
          )}
          {tracks.length > 0 && (
            <section className="search-top__tracks">
              <h2 className="section__title">Titres</h2>
              <TrackList tracks={tracks.slice(0, TOP_COUNT)} showAlbum={false} />
            </section>
          )}
        </div>
      )}
      {webPending && <p className="muted search-pending">Recherche sur YouTube…</p>}
      {web.data?.status === 'quota' && webSettled && (
        <p className="muted search-pending">Quota de recherche YouTube atteint pour aujourd’hui : seuls vos titres s’affichent.</p>
      )}

      {tracks.length > TOP_COUNT && (
        <section className="section">
          <h2 className="section__title">Plus de titres</h2>
          <TrackList tracks={tracks.slice(TOP_COUNT)} offset={TOP_COUNT} />
        </section>
      )}
      {r && r.artists.length > 0 && (
        <section className="section">
          <h2 className="section__title">Artistes</h2>
          <Grid>{r.artists.map((a) => <ArtistCard key={a.id} artist={a} />)}</Grid>
        </section>
      )}
      {r && r.albums.length > 0 && (
        <section className="section">
          <h2 className="section__title">Albums</h2>
          <Grid>{r.albums.map((a) => <AlbumCard key={a.id} album={a} />)}</Grid>
        </section>
      )}
      {tracks.some((t) => t.source !== 'local') && (
        <p className="muted attribution">
          Résultats externes fournis par{' '}
          {tracks.some((t) => t.source === 'youtube') && <a href="https://www.youtube.com" target="_blank" rel="noreferrer">YouTube</a>}
          {tracks.some((t) => t.source === 'youtube') && tracks.some((t) => t.source === 'jamendo') && ' et '}
          {tracks.some((t) => t.source === 'jamendo') && <a href="https://www.jamendo.com" target="_blank" rel="noreferrer">Jamendo</a>}.
        </p>
      )}
    </div>
  );
}

function BestResult({ best, tracks }: { best: Best; tracks: Track[] }) {
  const { playQueue } = usePlayer();
  const navigate = useNavigate();

  if (best.kind === 'artist') {
    return (
      <Link to={`/artist/${best.artist.id}`} className="best">
        <Cover src={best.cover} alt={best.artist.name} size={96} round />
        <span className="best__title">{best.artist.name}</span>
        <span className="best__kind">Artiste</span>
      </Link>
    );
  }
  if (best.kind === 'album') {
    return (
      <Link to={`/album/${best.album.id}`} className="best">
        <Cover src={best.album.coverUrl} alt={best.album.title} size={96} />
        <span className="best__title">{best.album.title}</span>
        <span className="best__kind">Album · {best.album.artist.name}</span>
      </Link>
    );
  }
  const { track } = best;
  return (
    <div className="best" role="link" tabIndex={0} onClick={() => navigate(`/album/${track.album.id}`)}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/album/${track.album.id}`)}>
      <Cover src={track.album.coverUrl} alt={track.album.title} size={96} />
      <span className="best__title">{track.title}</span>
      <span className="best__kind">Titre · {track.artist.name}</span>
      <button className="best__play" aria-label={`Lire ${track.title}`}
        onClick={(e) => { e.stopPropagation(); playQueue(tracks, best.index); }}>
        <PlayIcon size={22} />
      </button>
    </div>
  );
}
