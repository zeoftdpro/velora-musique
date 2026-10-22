import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, formatDuration } from '../api';
import { Cover } from '../components/Cover';
import { BigPlayButton, Hero, ShareButton } from '../components/Hero';
import { TrashIcon, UploadIcon } from '../components/icons';
import { ErrorState, Loading } from '../components/States';
import { TrackList } from '../components/TrackList';
import { useDialog } from '../context/dialog';
import { useLibrary } from '../context/library';
import { useToast } from '../context/toast';
import { useUploads } from '../context/uploads';
import { useAsync, useTitle } from '../hooks';
import { shareUrls } from '../share';
import { usePlayer } from '../context/player';
import { usePlayList } from './Album';

export function PlaylistPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const { reloadPlaylists } = useLibrary();
  const { pickFiles, version } = useUploads();
  // `version` : la liste se met à jour à chaque musique téléversée.
  const { data: playlist, error, loading, reload } = useAsync(() => api.playlist(id!), [id, version]);
  const [editing, setEditing] = useState(false);
  useTitle(playlist?.name);
  const source = playlist ? ({ kind: 'playlist', id: playlist.id } as const) : null;
  const play = usePlayList(playlist?.tracks, source);
  const { playlistChain, togglePlaylistChain } = usePlayer();

  if (loading && !playlist) return <Loading />;
  if (error || !playlist) return <ErrorState message={error ?? 'Playlist introuvable'} />;
  const total = playlist.tracks.reduce((s, t) => s + t.durationMs, 0);
  const isUploads = playlist.kind === 'uploads';

  const save = async (form: FormData) => {
    const name = String(form.get('name') ?? '').trim();
    if (!name) return;
    await api.updatePlaylist(playlist.id, {
      name,
      description: String(form.get('description') ?? '').trim() || null,
      isPublic: form.get('isPublic') === 'on',
    });
    setEditing(false);
    reload();
    reloadPlaylists();
  };

  const remove = async () => {
    const ok = await dialog.confirm({
      title: 'Supprimer la playlist ?',
      message: `« ${playlist.name} » sera supprimée définitivement.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    await api.deletePlaylist(playlist.id);
    await reloadPlaylists();
    toast('Playlist supprimée');
    navigate('/library');
  };

  const covers = [...new Set(playlist.tracks.map((t) => t.album.coverUrl))].slice(0, 4);

  return (
    <div className="page">
      <Hero kind={playlist.isPublic ? 'Playlist publique' : 'Playlist'} title={playlist.name}
        cover={covers.length >= 4
          ? <div className="mosaic">{covers.map((c, i) => <Cover key={i} src={c} alt="" />)}</div>
          : { src: covers[0] ?? null, alt: playlist.name }}
        meta={<>
          {playlist.description && <span className="hero__desc">{playlist.description}</span>}
          <span>{playlist.tracks.length} titre{playlist.tracks.length > 1 ? 's' : ''}{total ? `, ${formatDuration(total)}` : ''}</span>
        </>}>
        <BigPlayButton {...play} disabled={playlist.tracks.length === 0} />
        {/* Une playlist privée n'est visible que de son propriétaire : son lien ne marcherait pas chez un ami. */}
        {!isUploads && (
          <ShareButton
            data={{ title: playlist.name, text: `Écoute la playlist « ${playlist.name} » sur Velora`, url: shareUrls.playlist(playlist.id) }}
            blocked={playlist.isPublic ? undefined : 'Playlist privée : rendez-la publique (bouton « Modifier ») pour la partager'} />
        )}
        {playlist.isOwner && (
          <>
            {isUploads && <button className="btn btn--primary" onClick={pickFiles}><UploadIcon size={18} /> Téléverser</button>}
            <button className="btn btn--ghost" onClick={() => setEditing((e) => !e)}>{isUploads ? 'Renommer' : 'Modifier'}</button>
            {/* La catégorie des musiques téléversées ne se supprime pas : elle reçoit les prochains envois. */}
            {!isUploads && <button className="icon-btn" onClick={remove} aria-label="Supprimer la playlist"><TrashIcon /></button>}
            <button className={`switch ${playlistChain ? 'switch--on' : ''}`} onClick={togglePlaylistChain} role="switch"
              aria-checked={playlistChain} title="À la fin de cette playlist, lancer la suivante de votre bibliothèque">
              <span className="switch__track"><span className="switch__thumb" /></span> Enchaîner les playlists
            </button>
          </>
        )}
      </Hero>

      {editing && (
        <form className="panel form" action={save}>
          <label>Nom<input name="name" defaultValue={playlist.name} maxLength={100} required /></label>
          <label>Description<textarea name="description" defaultValue={playlist.description ?? ''} maxLength={500} rows={2} /></label>
          {/* Rendre publique les musiques téléversées n'aurait pas d'effet : elles restent privées. */}
          {!isUploads && <label className="checkbox"><input type="checkbox" name="isPublic" defaultChecked={playlist.isPublic} /> Rendre publique</label>}
          <div className="form__actions">
            <button type="button" className="btn btn--ghost" onClick={() => setEditing(false)}>Annuler</button>
            <button className="btn btn--primary">Enregistrer</button>
          </div>
        </form>
      )}

      <TrackList
        tracks={playlist.tracks}
        source={source}
        // Dans « Musiques téléversées », retirer un titre supprime le fichier : on demande confirmation.
        removeLabel={isUploads ? 'Supprimer définitivement' : undefined}
        onRemove={playlist.isOwner ? async (t) => {
          if (isUploads && !(await dialog.confirm({
            title: 'Supprimer cette musique ?',
            message: `« ${t.title} » sera supprimée de Velora, ainsi que de vos autres playlists.`,
            confirmLabel: 'Supprimer',
            danger: true,
          }))) return;
          await api.removeFromPlaylist(playlist.id, t.itemId!);
          reload();
          reloadPlaylists();
        } : undefined}
        onMove={playlist.isOwner ? async (t, delta) => {
          const index = playlist.tracks.findIndex((x) => x.itemId === t.itemId);
          await api.movePlaylistItem(playlist.id, t.itemId!, index + delta);
          reload();
        } : undefined}
      />
      {playlist.tracks.length === 0 && playlist.isOwner && (
        <p className="muted">
          {isUploads
            ? 'Envoyez vos musiques (MP3, M4A, FLAC…) avec le bouton « Téléverser » : elles arrivent ici, et vous seul pouvez les écouter.'
            : 'Ajoutez des titres depuis la recherche ou un album avec le menu « ⋯ ».'}
        </p>
      )}
    </div>
  );
}
