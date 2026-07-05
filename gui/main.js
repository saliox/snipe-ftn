// Processus principal Electron. Pont entre l'UI et le moteur de snipe Epic.
import { app, BrowserWindow, ipcMain, shell, nativeImage, session, Menu, Notification } from 'electron';
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
import { authCodeUrl } from '../src/auth.js';
import {
  loginInteractive, getValidToken, cachedAccount,
  listAccounts, removeAccount, setActive, allFreshTokens,
} from '../src/accounts.js';
import { displayNameStatus, validName, nameChangeEligibility } from '../src/epicapi.js';
import { generateNames, spaceSize } from '../src/generate.js';
import { rankNames } from '../src/score.js';
import { bulkCheck, estimateScanMs } from '../src/bulk.js';
import { setWebhookUrl, testAlert, alertsConfigured } from '../src/alerts.js';
import { snipe, watchNames, requestStop } from '../src/sniper.js';
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

// Éligibilité au changement de pseudo (cooldown 2 semaines) du compte actif.
ipcMain.handle('eligibility', async () => {
  try {
    const { accessToken, accountId } = await getValidToken();
    return { ok: true, ...(await nameChangeEligibility(accessToken, accountId)) };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Ouvre la page Epic de récupération du code et renvoie l'URL (affichée en repli).
ipcMain.handle('login-url', () => {
  const url = authCodeUrl();
  shell.openExternal(url).catch(() => {});
  return url;
});

ipcMain.handle('login', async (_e, code, label) => {
  try {
    if (typeof code !== 'string' || !code.trim()) throw new Error('authorizationCode vide.');
    await loginInteractive(async () => code, label);
    return { ok: true, account: cachedAccount() };
  } catch (e) { return { ok: false, error: e.message }; }
});

// --- Multi-comptes ---
ipcMain.handle('accounts-list', () => { try { return { ok: true, ...listAccounts() }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle('account-remove', (_e, id) => { try { return { ok: true, ...removeAccount(id) }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle('account-activate', (_e, id) => { try { return { ok: true, ...setActive(id) }; } catch (e) { return { ok: false, error: e.message }; } });

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
    const common = {
      name: opts.name,
      dropAt: opts.dropAt || undefined,
      monitor: !!opts.monitor,
      burst: opts.burst,
      volley: opts.volley,
      spacingMs: opts.spacingMs,
      leadMs: opts.leadMs,
      pollMs: opts.pollMs,
      connections: opts.connections,
      diag: !!opts.diag,
      skipNtp: !!opts.skipNtp,
    };

    // Multi-comptes : tire depuis tous les comptes enregistrés en parallèle.
    if (opts.allAccounts) {
      const toks = await allFreshTokens();
      if (!toks.length) return { ok: false, error: 'Aucun compte enregistré.' };
      bus.emit('log', { level: 'step', msg: `Snipe multi-comptes : ${toks.length} compte(s)`, t: Date.now() });
      const results = await Promise.all(toks.map((t) =>
        snipe({ ...common, token: t.accessToken, accountId: t.accountId })
          .then((r) => ({ label: t.displayName || t.label, success: !!r.success }))
          .catch((e) => ({ label: t.displayName || t.label, success: false, error: e.message }))));
      const winner = results.find((x) => x.success) || null;
      return { ok: true, multi: true, count: toks.length, winner: winner ? winner.label : null, results };
    }

    const { accessToken, accountId, displayName } = await getValidToken();
    const result = await snipe({ ...common, token: accessToken, accountId, displayName, onFree: notifyFree });
    return { ok: true, result };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Notification native Windows quand un nom se libère.
function notifyFree(name) {
  try { new Notification({ title: 'Nom libre !', body: `« ${name} » vient de se libérer`, urgency: 'critical' }).show(); }
  catch { /* notifications indispo */ }
}

// --- Watchlist ---
ipcMain.handle('watch-start', async (_e, opts) => {
  try {
    const { accessToken, accountId, displayName } = await getValidToken();
    const names = (opts.names || []).map((s) => String(s).trim()).filter(Boolean);
    if (!names.length) return { ok: false, error: 'Watchlist vide.' };
    const result = await watchNames({
      names, token: accessToken, accountId, displayName,
      burst: opts.burst, volley: opts.volley, spacingMs: opts.spacingMs,
      pollMs: opts.pollMs, connections: opts.connections,
      diag: !!opts.diag, skipNtp: !!opts.skipNtp, onFree: notifyFree,
    });
    return { ok: true, result };
  } catch (e) { return { ok: false, error: e.message }; }
});

// --- Alertes Discord ---
ipcMain.handle('alert-status', () => ({ ok: true, configured: alertsConfigured() }));
ipcMain.handle('alert-set', (_e, url) => { try { setWebhookUrl(url); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle('alert-clear', () => { try { setWebhookUrl(''); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });
ipcMain.handle('alert-test', async () => { try { return { ok: true, ...(await testAlert()) }; } catch (e) { return { ok: false, error: e.message }; } });

ipcMain.handle('stop', () => { requestStop(); return { ok: true }; });

// --- Générateur + scanner en masse ---
let scanStopFlag = false;

ipcMain.handle('generate', (_e, opts) => {
  try {
    const names = generateNames(opts || {});
    return { ok: true, names, sample: names.slice(0, 12), space: spaceSize(opts?.length || 3, opts?.charset || 'alpha') };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('scan-stop', () => { scanStopFlag = true; return { ok: true }; });

ipcMain.handle('scan-start', async (_e, opts) => {
  try {
    scanStopFlag = false;
    const { accessToken } = await getValidToken();
    const names = (opts.names && opts.names.length) ? opts.names : generateNames(opts);
    if (!names.length) return { ok: false, error: 'Rien à scanner.' };

    const send = (ch, d) => { if (win && !win.isDestroyed()) win.webContents.send(ch, d); };
    send('scan-status', { state: 'start', total: names.length, etaMs: estimateScanMs(names.length) });

    let lastStat = 0;
    const summary = await bulkCheck(names, {
      token: accessToken,
      // Ne pousse que les LIBRES au renderer (les « pris » sont des milliers) ;
      // la progression passe par scan-stats (throttlé).
      onResult: (r) => { if (r.state === 'free') send('scan-result', r); },
      onStats: (s) => { const now = Date.now(); if (now - lastStat >= 250) { lastStat = now; send('scan-stats', s); } },
      shouldStop: () => scanStopFlag,
    });
    const ranked = rankNames(summary.freeList);
    return { ok: true, summary, ranked };
  } catch (e) { return { ok: false, error: e.message }; }
});
