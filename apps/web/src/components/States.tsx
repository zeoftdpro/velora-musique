export function Loading() {
  return <div className="state"><span className="spinner" aria-label="Chargement" /></div>;
}

export function ErrorState({ message }: { message: string }) {
  return <div className="state state--error">{message}</div>;
}

/** Écran de démarrage, le temps de restaurer la session (une fraction de seconde). */
export function BootScreen() {
  return (
    <div className="boot">
      <div className="boot__inner">
        <Loading />
      </div>
    </div>
  );
}
