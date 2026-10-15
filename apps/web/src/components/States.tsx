import { useEffect, useState } from 'react';

export function Loading() {
  return <div className="state"><span className="spinner" aria-label="Chargement" /></div>;
}

export function ErrorState({ message }: { message: string }) {
  return <div className="state state--error">{message}</div>;
}

/** Écran de démarrage : au-delà de quelques secondes, explique l'attente (serveur gratuit en cours de réveil). */
export function BootScreen() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(id);
  }, []);
  return (
    <div className="boot">
      <div className="boot__inner">
        <Loading />
        {slow && <p className="muted boot__hint">Réveil du serveur Velora… cela peut prendre jusqu’à une minute.</p>}
      </div>
    </div>
  );
}
