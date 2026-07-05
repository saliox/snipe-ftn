// Pont sécurisé renderer <-> main (contextIsolation activé).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  appVersion: () => ipcRenderer.invoke('app-version'),
  updateCheck: () => ipcRenderer.invoke('update-check'),
  updateApply: (info) => ipcRenderer.invoke('update-apply', info),

  whoami: () => ipcRenderer.invoke('whoami'),
  eligibility: () => ipcRenderer.invoke('eligibility'),
  loginUrl: () => ipcRenderer.invoke('login-url'),
  login: (code, label) => ipcRenderer.invoke('login', code, label),

  accountsList: () => ipcRenderer.invoke('accounts-list'),
  accountRemove: (id) => ipcRenderer.invoke('account-remove', id),
  accountActivate: (id) => ipcRenderer.invoke('account-activate', id),

  check: (name) => ipcRenderer.invoke('check', name),
  ntp: () => ipcRenderer.invoke('ntp'),

  snipe: (opts) => ipcRenderer.invoke('snipe', opts),
  stop: () => ipcRenderer.invoke('stop'),

  generate: (opts) => ipcRenderer.invoke('generate', opts),
  scanStart: (opts) => ipcRenderer.invoke('scan-start', opts),
  scanStop: () => ipcRenderer.invoke('scan-stop'),

  onLog: (cb) => ipcRenderer.on('log', (_e, data) => cb(data)),
  onScanResult: (cb) => ipcRenderer.on('scan-result', (_e, data) => cb(data)),
  onScanStats: (cb) => ipcRenderer.on('scan-stats', (_e, data) => cb(data)),
  onScanStatus: (cb) => ipcRenderer.on('scan-status', (_e, data) => cb(data)),
});
