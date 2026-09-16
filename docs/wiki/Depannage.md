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

`iakaReady()` sur **tous** les points d’entrée IAKA (carte, RGP, FRS,
identify, analyse, PV, évaluation, Ariane extract/consolidate). Lève
**avant** tout fetch si `IAKA_BASE_URL`, `IAKA_JWT` ou `IAKA_TENANT_ID`
est vide.

Actions :

- `cp .env.example .env` a-t-il été fait ? Les `IAKA_*` sont-ils dans l’env
  du **conteneur** `bff` (`docker compose exec bff env | grep IAKA_`) ?
- **Ne pas mettre de JWT dans le wiki** : coller le jeton dans `.env` puis
  `docker compose up -d bff --force-recreate`.

## `WORKFLOW_NON_CONFIGURE` (422)

L’`app_id` du workflow appelé est vide (`IAKA_*_APP_ID`). Aucun fetch IAKA.
Renseigner l’UUID dans `.env` puis recréer le BFF. Le flag `workflows.*` de
`/api/config` est `false` ; le BFF refuse maintenant l’appel.

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
# compose interpole RGP_API_TOKEN / RENS_API_TOKEN / COTE_API_TOKEN
grep TOKEN .env
```

Sans `.env` (`cp .env.example .env` oublié), les tokens retombent sur
`changeme` côté API ; le BFF sans `.env` a des tokens vides → 401.

## Seeds absents

- RGP : `rgp-api` n’a pas fini `start.js` (voir `docker compose logs rgp-api`).
  UNA attendue : `12345/1/2026`.
- FRS : volume Postgres déjà existant d’avant l’init auto — `start.js`
  rattrape si `frs` est vide ; sinon `docker compose down -v` (efface les
  données) puis `up`. Voir [Installation](Installation.md).

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
