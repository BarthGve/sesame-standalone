# Brancher IAKA

IAKA n’est **pas** un service du compose SÉSAME. Le BFF l’appelle en HTTP
(`IAKA_BASE_URL` + jeton + tenant + `app_id`). Les workflows restent dans
IAKA ; le BFF fait `execute` puis poll jusqu’à `SUCCESS`.

**Ne pas mettre de JWT dans le wiki.** Coller le jeton uniquement dans `.env`.

## 1. Variables BFF (`.env`)

Reprendre `.env.example`. Redémarrer le BFF après modification :

```bash
docker compose up -d bff --force-recreate
curl -s localhost/api/ready
```

### Connexion

| Variable | Défaut `.env.example` | Rôle |
|---|---|---|
| `IAKA_BASE_URL` | `http://iaka:8080` | Origine HTTP d’IAKA, **sans** chemin d’API |
| `IAKA_JWT` | vide | Bearer d’exécution. Hors git. |
| `IAKA_TENANT_ID` | vide | Tenant IAKA. Hors git. |
| `IAKA_EXECUTE_PATH` | `/workflows/execute` | POST de déclenchement |
| `IAKA_STATUS_PATH` | `/workflows/executions/{id}` | GET de poll (`{id}` remplacé) |

Si l’URL, le JWT ou le tenant manque : **carte / RGP / FRS synthèse-zoom /
qualité à la demande** passent par `iakaReady()` (`server/iaka.mjs`) et
renvoient `IAKA_UNAVAILABLE` (503) **sans** fetch. Identify, analyse, PV,
évaluation, Ariane **n’ont pas** cette garde : l’appel part et échoue en
`IDENTIFY_UPSTREAM` / `SYNTHESE_UPSTREAM` / `PVTCMP_UPSTREAM` /
`EVALUATION_UPSTREAM` / `ARIANE_UPSTREAM`. IAKA jointe mais graphe ko :
`IAKA_UPSTREAM` (502) ou l’équivalent métier. Voir [Dépannage](Depannage.md).

`IAKA_BASE_URL=http://iaka:8080` suppose un hostname `iaka` résolu depuis le
réseau Docker du BFF (conteneur IAKA sur le même réseau, ou entrée extra_hosts).
Sinon : URL HTTP interne (`http://<ip-lan>:<port>`), toujours joignable **depuis
le conteneur `bff`**, pas seulement depuis l’hôte.

### `app_id` ↔ page

Un `app_id` **vide** : le flag `workflows.*` de `GET /api/config` et
`GET /api/ready` reste `false` (booléen, valeur jamais renvoyée). L’UI **ne
masque pas** la page pour autant : un clic lance quand même le BFF, qui
appelle IAKA avec un `app_id` vide → `IAKA_UPSTREAM` / 422 (ou `*_UPSTREAM`
selon la page). Exception : RAG Ariane (`IAKA_RAG_CORPUS_ID` vide) →
« corpus non configuré », pas d’appel. Ne jamais coller d’UUID dans le wiki.

| Variable | Page / usage | Route UI |
|---|---|---|
| `IAKA_CARTE_APP_ID` | Carte BDSP (question → GeoJSON) | `/app/carte` |
| `IAKA_IDENTIFY_APP_ID` | Identification d’objet (photo) | `/app/saisies` |
| `IAKA_RGP_APP_ID` | Assistant RGP (chat) | `/app/rgp` |
| `IAKA_SYNTHESE_APP_ID` | Analyse / synthèse d’audition | `/app/analyse` |
| `IAKA_EVALUATION_APP_ID` | Évaluation des avoirs | `/app/evaluation` |
| `IAKA_PVTCMP_APP_ID` | PV de transport | `/app/pv-transport` |
| `IAKA_ARIANE_EXTRACTION_APP_ID` | Ariane — extraction MAP | `/app/ariane` |
| `IAKA_ARIANE_CONSOLIDATION_APP_ID` | Ariane — consolidation REDUCE | `/app/ariane` |
| `IAKA_RENS_SYNTHESE_APP_ID` | FRS — synthèse quotidienne | `/app/frs?onglet=synthese` |
| `IAKA_RENS_ZOOM_APP_ID` | FRS — zoom (enchaîné) | `/app/frs?onglet=synthese` |
| `IAKA_QUALITE_APP_ID` | Contrôle qualité GIPASP | `/app/frs?onglet=controle` |

RAG Ariane (onglet Questions) — corpus vide = onglet indisponible, pas d’appel :

| Variable | Rôle |
|---|---|
| `IAKA_RAG_CORPUS_ID` | Vide = RAG off |
| `IAKA_RAG_BASE_URL` | Vide = même hôte que `IAKA_BASE_URL` |
| `IAKA_RAG_IAK_ID` | Identifiant d’agent RAG |
| `IAKA_RAG_MODEL` | Modèle |
| `IAKA_RAG_MAX_TOKENS` | Défaut `28000` |

Timeouts surchargeables : `POLL_INTERVAL_MS`, `POLL_TIMEOUT_MS`,
`CARTE_POLL_TIMEOUT_MS`, `CARTE_POLL_INTERVAL_MS` (voir `.env.example`).

## 2. Recâbler les MCP IAKA vers le local

Les graphes IAKA doivent pointer vers **nos** services, pas vers une démo
distante. Recâblage **manuel** côté IAKA (non automatisé par ce dépôt).

### HTTP (depuis le réseau Docker d’IAKA)

| MCP | URL interne | Auth |
|---|---|---|
| Perquisitions / RGP | `http://rgp-api:8080` | Bearer = `API_TOKEN` compose (`changeme`) |
| Fiches FRS | `http://rens-api:8080` | Bearer = `API_TOKEN` compose (`changeme`) |
| Cote véhicules | `http://cote-api:8082` | Bearer = `API_TOKEN` compose (`changeme`) |

OpenAPI : fichiers `server/rgp-api/openapi.json`, `server/rens-api/openapi.json`,
`server/cote-api/openapi.json` **dans le dépôt git**. Seule l’image `rens-api`
copie `openapi.json` (Dockerfile). Les images `rgp-api` et `cote-api` **ne
l’embarquent pas** — s’en servir depuis le checkout pour recâbler les MCP.
Contrats fail-closed : sans Bearer, 401.

### Postgres BDSP (carte)

| Paramètre | Valeur |
|---|---|
| Hôte | `postgres` |
| Port | `5432` |
| Base | `bdsp` |
| Utilisateur | `iaka_ro` |
| Mot de passe | placeholder local `infra/postgres/init/02-passwords.sql` (`iaka-ro-local-dev`) |
| Droits | `CONNECT` sur `bdsp` ; `SELECT` à (re)accorder après restore — voir [dumps](Importer-les-dumps.md) |

`iaka_ro` est un rôle LOGIN créé au init Postgres. Après `pg_restore` du dump
BDSP, accorder `SELECT` sur les tables restaurées.

### IAKA sur le même réseau Docker

Trouver le réseau du compose puis y connecter le conteneur IAKA :

```bash
docker compose ls
docker network ls
docker network connect <reseau-du-compose> <conteneur-iaka>
```

Le nom usuel est `<nom-du-répertoire>_default` (ex. `sesame-standalone_default`
si le projet Compose s’appelle comme le dossier). Après ça, IAKA résout
`rgp-api`, `rens-api`, `cote-api`, `postgres`.

Inversement, pour que le BFF résolve `iaka` : connecter IAKA au même réseau
**ou** poser `IAKA_BASE_URL` sur une IP/hostname que le BFF sait joindre.

### IAKA hors de ce réseau

Publier les API **en interne machine** (pas sur le LAN) et documenter côté
MCP IAKA :

```
http://<ip-docker-bridge>:port
```

Exemples d’IP bridge (à relever sur **cette** machine, ne pas inventer) :

```bash
docker network inspect bridge --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}'
```

Il faut alors publier les ports des API sur l’hôte (bind `127.0.0.1` de
préférence) : aujourd’hui le compose ne les publie pas (`expose` seulement).
Adapter un override Compose local, **sans** ouvrir ces ports au LAN.

Postgres : `docker compose --profile debug up -d` publie `5432` sur l’hôte
(sidecar `postgres-debug`). Pointer le MCP Postgres sur
`http://<ip-hôte>:5432` n’est pas HTTP — utiliser l’hôte TCP
`<ip-docker-bridge>` ou `127.0.0.1` selon où tourne IAKA, base `bdsp`,
user `iaka_ro`.

## 3. Contrôles

```bash
curl -s localhost/api/ready
curl -s localhost/api/config
```

`iaka: true` = IAKA a répondu HTTP (n’importe quel statut compte comme
joignable). Les flags `workflows` reflètent la **présence** des `app_id`,
pas leur validité métier.

Un `app_id` faux se verra à l’usage (`IAKA_UPSTREAM` / 422) — voir
[Dépannage](Depannage.md).

## 4. Audit nocturne rens-api

`AUDIT_NIGHTLY=0` dans le compose et `.env.example`. Le script
`audit/nightly.mjs` **ne fait rien** tant que `AUDIT_NIGHTLY` n’est pas
exactement `1`. Pour un run volontaire :

```bash
docker compose exec -e AUDIT_NIGHTLY=1 rens-api node /app/audit/nightly.mjs
```

Il utilise `IAKA_QUALITE_APP_ID` et les mêmes knobs `IAKA_EXECUTE_PATH` /
`IAKA_STATUS_PATH`. Ne pas le lancer tant que qualité n’est pas câblée.
