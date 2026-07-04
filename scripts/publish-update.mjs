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

// 1. Construit le zip de sources. On n'inclut que ce qui doit être déployé
//    (jamais data/, node_modules/, .env, release/, .git).
fs.mkdirSync(releaseDir, { recursive: true });
fs.rmSync(zipPath, { force: true });

const include = ['src', 'scripts', 'package.json', 'package-lock.json', 'README.md', '.env.example', '.gitignore']
  .filter((p) => fs.existsSync(path.join(root, p)))
  .map((p) => `'${path.join(root, p).replace(/'/g, "''")}'`)
  .join(',');

const z = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
  `Compress-Archive -Path ${include} -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`],
  { stdio: 'inherit' });
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

// Mode LAN : on s'arrête ici (aucune publication publique).
if (local) {
  console.log('\n✓ Feed LAN prêt. Sers-le avec :  npm run serve:updates');
  console.log('  Puis mets l\'UPDATE_URL affichée dans le .env des PC clients.');
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

console.log(`\n✓ Publié : https://github.com/saliox/snipe-ftn/releases/tag/${tag}`);
console.log('  Les installations récupéreront l\'avis au prochain lancement (check 1×/jour),');
console.log('  ou immédiatement via : node src/index.js update');
