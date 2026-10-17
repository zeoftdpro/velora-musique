import { useEffect, useState, type ReactNode } from 'react';
import { useInstall, type IosBrowser } from '../pwa';
import { CloseIcon, MoreIcon, ShareIcon } from './icons';

const DISMISS_KEY = 'velora.installBanner';
const DISMISS_DAYS = 14;

function readDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return at > 0 && Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

/**
 * Bannière « Installer Velora » des téléphones : APK sur Android, étapes d'ajout à l'écran d'accueil sur iPhone.
 * Masquable ; elle revient après quelques jours tant que l'appli n'est pas installée.
 */
export function InstallBanner() {
  const install = useInstall();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [help, setHelp] = useState(false);

  if (dismissed || install.installed || !install.mobile) return null;
  if (!install.androidDownload && !install.canPrompt && !install.ios) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* stockage indisponible : masquée pour cette visite seulement */
    }
  };

  return (
    <>
      <div className="install-banner">
        <img src="/icons/icon-192.png" alt="" width={44} height={44} />
        <div className="install-banner__text">
          <strong>Installer Velora</strong>
          <span>{install.ios ? 'Sur votre écran d’accueil, en plein écran' : 'L’appli Android, en plein écran'}</span>
        </div>
        {install.androidDownload ? (
          <a className="btn btn--primary" href={install.androidDownload} download>Installer</a>
        ) : install.ios ? (
          <button className="btn btn--primary" onClick={() => setHelp(true)}>Installer</button>
        ) : (
          <button className="btn btn--primary" onClick={install.prompt}>Installer</button>
        )}
        <button className="icon-btn" onClick={dismiss} aria-label="Masquer"><CloseIcon size={18} /></button>
      </div>
      {help && install.ios && <IosInstallDialog browser={install.ios} onClose={() => setHelp(false)} />}
    </>
  );
}

function IosInstallDialog({ browser, onClose }: { browser: IosBrowser; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="ios-install-title">
        <h2 id="ios-install-title" className="dialog__title">Installer Velora sur iPhone</h2>
        <IosInstallSteps browser={browser} />
        <div className="dialog__actions">
          <button className="btn btn--primary" onClick={onClose}>Compris</button>
        </div>
      </div>
    </div>
  );
}

const share = <ShareIcon size={16} className="inline-icon" />;
const more = <MoreIcon size={16} className="inline-icon" />;

const STEPS: Record<Exclude<IosBrowser, 'google' | 'inapp'>, ReactNode[]> = {
  safari: [
    <>Touchez le bouton <b>Partager</b> {share} (en bas de l’écran, ou dans le menu {more}).</>,
    <>Faites défiler et touchez <b>Sur l’écran d’accueil</b>.</>,
    <>Touchez <b>Ajouter</b> : l’icône Velora apparaît sur votre écran d’accueil.</>,
  ],
  chrome: [
    <>Touchez le bouton <b>Partager</b> {share} à droite de la barre d’adresse (ou menu {more} → <b>Partager</b>).</>,
    <>Touchez <b>Sur l’écran d’accueil</b>.</>,
    <>Touchez <b>Ajouter</b> : l’icône Velora apparaît sur votre écran d’accueil.</>,
  ],
  firefox: [
    <>Touchez le menu <b>☰</b> en bas à droite, puis <b>Partager</b> {share}.</>,
    <>Touchez <b>Sur l’écran d’accueil</b>.</>,
    <>Touchez <b>Ajouter</b> : l’icône Velora apparaît sur votre écran d’accueil.</>,
  ],
  edge: [
    <>Touchez le menu {more} en bas, puis <b>Partager</b> {share}.</>,
    <>Touchez <b>Sur l’écran d’accueil</b>.</>,
    <>Touchez <b>Ajouter</b> : l’icône Velora apparaît sur votre écran d’accueil.</>,
  ],
};

/** Étapes d'ajout à l'écran d'accueil, selon le navigateur de l'iPhone. */
export function IosInstallSteps({ browser }: { browser: IosBrowser }) {
  const [copied, setCopied] = useState(false);

  if (browser === 'google' || browser === 'inapp') {
    const copy = () => {
      void navigator.clipboard?.writeText(window.location.origin).then(() => setCopied(true)).catch(() => undefined);
    };
    return (
      <div className="install-steps">
        <p className="muted small">
          {browser === 'google' ? 'L’appli Google' : 'Ce navigateur intégré'} ne permet pas d’installer un site.
          Ouvrez Velora dans <b>Safari</b> ou <b>Chrome</b> (menu {more} ou {share} → <b>Ouvrir dans Safari</b>),
          puis touchez <b>Partager</b> {share} → <b>Sur l’écran d’accueil</b>.
        </p>
        <button className="btn btn--ghost" onClick={copy}>{copied ? 'Lien copié ✓' : 'Copier le lien du site'}</button>
      </div>
    );
  }

  return (
    <ol className="install-steps">
      {STEPS[browser].map((step, i) => <li key={i}>{step}</li>)}
    </ol>
  );
}
