// Pont sécurisé renderer <-> main (contextIsolation activé).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  appVersion: () => ipcRenderer.invoke('app-version'),
  updateCheck: () => ipcRenderer.invoke('update-check'),
  updateApply: (info) => ipcRenderer.invoke('update-apply', info),

  whoami: () => ipcRenderer.invoke('whoami'),
  loginUrl: () => ipcRenderer.invoke('login-url'),
  login: (code) => ipcRenderer.invoke('login', code),

  check: (name) => ipcRenderer.invoke('check', name),
  ntp: () => ipcRenderer.invoke('ntp'),

  snipe: (opts) => ipcRenderer.invoke('snipe', opts),
  stop: () => ipcRenderer.invoke('stop'),

  onLog: (cb) => ipcRenderer.on('log', (_e, data) => cb(data)),
});
