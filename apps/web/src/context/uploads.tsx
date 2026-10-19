import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, putFile } from '../api';
import { CheckIcon, CloseIcon, UploadIcon } from '../components/icons';
import { useLibrary } from './library';
import { useToast } from './toast';

const EXTENSIONS = ['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.opus', '.aiff', '.wma'];
const ACCEPT = ['audio/*', ...EXTENSIONS].join(',');
const MAX_BYTES = 50 * 1024 * 1024;

type Status = 'waiting' | 'sending' | 'processing' | 'done' | 'error';
type Item = { key: number; file: File; status: Status; progress: number; error?: string };

type UploadsState = {
  /** Ouvre le sélecteur de fichiers (téléphone ou ordinateur). */
  pickFiles: () => void;
  /** Incrémenté à chaque musique ajoutée : les pages concernées se rechargent. */
  version: number;
};

const UploadsContext = createContext<UploadsState | null>(null);

const extensionOf = (name: string) => name.slice(name.lastIndexOf('.')).toLowerCase();

/**
 * Téléversement de musiques : chaque fichier est envoyé directement au stockage, puis converti par le serveur et
 * rangé dans la catégorie « Musiques téléversées ». Les envois se font un par un et continuent pendant la navigation.
 */
export function UploadsProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const { playlists, reloadPlaylists } = useLibrary();
  const [items, setItems] = useState<Item[]>([]);
  const [version, setVersion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);
  const running = useRef(false);

  const update = (key: number, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  // Traite la file : le premier fichier en attente, puis le suivant.
  useEffect(() => {
    if (running.current) return;
    const item = items.find((i) => i.status === 'waiting');
    if (!item) return;
    running.current = true;
    void (async () => {
      try {
        update(item.key, { status: 'sending' });
        const ticket = await api.startUpload({ fileName: item.file.name, size: item.file.size });
        await putFile(ticket, item.file, (progress) => update(item.key, { progress }));
        update(item.key, { status: 'processing', progress: 1 });
        await api.completeUpload(ticket.id, item.file.name);
        update(item.key, { status: 'done' });
        setVersion((v) => v + 1);
        void reloadPlaylists().catch(() => undefined);
      } catch (err) {
        update(item.key, { status: 'error', error: err instanceof ApiError || err instanceof Error ? err.message : 'Envoi impossible' });
      } finally {
        running.current = false;
        setItems((list) => [...list]); // relance l'effet pour le fichier suivant
      }
    })();
  }, [items, reloadPlaylists]);

  // Fin de la série : un message récapitulatif.
  const finished = items.length > 0 && items.every((i) => i.status === 'done' || i.status === 'error');
  const doneCount = items.filter((i) => i.status === 'done').length;
  const category = playlists.find((p) => p.kind === 'uploads')?.name ?? 'Musiques téléversées';
  const wasFinished = useRef(false);
  useEffect(() => {
    // Uniquement au passage à « terminé ».
    if (finished && !wasFinished.current && doneCount > 0) {
      toast(`${doneCount} musique${doneCount > 1 ? 's' : ''} ajoutée${doneCount > 1 ? 's' : ''} à « ${category} »`);
    }
    wasFinished.current = finished;
  }, [finished, doneCount, category, toast]);

  // Série réussie : le panneau se ferme seul. En cas d'échec, il reste ouvert pour qu'on voie lequel.
  const failed = items.some((i) => i.status === 'error');
  useEffect(() => {
    if (!finished || failed) return;
    const id = setTimeout(() => setItems([]), 4000);
    return () => clearTimeout(id);
  }, [finished, failed]);

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const added = [...files].map((file): Item => {
      const key = nextKey.current++;
      if (!EXTENSIONS.includes(extensionOf(file.name))) return { key, file, status: 'error', progress: 0, error: 'Format non pris en charge' };
      if (file.size > MAX_BYTES) return { key, file, status: 'error', progress: 0, error: 'Fichier trop lourd (50 Mo maximum)' };
      return { key, file, status: 'waiting', progress: 0 };
    });
    // Une nouvelle série remplace la précédente si celle-ci est terminée.
    setItems((list) => (list.every((i) => i.status === 'done' || i.status === 'error') ? added : [...list, ...added]));
  };

  const pickFiles = useCallback(() => inputRef.current?.click(), []);
  const value = useMemo(() => ({ pickFiles, version }), [pickFiles, version]);

  return (
    <UploadsContext.Provider value={value}>
      {children}
      <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = ''; // permet de renvoyer le même fichier
        }} />
      {items.length > 0 && <UploadPanel items={items} finished={finished} onClose={() => setItems([])} />}
    </UploadsContext.Provider>
  );
}

const STATUS_LABEL: Record<Status, string> = {
  waiting: 'En attente',
  sending: 'Envoi',
  processing: 'Conversion…',
  done: 'Ajoutée',
  error: 'Échec',
};

function UploadPanel({ items, finished, onClose }: { items: Item[]; finished: boolean; onClose: () => void }) {
  const done = items.filter((i) => i.status === 'done').length;
  return (
    <section className="upload-panel" aria-label="Téléversement" aria-live="polite">
      <header className="upload-panel__head">
        <UploadIcon size={18} />
        <strong>{finished ? 'Téléversement terminé' : 'Téléversement en cours'}</strong>
        <span className="muted">{done}/{items.length}</span>
        {finished && <button className="icon-btn" onClick={onClose} aria-label="Fermer"><CloseIcon size={16} /></button>}
      </header>
      <ul className="upload-panel__list">
        {items.map((item) => (
          <li key={item.key} className={`upload-item upload-item--${item.status}`}>
            <div className="upload-item__row">
              <span className="upload-item__name" title={item.file.name}>{item.file.name}</span>
              <span className="upload-item__status">
                {item.status === 'done' && <CheckIcon size={14} />}
                {item.status === 'sending' ? `${Math.round(item.progress * 100)} %` : STATUS_LABEL[item.status]}
              </span>
            </div>
            {item.error && <span className="upload-item__error">{item.error}</span>}
            {(item.status === 'sending' || item.status === 'processing') && (
              <div className={`upload-item__bar ${item.status === 'processing' ? 'upload-item__bar--busy' : ''}`}>
                <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function useUploads() {
  const ctx = useContext(UploadsContext);
  if (!ctx) throw new Error('useUploads doit être utilisé dans <UploadsProvider>');
  return ctx;
}
