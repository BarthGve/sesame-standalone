# Changelog install

Variables d’environnement ajoutées ou sémantique changée pour le standalone
air-gap. Source de vérité : `.env.example` à la racine. **Ne pas mettre de
JWT dans le wiki.**

## `MAP_TILES_URL`

Template HTTP des tuiles raster, vu **uniquement par le BFF**.

- Vide (défaut) : tuiles off. `GET /api/config` → `tiles: false`,
  `tilesUrl: null`. Front : fond neutre. `GET /api/tiles/{z}/{x}/{y}` → 404
  `TILES_OFF`.
- Renseigné : le BFF substitue `{z}/{x}/{y}` (entiers uniquement) et proxifie.
  Le navigateur n’utilise que le chemin relatif `/api/tiles/{z}/{x}/{y}`.

Exemple (tileserver sur le réseau Docker, **pas** un service de ce compose) :

```
MAP_TILES_URL=http://tiles:8080/{z}/{x}/{y}.png
```

Voir [Importer les dumps](Importer-les-dumps.md).

## `BAN_API_URL`

Origine Addok / BAN locale, vue **uniquement par le BFF**.

- Vide (défaut) : `GET /api/adresses?q=` → `{ "data": [] }` sans fetch amont.
  Saisie d’adresse libre conservée.
- Renseigné : proxy `…/search/?q=&limit=` (contrat Addok). Amont ko → `[]`.

Exemple :

```
BAN_API_URL=http://addok:7878
```

Addok n’est pas lancé par ce compose.

## `IAKA_EXECUTE_PATH`

Chemin POST de déclenchement d’un workflow, concaténé à `IAKA_BASE_URL`.

- Défaut : `/workflows/execute`
- À surcharger si l’API IAKA locale n’utilise pas ce contrat
  (l’API n’est pas figée).

Utilisé par le BFF (`server/iaka.mjs`) **et** par rens-api audit
(`server/rens-api/audit/iaka.mjs`).

## `IAKA_STATUS_PATH`

Chemin GET de poll. Le marqueur `{id}` est remplacé par l’`execution_id`.

- Défaut : `/workflows/executions/{id}`
- Query `tenant_id` ajoutée par le client.

Même knob côté audit rens-api.

## `AUDIT_NIGHTLY`

Interrupteur de l’audit qualité GIPASP (`rens-api` / `audit/nightly.mjs`).

| Valeur | Effet |
|---|---|
| `0` (défaut compose + `.env.example`) | Noop. `main()` sort 0 sans appeler IAKA |
| unset, `true`, toute autre chaîne | Noop |
| `1` | Run réel (opt-in) |

Il n’y a **pas** de cron in-process. Pour un audit :

```bash
docker compose exec -e AUDIT_NIGHTLY=1 rens-api node /app/audit/nightly.mjs
```

Ne pas laisser `AUDIT_NIGHTLY=1` en permanent sur une install de démo sans
`IAKA_QUALITE_APP_ID` câblé.

## Autres knobs déjà dans `.env.example`

| Variable | Notes install |
|---|---|
| `IAKA_BASE_URL` | Placeholder `http://iaka:8080` — hostname à faire résoudre par le BFF |
| `IAKA_JWT` / `IAKA_TENANT_ID` | Vides = `IAKA_UNAVAILABLE` ; valeurs hors git |
| `IAKA_*_APP_ID` | Tous vides ; un vide = workflow flag `false`, pas d’appel |
| `IAKA_RAG_*` | Corpus vide = RAG off |
| `RGP_API_TOKEN` / `RENS_API_TOKEN` | Doivent matcher `API_TOKEN=changeme` du compose |
| `POLL_*` / `CARTE_POLL_*` | Timeouts de poll IAKA |
| `PROXY_PORT` | `8787` dans le conteneur ; hôte = port **80** |

## Ports et services (rappel)

| Service | Port LAN | Port interne |
|---|---|---|
| `bff` | **80** | 8787 |
| `rgp-api` | — | 8080 |
| `rens-api` | — | 8080 |
| `cote-api` | — | 8082 |
| `postgres` | 5432 si profil `debug` | 5432 |
| `minio` | — | 9000 |

Santé : `GET /health`. Diagnostic : `GET /api/ready`.
