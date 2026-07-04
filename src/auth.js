// Authentification Epic Games (compte -> token OAuth du service de compte).
//
// Epic n'a pas de "device code" façon Microsoft. Le flux fiable utilisé par les
// outils tiers Fortnite :
//   1. L'utilisateur se connecte sur https://www.epicgames.com dans son navigateur.
//   2. Il ouvre l'URL de redirection (authCodeUrl() ci-dessous) qui renvoie un
//      JSON contenant "authorizationCode".
//   3. On échange ce code contre un access_token + refresh_token via oauth/token.
//
// ⚠️ CGU : cet échange s'appuie sur les identifiants d'un client de JEU Epic
// (Basic auth ci-dessous). C'est la même zone grise que la quasi-totalité des
// outils Fortnite tiers. À utiliser sur TON propre compte, à tes risques.
//
// Configurable via .env : EPIC_CLIENT_ID / EPIC_CLIENT_SECRET (défaut =
// fortniteIOSGameClient, largement connu). Voir README.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log, c } from './util.js';
import { saveEncrypted, loadEncrypted } from './securebox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dossier de données : SNIPE_DATA_DIR (défini par un futur GUI) sinon data/ du projet.
function dataDir() { return process.env.SNIPE_DATA_DIR || path.join(__dirname, '..', 'data'); }
function tokenFile() { return path.join(dataDir(), 'token.enc'); }

const ACCOUNT_HOST = 'https://account-public-service-prod.ol.epicgames.com';
const TOKEN_URL = `${ACCOUNT_HOST}/account/api/oauth/token`;
const VERIFY_URL = `${ACCOUNT_HOST}/account/api/oauth/verify`;

// Client de jeu par défaut (fortniteIOSGameClient). Surchargeable via .env.
function clientId() { return process.env.EPIC_CLIENT_ID || '3446cd72694c4a4485d81b77adbb2141'; }
function clientSecret() { return process.env.EPIC_CLIENT_SECRET || '9209d4a5e25a457fb9b07489d313b41a'; }
function basicAuth() {
  return 'Basic ' + Buffer.from(`${clientId()}:${clientSecret()}`).toString('base64');
}

// URL à ouvrir (connecté sur epicgames.com) pour obtenir un authorizationCode.
export function authCodeUrl() {
  return `https://www.epicgames.com/id/api/redirect?clientId=${clientId()}&responseType=code`;
}

function saveCache(obj) { saveEncrypted(tokenFile(), obj); }
function loadCache() { return loadEncrypted(tokenFile()); }

// --- Échange authorization_code -> tokens ---
async function exchangeAuthCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { authorization: basicAuth(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, token_type: 'eg1' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`oauth/token ${res.status}: ${data.errorMessage || data.error_description || JSON.stringify(data)}`);
  }
  return data;
}

async function refreshTokens(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { authorization: basicAuth(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, token_type: 'eg1' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`refresh ${res.status}: ${data.errorMessage || data.error_description || JSON.stringify(data)}`);
  return data;
}

// Normalise la réponse oauth en un cache exploitable.
function cacheFromToken(data) {
  // expires_at fourni par Epic (ISO) ; on garde une marge de 60s.
  const expiresAt = data.expires_at
    ? Date.parse(data.expires_at) - 60_000
    : Date.now() + ((data.expires_in || 3600) - 60) * 1000;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    accountId: data.account_id,
    displayName: data.displayName || null,
  };
}

// Flux interactif : affiche l'URL, attend le code collé.
// getCode() : fonction async qui renvoie le code (CLI = readline ; GUI = champ).
export async function loginInteractive(getCode) {
  log.step('Connexion Epic Games');
  console.log(
    `\n  1. Connecte-toi sur ${c.cyan}https://www.epicgames.com${c.reset} (dans ton navigateur).\n` +
    `  2. Ouvre cette URL :\n     ${c.cyan}${authCodeUrl()}${c.reset}\n` +
    `  3. Copie la valeur de ${c.yellow}"authorizationCode"${c.reset} affichée en JSON.\n`
  );
  const code = (await getCode()).trim().replace(/^"|"$/g, '');
  if (!code) throw new Error('Aucun authorizationCode fourni.');

  const data = await exchangeAuthCode(code);
  const cache = cacheFromToken(data);
  saveCache(cache);
  log.ok(`Connecté en tant que ${c.green}${cache.displayName || cache.accountId}${c.reset} (${cache.accountId})`);
  return cache;
}

// Renvoie un token Epic valide, en rafraîchissant silencieusement si besoin.
export async function getValidToken() {
  const cache = loadCache();
  if (!cache) throw new Error('Non connecté. Lance : node src/index.js login');

  if (cache.accessToken && cache.expiresAt && Date.now() < cache.expiresAt) {
    return { accessToken: cache.accessToken, accountId: cache.accountId, displayName: cache.displayName };
  }

  if (!cache.refreshToken) throw new Error('Token expiré, refresh indisponible. Relance login.');
  log.info('Token Epic expiré, rafraîchissement...');
  const data = await refreshTokens(cache.refreshToken);
  const fresh = cacheFromToken(data);
  // Epic peut ne pas renvoyer displayName au refresh : on garde l'ancien.
  fresh.displayName = fresh.displayName || cache.displayName;
  saveCache(fresh);
  return { accessToken: fresh.accessToken, accountId: fresh.accountId, displayName: fresh.displayName };
}

// Valide un token en interrogeant oauth/verify. Renvoie les infos de session.
export async function verifyToken(accessToken) {
  const res = await fetch(VERIFY_URL, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`verify ${res.status}`);
  return res.json(); // { account_id, displayName, expires_at, ... }
}

export function cachedAccount() {
  const cache = loadCache();
  if (!cache) return null;
  return { accountId: cache.accountId, displayName: cache.displayName };
}
