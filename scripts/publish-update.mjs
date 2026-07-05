// Publie une mise à jour de snipe-ftn (CLI). Construit snipe-ftn.zip (les
// sources), calcule son SHA-256, écrit release/latest.json + une copie du zip,
// puis publie sur GitHub Releases (canal d'auto-update autonome).
//
//   node scripts/publish-update.mjs ["notes de version"]
//
// Ensuite, pour un flux LAN au lieu de GitHub :  npm run serve:updates
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
// --local : construit uniquement le feed release/ (pour distribution LAN via
// serve-updates), sans publier de release GitHub publique.
const rawArgs = process.argv.slice(2);
const local = rawArgs.includes('--local');
const notes = rawArgs.filter((a) => a !== '--local').join(' ');

const zipName = 'snipe-ftn.zip';
const releaseDir = path.join(root, 'release');
const zipPath = path.join(releaseDir, zipName);

// 1. Construit le zip via un dossier de staging (structure préservée). On y
//    embarque aussi les deps runtime (undici, dotenv) pour que l'auto-update
//    fonctionne SANS `npm install` (machines sans Node/npm). Jamais data/, .env,
//    release/, .git, ni node_modules/electron.
fs.mkdirSync(releaseDir, { recursive: true });
fs.rmSync(zipPath, { force: true });

const staging = path.join(releaseDir, '_stage');
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

const items = [
  'src', 'gui', 'scripts', 'package.json', 'package-lock.json',
  'README.md', '.env.example', '.gitignore',
  path.join('node_modules', 'undici'),
  path.join('node_modules', 'dotenv'),
];
for (const rel of items) {
  const from = path.join(root, rel);
  if (!fs.existsSync(from)) continue;
  const to = path.join(staging, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

const q = (s) => s.replace(/'/g, "''");
const z = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
  `Compress-Archive -Path '${q(path.join(staging, '*'))}' -DestinationPath '${q(zipPath)}' -Force`],
  { stdio: 'inherit' });
fs.rmSync(staging, { recursive: true, force: true });
if (z.status !== 0 || !fs.existsSync(zipPath)) {
  console.error('Échec de la construction du zip.');
  process.exit(1);
}

// 2. SHA-256 + taille.
const buf = fs.readFileSync(zipPath);
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
const size = buf.length;

// 3. latest.json (pour le flux HTTP/LAN).
const latest = {
  version,
  file: zipName,
  sha256,
  size,
  notes,
  pubDate: new Date().toISOString(),
};
fs.writeFileSync(path.join(releaseDir, 'latest.json'), JSON.stringify(latest, null, 2));

console.log('Feed local prêt dans release/ :');
console.log(`  version : ${version}  |  ${(size / 1024).toFixed(0)} Ko  |  sha256 ${sha256.slice(0, 12)}…`);

// Construit l'installeur NSIS (Setup.exe) pour les NOUVEAUX installs. Best-effort :
// une absence de makensis ne doit pas faire échouer la publication de la MAJ.
function buildInstaller() {
  console.log('\nConstruction de l\'installeur (Setup.exe)…');
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-installer.mjs')], { stdio: 'inherit' });
  const exe = path.join(root, 'dist', `Fortnite Sniper Setup ${version}.exe`);
  if (r.status === 0 && fs.existsSync(exe)) return exe;
  console.warn('⚠ Installeur non généré (makensis absent ?). Le reste de la publication reste OK.');
  return null;
}

// Mode LAN : on s'arrête ici (aucune publication publique), mais on régénère
// quand même l'installeur local pour les nouveaux installs.
if (local) {
  const exe = buildInstaller();
  console.log('\n✓ Feed LAN prêt. Sers-le avec :  npm run serve:updates');
  console.log('  Puis mets l\'UPDATE_URL affichée dans le .env des PC clients.');
  if (exe) console.log(`  Installeur pour nouveaux PC : ${exe}`);
  process.exit(0);
}

// 4. Publication GitHub Releases (canal d'auto-update autonome).
//    Nécessite gh authentifié. Si la release existe déjà, on remplace l'asset.
const tag = `v${version}`;
console.log(`\nPublication GitHub (${tag})...`);
const exists = spawnSync('gh', ['release', 'view', tag], { stdio: 'ignore' }).status === 0;
let gh;
if (exists) {
  console.log('  release existante → remplacement de l\'asset');
  gh = spawnSync('gh', ['release', 'upload', tag, zipPath, '--clobber'], { stdio: 'inherit' });
} else {
  gh = spawnSync('gh', ['release', 'create', tag, zipPath,
    '--title', `snipe-ftn ${version}`, '--notes', notes || `snipe-ftn ${version}`], { stdio: 'inherit' });
}
if (gh.status !== 0) {
  console.error('\n⚠ Publication GitHub échouée (gh non authentifié, ou dépôt saliox/snipe-ftn absent ?).');
  console.error('  Le feed local (release/) reste utilisable via npm run serve:updates.');
  process.exit(1);
}

// 5. Installeur Setup.exe joint à la release (téléchargement direct pour les
//    nouveaux installs). Best-effort : n'invalide pas la MAJ si ça échoue.
const setupExe = buildInstaller();
if (setupExe) {
  const up = spawnSync('gh', ['release', 'upload', tag, setupExe, '--clobber'], { stdio: 'inherit' });
  if (up.status === 0) console.log(`  ✓ Installeur joint à la release (${(fs.statSync(setupExe).size / 1e6).toFixed(0)} Mo).`);
  else console.warn('  ⚠ Upload de l\'installeur échoué (la MAJ zip reste publiée).');
}

console.log(`\n✓ Publié : https://github.com/saliox/snipe-ftn/releases/tag/${tag}`);
console.log('  Les installations récupéreront l\'avis au prochain lancement (check 1×/jour),');
console.log('  ou immédiatement via : node src/index.js update');
console.log(`  Nouveaux installs : https://github.com/saliox/snipe-ftn/releases/latest`);
