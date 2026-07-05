# snipe-ftn — sniper de pseudos Fortnite / Epic Games

Équivalent Fortnite de `snipe-mc` : surveille un **display name Epic** et, dès
qu'il se libère, tente de le réclamer sur **ton propre compte** avec une rafale
de requêtes calibrée par NTP. Node ESM, zéro dépendance lourde (juste `undici`
et `dotenv`).

> ⚠️ **À lire avant de lancer.** À utiliser uniquement pour réclamer un pseudo
> **libre** sur **ton** compte. Pas de vol de compte, pas de credential stuffing.

## Différences importantes avec Minecraft

Fortnite/Epic ne marche pas comme Mojang. Trois points à connaître :

1. **Cooldown de 2 semaines.** Epic n'autorise qu'un changement de pseudo toutes
   les 2 semaines. Le burst au moment du drop sert à **gagner la course** face
   aux autres snipers, mais tu dois être **éligible** (hors cooldown) pour que
   ça marche. Inutile de spammer : tu n'as qu'un essai utile par fenêtre.

2. **Pas d'horaire de drop public.** Contrairement à MC (nom libéré ~37 jours
   après un changement), Epic n'expose pas de « disponible à telle heure ».
   → Le mode **`--monitor`** est le mode principal ici. `--at` reste dispo si tu
   connais l'instant par un autre moyen.

3. **Endpoint de changement confirmé.** L'auto-claim utilise l'endpoint
   documenté `PUT /account/api/public/account/{accountId}` (corps
   `{"displayName": "..."}`, scope `account:public:account UPDATE`) — cf.
   [`src/epicapi.js`](src/epicapi.js) (`changeDisplayName`). L'app vérifie aussi
   ton **éligibilité** (cooldown 2 semaines) avant de tenter, via
   `canUpdateDisplayName` / `lastDisplayNameChange` du compte. Seule réserve : que
   le token du client de jeu par défaut porte bien ce scope pour ton compte (vrai
   en pratique), confirmé au 1er changement réel. En repli, le monitor t'alerte
   de toute façon pour réclamer à la main.

> **CGU Epic.** L'échange de token s'appuie sur les identifiants d'un client de
> jeu Epic (comme la quasi-totalité des outils Fortnite tiers). C'est une zone
> grise vis-à-vis des conditions d'utilisation d'Epic. Tu l'utilises sur ton
> compte, à tes risques.

## Installation

```bash
cd snipe-ftn
npm install
cp .env.example .env   # puis édite si besoin (identifiants par défaut fournis)
```

## Interface graphique (recommandée)

Une app de bureau (Electron) offre login Epic, vérif de pseudo, NTP, snipe
(surveillance/planifié) avec **logs en direct**, et un bouton de mise à jour.

```bash
npm start
```

Dans la fenêtre : **1** ouvre la page Epic → **2** colle l'`authorizationCode` →
**3** connecte-toi. Ensuite : vérifie un pseudo, ou lance un snipe en mode
Surveillance ou Planifié. Le journal en bas affiche tout en temps réel.

> Le CLI ci-dessous reste disponible pour un usage terminal/scripté ; les deux
> partagent le même moteur et le même token chiffré.

## Connexion (CLI)

```bash
node src/index.js login
```

1. Connecte-toi sur https://www.epicgames.com dans ton navigateur.
2. Ouvre l'URL affichée (`.../id/api/redirect?clientId=...&responseType=code`).
3. Copie la valeur de `"authorizationCode"` du JSON et colle-la dans le terminal.

Le token (access + refresh) est chiffré au repos via `securebox.js`
(AES-256-GCM, clé liée à la machine + au compte utilisateur). Le refresh est
automatique tant qu'il est valide.

## Utilisation

```bash
# Vérifier si un pseudo est libre
node src/index.js check MonPseudo

# Réclamer un nom LIBRE tout de suite (change ton pseudo maintenant)
node src/index.js claim MonPseudo

# Mesurer la dérive d'horloge (NTP)
node src/index.js time

# Surveiller et réclamer dès que libre (mode principal)
node src/index.js snipe MonPseudo --monitor

# Snipe planifié si tu connais l'instant du drop (UTC)
node src/index.js snipe MonPseudo --at 2026-07-10T15:00:00Z --burst 8

# Mettre l'outil à jour (voir « Mise à jour automatique »)
node src/index.js update           # installe la dernière version
node src/index.js update --check   # vérifie seulement
```

### Multi-comptes

Enregistre plusieurs comptes Epic et tire depuis tous en parallèle pour
maximiser tes chances de gagner la course sur un nom :

```bash
node src/index.js accounts add "Compte 2"   # ajoute un compte (colle son authorizationCode)
node src/index.js accounts                   # liste (● = compte actif)
node src/index.js accounts use <id>          # change de compte actif
node src/index.js accounts remove <id>       # retire un compte

# Snipe depuis TOUS les comptes à la fois :
node src/index.js snipe MonPseudo --at 2026-07-10T15:00:00Z --all-accounts
```

Chaque compte stocke son *refresh token* chiffré ; l'access token est rafraîchi
automatiquement au moment du snipe. Dans le GUI : ajoute les comptes dans la
carte « Comptes Epic » et coche **Tous les comptes** avant de lancer.

> En mode `--monitor`, `--all-accounts` fait sonder chaque compte séparément
> (plus de pression sur le rate-limit). Pour du multi-comptes, le mode planifié
> `--at` est préférable : tous les comptes tirent pile au drop.

### Trouver des noms libres (scan + générateur)

Sur Epic, l'essentiel de l'acquisition de pseudos, c'est de la **découverte de
noms déjà libres** (pas d'attente d'un drop précis). Le générateur crée des
candidats, le scanner vérifie en masse lesquels sont libres, et les classe par
**désirabilité** (S/A/B/C/D : court, sans chiffre, mot du dico ou prononçable).

```bash
# Générer un aperçu (sans réseau)
node src/index.js gen --mode dict --length 4 --count 30 --rank

# Scanner 500 combinaisons de 3 lettres, ne garder que les libres au score ≥ 60
node src/index.js scan --length 3 --charset alpha --count 500 --og --min-score 60

# Scanner une liste perso, via proxies, et sauver les libres
node src/index.js scan --file mes-noms.txt --proxies proxies.txt --out libres.txt
```

Modes : `random`, `pronounceable` (consonne/voyelle), `dict` (mots courts),
`pattern` (`?`=lettre, `#`=chiffre, `*`=alphanum). Le scan est **adaptatif**
(AIMD : accélère quand l'API suit, ralentit sur 429) et exploite les **proxies**
pour aller plus vite sans se faire rate-limiter. Dans le GUI : carte
**« Scanner de noms libres »**, clique un résultat pour le mettre en cible.

> ⚠️ Le lookup Epic est **authentifié** : le scan lit la dispo avec ton token
> (il ne réclame rien). Les proxies ne portent que la lecture, jamais ton token
> de manière risquée — le tir de changement part toujours de ton IP.

### Watchlist & alertes Discord

Surveille **plusieurs** noms à la fois et réclame le **premier** qui se libère
(tu ne peux tenir qu'un pseudo). Reçois une **alerte Discord** + une
**notification Windows** dès qu'un nom se libère — pratique si l'auto-claim rate,
tu réclames alors à la main en quelques secondes.

```bash
# Configurer l'alerte Discord (une fois) — webhook stocké chiffré
node src/index.js alert set https://discord.com/api/webhooks/XXX/YYY
node src/index.js alert test          # vérifier

# Surveiller une liste et réclamer le 1er libre
node src/index.js watch OG cool epic --proxies proxies.txt
node src/index.js watch --file cibles.txt
```

Le webhook peut aussi venir de `.env` (`DISCORD_WEBHOOK_URL`). Dans le GUI :
carte **« Watchlist & alertes »** (liste + champ webhook + Tester).

### Snipes planifiés (survivent au redémarrage)

Un snipe programmé dans plusieurs jours ne doit pas dépendre du fait que le PC
reste allumé et l'outil ouvert. `schedule` persiste la file **et** crée une
**Tâche Windows** (sans droits admin) qui relance l'outil ~2 min avant le drop.
Grâce à « démarrer dès que possible si manqué », une tâche ratée (PC éteint à
l'heure) se lance dès le retour de la machine.

```bash
node src/index.js schedule add MonPseudo --at 2026-07-10T15:00:00Z --burst 8
node src/index.js schedule                 # lister
node src/index.js schedule remove <id>     # retirer (supprime aussi la tâche)
node src/index.js schedule prune           # nettoyer les drops passés
```

Dans le GUI : en mode **Planifié**, coche **« Survit au redémarrage »** avant de
lancer ; les planifiés s'affichent sous la carte snipe.

### Historique des noms vus

Chaque `check`/`scan` enregistre l'état (libre/pris) des noms. Pratique pour
retrouver les libres passés et repérer ceux qui « tournent ».

```bash
node src/index.js history            # stats
node src/index.js history --free     # lister les noms vus libres
node src/index.js history --search og
node src/index.js history clear
```

### Options de snipe

| Option | Défaut | Rôle |
|---|---|---|
| `--monitor` | — | surveille jusqu'à ce que le nom soit libre puis rafale |
| `--at <ISO>` | — | instant du drop en UTC |
| `--in <durée>` | — | drop relatif : `90s`, `15m`, `2h` |
| `--burst <n>` | 6 | nombre total de requêtes dans la rafale |
| `--volley <n>` | 3 | requêtes lâchées **simultanément** à T0 (course serrée) |
| `--spacing <ms>` | 30 | espacement des relances après la volée |
| `--lead <ms>` | 40 | avance de la 1re requête sur T0 |
| `--poll <ms>` | 1000 | sondage en monitor (**adaptatif** : accélère près de `--at`) |
| `--connections <n>` | 3 | connexions TLS pré-chauffées |
| `--proxies <file>` | — | .txt de proxies (host:port) pour répartir la **détection** |
| `--all-accounts` | — | tire depuis tous les comptes enregistrés en parallèle |
| `--diag` | — | journal détaillé + résumé de métriques (RTT, 429, offset) |
| `--skip-ntp` | — | ne pas synchroniser l'horloge |

**Optimisations du moteur :**
- **Volée parallèle** : à T0, `--volley` requêtes partent d'un coup (au lieu de
  toutes échelonnées) pour gagner la course à la milliseconde, puis des relances
  espacées rattrapent une libération légèrement retardée. Le tir s'arrête dès
  qu'une requête gagne.
- **Polling adaptatif** : en monitor avec un `--at` connu, le sondage est lent
  loin du drop et passe à ~150-250 ms dans la fenêtre du drop (avec jitter).
- **Ré-sync NTP** avant le tir sur les attentes longues (l'horloge dérive).
- **Proxies (détection only)** : `--proxies` répartit le *polling* sur plusieurs
  IP pour sonder plus vite sans se faire rate-limiter. Le **tir** de changement
  part toujours de ton IP (authentifié, stable). Un proxy mort est ignoré.
- **`--diag`** affiche RTT min/médian/p95/max, nombre de 429, offset horloge —
  pour optimiser sur des mesures réelles plutôt qu'au jugé.

## Mise à jour automatique

Même système que snipe-mc, adapté au CLI (l'asset de release est un **zip de
sources**, pas un installeur `.exe`).

- **Avis discret au démarrage** : au plus **1×/24 h**, l'outil vérifie s'il
  existe une version plus récente. En **CLI** (sauf `snipe`, chemin critique) il
  affiche un simple avis ; dans l'**app (GUI)** il ouvre au démarrage une fenêtre
  proposant l'install (jamais forcée). Non bloquant, silencieux si hors-ligne.
- **`node src/index.js update`** : télécharge la dernière release, vérifie le
  **SHA-256**, extrait le zip, remplace les fichiers (sans toucher à `data/` ni
  `.env`). Le zip **embarque les deps** (`undici`/`dotenv`), donc la MAJ marche
  même sans Node/npm (app packagée). `--check` = vérifier sans installer.
- **Source par défaut** : Releases GitHub de `saliox/snipe-ftn` (autonome, aucune
  config). Overrides dans `.env` :
  - `UPDATE_REPO=owner/name` — autre dépôt GitHub.
  - `UPDATE_URL=http://ip:8770/` — flux HTTP local (LAN).

### Publier une mise à jour (distribution LAN — configuration retenue)

Rien n'est publié en public : les MAJ sont servies depuis ta machine sur le
réseau local.

```bash
# 1. bumpe la version dans package.json
# 2. construis le feed local (release/snipe-ftn.zip + latest.json), sans GitHub
npm run publish:update -- --local "notes de version"

# 3. sers le feed sur le LAN (affiche l'UPDATE_URL à coller chez les clients)
npm run serve:updates
```

Sur chaque **PC client**, mets dans son `.env` l'adresse affichée :

```
UPDATE_URL=http://<ip-de-ta-machine>:8770/
```

Ensuite, sur le client : `node src/index.js update` (ou l'avis automatique au
prochain lancement) télécharge et applique la nouvelle version.

> Le pare-feu Windows peut demander d'autoriser Node.js sur le réseau privé la
> première fois que tu lances `serve:updates`.

<details>
<summary>Variante GitHub Releases (autonome, mais publique)</summary>

Si un jour tu veux un canal autonome sans serveur : `npm run publish:update
"notes"` (sans `--local`) crée `release/` puis publie une release GitHub via
`gh` sur `saliox/snipe-ftn`. Le dépôt doit exister et être **public** pour que
l'auto-update fonctionne sans token. Overrides via `.env` : `UPDATE_REPO`.
</details>

## Architecture (miroir de snipe-mc)

| Fichier | Rôle |
|---|---|
| `src/index.js` | CLI |
| `src/auth.js` | protocole OAuth Epic (échange de code, refresh) |
| `src/accounts.js` | gestionnaire multi-comptes (store chiffré, refresh, actif) |
| `src/epicapi.js` | dispo du display name, vérif, changement, validation |
| `src/sniper.js` | moteur burst + monitor + timing NTP + métriques |
| `src/proxy.js` | proxies : dispatchers (détection) + pool santé (scan) |
| `src/generate.js` | générateur de pseudos candidats (+ dictionnaire) |
| `src/bulk.js` | scan de dispo en masse (adaptatif AIMD + proxies) |
| `src/score.js` | score de désirabilité (classe les libres) |
| `src/alerts.js` | alertes Discord (webhook chiffré) + hook notif native |
| `src/schedule.js` | snipes planifiés persistés + Tâche Windows (reboot-safe) |
| `src/history.js` | historique des noms vus (libre/pris) |
| `src/ntp.js` | client SNTP (mesure de dérive d'horloge) |
| `src/securebox.js` | chiffrement du token au repos |
| `src/update.js` | auto-update CLI (check + download + remplacement) |
| `src/updatecore.js` | logique réseau de MAJ (GitHub/HTTP, SHA-256) |
| `src/util.js` | logs, couleurs, sleep haute précision |
| `gui/main.js` | processus principal Electron (IPC ↔ moteur) |
| `gui/preload.cjs` | pont sécurisé renderer ↔ main |
| `gui/renderer/` | interface (HTML/CSS/JS), logs en direct |
| `scripts/publish-update.mjs` | construit le zip + publie la release |
| `scripts/serve-updates.mjs` | sert les MAJ sur le LAN (flux HTTP) |

## Prochaines étapes possibles

- Confirmer/brancher l'endpoint réel de changement de pseudo (voir plus haut).
- GUI Electron (comme snipe-mc) : bus d'événements déjà présent dans `util.js`.
- Support multi-comptes, proxies, alerte webhook Discord sur nom libéré.
