# Prérequis

Machine **isolée du réseau public**, Docker Engine, et une instance **IAKA
joignable sur le LAN**. Rien n’est tiré d’un registre distant au runtime :
les images sont construites (ou chargées depuis une archive) avant le
`docker compose up`.

## Logiciels

| Logiciel | Version minimale | Rôle |
|---|---|---|
| Docker Engine | **24+** | Runtime des conteneurs |
| Docker Compose | plugin v2 (`docker compose`) | Orchestration du fichier du dépôt |
| `curl` | quelconque | Vérifs `/health` et `/api/ready` |
| `git` | quelconque | Clone du dépôt (ou copie USB du working tree) |

Sur la machine de **build** (qui a encore un accès réseau ou les couches de
base déjà présentes) : Docker 24+ suffit. Sur le **serveur air-gap** : Docker
24+ + l’archive `sesame-images.tar` (voir [Build hors ligne](Build-hors-ligne.md)).

Vérifier :

```bash
docker version
docker compose version
```

## Ressources machine

| Ressource | Minimum | Recommandé |
|---|---|---|
| RAM | **8 Go** | **16 Go** |
| Disque | **20 Go** sans dumps | 20 Go + taille des archives (tuiles, BDSP, photos, Addok) |
| CPU | 2 cœurs | 4 cœurs |

Les 20 Go couvrent les images (Node, PostGIS, MinIO), les volumes Postgres/MinIO
vides et les seeds git. Une archive de tuiles raster ou un dump BDSP peut
ajouter plusieurs Go : dimensionner le disque **selon l’archive fournie**,
pas selon ce dépôt.

IAKA (LLM, graphes) vit sur **une autre** machine ou un autre compose : sa RAM
n’est pas comptée ici.

## Réseau

- IAKA **joignable depuis le serveur** (HTTP). Le BFF l’appelle via
  `IAKA_BASE_URL` (placeholder `.env.example` : `http://iaka:8080`).
- Navigateur des opérateurs : HTTP vers le BFF, **port 80 uniquement**.
- Pas d’auth UI. Réseau isolé = confiance. Ne pas exposer le port 80 hors du LAN
  maîtrisé.
- Les microservices (`rgp-api:8080`, `rens-api:8080`, `cote-api:8082`),
  Postgres et MinIO restent sur le réseau Docker interne.
- Postgres `5432` n’est publié sur l’hôte qu’avec
  `docker compose --profile debug up` (sidecar `postgres-debug`).

Pour que les MCP IAKA résolvent `rgp-api` / `rens-api` / `cote-api` /
`postgres`, IAKA doit **partager le réseau Docker** du compose, ou bien
utiliser les IP de l’hôte — voir [Brancher IAKA](Brancher-IAKA.md).

## Compte et dépôt

- Copie du dépôt (git clone hors ligne, ou arborescence copiée sur USB).
- Fichier `.env` **non versionné** : `cp .env.example .env` puis remplir
  `IAKA_*` (voir [Installation](Installation.md)).
- **Ne pas mettre de JWT dans le wiki** ni dans git.

## Archives optionnelles

Aucune n’est dans git. Chacune a une dégradation documentée si on saute
l’étape ([Importer les dumps](Importer-les-dumps.md)).

| Archive | Contenu | Si absente |
|---|---|---|
| Dump BDSP (`dump.fc` ou équivalent) | Couches carto PostGIS, base `bdsp` | Carte : overlays vides après exécution, pas de crash |
| Photos MinIO | JPEG/PNG des scellés, bucket `perquisitions` | RGP / perquisitions fonctionnent, aperçus **404** |
| Tuiles | PMTiles/MBTiles + tileserver, ou PNG `{z}/{x}/{y}` | Fond neutre ; GeoJSON IAKA quand même |
| Addok / BAN | Service d’autocomplétion d’adresses | `/api/adresses` → `[]` ; saisie libre conservée |

Seeds **dans git**, pas des archives :

- RGP : UNA fictive `12345/1/2026` (COB Démo, un téléphone `SC-DEMO-1`, pas de photo).
- FRS : `server/rens-api/seed/frs_seed.sql` (fiches de démonstration, identités fictives).

## Tokens inter-services

Le BFF injecte un Bearer vers rgp/rens. Les valeurs du `.env` **doivent
matcher** les `API_TOKEN` du compose :

- compose : `API_TOKEN: changeme` (rgp-api, rens-api, cote-api)
- `.env.example` : `RGP_API_TOKEN=changeme` et `RENS_API_TOKEN=changeme`

Sans `.env` copié, le BFF part avec des tokens vides et les API répondent 401.

## Hors périmètre

- IAKA (images, licence, LLM) n’est pas un service de ce compose.
- Compte utilisateur, écran de login : absents volontairement.
- Redis / second store de jobs : non. Les jobs longs vivent **en mémoire BFF**.
