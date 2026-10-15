// Signale à l'application web qu'elle tourne dans l'appli Windows (masque les boutons « Installer »).
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('veloraDesktop', { isDesktop: true, platform: process.platform });
