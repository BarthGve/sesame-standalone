# Persistance photos MinIO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persister les photos dans MinIO : upload au « valider tout », `photo_url`=clé, image servie par le proxy via `/api/photo?key=`, affichage de la vraie photo en batch et en édition (lecture seule).

**Architecture:** Proxy `server/proxy.mjs` = client S3 (`minio`, import dynamique) + routes `POST /api/photo` (upload) et `GET /api/photo` (stream). Front : `uploadPhoto`/`photoUrl`, `BatchIdentify` uploade au valider-tout, `mapObjet` émet `photo_url`, `apiObjetToDraft` reporte la clé, `ObjetEditor` affiche la vraie photo. Backend rgp-api inchangé (`photo_url` déjà géré).

**Tech Stack:** Node ESM proxy + `minio` + `node:test` ; React+Vite+TS, Vitest.

## Global Constraints

- **INTERDIT : emoji dans le front** (CLAUDE.md). Icônes = `Icon` / SVG.
- Gate typecheck+build réel = **`npm run build`** (`tsc -b && vite build`). `tsc --noEmit` = NO-OP. `noUnusedLocals`/`noUnusedParameters` ON.
- Proxy = local (app en local). rgp-api NON redéployé (backend inchangé). MinIO interne → **tunnel dev** `localhost:9000 → minio:9000` requis.
- MinIO : container `brunogauville-minio-1`, réseau `brunogauville_default`, port 9000. Creds root `admin` / `<MINIO_SECRET_KEY>` (s3v4, path-style). Bucket cible `perquisitions` (à créer). `mc` alias `local` configuré dans le container.
- Enveloppe proxy : succès `{ data: … }` ; les erreurs photo renvoient `{ error: "…" }`.
- Commandes ssh/scp/npm sensibles au sandbox réseau → si un ssh/npm time out, réexécuter avec le sandbox désactivé.
- Spec : `docs/superpowers/specs/2026-07-15-photos-minio-design.md`.

---

## File Structure

- `package.json` (modifié) : dépendance `minio`.
- `server/proxy.mjs` (modifié) : client MinIO (import dynamique) + `handlePhotoUpload`/`handlePhotoGet` + dispatch `/api/photo` + cfg MinIO.
- `server/proxy.test.mjs` (modifié) : tests photo (fake client MinIO).
- `src/features/saisies/perquisitionApi.ts` (modifié) : `uploadPhoto`, `photoUrl` ; `mapObjet` (photo_url) ; `ApiObjet.photo_url` ; `apiObjetToDraft` (photo).
- `src/features/saisies/perquisitionApi.test.ts` (modifié) : tests `photoUrl`/`uploadPhoto` + apiObjetToDraft photo.
- `src/features/saisies/SaisiesApp.tsx` (modifié) : `BatchItem.file`, upload au valider-tout, `ObjetEditor` previewUrl réelle.
- `scripts/tunnel-rgp.sh` (modifié) : forwarder aussi MinIO 9000.
- `.env`, `.env.example` (modifiés) : vars MinIO.

---

### Task 1: Prep infra — dépendance, bucket, tunnel, env (CONTRÔLEUR)

_Exécutée par le contrôleur (réseau : npm/ssh)._

- [ ] **Step 1: Ajouter la dépendance `minio`**

```bash
cd /Users/brunogauville/Developpeur/XP-IAka/carte-bdsp
npm install minio@^8
```
Expected: `minio` ajouté à `package.json` + `package-lock.json`.

- [ ] **Step 2: Créer le bucket `perquisitions` sur OVH**

```bash
ssh ovh 'docker exec brunogauville-minio-1 sh -c "mc mb -p local/perquisitions 2>&1; mc ls local | grep perquisitions"'
```
Expected: bucket créé (ou déjà existant), listé.

- [ ] **Step 3: Étendre le tunnel pour MinIO**

Modify `scripts/tunnel-rgp.sh` — résoudre aussi l'IP MinIO et forwarder 9000 :

```bash
#!/usr/bin/env bash
# Tunnel SSH local -> rgp-api (8080) + MinIO (9000), tous deux privés sur le réseau docker OVH.
set -euo pipefail
RGP_IP=$(ssh ovh "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' brunogauville-rgp-api-1")
MINIO_IP=$(ssh ovh "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' brunogauville-minio-1")
echo "rgp-api $RGP_IP:8080 -> localhost:8080 ; minio $MINIO_IP:9000 -> localhost:9000"
exec ssh -N -L "8080:$RGP_IP:8080" -L "9000:$MINIO_IP:9000" ovh
```

- [ ] **Step 4: Variables d'environnement**

Modify `.env` — ajouter :
```
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=admin
MINIO_SECRET_KEY=<MINIO_SECRET_KEY>
MINIO_BUCKET=perquisitions
```
Modify `.env.example` — ajouter (sans secrets) :
```
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=changeme
MINIO_SECRET_KEY=changeme
MINIO_BUCKET=perquisitions
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json scripts/tunnel-rgp.sh .env.example
git commit -m "chore(minio): dependance minio + bucket perquisitions + tunnel MinIO + env"
```
(`.env` non commité — secrets.)

---

### Task 2: Proxy — routes `/api/photo` (upload + serve) + client MinIO

**Files:**
- Modify: `server/proxy.mjs`
- Modify: `server/proxy.test.mjs`

**Interfaces:**
- Consumes: `minio` (import dynamique), `cfg` MinIO.
- Produces: `POST /api/photo` → `{ data: { key } }` ; `GET /api/photo?key=` → stream. `createHandler` accepte `minioClient` (injectable pour tests).

- [ ] **Step 1: Écrire les tests (fake client MinIO, node:test — helpers `mockRes`/`mockReq` existants)**

Ajouter à la fin de `server/proxy.test.mjs` :

```js
import { Readable } from "node:stream";

test("photo upload: POST /api/photo -> putObject + { data: { key } }", async () => {
  let put = null;
  const minioClient = {
    bucketExists: async () => true,
    makeBucket: async () => {},
    putObject: async (bucket, key, buf, size, meta) => { put = { bucket, key, size, meta }; },
  };
  const h = createHandler({ cfg: { minioBucket: "perquisitions" }, minioClient });
  const res = mockRes();
  await h(mockReq("POST", "/api/photo", JSON.stringify({ imageBase64: Buffer.from("hello").toString("base64"), mime: "image/jpeg", filename: "a.jpg" })), res);
  assert.equal(res.code, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.data.key.endsWith(".jpg"));
  assert.equal(put.bucket, "perquisitions");
  assert.equal(put.meta["Content-Type"], "image/jpeg");
  assert.equal(put.size, 5); // "hello"
});

test("photo upload: image manquante -> 400", async () => {
  const minioClient = { bucketExists: async () => true, putObject: async () => {} };
  const h = createHandler({ cfg: {}, minioClient });
  const res = mockRes();
  await h(mockReq("POST", "/api/photo", JSON.stringify({})), res);
  assert.equal(res.code, 400);
  assert.equal(JSON.parse(res.body).error, "IMAGE_REQUISE");
});

test("photo serve: GET /api/photo?key=x -> stream + content-type", async () => {
  const minioClient = {
    statObject: async () => ({ metaData: { "content-type": "image/png" } }),
    getObject: async () => Readable.from([Buffer.from("PNGBYTES")]),
  };
  const h = createHandler({ cfg: {}, minioClient });
  const res = mockRes();
  await h(mockReq("GET", "/api/photo?key=abc.png"), res);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(res.code, 200);
  assert.equal(res.headers["Content-Type"], "image/png");
});

test("photo serve: clé de traversée -> 400", async () => {
  const minioClient = { statObject: async () => ({}), getObject: async () => Readable.from([]) };
  const h = createHandler({ cfg: {}, minioClient });
  const res = mockRes();
  await h(mockReq("GET", "/api/photo?key=../secret"), res);
  assert.equal(res.code, 400);
});
```

NB : `mockRes` doit supporter le `pipe` d'un flux. Si `mockRes().end` n'est pas appelé par `stream.pipe(res)` dans ce mock, adapter `mockRes` pour être un `Writable` minimal OU faire en sorte que `handlePhotoGet` fasse `stream.pipe(res)` (Node appelle `res.write`/`res.end`). Le mock `mockRes` actuel n'a que `writeHead`/`end` : dans le test, ajouter à `mockRes` un `on(){}` et `once(){}` et `emit(){}` no-op et `write(){return true;}` pour satisfaire `pipe`, et considérer le test « stream » validé sur `res.code`/`res.headers` après `writeHead` (le `pipe` écrit ensuite). Garder l'assertion sur le code + le content-type (posés par `writeHead` avant le pipe).

- [ ] **Step 2: Lancer → échec attendu**

Run: `node --test server/proxy.test.mjs`
Expected: FAIL (routes photo absentes).

- [ ] **Step 3: Implémenter dans proxy.mjs**

(a) Import en tête : `import { randomUUID } from "node:crypto";`

(b) Client MinIO (import dynamique, lazy) + helpers — avant `createHandler` :

```js
let _minio;
async function getMinio(cfg) {
  if (_minio) return _minio;
  const { Client } = await import("minio");
  _minio = new Client({
    endPoint: cfg.minioEndpoint || "localhost",
    port: cfg.minioPort || 9000,
    useSSL: !!cfg.minioUseSSL,
    accessKey: cfg.minioAccessKey,
    secretKey: cfg.minioSecretKey,
  });
  return _minio;
}

const EXT_BY_MIME = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/heic": ".heic" };
function extFor(mime, filename) {
  if (mime && EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
  const m = /\.[a-z0-9]+$/i.exec(filename || "");
  return m ? m[0].toLowerCase() : "";
}

async function handlePhotoUpload(req, res, cfg, minio) {
  try {
    const { imageBase64, mime, filename } = JSON.parse((await readBody(req)) || "{}");
    if (!imageBase64 || typeof imageBase64 !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "IMAGE_REQUISE" }));
      return;
    }
    const buf = Buffer.from(imageBase64, "base64");
    const bucket = cfg.minioBucket || "perquisitions";
    if (!(await minio.bucketExists(bucket))) await minio.makeBucket(bucket);
    const key = randomUUID() + extFor(mime, filename);
    await minio.putObject(bucket, key, buf, buf.length, { "Content-Type": mime || "application/octet-stream" });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: { key } }));
  } catch (e) {
    console.error("photo_upload_error", e.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "PHOTO_UPLOAD" }));
  }
}

async function handlePhotoGet(req, res, cfg, minio, url) {
  const key = url.searchParams.get("key") || "";
  if (!key || key.includes("/") || key.includes("..")) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "CLE_INVALIDE" }));
    return;
  }
  const bucket = cfg.minioBucket || "perquisitions";
  try {
    const stat = await minio.statObject(bucket, key);
    const stream = await minio.getObject(bucket, key);
    res.writeHead(200, { "Content-Type": (stat.metaData && stat.metaData["content-type"]) || "application/octet-stream" });
    stream.pipe(res);
  } catch (e) {
    console.error("photo_get_error", e.message);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "PHOTO_INTROUVABLE" }));
  }
}
```

(c) Signature + dispatch : ajouter `minioClient` aux params et router `/api/photo` en tête (après le bloc RGP, AVANT le guard `if (req.method !== "POST")`) :

Remplacer :
```js
export function createHandler({ cfg, run = runWorkflow, identify = runIdentify, fetchImpl = fetch }) {
  return async (req, res) => {
    const url = new URL(req.url, "http://x");
    const rgpKey = `${req.method} ${url.pathname}`;
    if (rgpKey in RGP_ROUTES) {
      return forwardRgp(req, res, cfg, fetchImpl, RGP_ROUTES[rgpKey], url.search);
    }
    if (req.method !== "POST") {
```
par :
```js
export function createHandler({ cfg, run = runWorkflow, identify = runIdentify, fetchImpl = fetch, minioClient }) {
  return async (req, res) => {
    const url = new URL(req.url, "http://x");
    const rgpKey = `${req.method} ${url.pathname}`;
    if (rgpKey in RGP_ROUTES) {
      return forwardRgp(req, res, cfg, fetchImpl, RGP_ROUTES[rgpKey], url.search);
    }
    if (url.pathname === "/api/photo" && (req.method === "POST" || req.method === "GET")) {
      const minio = minioClient || (await getMinio(cfg));
      if (req.method === "POST") return handlePhotoUpload(req, res, cfg, minio);
      return handlePhotoGet(req, res, cfg, minio, url);
    }
    if (req.method !== "POST") {
```

(d) cfg MinIO (bloc de démarrage, après les vars rgp) :
```js
    minioEndpoint: process.env.MINIO_ENDPOINT || "localhost",
    minioPort: Number(process.env.MINIO_PORT ?? 9000),
    minioUseSSL: process.env.MINIO_USE_SSL === "true",
    minioAccessKey: process.env.MINIO_ACCESS_KEY,
    minioSecretKey: process.env.MINIO_SECRET_KEY,
    minioBucket: process.env.MINIO_BUCKET || "perquisitions",
```

(e) Si nécessaire pour le test `pipe`, adapter `mockRes` dans `server/proxy.test.mjs` pour exposer un `write(){ return true; }` et `on/once/emit` no-op (Writable minimal).

- [ ] **Step 4: Lancer → succès**

Run: `node --test server/proxy.test.mjs`
Expected: PASS (tous les tests, dont les 4 photo).

- [ ] **Step 5: Commit**

```bash
git add server/proxy.mjs server/proxy.test.mjs
git commit -m "feat(proxy): routes /api/photo upload+serve (client MinIO, import dynamique)"
```

---

### Task 3: Front — clients photo + `mapObjet`/`ApiObjet`/`apiObjetToDraft`

**Files:**
- Modify: `src/features/saisies/perquisitionApi.ts`
- Modify: `src/features/saisies/perquisitionApi.test.ts`

**Interfaces:**
- Produces: `uploadPhoto(file, fetchImpl?): Promise<string>` (clé), `photoUrl(key): string`. `mapObjet` émet `photo_url: o.photo || undefined`. `ApiObjet.photo_url?: string | null`. `apiObjetToDraft` reporte `photo`.

- [ ] **Step 1: Écrire les tests**

Ajouter à `src/features/saisies/perquisitionApi.test.ts` :

```ts
import { photoUrl, uploadPhoto } from "./perquisitionApi";

describe("photoUrl", () => {
  it("construit l'URL de service encodée", () => {
    expect(photoUrl("a b/c.jpg")).toBe("/api/photo?key=a%20b%2Fc.jpg");
  });
});

describe("uploadPhoto", () => {
  it("poste l'image et retourne la clé", async () => {
    let body: any;
    const fake = async (_u: string, init: any) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ data: { key: "k1.jpg" } }) }; };
    const file = new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" });
    const key = await uploadPhoto(file, fake as any);
    expect(key).toBe("k1.jpg");
    expect(typeof body.imageBase64).toBe("string");
    expect(body.mime).toBe("image/jpeg");
    expect(body.filename).toBe("photo.jpg");
  });
});

describe("apiObjetToDraft photo", () => {
  it("reporte photo_url en photo", () => {
    const api: any = { id: 1, categorie: "DIVERS", champs: [], identifiants: [], photo_url: "k.jpg" };
    expect(apiObjetToDraft(api).photo).toBe("k.jpg");
  });
});
```

(`apiObjetToDraft` est déjà importé dans ce fichier de test.)

- [ ] **Step 2: Lancer → échec attendu**

Run: `npx vitest run src/features/saisies/perquisitionApi.test.ts`
Expected: FAIL — `photoUrl`/`uploadPhoto` absents ; `photo` non reporté.

- [ ] **Step 3: Implémenter**

Dans `src/features/saisies/perquisitionApi.ts` :

(a) `mapObjet` — remplacer `photo_url: undefined,` par :
```ts
    photo_url: o.photo || undefined,
```

(b) `ApiObjet` — ajouter le champ :
```ts
  photo_url?: string | null;
```

(c) `apiObjetToDraft` — ajouter dans l'objet retourné :
```ts
    photo: o.photo_url ?? undefined,
```

(d) Ajouter les clients (fin du fichier) :
```ts
export function photoUrl(key: string): string {
  return "/api/photo?key=" + encodeURIComponent(key);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("LECTURE_FICHIER"));
    r.onload = () => {
      const s = String(r.result);
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.readAsDataURL(file);
  });
}

export async function uploadPhoto(file: File, fetchImpl: typeof fetch = fetch): Promise<string> {
  const imageBase64 = await fileToBase64(file);
  const res = await fetchImpl("/api/photo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, mime: file.type, filename: file.name }),
  });
  const data = await unwrap<{ key: string }>(res, "ERREUR_UPLOAD_PHOTO");
  return data.key;
}
```

- [ ] **Step 4: Lancer → succès + build**

Run: `npx vitest run src/features/saisies/perquisitionApi.test.ts && npm run build`
Expected: PASS ; build réussi.

- [ ] **Step 5: Commit**

```bash
git add src/features/saisies/perquisitionApi.ts src/features/saisies/perquisitionApi.test.ts
git commit -m "feat(saisies): clients uploadPhoto/photoUrl + photo_url dans mapObjet/ApiObjet/apiObjetToDraft"
```

---

### Task 4: Front — upload au valider-tout + vraie photo en édition

**Files:**
- Modify: `src/features/saisies/SaisiesApp.tsx`

**Interfaces:**
- Consumes: `uploadPhoto`, `photoUrl` (Task 3), `BatchIdentify`, `ObjetEditor`, `ObjetCard`.
- Produces: photos uploadées au « valider tout » (clé sur `draft.photo`) ; `ObjetEditor` affiche la vraie photo.

- [ ] **Step 1: Imports**

Compléter l'import `./perquisitionApi` avec `uploadPhoto, photoUrl`.

- [ ] **Step 2: `BatchItem` garde le fichier + upload au valider-tout**

Dans `BatchIdentify` :

(a) Type `BatchItem` : ajouter `file?: File;`.

(b) Dans `addFiles`, conserver le fichier dans l'item (associer `file: arr[i]`) :
```tsx
    const news: BatchItem[] = arr.map((f) => ({ id: nextId(), previewUrl: URL.createObjectURL(f), status: "pending" as const, file: f }));
```

(c) Remplacer l'appel direct `onValiderTout(doneItems.map((it) => it.draft!))` du bouton par un handler qui uploade d'abord :
```tsx
  const [uploading, setUploading] = useState(false);

  async function validerTout() {
    setUploading(true);
    try {
      const drafts = await Promise.all(
        doneItems.map(async (it) => {
          if (it.file) {
            const key = await uploadPhoto(it.file);
            return { ...it.draft!, photo: key };
          }
          return it.draft!;
        })
      );
      onValiderTout(drafts);
    } catch (e) {
      // échec d'upload : ne pas enregistrer, remonter l'erreur via saveState local
      setUploadError((e as Error).message || "Échec de l'upload d'une photo.");
    } finally {
      setUploading(false);
    }
  }
```
Ajouter aussi `const [uploadError, setUploadError] = useState<string | null>(null);`.

(d) Le bouton « Valider tout » : `onClick={validerTout}`, désactivé aussi si `uploading` (`disabled={!peutValider || uploading}` et inclure `uploading` dans l'opacité), et afficher `uploadError` s'il est non nul (près des autres messages, couleur `ERR`, icône `Icon name="error"`). Réinitialiser `uploadError` à null au début de `validerTout` et dans `addFiles`/`addDemo` (via `onDirty` déjà présent — ajouter `setUploadError(null)` dans `addFiles`/`addDemo`).

- [ ] **Step 3: `ObjetEditor` — vraie photo**

Dans `ObjetEditor`, remplacer `previewUrl=""` de l'`ObjetCard` par :
```tsx
      <ObjetCard index={0} draft={draft} previewUrl={draft.photo ? photoUrl(draft.photo) : ""} perquisition={perquisition} onChange={onChange} onRemove={onCancel} />
```

- [ ] **Step 4: Build + tests**

Run: `npm run build && npx vitest run`
Expected: build réussi ; suite verte.

- [ ] **Step 5: Commit**

```bash
git add src/features/saisies/SaisiesApp.tsx
git commit -m "feat(saisies): upload des photos au valider-tout + affichage de la vraie photo en edition"
```

---

### Task 5: Vérification E2E (CONTRÔLEUR)

- [ ] **Step 1: Stack local** : `./scripts/tunnel-rgp.sh` (rgp-api + MinIO), proxy 8787 à jour (`node --env-file=.env server/proxy.mjs`), `npm run dev`.
- [ ] **Step 2:** Créer une perquisition → ajouter une **vraie photo** (import) → attendre l'identification → « Valider tout ».
- [ ] **Step 3:** Vérifier l'upload MinIO : `ssh ovh 'docker exec brunogauville-minio-1 mc ls local/perquisitions'` (un objet présent) ; et en base `SELECT photo_url FROM objet_saisi ORDER BY id DESC LIMIT 1` (clé non nulle).
- [ ] **Step 4:** Rouvrir la perquisition → cliquer l'objet → l'éditeur affiche la vraie photo (chargée via `/api/photo?key=`). Vérifier dans l'onglet réseau que `/api/photo?key=…` renvoie 200 image.
- [ ] **Step 5:** Nettoyage : supprimer la perquisition de test (et optionnellement l'objet MinIO `mc rm`).

---

## Self-Review

**Spec coverage :**
- Proxy client S3 + `POST/GET /api/photo` → Task 2. ✓
- Upload au valider-tout (clé sur draft.photo) → Task 4. ✓
- `mapObjet` émet `photo_url` ; `ApiObjet.photo_url` ; `apiObjetToDraft` reporte photo → Task 3. ✓
- Affichage vraie photo (batch via URL locale, édition via `/api/photo?key=`) → Tasks 3-4. ✓
- Bucket + tunnel MinIO + env → Task 1. ✓
- Backend inchangé (photo_url déjà géré) → aucune tâche backend. ✓
- Hors périmètre (remplacement en édition, presigned, backfill) : non traité. ✓

**Placeholder scan :** aucun TBD ; code complet. Le point `mockRes`/`pipe` (Task 2 Step 1/3e) donne l'adaptation exacte à faire.

**Type consistency :** `uploadPhoto(file, fetchImpl?)` / `photoUrl(key)` cohérents Tasks 3-4. `mapObjet` lit `o.photo` (champ `ObjetSaisi.photo?: string`) ; `apiObjetToDraft` écrit `photo` depuis `ApiObjet.photo_url`. Proxy `handlePhotoUpload`/`handlePhotoGet(req,res,cfg,minio[,url])` cohérents avec le dispatch. `createHandler({…, minioClient})` injectable pour tests.
