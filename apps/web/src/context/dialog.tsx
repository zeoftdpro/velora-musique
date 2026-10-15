import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Boîtes de dialogue intégrées à l'application, en remplacement de window.prompt() / window.confirm() :
 * celles-ci sont bloquantes, impossibles à styler, et non prises en charge par Electron (appli Windows).
 */
type PromptOptions = { title: string; label?: string; defaultValue?: string; confirmLabel?: string };
type ConfirmOptions = { title: string; message?: string; confirmLabel?: string; danger?: boolean };

type DialogApi = {
  prompt: (options: PromptOptions) => Promise<string | null>;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

type Pending =
  | ({ kind: 'prompt'; resolve: (value: string | null) => void } & PromptOptions)
  | ({ kind: 'confirm'; resolve: (value: boolean) => void } & ConfirmOptions);

const DialogContext = createContext<DialogApi | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const prompt = useCallback(
    (options: PromptOptions) => new Promise<string | null>((resolve) => setPending({ kind: 'prompt', resolve, ...options })),
    [],
  );
  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ kind: 'confirm', resolve, ...options })),
    [],
  );

  return (
    <DialogContext.Provider value={{ prompt, confirm }}>
      {children}
      {pending && <Dialog pending={pending} onClose={() => setPending(null)} />}
    </DialogContext.Provider>
  );
}

function Dialog({ pending, onClose }: { pending: Pending; onClose: () => void }) {
  const [value, setValue] = useState(pending.kind === 'prompt' ? pending.defaultValue ?? '' : '');
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const cancel = useCallback(() => {
    if (pending.kind === 'prompt') pending.resolve(null);
    else pending.resolve(false);
    onClose();
  }, [pending, onClose]);

  const submit = () => {
    if (pending.kind === 'prompt') {
      if (!value.trim()) return;
      pending.resolve(value.trim());
    } else {
      pending.resolve(true);
    }
    onClose();
  };

  useEffect(() => {
    if (pending.kind === 'prompt') inputRef.current?.select();
    else confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, cancel]);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"
        onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <h2 id="dialog-title" className="dialog__title">{pending.title}</h2>
        {pending.kind === 'confirm' && pending.message && <p className="muted">{pending.message}</p>}
        {pending.kind === 'prompt' && (
          <label className="dialog__field">
            {pending.label && <span>{pending.label}</span>}
            <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} maxLength={100} autoFocus />
          </label>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={cancel}>Annuler</button>
          <button ref={confirmRef} type="submit" disabled={pending.kind === 'prompt' && !value.trim()}
            className={`btn ${pending.kind === 'confirm' && pending.danger ? 'btn--danger' : 'btn--primary'}`}>
            {pending.confirmLabel ?? (pending.kind === 'prompt' ? 'Valider' : 'Confirmer')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog doit être utilisé dans <DialogProvider>');
  return ctx;
}
