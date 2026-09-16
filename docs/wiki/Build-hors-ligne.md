# Build hors ligne

Les images de ce dépôt se construisent **localement** (`docker compose build`).
Aucun registre distant n’est utilisé au runtime. Procédure type : construire
sur une machine qui a encore les couches de base (ou un cache Docker),
exporter une archive, la porter sur USB, la charger sur le serveur coupé.

## Images concernées

Services **construits** depuis les Dockerfile du dépôt :

| Service compose | Contexte | Rôle |
|---|---|---|
| `bff` | `.` (`Dockerfile` racine) | SPA + `/api/*`, écoute 8787, publié 80 |
| `rgp-api` | `./server/rgp-api` | Perquisitions, objets, photos MinIO |
| `rens-api` | `./server/rens-api` | Fiches FRS, audit, rédaction |
| `cote-api` | `./server/cote-api` | Catalogue cote simulé |

Images **amont** (à précharger ou à laisser Docker tirer **une fois** sur la
machine de build) :

- `postgis/postgis:16-3.5` — Postgres + PostGIS
- `minio/minio:RELEASE.2024-12-18T13-15-44Z`
- `minio/mc:RELEASE.2024-11-17T19-35-38Z` — init du bucket `perquisitions`
- `alpine:3.20` — uniquement profil `debug` (`postgres-debug`)
- `node:20-alpine` — bases des Dockerfile applicatifs

Lister ce que Compose utilisera :

```bash
docker compose config --images
```

## Sur la machine de build

Depuis la racine du dépôt :

```bash
docker compose build
docker compose save -o sesame-images.tar   # si compose save indispo :
docker save -o sesame-images.tar $(docker compose config --images)
# USB → serveur
docker load -i sesame-images.tar
```

`docker compose save` n’existe pas sur toutes les versions du plugin Compose :
si la commande échoue, utiliser le `docker save` ci-dessus (il embarque aussi
les images amont listées par `config --images`).

Vérifier l’archive avant de copier :

```bash
ls -lh sesame-images.tar
```

Copier sur USB **également** :

- le dépôt (code + `docker-compose.yml` + `infra/` + `.env.example`)
- éventuellement les dumps (BDSP, photos, tuiles, Addok) — pas dans git

## Sur le serveur air-gap

```bash
docker load -i sesame-images.tar
docker images
```

Les tags doivent correspondre à ceux de `docker compose config --images`.
Ensuite : [Installation](Installation.md) (`cp .env.example .env`, `up -d`).

Ne **pas** lancer `docker compose pull` sur le serveur coupé : il n’y a pas
d’amont.

## Alternative : builder sur place

Si le serveur air-gap a déjà `node:20-alpine`, `postgis/postgis:16-3.5`,
`minio/minio:…` et `minio/mc:…` chargés (`docker load` de ces bases seules),
on peut copier uniquement le dépôt et lancer :

```bash
docker compose build
```

Sans ces couches de base, le build échoue (pas de registre).

## Après un changement de code

Reconstruire **uniquement** les services touchés, ré-exporter, recharger :

```bash
docker compose build bff rgp-api
docker save -o sesame-images.tar $(docker compose config --images)
# USB → serveur
docker load -i sesame-images.tar
docker compose up -d
```

Un `up -d` recrée les conteneurs dont l’image a changé. Les volumes
`postgres_data` et `minio_data` sont conservés.

## Ce que l’archive ne contient pas

- le fichier `.env` (à recréer sur le serveur)
- les volumes Postgres / MinIO
- IAKA
- les dumps BDSP / tuiles / Addok / photos
