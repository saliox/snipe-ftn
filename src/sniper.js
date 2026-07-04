// Moteur de snipe : surveille un display name Epic et, dès qu'il se libère,
// envoie une rafale de requêtes de changement de nom calibrée autour du drop,
// sur des connexions pré-chauffées.
import { Pool } from 'undici';
import { log, c, sleep, sleepUntil, fmtDuration } from './util.js';
import { bestOffset } from './ntp.js';
import { displayNameStatus, changeDisplayName } from './epicapi.js';

const HOST = 'https://account-public-service-prod.ol.epicgames.com';

// Arrêt coopératif (utilisé par une UI pour stopper le mode surveillance).
let stopFlag = false;
export function requestStop() { stopFlag = true; }

// Cloche terminal : alerte sonore quand le nom se libère (utile en monitor).
function bell() { try { process.stdout.write('\x07'); } catch {} }

// Pré-établit `n` connexions TLS pour éliminer le handshake du chemin critique.
async function warmup(pool, token, n) {
  const warm = async () => {
    try {
      const { body } = await pool.request({
        path: '/account/api/oauth/verify',
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });
      await body.dump();
    } catch { /* peu importe, le but est d'ouvrir le socket */ }
  };
  await Promise.all(Array.from({ length: n }, warm));
}

// Un essai de changement de nom via le pool chaud. Renvoie { ok, status, retryAfter }.
async function attempt(pool, name, token, accountId) {
  try {
    const { statusCode, headers, body } = await pool.request({
      path: `/account/api/public/account/${encodeURIComponent(accountId)}`,
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: name }),
    });
    const retryAfter = headers['retry-after'] ? Number(headers['retry-after']) : null;
    await body.dump();
    return { ok: statusCode === 200 || statusCode === 204, status: statusCode, retryAfter };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
}

/**
 * @param {object} opts
 * @param {string} opts.name          display name cible
 * @param {string} opts.token         access token Epic
 * @param {string} opts.accountId     id du compte à renommer
 * @param {number} [opts.dropAt]      epoch ms du drop (mode planifié)
 * @param {boolean} [opts.monitor]    mode surveillance (poll jusqu'à libre)
 * @param {number} [opts.connections] connexions pré-chauffées (def 3)
 * @param {number} [opts.burst]       nb de requêtes dans la rafale (def 6)
 * @param {number} [opts.spacingMs]   espacement entre requêtes (def 30ms)
 * @param {number} [opts.leadMs]      avance de la 1re requête sur T0 (def 40ms)
 * @param {number} [opts.pollMs]      intervalle de sondage en monitor (def 1000ms)
 * @param {boolean} [opts.skipNtp]    ne pas synchroniser l'horloge
 */
export async function snipe(opts) {
  const {
    name, token, accountId, dropAt, monitor = false,
    connections = 3, burst = 6, spacingMs = 30, leadMs = 40, pollMs = 1000, skipNtp = false,
  } = opts;

  stopFlag = false;
  const pool = new Pool(HOST, { connections, pipelining: 1 });
  let offset = 0;

  try {
    if (!skipNtp) {
      log.step('Synchronisation NTP');
      try {
        const o = await bestOffset();
        offset = o.offset;
        log.ok(`Offset horloge : ${offset >= 0 ? '+' : ''}${offset.toFixed(1)} ms ` +
          `(via ${o.server}, rtt ${o.rtt.toFixed(0)} ms)`);
        if (Math.abs(offset) > 250) log.warn('Ton horloge Windows dérive beaucoup — l\'offset NTP corrige ça.');
      } catch (e) {
        log.warn(`NTP indisponible (${e.message}) — on utilise l'horloge locale telle quelle.`);
      }
    }
    // "Maintenant" corrigé = Date.now() + offset. Pour viser un temps réel T,
    // on attend l'instant local L tel que L + offset = T, soit L = T - offset.
    const toLocal = (realMs) => realMs - offset;

    if (monitor) return await monitorLoop(pool, name, token, accountId, { burst, spacingMs, pollMs });

    if (!dropAt) throw new Error('Mode planifié : --at requis (ou utilise --monitor).');

    const now = Date.now() + offset;
    log.step(`Snipe planifié de ${c.yellow}${name}${c.reset}`);
    log.info(`Drop dans ${c.cyan}${fmtDuration(dropAt - now)}${c.reset} (${new Date(dropAt).toISOString()})`);

    // Pré-chauffage ~10s avant le drop pour avoir des sockets frais.
    const warmAtLocal = toLocal(dropAt - 10_000);
    if (warmAtLocal > Date.now()) await sleepUntil(warmAtLocal);
    log.info('Pré-chauffage des connexions...');
    await warmup(pool, token, connections);
    log.ok('Connexions prêtes.');

    // Rafale : première requête `leadMs` avant T0, puis toutes les `spacingMs`.
    const firstLocal = toLocal(dropAt - leadMs);
    log.info(`Rafale de ${burst} requêtes espacées de ${spacingMs} ms, ` +
      `1re à T0-${leadMs} ms. En attente...`);
    await sleepUntil(firstLocal, 20);

    const result = await fireBurst(pool, name, token, accountId, { burst, spacingMs });
    reportResult(result, name);
    return result;
  } finally {
    await pool.close().catch(() => {});
  }
}

async function fireBurst(pool, name, token, accountId, { burst, spacingMs }) {
  const inflight = [];
  let winner = null;
  for (let i = 0; i < burst; i++) {
    const t = Date.now();
    inflight.push(
      attempt(pool, name, token, accountId).then((r) => {
        const dt = (Date.now() - t);
        log.info(`  req#${i + 1} → ${statusColor(r.status)} (${dt} ms)` +
          (r.retryAfter ? ` retry-after ${r.retryAfter}s` : ''));
        if (r.ok && !winner) winner = { ...r, index: i + 1 };
        return r;
      }).catch((e) => { log.warn(`  req#${i + 1} erreur: ${e.message}`); return { ok: false }; })
    );
    if (i < burst - 1) await sleep(spacingMs);
  }
  const all = await Promise.all(inflight);
  return { success: !!winner, winner, attempts: all };
}

// Mode surveillance : poll la dispo et déclenche une rafale dès que le nom
// passe libre. C'est le mode principal côté Epic (pas d'horaire de drop public).
async function monitorLoop(pool, name, token, accountId, { burst, spacingMs, pollMs }) {
  log.step(`Surveillance de ${c.yellow}${name}${c.reset} (Ctrl+C pour arrêter)`);
  await warmup(pool, token, 2);
  let polls = 0;
  while (!stopFlag) {
    polls++;
    const st = await displayNameStatus(name, token, pool);

    if (st.free === true) {
      bell();
      log.ok(`${c.green}${name} est LIBRE — rafale !${c.reset}`);
      const result = await fireBurst(pool, name, token, accountId, { burst, spacingMs });
      reportResult(result, name);
      return result;
    }
    if (st.rateLimited) {
      const wait = (st.retryAfter || 5) * 1000;
      log.warn(`Rate limit — pause ${Math.round(wait / 1000)}s.`);
      await sleep(wait);
      continue;
    }
    if (polls % 20 === 0) {
      const who = st.displayName ? `pris par ${st.displayName}` : (st.statusCode || 'pris');
      log.info(`...toujours indisponible (${who}) — ${polls} sondages`);
    }
    await sleep(pollMs);
  }
  log.warn('Surveillance arrêtée.');
  return { success: false, stopped: true, attempts: [] };
}

function statusColor(s) {
  if (s === 200 || s === 204) return `${c.green}${s} OK${c.reset}`;
  if (s === 429) return `${c.red}429 rate-limit${c.reset}`;
  if (s === 403 || s === 400 || s === 409) return `${c.yellow}${s} indispo/refus${c.reset}`;
  if (s === 0) return `${c.gray}erreur réseau${c.reset}`;
  return `${c.gray}${s}${c.reset}`;
}

function reportResult(result, name) {
  console.log('');
  if (result.success) {
    log.ok(`${c.green}🎯 SNIPE RÉUSSI${c.reset} — ${name} obtenu (req#${result.winner.index}) !`);
  } else {
    const got429 = result.attempts.some((a) => a.status === 429);
    const got403 = result.attempts.some((a) => a.status === 403);
    log.err(`Échec du snipe de ${name}.` +
      (got429 ? ' Rate-limité (429) : réduis burst/augmente spacing.' : '') +
      (got403 ? ' Refus 403 : cooldown 2 semaines actif, nom repris, ou endpoint de changement à vérifier (voir epicapi.js).' : ''));
  }
}
