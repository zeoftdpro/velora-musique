import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, API_CONFIGURED } from '../api';
import { Cover } from '../components/Cover';
import { InstallBanner } from '../components/InstallBanner';
import { LogoMark } from '../components/icons';
import { useAuth } from '../context/auth';
import { useAsync, useTitle } from '../hooks';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  useTitle(mode === 'login' ? 'Connexion' : 'Inscription');
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Arrivée par un lien partagé sans être connecté : on montre le titre en question (la fiche d'un titre public
  // se lit sans compte).
  const from = (location.state as { from?: string } | null)?.from;
  const sharedId = from?.match(/^\/track\/([0-9a-f-]{36})/)?.[1];
  const { data: shared } = useAsync(() => (sharedId ? api.track(sharedId).catch(() => null) : Promise.resolve(null)), [sharedId]);

  const submit = async (form: FormData) => {
    setBusy(true);
    setError(null);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, String(form.get('displayName') ?? ''));
      navigate(from ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue');
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <InstallBanner />
      <div className="auth__card">
        <div className="auth__brand"><LogoMark size={40} /><span>Velora</span></div>
        <h1>{mode === 'login' ? 'Connexion' : 'Créer un compte'}</h1>
        <p className="muted">{mode === 'login' ? 'Retrouvez votre musique.' : 'Gratuit, sans carte bancaire.'}</p>
        {shared && (
          <div className="auth__shared">
            <Cover src={shared.album.coverUrl} alt={shared.album.title} size={48} />
            <p>
              On vous a partagé <strong>« {shared.title} »</strong> de {shared.artist.name}.{' '}
              {mode === 'login' ? 'Connectez-vous' : 'Créez votre compte gratuit'} pour l’écouter tout de suite.
            </p>
          </div>
        )}
        {!API_CONFIGURED && (
          <p className="form__error" role="alert">
            Ce site n’est relié à aucun serveur Velora : la connexion est impossible pour l’instant.
          </p>
        )}
        <form className="form" action={submit}>
          <fieldset className="form__fields" disabled={!API_CONFIGURED}>
            {mode === 'register' && (
              <label>Nom affiché<input name="displayName" autoComplete="nickname" required maxLength={60} /></label>
            )}
            <label>Email<input name="email" type="email" autoComplete="email" required /></label>
            <label>Mot de passe
              <input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={mode === 'register' ? 8 : undefined} required />
            </label>
          </fieldset>
          {error && <p className="form__error" role="alert">{error}</p>}
          <button className="btn btn--primary btn--block" disabled={busy || !API_CONFIGURED}>
            {busy ? '…' : mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
          </button>
        </form>
        <p className="muted auth__switch">
          {mode === 'login'
            // L'état garde la page demandée (lien partagé…) quand on passe de la connexion à l'inscription.
            ? <>Pas encore de compte ? <Link to="/register" state={location.state}>Inscription</Link></>
            : <>Déjà inscrit ? <Link to="/login" state={location.state}>Connexion</Link></>}
        </p>
      </div>
    </div>
  );
}
