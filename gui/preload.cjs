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
  claim: (name) => ipcRenderer.invoke('claim', name),
  ntp: () => ipcRenderer.invoke('ntp'),

  snipe: (opts) => ipcRenderer.invoke('snipe', opts),
  stop: () => ipcRenderer.invoke('stop'),

  generate: (opts) => ipcRenderer.invoke('generate', opts),
  scanStart: (opts) => ipcRenderer.invoke('scan-start', opts),
  scanStop: () => ipcRenderer.invoke('scan-stop'),

  watchStart: (opts) => ipcRenderer.invoke('watch-start', opts),
  alertStatus: () => ipcRenderer.invoke('alert-status'),
  alertSet: (url) => ipcRenderer.invoke('alert-set', url),
  alertClear: () => ipcRenderer.invoke('alert-clear'),
  alertTest: () => ipcRenderer.invoke('alert-test'),

  scheduleList: () => ipcRenderer.invoke('schedule-list'),
  scheduleAdd: (payload) => ipcRenderer.invoke('schedule-add', payload),
  scheduleRemove: (id) => ipcRenderer.invoke('schedule-remove', id),
  historyStats: () => ipcRenderer.invoke('history-stats'),
  historyFree: () => ipcRenderer.invoke('history-free'),

  onLog: (cb) => ipcRenderer.on('log', (_e, data) => cb(data)),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, data) => cb(data)),
  onScanResult: (cb) => ipcRenderer.on('scan-result', (_e, data) => cb(data)),
  onScanStats: (cb) => ipcRenderer.on('scan-stats', (_e, data) => cb(data)),
  onScanStatus: (cb) => ipcRenderer.on('scan-status', (_e, data) => cb(data)),
});
