# Importer les dumps

Les archives lourdes **ne sont pas** dans git. Chaque étape est optionnelle :
sauter = dégradation, pas d’écran blanc.

| Archive | Variable / cible | Si on saute |
|---|---|---|
| Dump Postgres `bdsp` | base `bdsp` | Carte : couches BDSP vides après exécution |
| Photos MinIO | bucket `perquisitions` | Aperçus photo **404** ; saisie RGP OK |
| Tuiles | `MAP_TILES_URL` | Fond vide (style neutre) ; GeoJSON OK |
| Addok / BAN | `BAN_API_URL` | `/api/adresses` → `[]` ; saisie libre OK |

Les seeds git (UNA `12345/1/2026`, FRS) suffisent à démontrer perquisitions /
FRS sans ces archives.

## 1. Dump BDSP (`pg_restore`)

La base `bdsp` est créée vide au init Postgres, avec PostGIS + `unaccent`
(`infra/postgres/init/03-bdsp.sh`). Le dump (format custom `.fc` typiquement)
se restaure **dans** `bdsp`.

Publier Postgres sur l’hôte (`5432`) le temps de l’import, puis restaurer
**avec hôte et utilisateur** (un `pg_restore -d bdsp dump.fc` seul vise le
socket local et échoue) :

```bash
docker compose --profile debug up -d
export PGPASSWORD=sesame-local-dev   # placeholder compose, pas un secret prod
pg_restore -h 127.0.0.1 -p 5432 -U sesame -d bdsp dump.fc
```

Variante tout-Docker (pas de client `pg_restore` sur l’hôte) :

```bash
docker compose --profile debug up -d
docker compose exec -T postgres pg_restore -U sesame -d bdsp --no-owner --no-acl \
  < dump.fc
```

Après restore, accorder la lecture au rôle MCP IAKA :

```bash
docker compose exec postgres psql -U sesame -d bdsp -c \
  'GRANT USAGE ON SCHEMA public TO iaka_ro;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO iaka_ro;
   GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO iaka_ro;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO iaka_ro;'
```

Vérif :

```bash
docker compose exec postgres psql -U sesame -d bdsp -c '\dt'
```

Sans dump : la page `/app/carte` s’ouvre, fond neutre ; une question IAKA
peut renvoyer un GeoJSON vide (« Aucun point pour cette requête ») plutôt
qu’un crash.

Retirer le profil debug ensuite si 5432 ne doit plus être publié :

```bash
docker compose up -d
```

## 2. Photos MinIO (`mc cp`)

Le bucket `perquisitions` est créé par `minio-init`. MinIO n’est **pas**
publié sur le LAN (`minio:9000` interne).

Depuis un client `mc` **sur le réseau Docker** :

```bash
mc alias set local http://minio:9000 minioadmin minio-local-dev
mc cp --recursive /chemin/photos/ local/perquisitions/
```

Depuis l’hôte, one-shot avec l’image `mc` du compose :

```bash
docker compose run --rm --no-deps \
  -v /chemin/photos:/photos:ro \
  --entrypoint /bin/sh \
  minio-init \
  -c 'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" && mc cp --recursive /photos/ local/perquisitions/'
```

Placeholders MinIO (compose, LAN uniquement) : user `minioadmin`, mot de passe
`minio-local-dev`.

Les clés d’objet doivent correspondre à ce que rgp-api attend (noms de fichiers
sans `/` ni `..` : le BFF refuse le path traversal). Une photo absente →
`GET /api/photo?key=…` **404**.

Sans archive : UNA de démo sans `photo_url` ; l’UI de saisie fonctionne.

## 3. Tuiles

Le BFF ne sert **pas** de fichiers tuiles lui-même : il proxifie
`GET /api/tiles/{z}/{x}/{y}` vers le template `MAP_TILES_URL`.
Le front n’utilise **jamais** l’URL amont : `GET /api/config` renvoie
`tilesUrl: "/api/tiles/{z}/{x}/{y}"` (relatif, same-origin) ou `null`.

Poser un tileserver (PMTiles / MBTiles / PNG statiques) joignable **depuis
le conteneur `bff`**, par exemple hostname `tiles` sur le même réseau Docker,
puis dans `.env` :

```
MAP_TILES_URL=http://tiles:8080/{z}/{x}/{y}.png
```

Recréer le BFF :

```bash
docker compose up -d bff --force-recreate
curl -s localhost/api/ready   # "tiles": true
```

`MAP_TILES_URL` vide : BAN/tuiles **off**. `GET /api/tiles/…` → 404 `TILES_OFF`.
Fond de carte neutre (style MapLibre sans source raster). Les overlays GeoJSON
IAKA s’affichent quand même.

Un amont 404/timeout → 502 `TILES_UPSTREAM` (cases manquantes, pas de crash SPA).

Ce compose **ne** lance **pas** le service `tiles` : c’est une archive / un
conteneur à part, fourni par l’équipe d’install.

## 4. Addok / BAN

Autocomplétion d’adresses (page Perquisitions). Le front appelle
`GET /api/adresses?q=` ; le BFF proxifie Addok si `BAN_API_URL` est défini
(contrat `/search/?q=&limit=`).

```
BAN_API_URL=http://addok:7878
```

Recréer le BFF, vérifier `"ban": true` dans `/api/ready`.

`BAN_API_URL` vide **ou** Addok ko **ou** requête &lt; 3 caractères : le BFF
répond `{ "data": [] }` (HTTP 200). La saisie libre (voie, CP, commune) reste
possible. Les listes de communes du seed rens ne dépendent pas d’Addok.

Comme les tuiles, **Addok n’est pas** un service de ce compose.

## 5. Ordre recommandé

1. `docker compose up -d` + seeds ([Installation](Installation.md))
2. Dump `bdsp` + `GRANT` `iaka_ro`
3. Photos MinIO si on a l’archive
4. Brancher tuiles / Addok + renseigner `MAP_TILES_URL` / `BAN_API_URL`
5. [Brancher IAKA](Brancher-IAKA.md) (MCP Postgres `bdsp` une fois le dump là)
