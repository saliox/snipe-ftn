// Vérifications et actions sur les pseudos (display names) Epic Games.
// Toutes authentifiées par un token du service de compte Epic (auth.js).
import { request } from 'undici';

const HOST = 'https://account-public-service-prod.ol.epicgames.com';

// --- Disponibilité d'un display name ---
// GET /account/api/public/account/displayName/{name}
//   200 -> PRIS (renvoie { id, displayName, ... })
//   404 -> LIBRE
//   429 -> rate limit
// dispatcher optionnel : Pool/proxy undici pour rester sur des sockets chauds.
export async function displayNameStatus(name, accessToken, dispatcher = null) {
  const opts = {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}` },
    headersTimeout: 8000,
    bodyTimeout: 8000,
  };
  if (dispatcher) opts.dispatcher = dispatcher;
  const { statusCode, headers, body } = await request(
    `${HOST}/account/api/public/account/displayName/${encodeURIComponent(name)}`,
    opts
  );
  if (statusCode === 404) { await body.dump(); return { free: true }; }
  if (statusCode === 200) {
    const data = await body.json();
    return { free: false, accountId: data.id, displayName: data.displayName };
  }
  if (statusCode === 429) {
    await body.dump();
    const retryAfter = headers['retry-after'] ? Number(headers['retry-after']) : null;
    return { free: null, rateLimited: true, retryAfter };
  }
  await body.dump();
  return { free: null, statusCode };
}

// --- Vérifie / rafraîchit l'identité du token ---
export async function accountFromToken(accessToken) {
  const { statusCode, body } = await request(`${HOST}/account/api/oauth/verify`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (statusCode === 200) {
    const d = await body.json();
    return { accountId: d.account_id, displayName: d.displayName };
  }
  await body.dump();
  if (statusCode === 401) throw new Error('Token invalide ou expiré (401).');
  throw new Error(`verify: HTTP ${statusCode}`);
}

// --- Changement de display name ---
//
// ⚠️ ENDPOINT À VÉRIFIER EN DIRECT.
// Epic ne documente pas publiquement d'endpoint de changement de pseudo par
// token de jeu. Sur le site (epicgames.com/account/personal), le changement
// passe par un appel authentifié par cookie de session, avec cooldown de 2
// semaines. L'appel ci-dessous est la meilleure hypothèse (PUT sur le compte).
// Si Epic renvoie 401/403/404 systématiquement, capture la vraie requête dans
// l'onglet Réseau du navigateur pendant un changement manuel et reporte
// l'URL + le corps ici — le reste du moteur (timing, burst, monitor) est bon.
//
// Renvoie { ok, status, retryAfter, reason }.
export async function changeDisplayName(name, accessToken, accountId) {
  const { statusCode, headers, body } = await request(
    `${HOST}/account/api/public/account/${encodeURIComponent(accountId)}`,
    {
      method: 'PUT',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: name }),
      headersTimeout: 8000,
      bodyTimeout: 8000,
    }
  );
  let payload = null;
  try { payload = await body.json(); } catch { await body.dump(); }

  if (statusCode === 200 || statusCode === 204) return { ok: true, status: statusCode, name };

  const retryAfter = headers['retry-after'] ? Number(headers['retry-after']) : null;
  const errCode = payload?.errorCode || '';
  const reasons = {
    400: payload?.errorMessage || 'Requête invalide (nom refusé ou format).',
    401: 'Token invalide/expiré (401).',
    403: /cooldown|frequency|rate/i.test(errCode + (payload?.errorMessage || ''))
      ? 'Cooldown de changement de pseudo actif (2 semaines).'
      : 'Refusé (403) — nom pris/réservé, ou endpoint non autorisé par token de jeu.',
    404: 'Endpoint introuvable (404) — voir la note dans epicapi.js pour capturer le vrai endpoint.',
    409: 'Conflit (409) — nom déjà pris entre-temps.',
    429: `Rate limit (429)${retryAfter ? `, retry-after ${retryAfter}s` : ''}.`,
  };
  return { ok: false, status: statusCode, retryAfter, reason: reasons[statusCode] || `HTTP ${statusCode}`, errorCode: errCode };
}

// Règles de display name Epic : 3 à 16 caractères. Epic autorise lettres,
// chiffres et quelques symboles ; on reste permissif et on se contente de la
// longueur (le filtre de contenu réel est côté serveur).
export function validName(name) {
  return typeof name === 'string' && name.length >= 3 && name.length <= 16;
}
