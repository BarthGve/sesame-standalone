# Pipeline CI/CD demo-iaka Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** CI GitHub Actions sur chaque PR (typecheck + tests + build image) et
CD sur tag `vX.Y.Z` (build/push image GHCR puis déploiement OVH après
approbation manuelle).

**Architecture :** `ci.yml` valide (PR + push main). `release.yml` sur tag `v*`
construit et pousse `ghcr.io/barthgve/demo-iaka:X.Y.Z`, puis un job `deploy`
gardé par l'Environment `production` SSHe sur OVH, pin `DEMO_IAKA_TAG`, pull +
`up -d`, health-check interne. Le compose OVH passe de `build:` à `image:`.

**Tech Stack :** GitHub Actions, GHCR, docker/build-push-action, Docker Compose,
SSH (ed25519 dédiée), Node 20, Vitest, `node --test`.

## Global Constraints

- Front sans emoji (CLAUDE.md) — non concerné ici (config only).
- Secrets jamais commit ; via secrets GitHub / `.env` OVH.
- Image : `ghcr.io/barthgve/demo-iaka` (minuscules). Tag image = version SANS le
  `v` (`X.Y.Z`) ; `DEMO_IAKA_TAG` = `X.Y.Z`.
- Health-check interne conteneur (`wget localhost:8787/`) — Cloudflare Access
  bloque tout check public.
- Port interne conteneur : `8787`. Service compose : `demo-iaka`, projet
  `brunogauville`, fichier `~/docker-compose.yml`.
- `GITHUB_TOKEN` seul pour GHCR (permission `packages: write`), aucun PAT.

---

## Task 1: Workflow CI (`ci.yml`)

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces : un check `test` + `docker` sur chaque PR et push `main`.

- [ ] **Step 1: Écrire `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: Typecheck
        run: npx tsc -b
      - name: Tests front (Vitest)
        run: npm test
      - name: Tests BFF (node --test)
        run: node --test server/*.test.mjs

  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build image (sans push)
        run: docker build -t demo-iaka:ci .
```

- [ ] **Step 2: Valider la syntaxe**

Run: `actionlint .github/workflows/ci.yml` (ou, à défaut d'actionlint installé,
`gh workflow view` après push ; sinon validation YAML : `python3 -c "import
yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"`)
Expected: aucune erreur.

- [ ] **Step 3: Vérifier les commandes localement**

Run: `npx tsc -b && npm test && node --test server/*.test.mjs`
Expected: tout PASS (c'est ce que la CI exécutera).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: validation PR (typecheck + tests + build image)"
```

---

## Task 2: Workflow release + deploy (`release.yml`)

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes : secrets `OVH_SSH_HOST`, `OVH_SSH_USER`, `OVH_SSH_KEY` (Task 4) ;
  Environment `production` (Task 4) ; image poussée par le job `build-push`.
- Produces : image `ghcr.io/barthgve/demo-iaka:X.Y.Z` + `:latest`, déploiement OVH.

- [ ] **Step 1: Écrire `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags: ["v*.*.*"]

jobs:
  build-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - name: Version depuis le tag (sans v)
        id: v
        run: echo "version=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"
      - uses: docker/setup-buildx-action@v3
      - name: Login GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build & push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ghcr.io/barthgve/demo-iaka:${{ steps.v.outputs.version }}
            ghcr.io/barthgve/demo-iaka:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: build-push
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Version depuis le tag (sans v)
        id: v
        run: echo "version=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"
      - name: Déploiement OVH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.OVH_SSH_HOST }}
          username: ${{ secrets.OVH_SSH_USER }}
          key: ${{ secrets.OVH_SSH_KEY }}
          script: |
            set -e
            cd ~
            # Pin la version déployée dans le .env du projet compose.
            touch .env
            sed -i '/^DEMO_IAKA_TAG=/d' .env
            echo "DEMO_IAKA_TAG=${{ steps.v.outputs.version }}" >> .env
            docker compose pull demo-iaka
            docker compose up -d demo-iaka
            # Health-check interne (Cloudflare Access bloque tout check public).
            docker compose exec -T demo-iaka wget -qO- http://localhost:8787/ >/dev/null
            echo "Déployé : demo-iaka ${{ steps.v.outputs.version }}"
```

- [ ] **Step 2: Valider la syntaxe**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: release sur tag v* (build/push GHCR + deploy OVH)"
```

---

## Task 3: Adapter le compose OVH à l'image GHCR

**Files:**
- Modify (OVH, hors repo) : `~/docker-compose.yml`, service `demo-iaka`.
- Modify (OVH, hors repo) : `~/.env` (projet compose) : `DEMO_IAKA_TAG`.

**Interfaces:**
- Consumes : image poussée par Task 2.
- Produces : un service `demo-iaka` qui tire l'image au lieu de builder.

- [ ] **Step 1: Sauvegarder le compose actuel**

```bash
ssh ovh 'cd ~ && cp docker-compose.yml docker-compose.yml.bak.$(date +%s)'
```

- [ ] **Step 2: Remplacer `build: ./demo-iaka` par `image:`**

Cible (service `demo-iaka` dans `~/docker-compose.yml`) :

```yaml
  demo-iaka:
    image: ghcr.io/barthgve/demo-iaka:${DEMO_IAKA_TAG:-latest}
    restart: unless-stopped
    env_file:
      - ./demo-iaka/.env
```

Appliquer via un patch ciblé (remplacer la seule ligne `build: ./demo-iaka`
par la ligne `image:` ; le reste du bloc est déjà correct).

- [ ] **Step 3: Initialiser `DEMO_IAKA_TAG`**

Le pin réel sera écrit par le déploiement ; on pose une valeur de départ
cohérente avec la version courante (0.1.0) pour ne pas dépendre de `latest`.

```bash
ssh ovh 'cd ~ && sed -i "/^DEMO_IAKA_TAG=/d" .env 2>/dev/null; echo "DEMO_IAKA_TAG=0.1.0" >> .env; grep DEMO_IAKA_TAG .env'
```

- [ ] **Step 4: Valider la syntaxe compose (sans redéployer)**

```bash
ssh ovh 'cd ~ && docker compose config >/dev/null && echo "compose OK"'
```
Expected: `compose OK` (référence l'image ; ne build plus).

Note : le service reste sur l'ancien conteneur tant que Task 5 n'a pas déployé —
ne PAS faire `up` ici (l'image n'existe pas encore sur GHCR).

---

## Task 4: Clés SSH, secrets, Environment, permissions GHCR

**Files:**
- (Aucun fichier repo — configuration GitHub + OVH.)

**Interfaces:**
- Produces : secrets `OVH_SSH_*`, Environment `production` (required reviewer),
  autorisation Actions→packages.

- [ ] **Step 1: Générer une clé ed25519 dédiée au déploiement**

```bash
SBDIR=/private/tmp/claude-501/-Users-brunogauville-Developpeur-XP-IAka-demo-iaka/9757b7a6-6636-4958-909e-c395439dcfb0/scratchpad
ssh-keygen -t ed25519 -N "" -C "gha-deploy-demo-iaka" -f "$SBDIR/deploy_key"
```

- [ ] **Step 2: Autoriser la clé publique sur OVH**

```bash
PUB=$(cat "$SBDIR/deploy_key.pub")
ssh ovh "grep -qF '$PUB' ~/.ssh/authorized_keys || echo '$PUB' >> ~/.ssh/authorized_keys"
```

- [ ] **Step 3: Récupérer host/user SSH effectifs**

Lire `~/.ssh/config` local pour l'alias `ovh` (HostName, User).
Run: `ssh -G ovh | awk '/^hostname /{h=$2} /^user /{u=$2} END{print h, u}'`

- [ ] **Step 4: Poser les secrets GitHub**

```bash
gh secret set OVH_SSH_KEY  --repo BarthGve/demo-iaka < "$SBDIR/deploy_key"
gh secret set OVH_SSH_HOST --repo BarthGve/demo-iaka --body "<hostname>"
gh secret set OVH_SSH_USER --repo BarthGve/demo-iaka --body "<user>"
```

- [ ] **Step 5: Créer l'Environment `production` avec required reviewer**

```bash
OWNER_ID=$(gh api users/BarthGve --jq .id)
gh api -X PUT repos/BarthGve/demo-iaka/environments/production \
  -F "reviewers[][type]=User" -F "reviewers[][id]=$OWNER_ID"
```

- [ ] **Step 6: Autoriser Actions à écrire des packages (si nécessaire)**

```bash
gh api -X PUT repos/BarthGve/demo-iaka/actions/permissions/workflow \
  -F default_workflow_permissions=read -F can_approve_pull_request_reviews=false
```
(Le job `release.yml` déclare `packages: write` explicitement ; ce réglage
garantit juste que les permissions de workflow ne sont pas verrouillées en
lecture stricte au niveau repo.)

- [ ] **Step 7: Vérifier la connexion SSH via la clé dédiée**

```bash
ssh -i "$SBDIR/deploy_key" -o IdentitiesOnly=yes <user>@<hostname> 'echo ssh-ok && docker compose version'
```
Expected: `ssh-ok` + version compose.

---

## Task 5: Ouvrir la PR, valider la CI, première release de bout en bout

**Files:**
- (Aucun — validation.)

**Interfaces:**
- Consumes : Tasks 1-4.

- [ ] **Step 1: Pousser la branche et ouvrir la PR**

```bash
git push -u origin HEAD
gh pr create --repo BarthGve/demo-iaka --base main \
  --title "ci: pipeline CI/CD (GHCR + deploy OVH)" \
  --body "CI sur PR (typecheck+tests+build) ; release sur tag v* (build/push GHCR + deploy OVH sur approbation)."
```

- [ ] **Step 2: Vérifier que `ci.yml` passe sur la PR**

```bash
gh pr checks --repo BarthGve/demo-iaka --watch
```
Expected: `test` et `docker` verts.

- [ ] **Step 3: Merger (procédure versioning CLAUDE.md — demander le bump)**

Proposer major/minor/patch. Ce lot = feature CI/CD sans rupture → `minor`.
```bash
gh pr merge <n> --repo BarthGve/demo-iaka --merge
git checkout main && git pull --ff-only
```

- [ ] **Step 4: Release → déclenche `release.yml`**

```bash
npm run release -- minor      # 0.1.0 -> 0.2.0, commit + tag
git push && git push origin v0.2.0
```

- [ ] **Step 5: Suivre le build-push puis approuver le deploy**

```bash
gh run watch --repo BarthGve/demo-iaka
```
- `build-push` pousse l'image. Puis passer le package GHCR en public :
```bash
gh api -X PATCH user/packages/container/demo-iaka --input - <<< '{"visibility":"public"}' \
  || echo "à régler via l'UI si l'API refuse (Packages > demo-iaka > visibility)"
```
- Le job `deploy` attend l'approbation → l'utilisateur approuve dans l'onglet
  Actions / Environment `production`.

- [ ] **Step 6: Vérifier la prod**

```bash
ssh ovh 'cd ~ && grep DEMO_IAKA_TAG .env && docker compose ps demo-iaka'
```
Expected: `DEMO_IAKA_TAG=0.2.0`, conteneur `Up`. Puis vérifier la pastille
version `v0.2.0` dans le sidemenu (via navigateur, derrière Cloudflare Access).

---

## Self-review (couverture spec)

- CI PR (typecheck+tests+build) → Task 1. ✓
- Release tag → build/push GHCR → Task 2 (`build-push`). ✓
- Deploy OVH + approbation + health-check interne → Task 2 (`deploy`) + Task 4
  (Environment). ✓
- Compose `build:`→`image:` + `DEMO_IAKA_TAG` → Task 3. ✓
- Secrets/clés/environment/GHCR public → Task 4 + Task 5 Step 5. ✓
- Critères de succès 1-5 → Task 5. ✓
- Hors périmètre (tests microservices, auto-rollback, staging) : absents du plan,
  conforme au YAGNI de la spec.
