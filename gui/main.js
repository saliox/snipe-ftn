// Processus principal Electron. Pont entre l'UI et le moteur de snipe Epic.
import { app, BrowserWindow, ipcMain, shell, nativeImage, session, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Charge .env depuis plusieurs emplacements probables (exe packagé, userData,
// racine du projet en dev). Le premier trouvé gagne.
function loadEnv() {
  const candidates = [
    path.join(path.dirname(app.getPath('exe')), '.env'),
    path.join(app.getPath('userData'), '.env'),
    path.join(__dirname, '..', '.env'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) { dotenv.config({ path: p }); return p; }
  }
  return null;
}
loadEnv();

import { bus } from '../src/util.js';
import { loginInteractive, getValidToken, cachedAccount, authCodeUrl } from '../src/auth.js';
import { displayNameStatus, validName } from '../src/epicapi.js';
import { snipe, requestStop } from '../src/sniper.js';
import { bestOffset } from '../src/ntp.js';
import { checkForUpdates, applyUpdate } from '../src/update.js';

let win;
const ICON = path.join(__dirname, '..', 'build', 'icon.png');

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 880,
    minHeight: 600,
    title: 'Fortnite Sniper',
    backgroundColor: '#0a0714',
    show: false,
    autoHideMenuBar: true,
    ...(fs.existsSync(ICON) ? { icon: nativeImage.createFromPath(ICON) } : {}),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0714', symbolColor: '#37e6ff', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Sécurité : liens externes -> navigateur système ; aucune navigation interne.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });

  // Les logs du moteur (util.bus) sont relayés en direct au renderer.
  bus.on('log', (e) => { if (win && !win.isDestroyed()) win.webContents.send('log', e); });
}

app.whenReady().then(() => {
  // Tokens chiffrés dans userData (persistant, hors dossier d'install).
  process.env.SNIPE_DATA_DIR = app.getPath('userData');

  // Durcissement : refuse toutes les permissions (l'app n'en a besoin d'aucune).
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  Menu.setApplicationMenu(null);

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// --- Meta / MAJ ---
ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('update-check', async () => {
  try { return { ok: true, ...(await checkForUpdates()) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('update-apply', async (_e, info) => {
  try {
    await applyUpdate(info);
    setTimeout(() => { app.relaunch(); app.quit(); }, 600);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// --- Compte / login Epic ---
ipcMain.handle('whoami', () => ({ ok: true, account: cachedAccount() }));

// Ouvre la page Epic de récupération du code et renvoie l'URL (affichée en repli).
ipcMain.handle('login-url', () => {
  const url = authCodeUrl();
  shell.openExternal(url).catch(() => {});
  return url;
});

ipcMain.handle('login', async (_e, code) => {
  try {
    if (typeof code !== 'string' || !code.trim()) throw new Error('authorizationCode vide.');
    await loginInteractive(async () => code);
    return { ok: true, account: cachedAccount() };
  } catch (e) { return { ok: false, error: e.message }; }
});

// --- Vérif de disponibilité ---
ipcMain.handle('check', async (_e, name) => {
  try {
    const out = { ok: true, name, valid: validName(name) };
    const { accessToken } = await getValidToken();
    out.status = await displayNameStatus(name, accessToken);
    return out;
  } catch (e) { return { ok: false, error: e.message }; }
});

// --- NTP ---
ipcMain.handle('ntp', async () => {
  try { return { ok: true, ...(await bestOffset()) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// --- Snipe ---
ipcMain.handle('snipe', async (_e, opts) => {
  try {
    if (!validName(opts.name)) return { ok: false, error: 'Pseudo invalide (Epic : 3-16 caractères).' };
    const { accessToken, accountId } = await getValidToken();
    const result = await snipe({
      name: opts.name,
      token: accessToken,
      accountId,
      dropAt: opts.dropAt || undefined,
      monitor: !!opts.monitor,
      burst: opts.burst,
      spacingMs: opts.spacingMs,
      leadMs: opts.leadMs,
      pollMs: opts.pollMs,
      connections: opts.connections,
      skipNtp: !!opts.skipNtp,
    });
    return { ok: true, result };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('stop', () => { requestStop(); return { ok: true }; });
