// Logique de l'UI. Communique avec le main via window.api (preload).
// Enveloppé dans une IIFE : aucune fuite dans le scope global (évite toute
// collision de déclaration si le script est évalué plus d'une fois).
(() => {
const $ = (id) => document.getElementById(id);
const api = window.api;

let mode = 'monitor';        // 'monitor' | 'scheduled'
let pendingUpdate = null;    // info de MAJ récupérée

// --- Console ---
const consoleEl = $('console');
function pushLog({ level, msg, t }) {
  const line = document.createElement('div');
  line.className = 'l';
  const time = new Date(t || Date.now()).toLocaleTimeString();
  line.innerHTML = `<span class="t">[${time}]</span> <span class="l-${level || 'info'}"></span>`;
  line.lastElementChild.textContent = ' ' + msg;
  consoleEl.appendChild(line);
  consoleEl.scrollTop = consoleEl.scrollHeight;
  while (consoleEl.childElementCount > 500) consoleEl.removeChild(consoleEl.firstChild);
}
api.onLog(pushLog);
$('btn-clear').onclick = () => { consoleEl.innerHTML = ''; };

// --- Connexion / compte ---
function renderAccount(account) {
  const conn = $('conn');
  if (account && account.accountId) {
    $('account-view').innerHTML =
      `Connecté : <b>${escapeHtml(account.displayName || '(nom inconnu)')}</b> ` +
      `<span class="muted">${escapeHtml(account.accountId)}</span>`;
    conn.textContent = account.displayName || 'Connecté';
    conn.className = 'conn on';
  } else {
    $('account-view').textContent = 'Pas encore connecté.';
    conn.textContent = 'Non connecté';
    conn.className = 'conn off';
  }
}

async function refreshWhoami() {
  const r = await api.whoami();
  renderAccount(r.ok ? r.account : null);
  if (r.ok && r.account && r.account.accountId) refreshEligibility();
  renderAccounts();
}

// Liste des comptes enregistrés (multi-comptes) : actif marqué, activer/retirer.
async function renderAccounts() {
  const box = $('accounts-list');
  const r = await api.accountsList();
  if (!r.ok || !r.accounts.length) { box.innerHTML = ''; return; }
  box.innerHTML = '';
  for (const a of r.accounts) {
    const row = document.createElement('div');
    row.className = 'acct' + (a.active ? ' active' : '');
    const name = document.createElement('span');
    name.className = 'acct-name';
    name.textContent = a.displayName || a.label;
    const tag = document.createElement('span');
    tag.className = 'acct-tag';
    tag.textContent = a.active ? 'actif' : '';
    const use = document.createElement('button');
    use.className = 'btn ghost sm'; use.textContent = 'Activer';
    use.disabled = a.active;
    use.onclick = async () => { await api.accountActivate(a.id); await refreshWhoami(); };
    const del = document.createElement('button');
    del.className = 'btn ghost sm'; del.textContent = '✕';
    del.title = 'Retirer';
    del.onclick = async () => { await api.accountRemove(a.id); await refreshWhoami(); };
    row.append(name, tag, use, del);
    box.appendChild(row);
  }
}

// Affiche l'éligibilité au changement de pseudo (cooldown 2 semaines).
async function refreshEligibility() {
  const el = await api.eligibility();
  const box = $('eligibility');
  if (!el.ok) { box.textContent = ''; return; }
  if (el.canUpdate) {
    box.innerHTML = `<span class="badge free">Éligible ✓</span> <span class="muted">changement de pseudo possible maintenant</span>`;
  } else {
    const when = el.availableAt ? new Date(el.availableAt).toLocaleString('fr-FR') : 'plus tard';
    box.innerHTML = `<span class="badge taken">Cooldown</span> <span class="muted">prochain changement possible ${escapeHtml(when)}</span>`;
  }
}

$('btn-login-url').onclick = async () => {
  const url = await api.loginUrl();
  pushLog({ level: 'step', msg: 'Page Epic ouverte dans le navigateur.' });
  pushLog({ level: 'info', msg: `Si rien ne s'ouvre : ${url}` });
};

$('btn-login').onclick = async () => {
  const code = $('login-code').value.trim();
  const label = $('login-label').value.trim();
  if (!code) { pushLog({ level: 'warn', msg: 'Colle d\'abord l\'authorizationCode.' }); return; }
  setBusy($('btn-login'), true);
  const r = await api.login(code, label || undefined);
  setBusy($('btn-login'), false);
  if (r.ok) {
    $('login-code').value = '';
    $('login-label').value = '';
    renderAccount(r.account);
    refreshEligibility();
    renderAccounts();
    pushLog({ level: 'ok', msg: `Compte ajouté : ${r.account?.displayName || r.account?.accountId}` });
  } else {
    pushLog({ level: 'err', msg: `Ajout échoué : ${r.error}` });
  }
};

// --- Vérif ---
$('btn-check').onclick = doCheck;
$('check-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') doCheck(); });
async function doCheck() {
  const name = $('check-name').value.trim();
  const box = $('check-result');
  if (!name) { box.textContent = ''; return; }
  box.innerHTML = '<span class="muted">Vérification…</span>';
  const r = await api.check(name);
  if (!r.ok) { box.innerHTML = `<span class="badge err">Erreur</span> ${escapeHtml(r.error)}`; return; }
  const s = r.status;
  if (s.free === true) box.innerHTML = `<span class="badge free">LIBRE</span>`;
  else if (s.free === false) box.innerHTML = `<span class="badge taken">PRIS</span> <span class="muted">par ${escapeHtml(s.displayName || '?')}</span>`;
  else if (s.rateLimited) box.innerHTML = `<span class="badge err">Rate limit</span> réessaie`;
  else box.innerHTML = `<span class="badge err">?</span> réponse ${s.statusCode}`;
  if (!r.valid) box.innerHTML += ' <span class="muted">(format inhabituel)</span>';
}

// --- NTP ---
$('btn-ntp').onclick = async () => {
  const box = $('ntp-result');
  box.innerHTML = '<span class="muted">Mesure…</span>';
  const r = await api.ntp();
  if (!r.ok) { box.innerHTML = `<span class="l-err">${escapeHtml(r.error)}</span>`; return; }
  const sign = r.offset >= 0 ? '+' : '';
  const state = r.offset >= 0 ? 'en retard' : 'en avance';
  box.innerHTML = `Offset <b>${sign}${r.offset.toFixed(1)} ms</b> <span class="muted">via ${escapeHtml(r.server)} · horloge ${state}</span>`;
};

// --- Mode segment ---
document.querySelectorAll('.seg-btn').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.seg-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    mode = b.dataset.mode;
    $('scheduled-row').classList.toggle('hidden', mode !== 'scheduled');
  };
});

// --- Snipe ---
$('btn-snipe').onclick = async () => {
  const name = $('snipe-name').value.trim();
  if (!name) { pushLog({ level: 'warn', msg: 'Indique un pseudo cible.' }); return; }

  const opts = {
    name,
    monitor: mode === 'monitor',
    burst: intVal('p-burst', 6),
    volley: intVal('p-volley', 3),
    spacingMs: intVal('p-spacing', 30),
    leadMs: intVal('p-lead', 40),
    pollMs: intVal('p-poll', 1000),
    connections: intVal('p-conn', 3),
    allAccounts: $('p-allaccounts').checked,
    diag: $('p-diag').checked,
    skipNtp: $('p-skipntp').checked,
  };

  if (mode === 'scheduled') {
    const v = $('snipe-at').value;
    if (!v) { pushLog({ level: 'warn', msg: 'Choisis l\'instant du drop.' }); return; }
    const ts = new Date(v).getTime(); // datetime-local = heure locale
    if (Number.isNaN(ts)) { pushLog({ level: 'err', msg: 'Date invalide.' }); return; }
    opts.dropAt = ts;
  }

  running(true);
  const r = await api.snipe(opts);
  running(false);
  if (!r.ok) pushLog({ level: 'err', msg: r.error });
  else if (r.multi) {
    if (r.winner) pushLog({ level: 'ok', msg: `🎯 ${name} obtenu par le compte « ${r.winner} » !` });
    else pushLog({ level: 'err', msg: `Échec multi-comptes (${r.count} compte(s)) pour ${name}.` });
  } else if (r.result?.success) pushLog({ level: 'ok', msg: `🎯 ${name} obtenu !` });
};

$('btn-stop').onclick = async () => { await api.stop(); pushLog({ level: 'warn', msg: 'Arrêt demandé…' }); };

function running(on) {
  $('btn-snipe').disabled = on;
  $('btn-stop').disabled = !on;
  $('btn-snipe').textContent = on ? 'Snipe en cours…' : 'Lancer le snipe';
}

// --- Mise à jour ---
$('btn-update').onclick = async () => {
  openModal('Mise à jour', 'Recherche…', false);
  const r = await api.updateCheck();
  if (!r.ok) { setModalBody(`Vérification impossible : ${escapeHtml(r.error)}`); return; }
  if (!r.available) { setModalBody(`Déjà à jour (version ${escapeHtml(r.current)}).`); return; }
  pendingUpdate = r.info;
  setModalBody(`Nouvelle version <b>${escapeHtml(r.version)}</b> disponible (actuelle ${escapeHtml(r.current)}).` +
    (r.notes ? `<br><span class="muted">${escapeHtml(String(r.notes).split('\n')[0])}</span>` : ''));
  $('update-go').classList.remove('hidden');
};
$('update-go').onclick = async () => {
  if (!pendingUpdate) return;
  setModalBody('Installation… l\'app va redémarrer.');
  $('update-go').classList.add('hidden');
  const r = await api.updateApply(pendingUpdate);
  if (!r.ok) setModalBody(`Échec : ${escapeHtml(r.error)}`);
};
$('update-cancel').onclick = () => $('update-modal').classList.add('hidden');

function openModal(title, body, showGo) {
  $('update-title').textContent = title;
  $('update-body').innerHTML = body;
  $('update-go').classList.toggle('hidden', !showGo);
  $('update-modal').classList.remove('hidden');
}
function setModalBody(html) { $('update-body').innerHTML = html; }

// --- Utilitaires ---
function intVal(id, def) { const n = parseInt($(id).value, 10); return Number.isFinite(n) ? n : def; }
function setBusy(btn, on) { btn.disabled = on; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Init ---
(async () => {
  try { const v = await api.appVersion(); $('version').textContent = 'v' + v; } catch {}
  refreshWhoami();
})();

})();
