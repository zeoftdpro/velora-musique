import { useState } from 'react';
import { api } from '../api';
import { IosInstallSteps } from '../components/InstallBanner';
import { useAuth } from '../context/auth';
import { useDialog } from '../context/dialog';
import { usePlayer } from '../context/player';
import { useToast } from '../context/toast';
import { useTitle } from '../hooks';
import { useInstall } from '../pwa';
import { useTheme, type ThemeChoice } from '../theme';

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: 'dark', label: 'Sombre' },
  { value: 'light', label: 'Clair' },
  { value: 'system', label: 'Système' },
];

export function AccountPage() {
  useTitle('Compte');
  const { user, setUser, logout, logoutEverywhere, changePassword } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const install = useInstall();
  const { autoplay, toggleAutoplay } = usePlayer();
  const [theme, setTheme] = useTheme();
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  if (!user) return null;

  const saveProfile = async (form: FormData) => {
    const displayName = String(form.get('displayName') ?? '').trim();
    if (!displayName) return;
    setUser(await api.updateMe({ displayName }));
    toast('Profil mis à jour');
  };

  const savePassword = async (form: FormData) => {
    const current = String(form.get('currentPassword') ?? '');
    const next = String(form.get('newPassword') ?? '');
    setPasswordError(null);
    if (next !== String(form.get('confirmPassword') ?? '')) {
      setPasswordError('Les deux nouveaux mots de passe ne correspondent pas');
      return;
    }
    setPasswordBusy(true);
    try {
      await changePassword(current, next);
      toast('Mot de passe modifié : vos autres appareils ont été déconnectés');
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Une erreur est survenue');
    } finally {
      setPasswordBusy(false);
    }
  };

  const signOutEverywhere = async () => {
    const ok = await dialog.confirm({
      title: 'Déconnecter tous les appareils ?',
      message: 'Toutes les sessions ouvertes sur ce compte (navigateurs, appli Windows), y compris celle-ci, seront fermées.',
      confirmLabel: 'Tout déconnecter',
      danger: true,
    });
    if (ok) await logoutEverywhere().catch(() => toast('Impossible de fermer les sessions, réessayez'));
  };

  return (
    <div className="page page--narrow">
      <h1 className="page__title">Compte</h1>

      <section className="panel">
        <h2 className="section__title">Profil</h2>
        <form className="form" action={saveProfile}>
          <label>Email<input value={user.email} disabled /></label>
          <label>Nom affiché<input name="displayName" defaultValue={user.displayName} maxLength={60} required /></label>
          <div className="form__actions"><button className="btn btn--primary">Enregistrer</button></div>
        </form>
      </section>

      <section className="panel section">
        <h2 className="section__title">Sécurité</h2>
        <form className="form" action={savePassword}>
          <input type="email" name="username" autoComplete="username" value={user.email} readOnly hidden />
          <label>Mot de passe actuel<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
          <label>Nouveau mot de passe<input name="newPassword" type="password" autoComplete="new-password" minLength={8} required /></label>
          <label>Confirmer le nouveau mot de passe<input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required /></label>
          {passwordError && <p className="form__error" role="alert">{passwordError}</p>}
          <div className="form__actions">
            <button type="button" className="btn btn--ghost" onClick={signOutEverywhere}>Déconnecter tous les appareils</button>
            <button className="btn btn--primary" disabled={passwordBusy}>{passwordBusy ? '…' : 'Changer le mot de passe'}</button>
          </div>
        </form>
      </section>

      <section className="panel section">
        <h2 className="section__title">Lecture</h2>
        <div className="setting">
          <div>
            <strong>Lecture automatique</strong>
            <p className="muted small">À la fin de la file d’attente, Velora enchaîne des titres recommandés d’après ce que vous écoutez.</p>
          </div>
          <button className={`switch ${autoplay ? 'switch--on' : ''}`} onClick={toggleAutoplay} role="switch" aria-checked={autoplay}
            aria-label="Lecture automatique">
            <span className="switch__track"><span className="switch__thumb" /></span>
          </button>
        </div>
        <div className="setting">
          <div>
            <strong>Apparence</strong>
            <p className="muted small">Thème sombre, clair, ou celui de votre appareil.</p>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Thème">
            {THEMES.map((t) => (
              <button key={t.value} role="radio" aria-checked={theme === t.value} onClick={() => setTheme(t.value)}>{t.label}</button>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">Application</h2>
        <div className="panel install-panel">
          <img src="/icons/icon-192.png" alt="" width={56} height={56} />
          <div>
            {install.installed ? (
              <><strong>Velora est installée</strong><p className="muted small">
                {install.desktopApp ? 'Vous utilisez l’application Windows.' : 'Vous utilisez l’application installée.'}
              </p></>
            ) : install.desktopDownload ? (
              <><strong>Velora pour Windows</strong><p className="muted small">
                Téléchargez l’installateur (.exe), puis ouvrez « Velora Musique » depuis le bureau ou le menu Démarrer : fenêtre dédiée, touches multimédia.
                {install.canPrompt && <> Ou <button className="link-btn" onClick={install.prompt}>installer depuis le navigateur</button>.</>}
              </p></>
            ) : install.androidDownload ? (
              <><strong>Velora pour Android</strong><p className="muted small">
                Téléchargez l’appli (.apk), ouvrez-la et autorisez l’installation si Android le demande : plein écran, lecture en arrière-plan et commandes sur l’écran verrouillé.
                {install.canPrompt && <> Ou <button className="link-btn" onClick={install.prompt}>installer depuis le navigateur</button>.</>}
              </p></>
            ) : install.canPrompt ? (
              <><strong>Installer Velora</strong><p className="muted small">Une vraie fenêtre, une icône sur votre bureau ou votre écran d’accueil, sans barre de navigateur.</p></>
            ) : install.ios ? (
              <><strong>Installer sur iPhone / iPad</strong><IosInstallSteps browser={install.ios} /></>
            ) : (
              <><strong>Installer Velora</strong><p className="muted small">Ouvrez ce site dans Chrome ou Edge et utilisez l’icône d’installation de la barre d’adresse (ou le menu ⋮ → « Installer Velora »).</p></>
            )}
          </div>
          {install.desktopDownload ? (
            <a className="btn btn--primary" href={install.desktopDownload} download>Télécharger (.exe)</a>
          ) : install.androidDownload ? (
            <a className="btn btn--primary" href={install.androidDownload} download>Télécharger (.apk)</a>
          ) : install.canPrompt && <button className="btn btn--primary" onClick={install.prompt}>Installer</button>}
        </div>
      </section>

      <button className="btn btn--ghost section" onClick={logout}>Se déconnecter</button>
    </div>
  );
}
