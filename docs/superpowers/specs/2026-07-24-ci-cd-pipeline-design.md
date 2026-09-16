# Pipeline CI/CD demo-iaka — Design

**Goal :** un pipeline GitHub Actions de niveau professionnel. Toute PR est
validée (typecheck + tests + build image). Un **tag de release `vX.Y.Z`**
(produit par `npm run release`) construit et pousse l'image sur GHCR, puis
déploie en production sur OVH **après approbation manuelle**.

**Tech :** GitHub Actions, GitHub Container Registry (ghcr.io), Docker Compose
(OVH), SSH. Node 20, Vite/Vitest, `node --test`.

## Contexte prod (existant)

- Prod = conteneur Docker `demo-iaka` (front `dist/` + BFF `proxy.mjs` sur `:8787`)
  orchestré par `~/docker-compose.yml` (projet `brunogauville`) sur OVH, réseau
  docker partagé avec `rgp-api`, `rens-api`, `cote-api`, `minio`.
- Aujourd'hui : `demo-iaka: build: ./demo-iaka` + `env_file: ./demo-iaka/.env`,
  source scp'd dans `~/demo-iaka` (pas un repo git), déploiement manuel
  `docker compose up -d --build`.
- Site derrière nginx + **Cloudflare Access (OTP email)** → un health-check
  public depuis GitHub est impossible (pas d'OTP). Health-check = **interne au
  conteneur** (`wget localhost:8787`).
- `Dockerfile` multi-stage déjà présent et fonctionnel (build front + runtime BFF).

## Décisions

| Sujet | Choix | Raison |
|---|---|---|
| Déclencheur prod | Tag `vX.Y.Z` | 1 déploiement versionné par release ; le merge seul ne déploie pas |
| Acheminement | Image GHCR | Build reproductible en CI, rollback = re-pull d'un tag ; sort le build du serveur de prod |
| Garde-fou | **Déploiement à déclenchement manuel** | Repo privé en plan gratuit → required reviewer d'Environment indisponible. Le deploy est un workflow `workflow_dispatch` (bouton « Run workflow », version en entrée) : rien ne part en prod sans acte manuel explicite. |
| Health-check | Interne conteneur | Cloudflare Access bloque tout check public |
| Visibilité image | Package GHCR **public** | Évite de stocker un token de pull sur OVH |

## Architecture

Deux workflows dans `.github/workflows/`.

### `ci.yml` — validation continue

- **Déclencheurs :** `pull_request` (toutes cibles) + `push` sur `main`.
- **Job `test`** (ubuntu-latest, Node 20) :
  1. `npm ci`
  2. `npx tsc -b` — typecheck (front + serveur typé)
  3. `npm test` — Vitest front (`src/**/*.test.{ts,tsx}`)
  4. `node --test server/*.test.mjs` — tests du BFF
- **Job `docker`** (indépendant) : `docker build .` sans push — garantit que
  l'image se construit. Ne bloque pas sur le registre.
- **Concurrency :** annule les runs obsolètes d'une même ref (`group:
  ci-${{ github.ref }}`, `cancel-in-progress: true`).
- **Rôle :** check requis sur la PR — rouge = pas de merge.

### `release.yml` — build + déploiement

- **Déclencheur :** `push` de tag `v*.*.*` (matche la sortie de `npm run release`).
- **Permissions :** `contents: read`, `packages: write` (push GHCR via
  `GITHUB_TOKEN`, aucun PAT).
- **Job `build-push`** (ubuntu-latest) :
  1. Checkout du tag.
  2. `docker/login-action` → ghcr.io avec `GITHUB_TOKEN`.
  3. `docker/build-push-action` → tags `ghcr.io/barthgve/demo-iaka:X.Y.Z`
     (X.Y.Z = tag sans le `v`) **et** `:latest`, avec cache GHA.
- **Pas de job deploy dans `release.yml`** : `release.yml` s'arrête au push de
  l'image. Le déploiement est un workflow distinct (ci-dessous).

### `deploy.yml` — déploiement manuel (le garde-fou)

- **Déclencheur :** `workflow_dispatch` avec une entrée `version` (X.Y.Z).
- **Job `deploy`** (`environment: production`, sans protection payante — sert
  l'historique de déploiement et un futur reviewer si passage Pro) :
  1. **Valide** `version` contre `^[0-9]+\.[0-9]+\.[0-9]+$` avant tout usage
     (entrée utilisateur → jamais interpolée brute dans un shell).
  2. SSH OVH (`appleboy/ssh-action`, clé + **port non-standard**) : écrit
     `DEMO_IAKA_TAG=<version>` dans le `.env` du projet compose, `docker compose
     pull demo-iaka`, `up -d demo-iaka`.
  3. Health-check : `docker compose exec -T demo-iaka wget -qO- \
     http://localhost:8787/ >/dev/null` — échec ⇒ job rouge.
- **Rollback :** relancer `deploy.yml` avec une version antérieure (l'image reste
  sur GHCR).

### Convention de tag / compose

Le compose OVH référence l'image par variable, pinée à la version déployée :

```yaml
  demo-iaka:
    image: ghcr.io/barthgve/demo-iaka:${DEMO_IAKA_TAG:-latest}
    restart: unless-stopped
    env_file:
      - ./demo-iaka/.env
```

`DEMO_IAKA_TAG` vit dans le fichier `.env` du **projet compose** (à côté de
`~/docker-compose.yml`), écrit par l'étape de déploiement. `${...:-latest}`
garantit un défaut si la variable manque.

## Secrets & configuration GitHub

| Secret | Contenu | Posé par |
|---|---|---|
| `OVH_SSH_HOST` | hôte OVH | Claude |
| `OVH_SSH_USER` | utilisateur SSH | Claude |
| `OVH_SSH_PORT` | port SSH (non-standard) | Claude |
| `OVH_SSH_KEY` | clé privée de déploiement (ed25519 dédiée) | Claude |

`GITHUB_TOKEN` (auto) suffit pour push GHCR ; aucun PAT.

**Environment `production`** : créé (sans required reviewer — indisponible en
plan gratuit sur repo privé). Le garde-fou est le déclenchement manuel de
`deploy.yml`.

## Répartition des tâches de mise en place

**Claude** (accès `ssh ovh` + `gh`) :
1. Génère une paire de clés ed25519 **dédiée au déploiement** ; clé publique →
   `~/.ssh/authorized_keys` OVH ; clé privée → secret `OVH_SSH_KEY` ; host/user
   → secrets.
2. Édite `~/docker-compose.yml` sur OVH (`build:` → `image:`), initialise
   `DEMO_IAKA_TAG` dans le `.env` du projet compose.
3. Crée l'Environment `production` avec required reviewer.
4. Après le 1er push d'image : passe le package GHCR en **public** (`gh api`).

**Utilisateur :**
- Approuve chaque déploiement (clic sur l'Environment) — c'est le garde-fou.
- Rien d'autre en régime permanent.

## Sécurité

- Clé SSH **dédiée** au déploiement (révocable sans toucher l'accès personnel) ;
  idéalement restreinte côté OVH (`command=`/`from=`) — noté, non bloquant v1.
- Aucun secret en clair dans les workflows ni le repo ; tout via secrets GitHub.
- `GITHUB_TOKEN` à permissions minimales (`packages: write` seulement sur
  `release.yml`).
- Le health-check interne n'expose aucun port supplémentaire.

## Hors périmètre (YAGNI v1)

- Tests des microservices `rgp-api`/`rens-api`/`cote-api` en CI (leur `package.json`
  propre + Postgres de service ⇒ itération dédiée).
- Auto-rollback sur health-check rouge (manuel v1).
- Environnement de staging, tests e2e, scan de vulnérabilités d'image.

## Critères de succès

1. Une PR déclenche `ci.yml` ; un échec typecheck/test/build rend le check rouge.
2. `npm run release -- <type>` + `git push --tags` déclenche `release.yml`.
3. L'image `ghcr.io/barthgve/demo-iaka:X.Y.Z` est poussée et publique.
4. Le job `deploy` **attend l'approbation**, puis met à jour le conteneur OVH sur
   la bonne version, health-check vert.
5. Le front en prod affiche la version attendue (pastille sidemenu).
