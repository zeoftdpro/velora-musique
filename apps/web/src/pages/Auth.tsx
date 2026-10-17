import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { API_CONFIGURED } from '../api';
import { InstallBanner } from '../components/InstallBanner';
import { LogoMark } from '../components/icons';
import { useAuth } from '../context/auth';
import { useTitle } from '../hooks';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  useTitle(mode === 'login' ? 'Connexion' : 'Inscription');
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (form: FormData) => {
    setBusy(true);
    setError(null);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, String(form.get('displayName') ?? ''));
      const from = (location.state as { from?: string } | null)?.from;
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
            ? <>Pas encore de compte ? <Link to="/register">Inscription</Link></>
            : <>Déjà inscrit ? <Link to="/login">Connexion</Link></>}
        </p>
      </div>
    </div>
  );
}
