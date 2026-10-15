import { api } from '../api';
import { useAuth } from '../context/auth';
import { useToast } from '../context/toast';
import { useTitle } from '../hooks';
import { useInstall } from '../pwa';

export function AccountPage() {
  useTitle('Compte');
  const { user, setUser, logout } = useAuth();
  const toast = useToast();
  const install = useInstall();
  if (!user) return null;

  const saveProfile = async (form: FormData) => {
    const displayName = String(form.get('displayName') ?? '').trim();
    if (!displayName) return;
    setUser(await api.updateMe({ displayName }));
    toast('Profil mis à jour');
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
                Téléchargez l’installateur (.exe) : raccourci sur le bureau et dans le menu Démarrer, fenêtre dédiée, touches multimédia.
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
