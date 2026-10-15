// Construit l'installateur Windows (.exe) puis le copie dans le site web (apps/web/public/downloads), où le
// bouton « Installer l'appli » le propose au téléchargement. En production, préférez une release GitHub
// (variable VITE_DESKTOP_DOWNLOAD_URL du site).
//
// La construction se fait hors du projet (%LOCALAPPDATA%\velora-desktop-build) : les éditeurs et outils qui
// surveillent le dossier du projet verrouillent sinon les fichiers .asar extraits (erreurs EBUSY/EPERM).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');
const pkg = require('../package.json');

const output = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'velora-desktop-build');

(async () => {
  await build({
    projectDir: path.join(__dirname, '..'),
    targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
    config: { ...pkg.build, directories: { ...pkg.build.directories, output } },
  });

  const installer = path.join(output, `Velora-Setup-${pkg.version}.exe`);
  const targetDir = path.join(__dirname, '..', '..', 'web', 'public', 'downloads');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(installer, path.join(targetDir, 'Velora-Setup.exe'));
  console.log(`\nInstallateur : ${installer} (${(fs.statSync(installer).size / 1e6).toFixed(0)} Mo)`);
  console.log('Copié dans apps/web/public/downloads/Velora-Setup.exe');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
