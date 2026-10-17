// Construit l'appli Android (APK signé) : une Trusted Web Activity qui ouvre le site en plein écran dans Chrome,
// donc avec la lecture en arrière-plan et les contrôles de l'écran verrouillé (Media Session) du navigateur.
// L'APK est copié dans apps/web/public/downloads/Velora.apk ; en production, publiez-le dans une release GitHub
// (variable VITE_ANDROID_DOWNLOAD_URL du site).
//
// Prérequis : Android Studio (JDK intégré + SDK). La clé de signature est créée au premier lancement dans
// ~/.velora-android : sans elle, impossible de publier une mise à jour installable par-dessus l'appli existante.
// Son empreinte est écrite dans apps/web/public/.well-known/assetlinks.json, que le site doit servir pour que
// Chrome masque sa barre d'adresse.
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AndroidSdkTools, Config, ConsoleLog, JdkHelper, KeyTool, TwaGenerator, TwaManifest } = require('@bubblewrap/core');
const pkg = require('../package.json');

const localAppData = process.env.LOCALAPPDATA || os.tmpdir();
const output = path.join(localAppData, 'velora-android-build');
const project = path.join(output, 'project');
const signingDir = path.join(os.homedir(), '.velora-android');
const webPublic = path.join(__dirname, '..', '..', 'web', 'public');

function firstExisting(candidates, what) {
  const found = candidates.filter(Boolean).find((p) => fs.existsSync(p));
  if (!found) throw new Error(`${what} introuvable : installez Android Studio ou définissez la variable d'environnement correspondante.`);
  return found;
}

const jdkPath = firstExisting(
  [process.env.JAVA_HOME, 'C:\\Program Files\\Android\\Android Studio\\jbr'],
  'JDK (JAVA_HOME)',
);
const sdkPath = firstExisting(
  [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(localAppData, 'Android', 'Sdk')],
  'SDK Android (ANDROID_HOME)',
);
// Bubblewrap lance keytool par son nom : le JDK doit être dans le PATH.
process.env.PATH = `${path.join(jdkPath, 'bin')}${path.delimiter}${process.env.PATH}`;

// 1.2.3 → 10203 : le code de version doit augmenter à chaque mise à jour.
const versionCode = () => pkg.version.split('.').reduce((code, part) => code * 100 + Number(part), 0);

/** Clé de signature : créée une seule fois, puis réutilisée pour toutes les versions. */
async function signingKey(keyTool) {
  const keystore = path.join(signingDir, 'velora-release.jks');
  const secretsFile = path.join(signingDir, 'signing.json');
  if (!fs.existsSync(keystore)) {
    fs.mkdirSync(signingDir, { recursive: true });
    const password = crypto.randomBytes(18).toString('base64url');
    await keyTool.createSigningKey({
      path: keystore,
      alias: 'velora',
      password,
      keypassword: password,
      fullName: 'Velora',
      organizationalUnit: 'Velora',
      organization: 'Velora',
      country: 'FR',
    });
    fs.writeFileSync(secretsFile, JSON.stringify({ alias: 'velora', password }, null, 2));
    console.log(`Nouvelle clé de signature : ${keystore} (à sauvegarder !)`);
  }
  const { alias, password } = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
  return { path: keystore, alias, password, keypassword: password };
}

(async () => {
  const log = new ConsoleLog('android');
  const config = new Config(jdkPath, sdkPath);
  const jdkHelper = new JdkHelper(process, config);
  // Pas de AndroidSdkTools.create() : sa vérification exige l'ancien dossier tools/, absent des SDK installés
  // par Android Studio, alors que seuls build-tools et platforms servent ici.
  const sdk = new AndroidSdkTools(process, config, jdkHelper, log);
  const key = await signingKey(new KeyTool(jdkHelper, log));

  // Nom, couleurs, icônes et raccourcis viennent du manifeste du site en ligne.
  const twa = await TwaManifest.fromWebManifest(new URL('/manifest.webmanifest', pkg.veloraAppUrl).href);
  Object.assign(twa, {
    packageId: pkg.packageId,
    name: pkg.productName,
    launcherName: 'Velora',
    appVersionName: pkg.version,
    appVersionCode: versionCode(),
    signingKey: { path: key.path, alias: key.alias },
    fallbackType: 'customtabs',
    minSdkVersion: 24, // Android 7 : minimum exigé par androidbrowserhelper.
  });
  const invalid = twa.validate();
  if (invalid) throw new Error(invalid);

  fs.rmSync(project, { recursive: true, force: true });
  fs.mkdirSync(project, { recursive: true });
  await new TwaGenerator().createTwaProject(project, twa, log);
  await twa.saveToFile(path.join(project, 'twa-manifest.json'));
  // Chemin complet plutôt que GradleWrapper : cmd.exe ne cherche pas gradlew.bat dans le dossier courant quand
  // NoDefaultCurrentDirectoryInExePath est défini.
  execFileSync(`"${path.join(project, 'gradlew.bat')}"`, ['assembleRelease'], { cwd: project, env: sdk.getEnv(), stdio: 'inherit', shell: true });

  const unsigned = path.join(project, 'app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk');
  const aligned = path.join(output, 'app-release-aligned.apk');
  const apk = path.join(output, `Velora-${pkg.version}.apk`);
  // zipalign et apksigner appelés directement : Bubblewrap passe par le shell sans guillemets, ce qui casse
  // sur « C:\Program Files\… ».
  const versions = fs.readdirSync(path.join(sdkPath, 'build-tools')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const buildTools = path.join(sdkPath, 'build-tools', versions.at(-1));
  execFileSync(path.join(buildTools, 'zipalign.exe'), ['-f', '-p', '4', unsigned, aligned], { stdio: 'inherit' });
  execFileSync(path.join(jdkPath, 'bin', 'java.exe'), [
    '-jar', path.join(buildTools, 'lib', 'apksigner.jar'), 'sign',
    '--ks', key.path, '--ks-key-alias', key.alias,
    '--ks-pass', 'env:VELORA_KS_PASS', '--key-pass', 'env:VELORA_KS_PASS',
    '--out', apk, aligned,
  ], { stdio: 'inherit', env: { ...process.env, VELORA_KS_PASS: key.password } });

  // Digital Asset Links : prouve à Chrome que l'appli et le site ont le même propriétaire.
  const { fingerprints } = await new KeyTool(jdkHelper, log).keyInfo(key);
  const assetLinks = [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: pkg.packageId, sha256_cert_fingerprints: [fingerprints.get('SHA256')] },
  }];
  fs.mkdirSync(path.join(webPublic, '.well-known'), { recursive: true });
  fs.writeFileSync(path.join(webPublic, '.well-known', 'assetlinks.json'), `${JSON.stringify(assetLinks, null, 2)}\n`);

  const downloads = path.join(webPublic, 'downloads');
  fs.mkdirSync(downloads, { recursive: true });
  fs.copyFileSync(apk, path.join(downloads, 'Velora.apk'));
  console.log(`\nAPK : ${apk} (${(fs.statSync(apk).size / 1e6).toFixed(1)} Mo)`);
  console.log('Copié dans apps/web/public/downloads/Velora.apk ; empreinte écrite dans apps/web/public/.well-known/assetlinks.json');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
