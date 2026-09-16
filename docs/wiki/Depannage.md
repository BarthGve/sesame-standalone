# Dépannage

Codes d’erreur **stables** renvoyés par le BFF (JSON `{ "error": "CODE" }`).
L’UI affiche un libellé métier ; les logs BFF gardent un extrait technique
tronqué, jamais le JWT ni le prompt complet.

## `GET /api/ready` → `iaka: false`

IAKA n’a pas répondu HTTP depuis le conteneur `bff` (timeout 2 s ou erreur
réseau). Le BFF **démarre quand même**.

Pistes :

1. `IAKA_BASE_URL` vide ou hostname non résolu dans le réseau Docker
   (`http://iaka:8080` exige un conteneur/alias `iaka`).
2. IAKA n’est pas sur le même réseau — [Brancher IAKA](Brancher-IAKA.md).
3. IAKA éteinte / mauvais port.

```bash
docker compose exec bff node -e 'fetch(process.env.IAKA_BASE_URL||"").then(r=>console.log(r.status)).catch(e=>console.error(e.message))'
curl -s localhost/api/ready
```

Les flags `workflows` peuvent être `true` (app_id remplis) avec `iaka: false` :
les appels échoueront.

## `IAKA_UNAVAILABLE` (503)

**Pas universel.** La garde `iakaReady()` n’existe que dans `server/iaka.mjs`
(`execWorkflow`). Elle lève `IAKA_UNAVAILABLE` **avant** tout fetch si
`IAKA_BASE_URL`, `IAKA_JWT` ou `IAKA_TENANT_ID` est vide.

Pages concernées (passent par `iaka.mjs`) :

- `/app/carte`, `/app/rgp`
- FRS synthèse / zoom, qualité à la demande (via `runRensWorkflow`)

Pages **sans** cette garde — l’appel part, codes `*_UPSTREAM` :

| Page | Code typique |
|---|---|
| `/app/saisies` identify photo | `IDENTIFY_UPSTREAM` |
| `/app/analyse` | `SYNTHESE_UPSTREAM` |
| `/app/pv-transport` | `PVTCMP_UPSTREAM` |
| `/app/evaluation` | `EVALUATION_UPSTREAM` |
| `/app/ariane` | `ARIANE_UPSTREAM` |

Actions :

- `cp .env.example .env` a-t-il été fait ? Les `IAKA_*` sont-ils dans l’env
  du **conteneur** `bff` (`docker compose exec bff env | grep IAKA_`) ?
- **Ne pas mettre de JWT dans le wiki** : coller le jeton dans `.env` puis
  `docker compose up -d bff --force-recreate`.

Un `app_id` vide ne masque **pas** l’écran : le flag `workflows.*` de
`/api/config` est `false`, mais le front appelle quand même le BFF. IAKA
répond alors souvent 422 / `IAKA_UPSTREAM` (ou l’équivalent métier ci-dessus).
Seul Ariane RAG a un message dédié (« corpus non configuré ») si
`IAKA_RAG_CORPUS_ID` est vide.

## `IAKA_UPSTREAM` (502)

IAKA a été jointe mais :

- HTTP non-ok sur `execute` ou `status` ;
- pas d’`execution_id` ;
- statut d’exécution `ERROR` ;
- corps illisible.

Pistes :

- `app_id` inconnu pour ce tenant ;
- **422 prompt** (ci-dessous) ;
- MCP IAKA encore pointés vers d’anciens hôtes (rgp/rens/cote/postgres) ;
- timeout trop court (`POLL_TIMEOUT_MS` / `CARTE_POLL_TIMEOUT_MS`).

Logs : `docker compose logs bff | grep IAKA_`.

`IAKA_TIMEOUT` (504) : poll épuisé, le workflow peut encore tourner côté IAKA.

## 422 prompt

Certains workflows IAKA sont **autonomes** : ils **rejettent** le champ
`prompt` (HTTP 422, détail du type « champs non acceptés »). D’autres
l’exigent.

Le BFF n’envoie `prompt` / `langue` / `include_traitement` **que si** un
prompt non vide est fourni (`server/iaka.mjs`). Synthèse FRS quotidienne :
pas de prompt. Zoom FRS, carte, RGP : prompt.

Si 422 malgré ça :

- nœud de début IAKA mal réglé (`require_prompt`) ;
- `IAKA_EXECUTE_PATH` / `IAKA_STATUS_PATH` ne correspondent pas à l’API réelle
  (surcharger dans `.env`, défauts `/workflows/execute` et
  `/workflows/executions/{id}`).

Un 422 prouve en général que **l’auth et le tenant sont bons** — chercher le
contrat du graphe, pas le JWT.

## Tuiles 404 (`TILES_OFF`) / fond vide

- `MAP_TILES_URL` vide → `GET /api/tiles/{z}/{x}/{y}` = 404 `TILES_OFF`,
  `tiles: false` dans `/api/ready`, fond neutre. **Normal** sans archive.
- Template posé mais amont ko → 502 `TILES_UPSTREAM`.
- Le navigateur doit appeler **`/api/tiles/{z}/{x}/{y}`** (relatif), jamais
  l’URL du tileserver.

Voir [Importer les dumps](Importer-les-dumps.md).

## BAN `[]`

`GET /api/adresses?q=…` répond toujours 200 `{ "data": [] }` si :

- `BAN_API_URL` vide ;
- `q` &lt; 3 caractères ;
- Addok injoignable ou non-ok.

Ce n’est **pas** une erreur bloquante : saisie libre (voie, CP, commune).
`ban: false` dans `/api/ready` si l’URL est vide.

## Photo 404

`GET /api/photo?key=…` :

- objet absent du bucket `perquisitions` (dump MinIO non importé, seed RGP
  sans `photo_url`) ;
- clé avec `/` ou `..` → 400 `CLE_INVALIDE` ;
- token BFF → rgp-api faux → 401.

RGP et la saisie restent utilisables sans aperçu.

## Tokens 401 (pages FRS / perquisitions vides de données)

Le BFF n’a pas le même Bearer que l’API :

```bash
# doit matcher le compose API_TOKEN=changeme
grep TOKEN .env
```

Sans `.env` (`cp .env.example .env` oublié), `RGP_API_TOKEN` /
`RENS_API_TOKEN` sont vides.

## Seeds absents

- RGP : `rgp-api` n’a pas fini `start.js` (voir `docker compose logs rgp-api`).
  UNA attendue : `12345/1/2026`.
- FRS : migrations + `frs_seed.sql` pas encore appliqués — commandes dans
  [Installation](Installation.md).

## Jobs disparus (`JOB_INCONNU`)

Redémarrage BFF, TTL 30 min, ou plafond 500. Relancer le traitement depuis
l’UI. Voir [Exploitation](Exploitation.md).

## Postgres / MinIO

```bash
docker compose ps
docker compose exec postgres pg_isready -U sesame
```

`minio-init` doit être `exited (0)` après création du bucket. Un restart en
boucle de `rgp-api` : souvent Postgres pas ready ou `API_TOKEN` manquant
(fail-closed).

## Checklist rapide

1. `curl -s localhost/health` → `ok: true`
2. `curl -s localhost/api/ready` → lire `iaka`, `workflows`, `tiles`, `ban`
3. `.env` présent, tokens `changeme` alignés, **pas de JWT dans git**
4. MCP IAKA : `http://rgp-api:8080`, `http://rens-api:8080`,
   `http://cote-api:8082`, Postgres `postgres` / `bdsp` / `iaka_ro`
5. Dumps optionnels : fond vide / BAN `[]` / photo 404 / carte sans couches
   sont des dégradations attendues
