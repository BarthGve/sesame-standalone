# Mise en ligne du démonstrateur demo-iaka — design

Date : 2026-07-20
Statut : approuvé (design), à décliner en plan d'implémentation.

## 1. Objectif

Mettre le démonstrateur **demo-iaka** (front React/Vite + BFF `proxy.mjs` + workflows IAka +
microservices OVH) en ligne, protégé par email (OTP `bgauville@mac.com`), en s'inspirant du
déploiement d'IA-DSFR (Cloudflare Access).

Contrainte forte : **les appels longs doivent fonctionner** (PV transport, synthèse : ~2-3 min).

## 2. Décision d'hébergement : OVH, pattern `carnet` — PAS Cloudflare Pages

Tout ce dont demo-iaka a besoin vit déjà sur le réseau docker du VPS OVH (`91.134.75.161`) :
IAka (`n8n`), `rgp-api:8080`, `rens-api:8080`, `minio:9000`, `postgis-bdsp`. Un conteneur
hébergé là joint ces services **en interne par nom docker** — aucun tunnel, aucune exposition
des services internes.

Le VPS héberge déjà ce type d'app derrière **nginx** (`brunogauville-nginx-1`, 80/443) avec
cert **wildcard `*.kerjean.net`** et Cloudflare devant. Modèle de référence :
`carnet.kerjean.net` (`carnet-app:3000`, proxifie même déjà `/rgp-api/`, `/rens-api/`).

Cloudflare Pages est écarté : il éloignerait le front de son backend et des services internes
OVH (tunnels/portage inutiles). On réplique le pattern OVH existant.

## 3. Architecture cible

```
[Navigateur]
   │  HTTPS, protégé par Cloudflare Access (OTP email)
   ▼
Cloudflare (orange) → nginx OVH (vhost demo-iaka.kerjean.net, TLS wildcard)
   │  same-origin : sert le front statique + proxifie /api/*
   ▼
Conteneur `demo-iaka` (Node) = front build (dist) + BFF (proxy.mjs)
   │  appels internes par nom docker
   ▼
n8n (IAka) · rgp-api:8080 · rens-api:8080 · minio:9000 · postgis-bdsp
```

### Composants

- **Conteneur `demo-iaka`** (un seul) : Node, sert `dist/` en statique **et** le BFF
  `proxy.mjs` sur `/api/*`. Unifié = même origine, pas de CORS, pas d'exposition séparée.
  Ajout minime à `proxy.mjs` : servir les fichiers statiques de `dist/` (fallback SPA →
  `index.html`) en plus des routes `/api/*` existantes. Port interne : **8787**.
- **docker-compose** : service ajouté à `/home/brunogauville/docker-compose.yml`, même
  réseau que les services existants. Build depuis un dossier `/home/brunogauville/demo-iaka/`
  (Dockerfile + `dist/` + `proxy.mjs` + libs `server/`).
- **nginx vhost `demo-iaka.kerjean.net`** : copie de `carnet.conf` (redirect 80→443, TLS
  wildcard, headers sécu, `client_max_body_size` adapté aux uploads photos/pièces,
  `resolver 127.0.0.11`, `proxy_pass http://demo-iaka:8787`). `proxy_read_timeout 120s`
  (les appels longs deviennent async, donc courts — 120s est une marge).
- **DNS Cloudflare** : `demo-iaka.kerjean.net` → `91.134.75.161`, **proxifié (orange)**.

## 4. Protection : Cloudflare Access (email OTP)

Sur la team Zero-Trust existante (celle d'IA-DSFR) :
- Application Access ciblant `demo-iaka.kerjean.net` (tout le domaine, `/*`).
- Policy **Allow** : `emails == bgauville@mac.com`, méthode **One-Time PIN** (email OTP).
- **Zéro code** : configuration dashboard uniquement. Le mur email est au niveau edge
  Cloudflare, avant d'atteindre nginx/OVH.
- Aucune lecture du JWT Access nécessaire côté app (contrairement à IA-DSFR qui l'utilisait
  pour signer des commits) : demo-iaka n'a pas besoin de connaître l'identité, juste d'être
  gardé. Le JWT peut être ignoré.

## 5. Refonte async des endpoints IAka (fait passer les appels longs)

### Problème

Cloudflare (orange, requis par Access) coupe une requête à **~100s** (erreur 524). Le BFF
tient aujourd'hui la connexion pendant tout le poll IAka (jusqu'à 300s) → 524 en ligne.

### Solution : job store en mémoire (déjà présent — Ariane), généralisé

Le pattern async EXISTE déjà dans le code : **Ariane** (`/api/ariane` → `202 { jobId }`,
`/api/ariane/status?jobId=…`) via un job store mémoire dans `server/ariane.mjs`
(`createJob`, `getJob`, `startJob` fire-and-forget). On **généralise** ce store et on y
branche les autres features.

```
Avant (bloquant) :
  POST /api/synthese ── BFF garde la connexion (poll 300s) ── réponse

Après (async, chaque requête < 100s) :
  POST /api/<feature>            → createJob + lance le worker en fond, rend { jobId }  (<1s)
  GET  /api/job/status?jobId=…   → getJob → { status, result? , error? }               (<1s ×N)
  Le FRONT poll toutes les ~3s jusqu'à done/error.
```

Point clé : **le worker de chaque feature NORMALISE avant de stocker** le résultat dans le
job (comme aujourd'hui : `synthese` rend `{texte}`, `pvtcmp` rend `{docxBase64,…}`, carte rend
le GeoJSON, rgp/chat rend `{text,parsed,message}`). Donc `job.result` est **déjà au bon
format par feature** → **un seul endpoint status générique** suffit, sans ambiguïté (pas de
normaliseur à choisir côté status).

### Contrat

- **Job store générique** (`server/jobs.mjs`, extrait/généralisé depuis `ariane.mjs`) :
  - `createJob() → jobId`
  - `getJob(jobId) → { status: "pending"|"running"|"done"|"error", result?, error? }`
  - `runJob(jobId, async () => result)` : passe le job en `running`, exécute le worker en
    arrière-plan, stocke `result` (status `done`) ou `error` (status `error`). Ne bloque pas
    l'appelant.
  (Ariane garde en plus son `progress` ; le store générique le supporte via un champ optionnel.)
- **Start** : chaque endpoint workflow (`/api/query`, `/api/rgp/chat`, `/api/synthese`,
  `/api/pvtcmp`, `/api/identify`) : valide l'entrée → `jobId = createJob()` →
  `runJob(jobId, () => <workerExistant>(...))` → `res 202 { jobId }`. Les workers existants
  (`run`, `runRaw`+normalize, `synthese`, `pvtcmp`, `identify`), retries inclus, sont
  réutilisés tels quels dans le worker.
- **Status unique** : `GET /api/job/status?jobId=<id>` → `getJob(id)` →
  `{ status, result?, error? }`. 404 si jobId inconnu.
- **Front** : un helper unique
  `runJobAsync(startUrl, body, opts?) → Promise<result>` : POST `startUrl` → `{jobId}` ;
  poll `GET /api/job/status?jobId=` (intervalle ~3s, timeout global, annulable) ; résout
  `result` sur `done`, rejette `error` sur `error`. Les clients d'API des features
  (`syntheseApi`, `pvApi`, `rgpApi`, carte, identify) l'utilisent.
- **Ariane** : déjà async avec son propre `/api/ariane/status` — laissé tel quel (ou aligné
  sur le store générique en option, non requis).

### Portée

- **Async** : les 5 endpoints IAka ci-dessus (uniforme, évite de deviner lesquels dépassent
  100s ; robuste à tout timeout edge).
- **Inchangés (courts)** : passthrough REST vers `rgp-api` (`/api/perquisition*`, listes,
  create/modify), `/api/photo` (MinIO). Restent synchrones.
- Les mécanismes existants (retries « pas de tool-output », préfixe date, timeouts) sont
  reportés dans le nouveau découpage.

## 6. Configuration & secrets

Env du conteneur `demo-iaka` (valeurs internes au réseau docker) :
- IAka : `IAKA_BASE_URL`, `IAKA_JWT`, `IAKA_TENANT_ID`, et les app_ids
  `IAKA_CARTE_APP_ID`, `IAKA_IDENTIFY_APP_ID`, `IAKA_RGP_APP_ID`, `IAKA_SYNTHESE_APP_ID`,
  `IAKA_PVTCMP_APP_ID`, `IAKA_IMAGE_FIELD`, champs multipart.
- RGP : `RGP_API_URL=http://rgp-api:8080`, `RGP_API_TOKEN`.
- MinIO : endpoint interne `minio:9000` + creds.

Secrets fournis via l'environnement docker-compose OVH (jamais commit), comme les autres
services. Réutiliser les valeurs déjà présentes sur OVH (`IAKA_JWT`, tokens) quand elles
existent.

## 7. Build & déploiement

Même flux que le déploiement `rgp-api` déjà pratiqué :
1. `npm run build` (front → `dist`).
2. Copier `dist/`, `server/` (proxy.mjs + libs), `Dockerfile`, `package.json` vers
   `/home/brunogauville/demo-iaka/` (scp).
3. `docker compose up -d --build demo-iaka`.
4. Ajouter/activer le vhost nginx + recharger nginx.
5. Créer l'enregistrement DNS + l'application Access (dashboard Cloudflare).
6. Vérifier : chargement front (après OTP), un appel court (RGP), un appel long (synthèse)
   de bout en bout.

## 8. Phasage suggéré (pour le plan)

1. **Refonte async** (BFF start/status + helper front + clients features) — testable en local.
2. **Conteneurisation** (Dockerfile front+BFF, static serving, `npm run build`).
3. **Déploiement OVH** (compose + vhost nginx + DNS).
4. **Cloudflare Access** (application + policy email OTP).
5. **Vérification en ligne** (court + long).

## 9. Hors périmètre (YAGNI)

- Pas de lecture/vérification du JWT Access côté app.
- Pas de portage MinIO/S3 (MinIO reste joint en interne).
- Pas de CI/CD automatisé (déploiement manuel, comme l'existant).
- Pas de multi-utilisateurs / rôles (un seul email autorisé).
- Pas de streaming SSE (async retenu à la place).

## 10. Risques / points à confirmer

- Sous-domaine `demo-iaka.kerjean.net` et port interne `8787` = valeurs proposées, ajustables.
- Vérifier que `n8n` (IAka) est bien joignable par son nom docker depuis le conteneur (réseau
  compose commun) ; sinon ajouter le service au bon réseau.
- Durée réelle des appels « courts » restants < 100s (RGP chat, carte, identify passent en
  async par cohérence, donc non bloquant).
