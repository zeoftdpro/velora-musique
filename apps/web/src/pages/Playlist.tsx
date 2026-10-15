import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, formatDuration } from '../api';
import { Cover } from '../components/Cover';
import { BigPlayButton, Hero } from '../components/Hero';
import { TrashIcon } from '../components/icons';
import { ErrorState, Loading } from '../components/States';
import { TrackList } from '../components/TrackList';
import { useDialog } from '../context/dialog';
import { useLibrary } from '../context/library';
import { useToast } from '../context/toast';
import { useAsync, useTitle } from '../hooks';
import { usePlayList } from './Album';

export function PlaylistPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const { reloadPlaylists } = useLibrary();
  const { data: playlist, error, loading, reload } = useAsync(() => api.playlist(id!), [id]);
  const [editing, setEditing] = useState(false);
  useTitle(playlist?.name);
  const play = usePlayList(playlist?.tracks);

  if (loading && !playlist) return <Loading />;
  if (error || !playlist) return <ErrorState message={error ?? 'Playlist introuvable'} />;
  const total = playlist.tracks.reduce((s, t) => s + t.durationMs, 0);

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
          <span>{playlist.tracks.length} titres{total ? `, ${formatDuration(total)}` : ''}</span>
        </>}>
        <BigPlayButton {...play} disabled={playlist.tracks.length === 0} />
        {playlist.isOwner && (
          <>
            <button className="btn btn--ghost" onClick={() => setEditing((e) => !e)}>Modifier</button>
            <button className="icon-btn" onClick={remove} aria-label="Supprimer la playlist"><TrashIcon /></button>
          </>
        )}
      </Hero>

      {editing && (
        <form className="panel form" action={save}>
          <label>Nom<input name="name" defaultValue={playlist.name} maxLength={100} required /></label>
          <label>Description<textarea name="description" defaultValue={playlist.description ?? ''} maxLength={500} rows={2} /></label>
          <label className="checkbox"><input type="checkbox" name="isPublic" defaultChecked={playlist.isPublic} /> Rendre publique</label>
          <div className="form__actions">
            <button type="button" className="btn btn--ghost" onClick={() => setEditing(false)}>Annuler</button>
            <button className="btn btn--primary">Enregistrer</button>
          </div>
        </form>
      )}

      <TrackList
        tracks={playlist.tracks}
        onRemove={playlist.isOwner ? async (t) => {
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
        <p className="muted">Ajoutez des titres depuis la recherche ou un album avec le menu « ⋯ ».</p>
      )}
    </div>
  );
}
