# Supprimer un objet enregistré — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supprimer un objet enregistré depuis `ObjetEditor` avec confirmation inline : endpoint delete (CASCADE), client, bouton « Supprimer l'objet » → « Confirmer ? Oui / Annuler ».

**Architecture:** Backend `deleteObjet(pool, body)` (404 si absent → DELETE objet_saisi CASCADE → relecture via client). Route `POST /perquisition/objet/delete` + proxy forward. Front : client `deleteObjet`, `ObjetEditor` bouton + confirmation inline, `SaisiesApp` `handleDeleteObjet`.

**Tech Stack:** Node http+pg (CommonJS) + `node:test` ; Node ESM proxy ; React+Vite+TS, Vitest.

## Global Constraints

- **INTERDIT : emoji dans le front** (CLAUDE.md). Icônes = `Icon` / SVG.
- Gate typecheck+build réel = **`npm run build`** (`tsc -b && vite build`). `tsc --noEmit` = NO-OP. `noUnusedLocals`/`noUnusedParameters` ON.
- rgp-api : enveloppe `{data}`/`{error:{code,message}}` ; `err()` renvoie **toujours HTTP 200**. Conserver.
- Vitest `test.include` = `src/**/*.test.{ts,tsx}`. Lancer : `npx vitest run <fichier>`.
- Déploiement rgp-api : `scp` vers `ovh:/home/brunogauville/rgp-api/` puis `ssh ovh 'cd /home/brunogauville && docker compose up -d --build rgp-api'`. ssh/scp sensibles au sandbox réseau → réexécuter sans sandbox si time out.
- FKs sur `objet_saisi` (`objet_champ`/`objet_identifiant`/`objet_estimation_*`/`objet_categorie_alternative`) = `ON DELETE CASCADE`.
- Spec : `docs/superpowers/specs/2026-07-15-supprimer-objet-design.md`.

---

## File Structure

- `server/rgp-api/perquisition.js` (modifié) : `deleteObjet` + export.
- `server/rgp-api/perquisition.test.js` (modifié) : tests `deleteObjet`.
- `server/rgp-api/server.js` (modifié) : route `POST /perquisition/objet/delete`.
- `server/rgp-api/openapi.json` (modifié) : chemin.
- `server/proxy.mjs` (modifié) : `RGP_ROUTES` += delete.
- `server/proxy.test.mjs` (modifié) : test forward.
- `src/features/saisies/perquisitionApi.ts` (modifié) : `deleteObjet`.
- `src/features/saisies/perquisitionApi.test.ts` (modifié) : tests.
- `src/features/saisies/SaisiesApp.tsx` (modifié) : `ObjetEditor` bouton+confirmation, `handleDeleteObjet`.

---

### Task 1: Backend — `deleteObjet` + tests

**Files:**
- Modify: `server/rgp-api/perquisition.js`
- Modify: `server/rgp-api/perquisition.test.js`

**Interfaces:**
- Consumes: `getPerquisition`.
- Produces: `deleteObjet(pool, body): Promise<{code,data?}|{code,error}>`. Exporté.

- [ ] **Step 1: Tests (fake pool)**

Ajouter à la fin de `server/rgp-api/perquisition.test.js` :

```js
const { deleteObjet } = require('./perquisition');

test('deleteObjet : objet_id manquant -> 400', async () => {
  const pool = { connect: async () => { throw new Error('no'); } };
  const out = await deleteObjet(pool, {});
  assert.equal(out.code, 400);
});

test('deleteObjet : objet inexistant -> 404', async () => {
  const client = { query: async () => ({ rows: [] }), release() {} };
  const pool = { connect: async () => client };
  const out = await deleteObjet(pool, { objet_id: 999 });
  assert.equal(out.code, 404);
  assert.equal(out.error.code, 'not_found');
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd server/rgp-api && node --test`
Expected: FAIL — `deleteObjet` non exporté.

- [ ] **Step 3: Implémenter**

Dans `server/rgp-api/perquisition.js`, après `updateObjet`, ajouter :

```js
// Supprime un objet existant (le CASCADE retire champs/identifiants/estimation/alternatives).
async function deleteObjet(pool, body) {
  const oid = parseInt(body.objet_id, 10);
  if (!Number.isInteger(oid)) return { code: 400, error: { code: 'bad_request', message: 'objet_id (entier) requis' } };
  const client = await pool.connect();
  try {
    const ex = await client.query('SELECT perquisition_id FROM objet_saisi WHERE id=$1', [oid]);
    if (!ex.rows.length) return { code: 404, error: { code: 'not_found', message: `Objet ${oid} introuvable` } };
    const perqId = ex.rows[0].perquisition_id;
    await client.query('DELETE FROM objet_saisi WHERE id=$1', [oid]);
    return await getPerquisition(client, perqId);
  } catch (e) {
    console.error('perq_delete_objet_error', e.message);
    return { code: 500, error: { code: 'db_error', message: 'Erreur base de données' } };
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Exporter**

Modify `module.exports` — ajouter `deleteObjet` (garder tous les exports existants) :

```js
module.exports = { normalizeIdent, extractIdentifiants, insertChampsIdentifiants, insertObjets, createPerquisition, addObjets, updateObjet, deleteObjet, getPerquisition, listPerquisitions, searchObjets };
```

- [ ] **Step 5: Lancer → succès + syntaxe**

Run: `cd server/rgp-api && node --test && node --check perquisition.js`
Expected: PASS (11 existants + 2 nouveaux `deleteObjet`) ; syntaxe OK.

- [ ] **Step 6: Commit**

```bash
git add server/rgp-api/perquisition.js server/rgp-api/perquisition.test.js
git commit -m "feat(rgp-api): deleteObjet (suppression + CASCADE) + tests"
```

---

### Task 2: Backend — route + proxy forward + openapi

**Files:**
- Modify: `server/rgp-api/server.js`
- Modify: `server/rgp-api/openapi.json`
- Modify: `server/proxy.mjs`
- Modify: `server/proxy.test.mjs`

**Interfaces:**
- Consumes: `perq.deleteObjet`.
- Produces: `POST /perquisition/objet/delete` ; forward proxy `POST /api/perquisition/objet/delete`.

- [ ] **Step 1: Test forward (node:test, helpers existants)**

Ajouter à la fin de `server/proxy.test.mjs` :

```js
test("proxy forward: POST /api/perquisition/objet/delete -> /perquisition/objet/delete avec Bearer", async () => {
  let captured;
  const fetchImpl = async (u, init) => { captured = { u, init }; return { status: 200, text: async () => JSON.stringify({ data: { id: 1 } }) }; };
  const h = createHandler({ cfg: { rgpApiUrl: "http://x:8080", rgpApiToken: "tok" }, fetchImpl });
  const res = mockRes();
  await h(mockReq("POST", "/api/perquisition/objet/delete", JSON.stringify({ objet_id: 1 })), res);
  assert.equal(captured.u, "http://x:8080/perquisition/objet/delete");
  assert.equal(captured.init.headers.Authorization, "Bearer tok");
  assert.equal(res.code, 200);
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `node --test server/proxy.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Forward**

Dans `server/proxy.mjs`, `RGP_ROUTES`, ajouter :

```js
  "POST /api/perquisition/objet/delete": "/perquisition/objet/delete",
```

- [ ] **Step 4: Lancer → succès**

Run: `node --test server/proxy.test.mjs`
Expected: PASS.

- [ ] **Step 5: Route server.js**

Dans `server/rgp-api/server.js`, après la route `POST /perquisition/objet/update`, ajouter :

```js
  if (u.pathname === '/perquisition/objet/delete' && req.method === 'POST') {
    const body = await readBody(req);
    if (body === null) return err(res, 400, 'bad_request', 'Corps JSON invalide');
    const out = await perq.deleteObjet(pool, body);
    if (out.data) return json(res, 200, { data: out.data });
    return err(res, out.code, out.error.code, out.error.message);
  }
```

- [ ] **Step 6: Syntaxe**

Run: `cd server/rgp-api && node --check server.js`
Expected: aucune sortie.

- [ ] **Step 7: openapi.json**

```bash
cd /Users/brunogauville/Developpeur/XP-IAka/carte-bdsp
python3 - <<'PY'
import json
p='server/rgp-api/openapi.json'; d=json.load(open(p))
d['paths']['/perquisition/objet/delete']={"post":{"tags":["Perquisitions"],"summary":"Supprimer un objet saisi","operationId":"deleteObjet","requestBody":{"required":True,"content":{"application/json":{"schema":{"type":"object","required":["objet_id"],"properties":{"objet_id":{"type":"integer"}}}}}},"responses":{"200":{"description":"Perquisition à jour (ou erreur {error}).","content":{"application/json":{"schema":{"type":"object","properties":{"data":{"type":"object"},"error":{"type":"object"}}}}}}}}
json.dump(d,open(p,'w'),ensure_ascii=False,indent=1)
print('ok', '/perquisition/objet/delete' in d['paths'])
PY
python3 -c "import json;json.load(open('server/rgp-api/openapi.json'));print('valid json')"
```
(Si le heredoc échoue, écrire le snippet dans un fichier .py temporaire et l'exécuter ; JSON identique.)

- [ ] **Step 8: Commit**

```bash
git add server/rgp-api/server.js server/rgp-api/openapi.json server/proxy.mjs server/proxy.test.mjs
git commit -m "feat(rgp-api,proxy): route POST /perquisition/objet/delete + forward + openapi"
```

---

### Task 3: Déployer + E2E curl (CONTRÔLEUR)

- [ ] **Step 1: Push + rebuild**

```bash
scp server/rgp-api/server.js server/rgp-api/perquisition.js server/rgp-api/openapi.json ovh:/home/brunogauville/rgp-api/
ssh ovh 'cd /home/brunogauville && docker compose up -d --build rgp-api'
```

- [ ] **Step 2: E2E** — script node dans le container : créer une perquisition avec 2 objets ; supprimer un objet via `POST /perquisition/objet/delete` ; relire et vérifier qu'il reste 1 objet ; vérifier en base que `objet_champ`/`objet_identifiant` de l'objet supprimé n'existent plus (CASCADE). Puis DELETE la perquisition de test.
Expected: 2 → 1 objet ; enfants supprimés en CASCADE.

- [ ] **Step 3: Commit (si fix ; sinon rien).**

---

### Task 4: Front — client `deleteObjet`

**Files:**
- Modify: `src/features/saisies/perquisitionApi.ts`
- Modify: `src/features/saisies/perquisitionApi.test.ts`

**Interfaces:**
- Produces: `deleteObjet(objetId: number, fetchImpl?): Promise<PerquisitionDetail>`.

- [ ] **Step 1: Tests**

Ajouter à `src/features/saisies/perquisitionApi.test.ts` :

```ts
import { deleteObjet } from "./perquisitionApi";

describe("deleteObjet", () => {
  it("poste objet_id et retourne le détail", async () => {
    let body: any;
    const fake = async (_u: string, init: any) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ data: { id: 3, objets: [] } }) }; };
    const out = await deleteObjet(42, fake as any);
    expect(out.id).toBe(3);
    expect(body.objet_id).toBe(42);
  });
  it("lève sur enveloppe d'erreur", async () => {
    const fake = async () => ({ ok: true, status: 200, json: async () => ({ error: { message: "Objet 42 introuvable" } }) });
    await expect(deleteObjet(42, fake as any)).rejects.toThrow("introuvable");
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `npx vitest run src/features/saisies/perquisitionApi.test.ts`
Expected: FAIL — `deleteObjet` absent.

- [ ] **Step 3: Implémenter**

Dans `src/features/saisies/perquisitionApi.ts`, ajouter (à côté de `updateObjet`) :

```ts
export async function deleteObjet(
  objetId: number,
  fetchImpl: typeof fetch = fetch
): Promise<PerquisitionDetail> {
  const res = await fetchImpl("/api/perquisition/objet/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objet_id: objetId }),
  });
  return unwrap<PerquisitionDetail>(res, "ERREUR_SUPPRESSION_OBJET");
}
```

- [ ] **Step 4: Lancer → succès + build**

Run: `npx vitest run src/features/saisies/perquisitionApi.test.ts && npm run build`
Expected: PASS ; build réussi.

- [ ] **Step 5: Commit**

```bash
git add src/features/saisies/perquisitionApi.ts src/features/saisies/perquisitionApi.test.ts
git commit -m "feat(saisies): client deleteObjet"
```

---

### Task 5: Front — bouton « Supprimer l'objet » + confirmation inline

**Files:**
- Modify: `src/features/saisies/SaisiesApp.tsx`

**Interfaces:**
- Consumes: `deleteObjet` (Task 4), `ObjetEditor`.
- Produces: bouton supprimer + confirmation inline dans `ObjetEditor` ; `handleDeleteObjet` dans `SaisiesApp`.

- [ ] **Step 1: Import**

Compléter l'import `./perquisitionApi` avec `deleteObjet`.

- [ ] **Step 2: `ObjetEditor` — prop `onDelete` + confirmation inline**

Dans `ObjetEditor` :

(a) Ajouter `onDelete` à la signature et au type :
```tsx
  onDelete,
```
```tsx
  onDelete: () => void;
```

(b) État local (dans le corps, avant `return`) :
```tsx
  const [confirming, setConfirming] = useState(false);
```

(c) Dans la barre d'action (le `<div>` contenant le bouton « Enregistrer les modifications »), ajouter à la fin, après le message d'erreur :
```tsx
        {!confirming ? (
          <button style={{ ...btnGhost, marginLeft: "auto", color: ERR, borderColor: ERR }} onClick={() => setConfirming(true)}>
            <Icon name="delete" size={16} /> Supprimer l'objet
          </button>
        ) : (
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: ERR, fontSize: 13 }}>Confirmer la suppression ?</span>
            <button style={{ ...btn, background: ERR, borderColor: ERR }} disabled={saveState.status === "saving"} onClick={onDelete}>
              <Icon name="delete" size={16} /> Oui, supprimer
            </button>
            <button style={{ ...btnGhost, padding: "8px 12px" }} onClick={() => setConfirming(false)}>Annuler</button>
          </span>
        )}
```

- [ ] **Step 3: `SaisiesApp` — handler + câblage**

Dans `SaisiesApp()` :

(a) Handler (après `handleSaveObjetEdit`) :
```tsx
  async function handleDeleteObjet() {
    if (!editingObjet) return;
    setSaveState({ status: "saving" });
    try {
      const refreshed = await deleteObjet(editingObjet.objetId);
      setOpened(refreshed);
      setEditingObjet(null);
      setSaveState({ status: "ok", id: refreshed.id });
    } catch (e) {
      setSaveState({ status: "err", msg: (e as Error).message });
    }
  }
```

(b) Passer `onDelete` au rendu `<ObjetEditor …>` :
```tsx
            onDelete={handleDeleteObjet}
```

- [ ] **Step 4: Build + tests**

Run: `npm run build && npx vitest run`
Expected: build réussi ; suite verte.

- [ ] **Step 5: Commit**

```bash
git add src/features/saisies/SaisiesApp.tsx
git commit -m "feat(saisies): bouton Supprimer l'objet avec confirmation inline"
```

---

### Task 6: Vérification E2E navigateur (CONTRÔLEUR)

- [ ] **Step 1: Stack local** (tunnel, proxy 8787 à jour, `npm run dev`).
- [ ] **Step 2:** Perquisition avec ≥ 2 objets → cliquer un objet → « Supprimer l'objet » → « Confirmer ? » → « Oui, supprimer ».
- [ ] **Step 3:** Vérifier que l'objet disparaît de la sidebar (nb objets décrémenté) et retour à `BatchIdentify`. En base : `SELECT count(*) FROM objet_saisi WHERE perquisition_id=…`.
- [ ] **Step 4:** Nettoyage (supprimer la perquisition de test).

---

## Self-Review

**Spec coverage :**
- Endpoint delete (CASCADE, relecture via client) → Tasks 1-3. ✓
- Proxy forward + openapi → Task 2. ✓
- Client `deleteObjet` → Task 4. ✓
- Bouton + confirmation inline dans l'éditeur → Task 5. ✓
- Hors périmètre (bulk, suppression depuis sidebar sans éditeur, purge blob MinIO) : non traité. ✓

**Placeholder scan :** aucun TBD ; code complet.

**Type consistency :** `deleteObjet(objetId)` cohérent Tasks 4-5. `deleteObjet(pool, body)` backend. `ObjetEditor` prop `onDelete: () => void` cohérente def/appel. `handleDeleteObjet` = `onDelete`.
