// Assemble une version portable de l'app SANS electron-builder (100% hors-ligne).
// Produit dist/Fortnite Sniper-portable/ avec "Fortnite Sniper.exe".
//
//   node scripts/build-portable.mjs
//
// Double-clique "Fortnite Sniper.exe" : l'app démarre, aucune install requise.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
const out = path.join(root, 'dist', 'Fortnite Sniper-portable');
const EXE_NAME = 'Fortnite Sniper.exe';
const RUNTIME_DEPS = ['undici', 'dotenv']; // deps de prod (zéro dep transitive)

// Applique une icône .ico à l'exe via rcedit (fourni dans le cache
// electron-builder de snipe-mc, si présent). Silencieux si introuvable.
function applyExeIcon(exe, ico) {
  if (!fs.existsSync(ico)) return;
  const base = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign');
  let rcedit = null;
  const stack = fs.existsSync(base) ? [base] : [];
  while (stack.length && !rcedit) {
    const dir = stack.pop();
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isFile() && /rcedit-x64\.exe$/i.test(e.name)) { rcedit = p; break; }
      if (e.isDirectory()) stack.push(p);
    }
  }
  if (!rcedit) { console.log('  (rcedit introuvable — icône du .exe inchangée, non bloquant)'); return; }
  const r = spawnSync(rcedit, [exe, '--set-icon', ico], { stdio: 'ignore' });
  console.log(r.status === 0 ? '  icône du .exe appliquée (rcedit)' : '  (rcedit a échoué — non bloquant)');
}

if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) {
  console.error('Binaire Electron introuvable. Lance d\'abord : npm install');
  process.exit(1);
}

// N'efface QUE le dossier portable (pas tout dist/, où vit le feed release/).
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// 1. Runtime Electron
fs.cpSync(electronDist, out, { recursive: true });
const exePath = path.join(out, EXE_NAME);
fs.renameSync(path.join(out, 'electron.exe'), exePath);
fs.rmSync(path.join(out, 'resources', 'default_app.asar'), { force: true });

// 1b. Icône du .exe si build/icon.ico existe (optionnel).
applyExeIcon(exePath, path.join(root, 'build', 'icon.ico'));

// 2. App dans resources/app (gui + src + package.json + éventuel build/)
const appDir = path.join(out, 'resources', 'app');
fs.mkdirSync(path.join(appDir, 'node_modules'), { recursive: true });
for (const item of ['gui', 'src', 'package.json']) {
  fs.cpSync(path.join(root, item), path.join(appDir, item), { recursive: true });
}
if (fs.existsSync(path.join(root, 'build'))) {
  fs.cpSync(path.join(root, 'build'), path.join(appDir, 'build'), { recursive: true });
}
for (const dep of RUNTIME_DEPS) {
  fs.cpSync(path.join(root, 'node_modules', dep), path.join(appDir, 'node_modules', dep), { recursive: true });
}

// 3. Modèle .env à côté de l'exe (l'app le cherche là en priorité).
fs.copyFileSync(path.join(root, '.env.example'), path.join(out, '.env.example'));

const size = (dirSize(out) / 1e6).toFixed(0);
console.log(`\nPortable prêt (${size} Mo) : ${out}`);
console.log(`Double-clique "${EXE_NAME}". Optionnel : place un .env (voir .env.example) à côté.`);

function dirSize(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}
