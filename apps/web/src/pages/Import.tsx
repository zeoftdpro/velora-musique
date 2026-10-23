import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatDuration } from '../api';
import { AddToPlaylistButton } from '../components/AddToPlaylist';
import { Cover } from '../components/Cover';
import { CheckIcon, LinkIcon, PlayIcon } from '../components/icons';
import { useLibrary } from '../context/library';
import { usePlayer } from '../context/player';
import { useTitle } from '../hooks';
import { PROVIDER_NAMES, readLink, resetImport, runImport, useImportJob } from '../imports';

const KIND_LABELS = { playlist: 'Playlist', album: 'Album', track: 'Titre' } as const;
const SERVICES = ['spotify', 'deezer', 'apple', 'youtube'] as const;

export function ImportPage() {
  useTitle('Importer');
  const job = useImportJob();
  const { reloadPlaylists } = useLibrary();
  const { playQueue } = usePlayer();
  const [params] = useSearchParams();
  const [url, setUrl] = useState(params.get('url') ?? '');
  const [name, setName] = useState('');
  const busy = job.status === 'reading' || job.status === 'importing';
  const source = job.source;

  // Lien reçu dans l'adresse (/import?url=…) : analyse immédiate.
  useEffect(() => {
    const linked = params.get('url');
    if (linked && job.status === 'idle') void readLink(linked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => setName(source?.name ?? ''), [source]);

  const analyse = (value = url) => {
    if (value.trim()) void readLink(value.trim());
  };
  const total = source?.tracks.length ?? 0;
  const pct = total ? Math.round((job.processed / total) * 100) : 0;
  const durationMs = source?.tracks.reduce((s, t) => s + t.durationMs, 0) ?? 0;

  return (
    <div className="page page--narrow import">
      <header className="import__head">
        <span className="eyebrow">Import</span>
        <h1 className="import__title">Ramenez votre musique de partout</h1>
        <p className="muted">
          Collez le lien d’une playlist, d’un album ou d’un titre : Velora retrouve chaque morceau et recrée la playlist dans votre bibliothèque.
        </p>
        <ul className="import__services" aria-label="Services pris en charge">
          {SERVICES.map((s) => <li key={s} className={`service service--${s}`}><i aria-hidden />{PROVIDER_NAMES[s]}</li>)}
        </ul>
      </header>

      <form className="import__form" onSubmit={(e) => { e.preventDefault(); analyse(); }}>
        <LinkIcon size={18} />
        <input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} disabled={job.status === 'importing'}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text').trim();
            if (/^https?:\/\//.test(pasted)) { e.preventDefault(); setUrl(pasted); analyse(pasted); }
          }}
          placeholder="https://open.spotify.com/playlist/…" aria-label="Lien à importer" autoFocus />
        <button className="btn btn--primary" disabled={busy || !url.trim()}>{job.status === 'reading' ? 'Lecture…' : 'Analyser'}</button>
      </form>

      {job.status === 'error' && <p className="form__error import__error">{job.error}</p>}

      {source && (
        <section className="import-card">
          <div className="import-card__head">
            <div className="import-card__art"><Cover src={source.coverUrl} alt={source.name} /></div>
            <div className="import-card__info">
              <span className={`service service--${source.provider}`}><i aria-hidden />{KIND_LABELS[source.kind]} {PROVIDER_NAMES[source.provider]}</span>
              {job.status === 'ready' && source.kind !== 'track' ? (
                <input className="import-card__name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} aria-label="Nom de la playlist" />
              ) : (
                <strong className="import-card__name">{job.status === 'ready' ? source.name : name || source.name}</strong>
              )}
              <span className="muted small">
                {total} titre{total > 1 ? 's' : ''}{durationMs ? ` · ${formatDuration(durationMs)}` : ''}
                {source.truncated && ' · seuls ces titres ont pu être lus'}
              </span>
            </div>
          </div>

          {job.status === 'ready' && (
            <>
              <ol className="import-card__preview">
                {source.tracks.slice(0, 5).map((t, i) => (
                  <li key={i}><span>{t.title}</span><span className="muted">{t.artists.join(', ')}</span></li>
                ))}
                {total > 5 && <li className="muted">… et {total - 5} autre{total - 5 > 1 ? 's' : ''}</li>}
              </ol>
              <div className="form__actions">
                <button className="btn btn--ghost" onClick={resetImport}>Annuler</button>
                <button className="btn btn--primary" onClick={() => void runImport(name, reloadPlaylists)}>
                  {source.kind === 'track' ? 'Trouver ce titre' : `Importer ${total} titre${total > 1 ? 's' : ''}`}
                </button>
              </div>
            </>
          )}

          {(job.status === 'importing' || job.status === 'done' || (job.status === 'error' && job.processed > 0)) && (
            <div className="import-progress">
              <div className="import-progress__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <pre className="import-log">
                {`> source : ${PROVIDER_NAMES[source.provider]} · « ${source.name} » · ${total} titre${total > 1 ? 's' : ''}\n`}
                {`> correspondance : ${job.processed}/${total} (${pct} %)\n`}
                {`> trouvés : ${job.found.length}${job.missing.length ? ` · introuvables : ${job.missing.length}` : ''}`}
                {job.status === 'importing' && <span className="import-log__caret" />}
              </pre>
            </div>
          )}

          {job.status === 'done' && (
            <div className="import-done">
              {source.kind === 'track' ? (
                job.found[0] ? (
                  <div className="import-done__track">
                    <CheckIcon size={18} />
                    <span><strong>{job.found[0].title}</strong> — {job.found[0].artist.name}</span>
                    <button className="btn btn--primary btn--with-icon" onClick={() => playQueue(job.found, 0)}><PlayIcon size={16} /> Écouter</button>
                    <AddToPlaylistButton track={job.found[0]} />
                  </div>
                ) : <p className="muted">Ce titre est introuvable sur YouTube Music.</p>
              ) : (
                <>
                  <p className="import-done__summary">
                    <CheckIcon size={18} /> {job.found.length} titre{job.found.length > 1 ? 's' : ''} sur {total} ajouté{job.found.length > 1 ? 's' : ''} à « {name || source.name} »
                  </p>
                  <div className="form__actions form__actions--start">
                    {job.playlistId && <Link className="btn btn--primary" to={`/playlist/${job.playlistId}`}>Ouvrir la playlist</Link>}
                    {job.found.length > 0 && (
                      <button className="btn btn--ghost btn--with-icon" onClick={() => playQueue(job.found, 0, job.playlistId ? { kind: 'playlist', id: job.playlistId } : null)}>
                        <PlayIcon size={16} /> Lire
                      </button>
                    )}
                    <button className="btn btn--ghost" onClick={() => { resetImport(); setUrl(''); }}>Importer un autre lien</button>
                  </div>
                </>
              )}
              {job.missing.length > 0 && source.kind !== 'track' && (
                <details className="import-missing">
                  <summary>{job.missing.length} titre{job.missing.length > 1 ? 's' : ''} introuvable{job.missing.length > 1 ? 's' : ''}</summary>
                  <ul>{job.missing.map((t, i) => <li key={i}>{t.title} <span className="muted">— {t.artists.join(', ')}</span></li>)}</ul>
                </details>
              )}
            </div>
          )}
        </section>
      )}

      {!source && job.status !== 'reading' && (
        <ol className="import-steps">
          <li><strong>Copiez le lien</strong><span className="muted">Dans Spotify, Deezer, Apple Music ou YouTube : « Partager » puis « Copier le lien ».</span></li>
          <li><strong>Collez-le ici</strong><span className="muted">Playlist publique, album ou titre.</span></li>
          <li><strong>Écoutez</strong><span className="muted">La playlist apparaît dans votre bibliothèque, prête à être lue.</span></li>
        </ol>
      )}
    </div>
  );
}
