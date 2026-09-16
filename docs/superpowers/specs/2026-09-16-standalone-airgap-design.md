# Standalone air-gap — démonstrateur IAKA hors Internet

**Date** : 2026-09-16
**Statut** : design validé en session, en attente de relecture spec
**Cible** : nouveau dépôt GitHub dédié (code standalone uniquement).
  Le dépôt `demo-iaka` (démo OVH) n’est **pas** modifié pour ce chantier.

## 1. But

Installer, sur un serveur **coupé d’Internet**, la stack SÉSAME (front + BFF +
rgp/rens/cote + Postgres + MinIO) à côté d’une instance **IAKA déjà posée**,
et faire tourner **tout le démonstrateur** (accueil, carte, saisies, RGP,
FRS/qualité, synthèse, PV transport, évaluation, Ariane) en appelant les API
IAKA locales.

Le livrable est un **dépôt autonome** remis à une équipe d’install, avec wiki
d’exploitation. Ce n’est pas un mode du dépôt OVH.

## 2. Décisions

| Sujet | Choix |
|---|---|
| Périmètre machine | IAKA + app complète (BFF, front, rgp-api, rens-api, cote-api, Postgres, MinIO) |
| Pages jour 1 | Tout le démonstrateur |
| Contrat IAKA | **Pas figé** — coder contre le contrat actuel + knobs de config |
| Isolation | Nouveau dépôt, code standalone seulement. OVH reste dans `demo-iaka` |
| Architecture | Extract + compose air-gap (même découpage qu’aujourd’hui) |
| Données | Seeds légers dans git + dumps lourds à part (wiki d’import) |
| Auth UI | **Aucune** (réseau isolé = confiance). Tokens uniquement inter-services |
| IAKA dans le compose | **Non** — produit tiers, joint par URL |
| Doc | Wiki GitHub du repo standalone, source = `docs/wiki/*.md` dans git |

## 3. Hors périmètre

- Modifier `demo-iaka` (CI OVH, GHCR, Cloudflare, `kerjean.net`, `deploy.yml`).
- Embarquer IAKA (images, licence, LLM) dans notre compose.
- Exporter / versionner les graphes de workflows IAKA (API non figée).
- Compte utilisateur, session SPA, Cloudflare Access.
- Redis, second store de jobs.
- CDN, Google Fonts, widget La Gaufre.
- Appels navigateur vers IGN / BAN / La Suite.

## 4. Architecture

```
[ Navigateur LAN ]  HTTP, pas d'auth
        │
        ▼
[ BFF : SPA statique + /api/* ]     ← seul ingress (port 80 ou 8787)
        ├── IAKA (externe)          IAKA_BASE_URL + JWT + tenant + app_id
        ├── rgp-api (interne)       Postgres rgp + MinIO
        ├── rens-api (interne)      Postgres rens
        └── cote-api (interne)      catalogue simulé
```

Frontières :

1. Le navigateur n’appelle **jamais** IAKA, IGN, data.gouv, La Suite. Même origine = BFF.
2. IAKA n’est pas un service de notre compose. Hostname + port fournis par l’install.
3. Les workflows restent dans IAKA. Le BFF fait `execute` + poll, chemins configurables.
4. Les MCP IAKA (HTTP rgp/rens/cote, Postgres BDSP) doivent pointer vers les
   services **locaux**. Recâblage documenté dans le wiki, pas automatisé.
5. Jobs longs : mémoire BFF (`jobs.mjs`). Redémarrage BFF = jobs perdus (déjà le cas).
6. Auth UI : aucune. `BFF_API_TOKEN` / `BFF_REQUIRE_CF_ACCESS` absents ou off.
   Bearer **interne** BFF → rgp/rens/cote (réseau Docker, non publié sur le LAN).
7. `/health` BFF : process up, **sans** sonder IAKA.
8. `GET /api/ready` : diagnostic d’install (IAKA joignable, `app_id` renseignés
   en booléens, tuiles/BAN présentes). N’expose ni JWT, ni UUID, ni secrets.

Dégradations (dump ou IAKA manquant ≠ écran blanc) :

| Manque | Comportement |
|---|---|
| Tuiles | Fond neutre, overlays GeoJSON OK |
| BAN | Saisie d’adresse libre ; `/api/adresses` → `[]` |
| `app_id` vide | Page : « workflow non configuré », pas d’appel IAKA |
| IAKA down | Code `IAKA_UNAVAILABLE` / `IAKA_UPSTREAM`, UI déjà prévue |
| RAG non configuré | Onglet grisé (déjà le cas si `IAKA_RAG_CORPUS_ID` vide) |
| Dump BDSP absent | Carte : couches vides après exécution, pas de crash |
| Photos MinIO absentes | RGP fonctionne, aperçus 404 |

## 5. Compose

Un `docker-compose.yml`, réseau interne, **aucun pull au runtime**.

| Service | Port LAN | Port interne |
|---|---|---|
| `bff` | **80** (override `8787` si besoin) | 8787 |
| `rgp-api` | — | 8080 |
| `rens-api` | — | 8080 (hostname distinct) |
| `cote-api` | — | 8082 |
| `postgres` | optionnel 5432 debug | 5432 |
| `minio` | — | 9000 |

Bases Postgres : `rgp`, `rens`, et `bdsp` (créée vide ; peuplée par dump optionnel).

Images : `docker compose build` depuis les Dockerfile du repo. **Pas de GHCR.**
Procédure wiki : build sur machine en réseau → `docker save` → USB → `docker load`
sur le serveur coupé. Alternative : précharger `node:20-alpine` / `postgres` /
`minio` et builder sur place.

Le BFF voit :

```
RGP_API_URL=http://rgp-api:8080
RENS_API_URL=http://rens-api:8080
COTE_API_URL=http://cote-api:8082
IAKA_BASE_URL=http://<hôte-iaka>:<port>
```

## 6. Config IAKA (tout en env, rien en dur)

Obligatoire pour les pages agent (le BFF démarre sans) :

- `IAKA_BASE_URL`, `IAKA_JWT`, `IAKA_TENANT_ID`

Chemins (défaut = contrat actuel) :

- `IAKA_EXECUTE_PATH` = `/workflows/execute`
- `IAKA_STATUS_PATH` = `/workflows/executions/{id}`

RAG :

- `IAKA_RAG_BASE_URL` (vide = même hôte que `IAKA_BASE_URL` ou onglet off selon
  les règles déjà en place)
- `IAKA_RAG_CORPUS_ID` vide = RAG off
- `IAKA_RAG_IAK_ID`, `IAKA_RAG_MODEL`, `IAKA_RAG_MAX_TOKENS`

`app_id` — **vides dans `.env.example`**, jamais les UUID cloud :

`IAKA_CARTE_APP_ID`, `IAKA_IDENTIFY_APP_ID`, `IAKA_RGP_APP_ID`,
`IAKA_SYNTHESE_APP_ID`, `IAKA_EVALUATION_APP_ID`, `IAKA_PVTCMP_APP_ID`,
`IAKA_ARIANE_EXTRACTION_APP_ID`, `IAKA_ARIANE_CONSOLIDATION_APP_ID`,
`IAKA_RENS_SYNTHESE_APP_ID`, `IAKA_RENS_ZOOM_APP_ID`, `IAKA_QUALITE_APP_ID`.

Timeouts : conserver `POLL_*` et `CARTE_POLL_*`, surchargeables.

Erreur nouvelle (ou réutiliser un code existant si équivalent) :

- `IAKA_UNAVAILABLE` si URL/JWT/tenant manquants au moment d’un appel, ou
  TCP/HTTP vers IAKA impossible — **pas** de stack ni de body IAKA au client.

`rens-api` audit nocturne : mêmes knobs (`IAKA_*`) si le job tourne ; sinon
désactiver le cron par défaut en standalone (`AUDIT_NIGHTLY=0`).

## 7. Front air-gap

Règle : **aucune URL `https://` externe** dans le JS/CSS/HTML livré.

### Tuiles

- Plus de `data.geopf.fr` en dur.
- Le BFF expose dans `GET /api/config` : `{ tilesUrl: string | null }`.
- `tilesUrl` vient de `MAP_TILES_URL` (template `{z}/{x}/{y}` ou style JSON
  local). Vide = fond neutre, GeoJSON IAKA quand même.
- Dump tuiles hors git (PMTiles/MBTiles + tileserver, ou statique). Wiki.

### BAN

- `src/features/saisies/ban.ts` n’appelle plus data.gouv.
- Front : `GET /api/adresses?q=` (via le module API de la feature, pas un
  `fetch` ad hoc hors module).
- BFF : si `BAN_API_URL` défini, proxy Addok/BAN local (contrat
  `/search/?q=&limit=` compatible). Sinon `[]`.
- Saisie libre conservée (voie, CP, commune). Listes communes seed rens
  inchangées.

### La Gaufre

- Retirer `LaGaufreV2` et les URLs `lasuite` / `anct.gouv.fr`.
- Header/footer DSFR inchangés, sans widget. Pas d’emoji.

### `/api/config`

Public, sans secret :

```json
{
  "tiles": false,
  "ban": false,
  "workflows": {
    "carte": false,
    "identify": false,
    "rgp": false,
    "synthese": false,
    "evaluation": false,
    "pvtcmp": false,
    "arianeExtraction": false,
    "arianeConsolidation": false,
    "rensSynthese": false,
    "rensZoom": false,
    "qualite": false
  },
  "rag": false
}
```

Booléens uniquement (présence d’URL / d’`app_id` / de corpus). Jamais les
valeurs.

Fonts et MapLibre : déjà bundlés, inchangés.

## 8. Données

### Dans git (léger)

- Seed FRS existant (`server/rens-api/seed/`).
- Jeu RGP **minimal** (1–2 UNA, quelques objets, **sans** photos binaires
  lourdes — ou 1–2 JPEG d’exemple < 200 ko si déjà dans le dépôt source).
- Cote : catalogue simulé, inchangé.
- Communes / référentiels déjà versionnés.

Premier `docker compose up` : migrations + seeds → pages FRS / RGP / cote
non vides.

### Hors git (archives + wiki)

- Dump Postgres `bdsp` (carte).
- Dump photos MinIO (optionnel).
- Archive tuiles.
- Dump Addok/BAN (optionnel).

Aucune de ces archives n’est commitée. Le wiki décrit format, commande
d’import, vérif, et l’état de l’app si on saute l’étape.

## 9. Auth et surface réseau

- UI : pas d’auth. Pas de Cloudflare. Pas d’écran de login.
- Ingress LAN : BFF seulement.
- rgp/rens/cote/minio/postgres : **non publiés** (sauf 5432 debug opt-in).
- `API_TOKEN` des microservices : secret compose interne, fail-closed
  conservé (sans token le microservice refuse de démarrer — déjà le cas).
- Le BFF injecte le Bearer serveur. Le navigateur ne le voit pas.

## 10. Ce qu’on retire du code copié

À extraire depuis `demo-iaka` puis **purger** :

- `BFF_REQUIRE_CF_ACCESS`, logique Cloudflare Access.
- URLs `kerjean.net`, `ghcr.io`, workflows `deploy.yml` / `release.yml` OVH.
- `.env.example` cloud (app_id, hosts publics).
- Widget La Gaufre + `@gouvfr-lasuite/ui-kit` si plus aucun autre usage.
- `src/lib/mapStyle.ts` : URL IGN.
- `src/features/saisies/ban.ts` : URL data.gouv.
- Docs / README centrés OVH, tunnel SSH, Cloudflare.
- CI qui pull GHCR / pousse des images distantes. CI standalone = lint +
  tests + build **local**, sans registry.

À **conserver** : client `iaka.mjs` (execute/poll), jobs, forward RGP/RENS,
features front, migrations, seeds, tests, fail-closed microservices,
`ERROR_STATUS`, pas de log de données de procédure.

## 11. Wiki (`docs/wiki/*.md` → Wiki GitHub à la création du dépôt)

1. Accueil — but, schéma, git vs dumps.
2. Prérequis — machine, Docker, IAKA joignable, archives.
3. Build hors ligne — `compose build` / `save` / `load`.
4. Installation — `.env`, `up -d`, seeds, `/health`, `/api/ready`.
5. Brancher IAKA — URL, JWT, tenant, chemins, chaque `app_id`, MCP locaux.
6. Importer les dumps — BDSP, MinIO, tuiles, BAN ; dégradations.
7. Pages de l’application — une fiche par cas d’usage.
8. Exploitation — logs, jobs mémoire, backup, pas d’auth UI.
9. Dépannage — IAKA down, 422, `app_id`, tuiles, BAN, photos, timeouts.
10. Changelog install — variables ajoutées.

Français, reproductible hors ligne, **aucun secret**. Pas de procédure OVH.

## 12. Tests (obligatoires sur le repo standalone)

| Zone | Quoi |
|---|---|
| Front | `ban.ts` ne tape plus data.gouv ; `/api/adresses` ; fond carte sans tuiles ; pas de La Gaufre ; `/api/config` drapeaux |
| BFF | chemins IAKA surchargeables ; `app_id` vide = pas d’appel ; `IAKA_UNAVAILABLE` ; proxy BAN on/off ; `/api/ready` sans secrets |
| rens / rgp / cote | tests existants conservés |
| Compose | smoke : fichiers compose valides, `.env.example` listé dans le wiki |

Pas de test d’intégration IAKA réelle (instance absente en CI). Faux fetch /
faux pool comme aujourd’hui.

## 13. Sécurité (checklist)

- [ ] Auth UI : volontairement absente ; ingress = BFF
- [ ] Microservices fail-closed, non publiés
- [ ] SQL paramétré (inchangé)
- [ ] `/api/config` et `/api/ready` sans secrets
- [ ] Pas de JWT / app_id / dumps dans git ni le wiki
- [ ] Données de procédure absentes des logs (inchangé)
- [ ] Photos : path traversal déjà géré côté rgp-api

## 14. Plan d’exécution (après validation de cette spec)

1. Créer le dépôt GitHub dédié (vide), y copier le code utile depuis
   `demo-iaka` (pas l’historique cloud comme source de vérité).
2. Purger cloud (§10), ajouter compose + `.env.example` standalone.
3. BFF : knobs IAKA, `/api/config`, `/api/ready`, `/api/adresses`.
4. Front : tuiles via config, BAN via BFF, retrait La Gaufre.
5. Seeds RGP minimaux si absents.
6. `docs/wiki/*.md` + publication Wiki GitHub.
7. Tests de la zone + `tsc` + tests microservices concernés.

`demo-iaka` n’est pas mergé, pas tagué, pas déployé pour ce chantier.
)
