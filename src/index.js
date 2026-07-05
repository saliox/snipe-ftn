#!/usr/bin/env node
// CLI du sniper de pseudos Fortnite / Epic Games.
import 'dotenv/config';
import readline from 'node:readline';
import { log, c } from './util.js';
import { loginInteractive, getValidToken, cachedAccount } from './auth.js';
import { displayNameStatus, validName, nameChangeEligibility } from './epicapi.js';
import { snipe } from './sniper.js';
import { bestOffset } from './ntp.js';
import { runUpdate, maybeNotify } from './update.js';

const argv = process.argv.slice(2);
const cmd = argv[0];

// Parse simple des --flags (--at "..." --burst 8 --monitor).
function flags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) { out[key] = true; }
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

// Lit une ligne au clavier (pour coller l'authorizationCode).
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

function usage() {
  console.log(`
${c.cyan}snipe-ftn${c.reset} — sniper de pseudos Fortnite / Epic Games

${c.yellow}Commandes :${c.reset}
  login                         Se connecter au compte Epic (authorizationCode)
  whoami                        Afficher le compte connecté
  check <pseudo>                Vérifier la disponibilité d'un display name
  time                          Mesurer le décalage d'horloge NTP
  snipe <pseudo> --monitor      Surveiller et déclencher dès que libre (recommandé)
  snipe <pseudo> --at <ISO>     Snipe planifié à un instant précis (UTC)
  update [--check]              Mettre à jour l'outil (--check = vérifier seulement)

${c.yellow}Options de snipe :${c.reset}
  --monitor         mode surveillance (poll jusqu'à libre) — mode principal Epic
  --at <ISO>        instant du drop, ex. 2026-07-10T15:00:00Z
  --in <durée>      alternative à --at, ex. 90s, 15m, 2h
  --burst <n>       nb de requêtes dans la rafale (def 6)
  --spacing <ms>    espacement entre requêtes (def 30)
  --lead <ms>       avance de la 1re requête sur le drop (def 40)
  --poll <ms>       intervalle de sondage en monitor (def 1000)
  --connections <n> connexions pré-chauffées (def 3)
  --skip-ntp        ne pas synchroniser l'horloge

${c.yellow}Exemples :${c.reset}
  node src/index.js login
  node src/index.js check Ninja
  node src/index.js snipe MonPseudo --monitor
  node src/index.js snipe MonPseudo --at 2026-07-10T15:00:00Z --burst 8

${c.yellow}Note :${c.reset} le changement de pseudo Epic a un cooldown de 2 semaines ; assure-toi
d'être éligible avant de sniper. Voir README.md.
`);
}

function parseDuration(s) {
  const m = /^(\d+)\s*(ms|s|m|h)?$/.exec(String(s).trim());
  if (!m) return null;
  const n = Number(m[1]);
  const mult = { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2] || 's'];
  return n * mult;
}

async function main() {
  try {
    // Avis de mise à jour discret (au plus 1×/24 h, non bloquant). Ignoré pour
    // `update` (qui vérifie déjà) et `snipe` (chemin critique en timing).
    if (cmd !== 'update' && cmd !== 'snipe') await maybeNotify();

    switch (cmd) {
      case 'login':
        await loginInteractive(() => prompt(`  Colle ici l'authorizationCode : `));
        break;

      case 'whoami': {
        const a = cachedAccount();
        if (!a) { log.warn('Aucun compte en cache. Lance : node src/index.js login'); break; }
        log.ok(`${c.green}${a.displayName || '(nom inconnu)'}${c.reset} (${a.accountId})`);
        try {
          const { accessToken, accountId } = await getValidToken();
          const el = await nameChangeEligibility(accessToken, accountId);
          if (el.canUpdate) log.info(`Changement de pseudo : ${c.green}éligible ✓${c.reset}` +
            (el.changes != null ? ` (${el.changes} changement(s) au total)` : ''));
          else log.info(`Changement de pseudo : ${c.yellow}cooldown${c.reset}` +
            (el.availableAt ? ` jusqu'au ${new Date(el.availableAt).toLocaleString('fr-FR')}` : ''));
        } catch { /* hors-ligne ou token absent : on n'affiche que le cache */ }
        break;
      }

      case 'time': {
        log.step('Mesure NTP');
        const o = await bestOffset();
        log.ok(`Offset : ${o.offset >= 0 ? '+' : ''}${o.offset.toFixed(1)} ms via ${o.server} (rtt ${o.rtt.toFixed(0)} ms)`);
        log.info(o.offset >= 0
          ? 'Horloge locale EN RETARD sur le temps réel.'
          : 'Horloge locale EN AVANCE sur le temps réel.');
        break;
      }

      case 'check': {
        const name = argv[1];
        if (!name) { log.err('Usage : check <pseudo>'); break; }
        if (!validName(name)) log.warn('Format inhabituel (Epic : 3-16 caractères) — vérif quand même.');
        log.step(`Disponibilité de ${c.yellow}${name}${c.reset}`);
        try {
          const { accessToken } = await getValidToken();
          const st = await displayNameStatus(name, accessToken);
          if (st.rateLimited) log.warn('API Epic rate-limitée, réessaie.');
          else if (st.free) log.ok(`${c.green}LIBRE${c.reset}`);
          else if (st.free === false) log.info(`${c.yellow}PRIS${c.reset} par ${st.displayName} (${st.accountId})`);
          else log.warn(`Réponse ${st.statusCode}`);
        } catch (e) {
          log.err(`Vérif impossible : ${e.message}`);
        }
        break;
      }

      case 'snipe': {
        const name = argv[1];
        if (!name) { log.err('Usage : snipe <pseudo> --monitor | --at <ISO>'); break; }
        if (!validName(name)) { log.err('Pseudo invalide (Epic : 3-16 caractères).'); break; }
        const f = flags(argv.slice(2));

        const { accessToken, accountId, displayName } = await getValidToken();
        log.info(`Compte : ${c.green}${displayName || accountId}${c.reset} → cible ${c.yellow}${name}${c.reset}`);

        // Pré-vérif d'éligibilité : évite de gâcher l'unique tentative si en cooldown.
        try {
          const el = await nameChangeEligibility(accessToken, accountId);
          if (el.canUpdate) log.ok('Éligible au changement de pseudo ✓');
          else log.warn(`⚠ Cooldown actif${el.availableAt ? ` jusqu'au ${new Date(el.availableAt).toLocaleString('fr-FR')}` : ''} — ` +
            'le changement échouera tant qu\'il court (la surveillance, elle, continue).');
        } catch (e) { log.info(`(Éligibilité non vérifiable : ${e.message})`); }

        let dropAt;
        if (f.at) {
          dropAt = Date.parse(f.at);
          if (Number.isNaN(dropAt)) { log.err(`Date --at invalide : ${f.at}`); break; }
        } else if (f.in) {
          const ms = parseDuration(f.in);
          if (ms == null) { log.err(`Durée --in invalide : ${f.in}`); break; }
          dropAt = Date.now() + ms;
        }

        if (!f.monitor && !dropAt) {
          log.err('Précise --monitor (surveillance) ou --at <ISO> / --in <durée> (planifié).');
          break;
        }

        await snipe({
          name,
          token: accessToken,
          accountId,
          dropAt,
          monitor: !!f.monitor,
          burst: f.burst ? Number(f.burst) : undefined,
          spacingMs: f.spacing ? Number(f.spacing) : undefined,
          leadMs: f.lead ? Number(f.lead) : undefined,
          pollMs: f.poll ? Number(f.poll) : undefined,
          connections: f.connections ? Number(f.connections) : undefined,
          skipNtp: !!f['skip-ntp'],
        });
        break;
      }

      case 'update': {
        const f = flags(argv.slice(1));
        await runUpdate({ check: !!f.check });
        break;
      }

      case 'help': case '--help': case '-h': case undefined:
        usage();
        break;

      default:
        log.err(`Commande inconnue : ${cmd}`);
        usage();
    }
  } catch (e) {
    log.err(e.message);
    if (process.env.DEBUG) console.error(e);
    process.exit(1);
  }
}

main();
