# Design — Persistance des photos (MinIO)

Date : 2026-07-15
Statut : validé (brainstorming), prêt pour plan d'implémentation

## Objectif

Persister les photos des objets saisis dans MinIO : à l'enregistrement (« valider tout » du
batch), chaque photo est uploadée ; la clé est stockée dans `objet_saisi.photo_url` ; à la
réouverture/édition d'un objet, la vraie photo s'affiche (lecture seule). Incrément 2/2 (après
`2026-07-15-editer-objet-enregistre`).

## Décisions actées (brainstorming)

| Sujet | Décision |
|---|---|
| Client S3 | Dépendance **`minio`** dans le proxy (léger, s3v4, path-style). |
| Stockage | `photo_url` = **clé MinIO** (pas une URL) ; image servie par le proxy via `/api/photo?key=`. |
| Moment de l'upload | Au **« valider tout »** du batch (upload parallèle, puis save). |
| Édition | La photo s'affiche (lecture seule) ; **pas de remplacement** en édition. |
| Transport MinIO | Interne (réseau docker) → **tunnel dev** `localhost:9000 → minio:9000` (comme rgp-api). Prod = co-localisation (hors périmètre). |

## Contexte infra (relevé sur OVH)

- Container `brunogauville-minio-1`, réseau `brunogauville_default`, port 9000 (interne, non publié),
  console 9001. Volume `minio_data:/data`.
- Creds root : `admin` / `<MINIO_SECRET_KEY>` (via `.env` OVH ; `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`).
  API s3v4, path-style. Vérifié via `mc`.
- Buckets existants : budget-wizard, data, lbap-private, meca, media. **Pas** de bucket `perquisitions` (à créer).
- Proxy `server/proxy.mjs` (Node ESM) : `createHandler({ cfg, run, identify, fetchImpl })`, `RGP_ROUTES`
  (forward vers rgp-api + Bearer), `readBody(req)`. `/api/identify` reçoit déjà `{ imageBase64, mime, filename }`.
- Front : `BatchIdentify` (batch photos → identify → grille → « Valider tout » → `onValiderTout(drafts)`),
  `ObjetCard` (`previewUrl` string, colonne droite `<img>`/« Sans photo »), `ObjetEditor` (édition, `previewUrl=""`).
  `mapObjet(o)` émet `photo_url: undefined`. `ObjetSaisi` a un champ `photo?: string`. `apiObjetToDraft` ne
  reporte pas de photo. Clients : `savePerquisition`, `addObjets`, `updateObjet`, `getPerquisition`, `unwrap`.
- Backend : `objet_saisi.photo_url` (text) déjà présent, stocké depuis le payload et renvoyé par `getPerquisition`.

## 1. Proxy — client S3 + 2 routes

- Dépendance `minio` (package.json du repo front). Config `cfg` étendue :
  `minioEndpoint` (host), `minioPort` (nombre), `minioUseSSL` (bool), `minioAccessKey`, `minioSecretKey`,
  `minioBucket` (défaut `perquisitions`), depuis l'env (`MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL`,
  `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`).
- Client MinIO instancié une fois (lazy). Au premier upload, s'assurer que le bucket existe
  (`bucketExists` → `makeBucket` sinon).
- **`POST /api/photo`** : body JSON `{ imageBase64, mime, filename }`. Décoder le base64 → `Buffer`.
  Clé = `crypto.randomUUID()` + extension déduite du `mime` (ex. `image/jpeg`→`.jpg`) ou du `filename`.
  `putObject(bucket, key, buffer, size, { "Content-Type": mime })`. Réponse `{ data: { key } }`
  (enveloppe cohérente). Erreur → 502 `{ error: "PHOTO_UPLOAD" }`.
- **`GET /api/photo?key=`** : valider `key` (présent, sans `/` de traversée). `getObject(bucket, key)` →
  récupérer aussi `statObject` pour le `Content-Type` → écrire le header + `pipe` le flux vers la réponse.
  Erreur/absence → 404. (Route GET : ajouter le support GET au handler pour ce chemin, comme les forwards RGP.)
- Ces routes ne passent pas par `RGP_ROUTES` (traitement local S3), branchées en tête du handler.

## 2. Front — upload au « valider tout » + affichage

### Client photo (`photoApi.ts` ou dans `perquisitionApi.ts`)
- `uploadPhoto(file: File, fetchImpl?): Promise<string>` : lit le fichier en base64 (FileReader),
  `POST /api/photo` `{ imageBase64, mime, filename }`, retourne `data.key` (via `unwrap`).
- `photoUrl(key: string): string` = `"/api/photo?key=" + encodeURIComponent(key)`.

### `BatchIdentify`
- `BatchItem` gagne `file?: File` (conservé à l'ajout ; les items démo n'en ont pas).
- Au clic « Valider tout » : pour chaque item `done` avec `file`, `uploadPhoto(file)` (parallèle) →
  `draft.photo = key`. Puis `onValiderTout(draftsAvecPhoto)`. Pendant l'upload : `saveState` local
  « saving ». Échec d'un upload → message d'erreur, pas d'appel `onValiderTout`.
- (La `previewUrl` locale reste utilisée pour l'aperçu avant enregistrement.)

### `mapObjet`
- Émettre `photo_url: o.photo || undefined` (au lieu de `undefined` fixe). Ainsi `savePerquisition`/
  `addObjets`/`updateObjet` transmettent la clé. (updateObjet en édition = pas de changement de photo,
  mais `o.photo` conserve la clé existante → photo_url inchangé, cohérent.)

### `ApiObjet` / `PerquisitionDetail` / `apiObjetToDraft`
- `ApiObjet` : ajouter `photo_url?: string | null`.
- `apiObjetToDraft(o)` : reporter `photo: o.photo_url ?? undefined` sur le draft.

### `ObjetCard` / `ObjetEditor`
- `ObjetCard` : `previewUrl` inchangé (déjà une string). En batch = URL locale ; en édition = `photoUrl(key)`.
- `ObjetEditor` : passer `previewUrl={draft.photo ? photoUrl(draft.photo) : ""}` à `ObjetCard`
  (vraie photo si présente, sinon « Sans photo »).

## 3. Infra / déploiement

- Bucket : créer `perquisitions` (via `mc` sur OVH, ou le proxy le crée au 1er upload).
- Tunnel dev : étendre `scripts/tunnel-rgp.sh` pour forwarder aussi MinIO :
  `ssh -N -L 8080:<rgp-ip>:8080 -L 9000:<minio-ip>:9000 ovh`.
- `.env` / `.env.example` : `MINIO_ENDPOINT=localhost`, `MINIO_PORT=9000`, `MINIO_USE_SSL=false`,
  `MINIO_ACCESS_KEY=admin`, `MINIO_SECRET_KEY=…`, `MINIO_BUCKET=perquisitions` (creds hors `.env.example`).

## Périmètre / hors périmètre

- **Dans le périmètre** : proxy S3 (upload/serve), upload au valider-tout, `photo_url`=clé, affichage
  de la vraie photo en batch et en édition, bucket + tunnel + env.
- **Hors périmètre** : remplacement de photo en édition, presigned URLs, purge des blobs orphelins
  (upload sans save réussi), migration/backfill des objets existants sans photo, déploiement prod du front.

## Points de vérification

- Upload : base64 → buffer → putObject avec le bon Content-Type ; clé unique.
- Serve : `Content-Type` correct ; `key` validée (pas de traversée) ; 404 si absente.
- `mapObjet` transmet `photo_url` ; round-trip clé → `photo` → affichage.
- Bucket créé une seule fois (idempotent).
- Tunnel MinIO requis en dev (sinon upload/serve échoue proprement, message clair).
- Aucun emoji (icônes `Icon`).
