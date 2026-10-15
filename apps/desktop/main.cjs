/**
 * Velora pour Windows : ouvre l'application web dans une fenêtre dédiée.
 * L'adresse chargée vient de `VELORA_APP_URL` ou du champ `veloraAppUrl` du package.json : en pointant
 * sur le site en ligne (Netlify…), l'appli installée profite de chaque mise à jour sans être réinstallée.
 */
const { app, BrowserWindow, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('./package.json');

const APP_URL = process.env.VELORA_APP_URL || pkg.veloraAppUrl;
const appOrigin = new URL(APP_URL).origin;

// Une seule fenêtre Velora à la fois : relancer l'appli remet la fenêtre existante au premier plan.
if (!app.requestSingleInstanceLock()) app.quit();

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function readWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return {};
  }
}
function saveWindowState(win) {
  try {
    const maximized = win.isMaximized();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...(maximized ? readWindowState() : win.getBounds()), maximized }));
  } catch {
    /* état non enregistré : sans conséquence */
  }
}

const openExternal = (url) => {
  if (/^https?:\/\//.test(url)) void shell.openExternal(url);
};

let win = null;

function createWindow() {
  const state = readWindowState();
  win = new BrowserWindow({
    width: state.width ?? 1280,
    height: state.height ?? 820,
    x: state.x,
    y: state.y,
    minWidth: 380,
    minHeight: 600,
    title: 'Velora',
    backgroundColor: '#0b0b0f',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.setMenu(null);
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  // Liens externes (YouTube, Jamendo…) : navigateur par défaut, jamais dans la fenêtre de l'appli.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:') || new URL(url).origin === appOrigin) return;
    event.preventDefault();
    openExternal(url);
  });

  // Serveur injoignable (hors ligne, site arrêté) : page d'attente avec bouton « Réessayer ».
  win.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 : navigation interrompue par une autre, pas une panne
    void win.loadFile(path.join(__dirname, 'offline.html'), { query: { url: APP_URL } });
  });

  win.on('close', () => saveWindowState(win));
  win.on('closed', () => (win = null));
  void win.loadURL(APP_URL);
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
