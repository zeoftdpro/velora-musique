import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/auth';
import { useDialog } from '../context/dialog';
import { useToast } from '../context/toast';
import { useTitle } from '../hooks';
import { useInstall } from '../pwa';

export function AccountPage() {
  useTitle('Compte');
  const { user, setUser, logout, logoutEverywhere, changePassword } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const install = useInstall();
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
            ) : install.canPrompt ? (
              <><strong>Installer Velora</strong><p className="muted small">Une vraie fenêtre, une icône sur votre bureau ou votre écran d’accueil, sans barre de navigateur.</p></>
            ) : install.iosHint ? (
              <><strong>Installer sur iPhone / iPad</strong><p className="muted small">Dans Safari, touchez <b>Partager</b> puis <b>Sur l’écran d’accueil</b>.</p></>
            ) : (
              <><strong>Installer Velora</strong><p className="muted small">Ouvrez ce site dans Chrome ou Edge et utilisez l’icône d’installation de la barre d’adresse (ou le menu ⋮ → « Installer Velora »).</p></>
            )}
          </div>
          {install.desktopDownload ? (
            <a className="btn btn--primary" href={install.desktopDownload} download>Télécharger (.exe)</a>
          ) : install.canPrompt && <button className="btn btn--primary" onClick={install.prompt}>Installer</button>}
        </div>
      </section>

      <button className="btn btn--ghost section" onClick={logout}>Se déconnecter</button>
    </div>
  );
}
