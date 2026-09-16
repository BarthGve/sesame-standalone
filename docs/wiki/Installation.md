# Installation

Objectif : stack locale qui répond sur `http://<serveur>/` avec les seeds RGP
et FRS, **sans** encore dépendre des dumps lourds. IAKA peut rester à brancher
ensuite ([Brancher IAKA](Brancher-IAKA.md)).

## 1. Copier l’environnement

À la racine du dépôt :

```bash
cp .env.example .env
```

Le BFF lit `.env`. **Sans cette copie**, `RGP_API_TOKEN` / `RENS_API_TOKEN`
sont vides alors que rgp-api / rens-api démarrent avec `API_TOKEN=changeme`
(compose) : les forwards BFF → API répondent 401.

Valeurs à **aligner** (placeholders LAN, pas des secrets de production) :

| Fichier | Variable | Valeur attendue |
|---|---|---|
| `docker-compose.yml` | `API_TOKEN` (rgp / rens / cote) | `changeme` |
| `.env` | `RGP_API_TOKEN` | `changeme` |
| `.env` | `RENS_API_TOKEN` | `changeme` |

Laisser vides pour l’instant (démarrage OK, pages agent en « non configuré ») :

- tous les `IAKA_*_APP_ID`
- `IAKA_JWT`, `IAKA_TENANT_ID` si IAKA n’est pas encore prête
- `MAP_TILES_URL`, `BAN_API_URL`

Remplir dès que l’instance IAKA est connue (détail :
[Brancher IAKA](Brancher-IAKA.md)) :

```
IAKA_BASE_URL=http://iaka:8080
IAKA_JWT=
IAKA_TENANT_ID=
IAKA_EXECUTE_PATH=/workflows/execute
IAKA_STATUS_PATH=/workflows/executions/{id}
```

**Ne pas mettre de JWT dans le wiki.** Coller le jeton uniquement dans `.env`
sur la machine, jamais dans git.

`AUDIT_NIGHTLY=0` : ne pas lancer l’audit qualité tout seul. Pour un run
manuel, voir [Exploitation](Exploitation.md).

## 2. Démarrer

Images déjà chargées ([Build hors ligne](Build-hors-ligne.md)) :

```bash
docker compose up -d
docker compose ps
```

Services attendus : `postgres`, `minio`, `minio-init` (exit 0), `rgp-api`,
`rens-api`, `cote-api`, `bff`.

Seul port publié sur le LAN : **80 → 8787** (BFF).

Attendre que Postgres soit healthy puis que rgp-api ait fini migrate/seed
(quelques secondes). Le BFF a un `start_period` de 15 s.

## 3. Vérifier la santé

```bash
curl -s localhost/health
curl -s localhost/api/ready
```

`GET /health` — processus BFF up, **sans** sonder IAKA :

```json
{"data":{"ok":true}}
```

`GET /api/ready` — diagnostic d’install (booléens, **aucun secret**) :

```json
{
  "data": {
    "ok": true,
    "iaka": false,
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
    "tiles": false,
    "ban": false,
    "rag": false
  }
}
```

- `iaka: false` tant que `IAKA_BASE_URL` n’est pas joignable (TCP/HTTP).
- chaque `workflows.*` passe à `true` quand l’`app_id` correspondant est
  renseigné (valeur **jamais** renvoyée).
- `tiles` / `ban` : `true` si `MAP_TILES_URL` / `BAN_API_URL` non vides.

Ouvrir `http://<serveur>/` dans le navigateur LAN : page d’accueil, bouton
**Entrer** → `/app/accueil`. Pas d’écran de login.

## 4. Seeds automatiques

### RGP (automatique)

Le conteneur `rgp-api` démarre via `node start.js` :

1. migrations SQL triées (`000_base.sql` puis les suivantes) ;
2. seed `server/rgp-api/seed/minimal.sql` (idempotent) ;
3. écoute `:8080` (fail-closed sans `API_TOKEN`).

Jeu minimal fictif :

- unité `12345` « COB Démo »
- UNA **`12345/1/2026`**
- une perquisition (1 rue de la Gendarmerie, 49500 Segré-en-Anjou Bleu)
- un objet `TELEPHONE`, scellé `SC-DEMO-1`, **sans** photo

Les pages Perquisitions / RGP / Évaluation voient cette UNA sans dump.

### FRS / rens-api (seed dans l’image)

Les migrations (`/app/migrations/*.sql`) et le seed
(`/app/seed/frs_seed.sql`, ~6 300 fiches de démonstration, identités fictives)
sont **embarqués** dans l’image `rens-api`. Au premier `up`, les appliquer
une fois depuis l’hôte (Postgres doit être healthy) :

```bash
# Migrations (ordre lexicographique 001 … 012)
for f in server/rens-api/migrations/*.sql; do
  docker compose exec -T postgres psql -U sesame -d rens -v ON_ERROR_STOP=1 -f - < "$f"
done

# Seed FRS
docker compose exec -T postgres psql -U sesame -d rens -v ON_ERROR_STOP=1 -f - \
  < server/rens-api/seed/frs_seed.sql

# Référentiels de rédaction (GGD, unités, communes, mots-clés)
docker compose exec rens-api node /app/seed/load-referentiels.mjs
```

Sans dépôt sur l’hôte (images seules), lire les fichiers **depuis le
conteneur** :

```bash
docker compose exec rens-api sh -c 'ls /app/migrations/*.sql | sort'
docker compose exec rens-api cat /app/seed/frs_seed.sql \
  | docker compose exec -T postgres psql -U sesame -d rens -v ON_ERROR_STOP=1
```

Les pages `/app/frs` (flux) ne sont alors plus vides. Relancer le seed est
sûr seulement sur une base `rens` neuve (INSERT non idempotents).

### Cote

Catalogue simulé dans `cote-api` : rien à importer.

## 5. Arrêt / relance

```bash
docker compose down          # volumes conservés (postgres_data, minio_data)
docker compose down -v       # EFFACE bases et photos — irréversible
docker compose up -d
```

Un redémarrage du BFF **perd les jobs** en mémoire — voir
[Exploitation](Exploitation.md).

## Suite

1. [Brancher IAKA](Brancher-IAKA.md) — URL, JWT, tenant, `app_id`, MCP
2. [Importer les dumps](Importer-les-dumps.md) — BDSP, photos, tuiles, BAN
3. [Pages de l’application](Pages-de-l-application.md)
