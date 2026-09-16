# Éditer un objet déjà enregistré — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cliquer un objet enregistré (sidebar consultation) ouvre une carte éditable (données gauche, « Sans photo » droite) ; modifier (y compris catégorie) et enregistrer via un nouvel endpoint de mise à jour. Increment 1/2 (MinIO = plus tard).

**Architecture:** Backend : refactor DRY `insertChampsIdentifiants` + endpoint `POST /perquisition/objet/update` (remplace champs + recalcule identifiants). Proxy forward. Front : client `updateObjet` + `apiObjetToDraft`, sidebar cliquable, vue d'édition `ObjetEditor` réutilisant `ObjetCard`.

**Tech Stack:** Node http+pg (CommonJS) + `node:test` ; Node ESM proxy ; React+Vite+TS, Vitest.

## Global Constraints

- **INTERDIT : emoji dans le front** (CLAUDE.md). Icônes = composant `Icon` / SVG.
- Gate typecheck+build réel = **`npm run build`** (`tsc -b && vite build`). `npx tsc --noEmit` = NO-OP. `tsconfig.app` a `noUnusedLocals`/`noUnusedParameters` (pas de symbole inutilisé ; une fonction top-level inutilisée EST signalée → l'exporter si non encore branchée).
- rgp-api : enveloppe `{data}` / `{error:{code,message}}` ; `err()` renvoie **toujours HTTP 200**. Conserver.
- Vitest `test.include` = `src/**/*.test.{ts,tsx}`. Lancer : `npx vitest run <fichier>`.
- Déploiement rgp-api : `scp` vers `ovh:/home/brunogauville/rgp-api/` puis `ssh ovh 'cd /home/brunogauville && docker compose up -d --build rgp-api'`. Commandes ssh/scp sensibles au sandbox réseau → si un ssh time out, réexécuter avec le sandbox désactivé.
- Tunnel dev : `./scripts/tunnel-rgp.sh` (port 8080). Creds via `.env` / docker-compose.
- Spec : `docs/superpowers/specs/2026-07-15-editer-objet-enregistre-design.md`.

---

## File Structure

- `server/rgp-api/perquisition.js` (modifié) : extraire `insertChampsIdentifiants`, ajouter `updateObjet`, exporter.
- `server/rgp-api/perquisition.test.js` (modifié) : tests unitaires `updateObjet`.
- `server/rgp-api/server.js` (modifié) : route `POST /perquisition/objet/update`.
- `server/rgp-api/openapi.json` (modifié) : chemin.
- `server/proxy.mjs` (modifié) : `RGP_ROUTES` += update.
- `server/proxy.test.mjs` (modifié) : test forward.
- `src/features/saisies/perquisitionApi.ts` (modifié) : `updateObjet`, `apiObjetToDraft`.
- `src/features/saisies/perquisitionApi.test.ts` (modifié) : tests.
- `src/features/saisies/SaisiesApp.tsx` (modifié) : `PerqSidebar` cliquable, state `editingObjet`, vue `ObjetEditor`.

---

### Task 1: Backend — refactor `insertChampsIdentifiants` + `updateObjet` + tests

**Files:**
- Modify: `server/rgp-api/perquisition.js`
- Modify: `server/rgp-api/perquisition.test.js`

**Interfaces:**
- Consumes: `extractIdentifiants`, `getPerquisition`.
- Produces: `insertChampsIdentifiants(client, objId, categorie, champs): Promise<void>` ; `updateObjet(pool, body): Promise<{code,data?}|{code,error}>`. Exportés.

- [ ] **Step 1: Écrire les tests unitaires (fake pool)**

Ajouter à la fin de `server/rgp-api/perquisition.test.js` :

```js
const { updateObjet } = require('./perquisition');

test('updateObjet : objet_id manquant -> 400', async () => {
  const pool = { connect: async () => { throw new Error('no'); } };
  const out = await updateObjet(pool, { categorie: 'DIVERS', champs: [] });
  assert.equal(out.code, 400);
});

test('updateObjet : categorie manquante -> 400', async () => {
  const pool = { connect: async () => { throw new Error('no'); } };
  const out = await updateObjet(pool, { objet_id: 5, champs: [] });
  assert.equal(out.code, 400);
});

test('updateObjet : objet inexistant -> 404', async () => {
  const client = { query: async () => ({ rows: [] }), release() {} };
  const pool = { connect: async () => client };
  const out = await updateObjet(pool, { objet_id: 999, categorie: 'DIVERS', champs: [] });
  assert.equal(out.code, 404);
  assert.equal(out.error.code, 'not_found');
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `cd server/rgp-api && node --test`
Expected: FAIL — `updateObjet` non exporté.

- [ ] **Step 3: Extraire `insertChampsIdentifiants` et adapter `insertObjets`**

Dans `server/rgp-api/perquisition.js`, AVANT `async function insertObjets`, ajouter :

```js
// Insère les champs + identifiants (extraits) d'un objet déjà créé (client de transaction ouvert).
async function insertChampsIdentifiants(client, objId, categorie, champs) {
  const list = champs || [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    await client.query('INSERT INTO objet_champ (objet_id, cle, libelle, valeur, source, obligatoire, ordre) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [objId, c.cle, c.libelle ?? c.cle, c.valeur ?? null, c.source || null, !!c.obligatoire, i]);
  }
  for (const id of extractIdentifiants(categorie, list))
    await client.query('INSERT INTO objet_identifiant (objet_id, type, valeur, valeur_norm) VALUES ($1,$2,$3,$4)', [objId, id.type, id.valeur, id.valeur_norm]);
}
```

Puis dans `insertObjets`, REMPLACER le bloc qui insère les champs (la boucle `for (let i = 0; i < champs.length; i++) { … objet_champ … }`) ET la boucle des identifiants (`for (const id of extractIdentifiants(o.categorie, champs)) … objet_identifiant …`) par un seul appel :

```js
    await insertChampsIdentifiants(client, objId, o.categorie, champs);
```

(Conserver l'insertion `objet_saisi` au-dessus — `const objId = obj.rows[0].id; const champs = o.champs || [];` reste — et les boucles estimation sources/hypothèses + `categoriesAlternatives` en dessous, INCHANGÉES.)

- [ ] **Step 4: Ajouter `updateObjet`**

Dans `server/rgp-api/perquisition.js`, après `addObjets`, ajouter :

```js
// Met à jour un objet existant : champs et identifiants REMPLACÉS (photo_url et estimation inchangés).
async function updateObjet(pool, body) {
  const oid = parseInt(body.objet_id, 10);
  if (!Number.isInteger(oid)) return { code: 400, error: { code: 'bad_request', message: 'objet_id (entier) requis' } };
  if (!body.categorie) return { code: 400, error: { code: 'bad_request', message: 'categorie requise' } };
  const client = await pool.connect();
  try {
    const ex = await client.query('SELECT perquisition_id FROM objet_saisi WHERE id=$1', [oid]);
    if (!ex.rows.length) return { code: 404, error: { code: 'not_found', message: `Objet ${oid} introuvable` } };
    const perqId = ex.rows[0].perquisition_id;
    await client.query('BEGIN');
    await client.query(
      'UPDATE objet_saisi SET categorie=$1, sous_type=$2, numero_scelle=$3, situation=$4, lieu=$5 WHERE id=$6',
      [body.categorie, body.sous_type || null, body.numero_scelle || null, body.situation || null, body.lieu || null, oid]);
    await client.query('DELETE FROM objet_champ WHERE objet_id=$1', [oid]);
    await client.query('DELETE FROM objet_identifiant WHERE objet_id=$1', [oid]);
    await insertChampsIdentifiants(client, oid, body.categorie, body.champs);
    await client.query('COMMIT');
    return await getPerquisition(client, perqId);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('perq_update_objet_error', e.message);
    return { code: 500, error: { code: 'db_error', message: 'Erreur base de données' } };
  } finally {
    client.release();
  }
}
```

- [ ] **Step 5: Exporter**

Modify `module.exports` pour ajouter `insertChampsIdentifiants, updateObjet` :

```js
module.exports = { normalizeIdent, extractIdentifiants, insertChampsIdentifiants, insertObjets, createPerquisition, addObjets, updateObjet, getPerquisition, listPerquisitions, searchObjets };
```

- [ ] **Step 6: Lancer → succès + syntaxe**

Run: `cd server/rgp-api && node --test && node --check perquisition.js`
Expected: PASS — 8 tests existants + 3 nouveaux (`updateObjet`) ; syntaxe OK.

- [ ] **Step 7: Commit**

```bash
git add server/rgp-api/perquisition.js server/rgp-api/perquisition.test.js
git commit -m "feat(rgp-api): updateObjet (remplace champs+identifiants) + refactor insertChampsIdentifiants + tests"
```

---

### Task 2: Backend — route + proxy forward + openapi

**Files:**
- Modify: `server/rgp-api/server.js`
- Modify: `server/rgp-api/openapi.json`
- Modify: `server/proxy.mjs`
- Modify: `server/proxy.test.mjs`

**Interfaces:**
- Consumes: `perq.updateObjet` (Task 1).
- Produces: endpoint `POST /perquisition/objet/update` ; forward proxy `POST /api/perquisition/objet/update`.

- [ ] **Step 1: Test forward (node:test, style existant du fichier — helpers `mockRes`/`mockReq` déjà présents)**

Ajouter à la fin de `server/proxy.test.mjs` :

```js
test("proxy forward: POST /api/perquisition/objet/update -> /perquisition/objet/update avec Bearer", async () => {
  let captured;
  const fetchImpl = async (u, init) => { captured = { u, init }; return { status: 200, text: async () => JSON.stringify({ data: { id: 1 } }) }; };
  const h = createHandler({ cfg: { rgpApiUrl: "http://x:8080", rgpApiToken: "tok" }, fetchImpl });
  const res = mockRes();
  await h(mockReq("POST", "/api/perquisition/objet/update", JSON.stringify({ objet_id: 1, categorie: "DIVERS", champs: [] })), res);
  assert.equal(captured.u, "http://x:8080/perquisition/objet/update");
  assert.equal(captured.init.headers.Authorization, "Bearer tok");
  assert.equal(res.code, 200);
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `node --test server/proxy.test.mjs`
Expected: FAIL (route non forwardée).

- [ ] **Step 3: Ajouter le forward**

Dans `server/proxy.mjs`, dans `RGP_ROUTES`, ajouter :

```js
  "POST /api/perquisition/objet/update": "/perquisition/objet/update",
```

- [ ] **Step 4: Lancer → succès**

Run: `node --test server/proxy.test.mjs`
Expected: PASS.

- [ ] **Step 5: Ajouter la route dans server.js**

Dans `server/rgp-api/server.js`, à côté des routes perquisition (après `POST /perquisition/objets`), ajouter :

```js
  if (u.pathname === '/perquisition/objet/update' && req.method === 'POST') {
    const body = await readBody(req);
    if (body === null) return err(res, 400, 'bad_request', 'Corps JSON invalide');
    const out = await perq.updateObjet(pool, body);
    if (out.data) return json(res, 200, { data: out.data });
    return err(res, out.code, out.error.code, out.error.message);
  }
```

- [ ] **Step 6: Vérifier syntaxe**

Run: `cd server/rgp-api && node --check server.js`
Expected: aucune sortie.

- [ ] **Step 7: openapi.json**

Ajouter le chemin via python + valider :

```bash
cd /Users/brunogauville/Developpeur/XP-IAka/carte-bdsp
python3 - <<'PY'
import json
p='server/rgp-api/openapi.json'; d=json.load(open(p))
d['paths']['/perquisition/objet/update']={"post":{"tags":["Perquisitions"],"summary":"Mettre à jour un objet saisi existant","operationId":"updateObjet","requestBody":{"required":True,"content":{"application/json":{"schema":{"type":"object","required":["objet_id","categorie"],"properties":{"objet_id":{"type":"integer"},"categorie":{"type":"string"},"sous_type":{"type":"string"},"numero_scelle":{"type":"string"},"situation":{"type":"string"},"lieu":{"type":"string"},"champs":{"type":"array","items":{"type":"object"}}}}}}},"responses":{"200":{"description":"Perquisition à jour (ou erreur {error}).","content":{"application/json":{"schema":{"type":"object","properties":{"data":{"type":"object"},"error":{"type":"object"}}}}}}}}
json.dump(d,open(p,'w'),ensure_ascii=False,indent=1)
print('ok', '/perquisition/objet/update' in d['paths'])
PY
python3 -c "import json;json.load(open('server/rgp-api/openapi.json'));print('valid json')"
```

- [ ] **Step 8: Commit**

```bash
git add server/rgp-api/server.js server/rgp-api/openapi.json server/proxy.mjs server/proxy.test.mjs
git commit -m "feat(rgp-api,proxy): route POST /perquisition/objet/update + forward + openapi"
```

---

### Task 3: Déployer + E2E curl (CONTRÔLEUR)

_Exécutée par le contrôleur (déploiement prod)._

- [ ] **Step 1: Push + rebuild**

```bash
scp server/rgp-api/server.js server/rgp-api/perquisition.js server/rgp-api/openapi.json ovh:/home/brunogauville/rgp-api/
ssh ovh 'cd /home/brunogauville && docker compose up -d --build rgp-api'
```

- [ ] **Step 2: E2E — créer une perquisition + objet, update l'objet, vérifier**

Script node dans le container : créer une perquisition (1 UNA existant) avec un objet catégorie DIVERS + champ `numero`="X1" (→ identifiant NUMERO_SERIE X1) ; récupérer l'`objet_id` ; appeler `POST /perquisition/objet/update` avec `categorie: TRANSPORT`, `champs: [{cle:"nmr_immatriculation",valeur:"AB-999-ZZ",...}]` ; relire et vérifier que l'objet est passé TRANSPORT, que `objet_champ` reflète les nouveaux champs, et que `objet_identifiant` contient IMMATRICULATION AB999ZZ (et plus NUMERO_SERIE X1). Puis DELETE la perquisition de test.

Expected: catégorie mise à jour, champs remplacés, identifiants recalculés (ancien retiré, nouveau présent).

- [ ] **Step 3: Commit (si fix ; sinon rien).**

---

### Task 4: Front — clients `updateObjet` + `apiObjetToDraft`

**Files:**
- Modify: `src/features/saisies/perquisitionApi.ts`
- Modify: `src/features/saisies/perquisitionApi.test.ts`

**Interfaces:**
- Consumes: `mapObjet`, `unwrap`, `ApiObjet`, `PerquisitionDetail`, types.
- Produces:
  - `updateObjet(objetId: number, objet: ObjetSaisi, fetchImpl?): Promise<PerquisitionDetail>`
  - `apiObjetToDraft(o: ApiObjet): ObjetSaisi`

- [ ] **Step 1: Écrire les tests**

Ajouter à `src/features/saisies/perquisitionApi.test.ts` :

```ts
import { updateObjet, apiObjetToDraft } from "./perquisitionApi";
import type { ApiObjet } from "./perquisitionApi";

describe("updateObjet", () => {
  it("poste objet_id + champs mappés et retourne le détail", async () => {
    let body: any;
    const fake = async (_u: string, init: any) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ data: { id: 3, objets: [] } }) }; };
    const objet = { id: "o1", categorie: "TRANSPORT", numeroScelle: "SC1", champs: [] } as any;
    const out = await updateObjet(7, objet, fake as any);
    expect(out.id).toBe(3);
    expect(body.objet_id).toBe(7);
    expect(body.categorie).toBe("TRANSPORT");
    expect(body.numero_scelle).toBe("SC1");
  });
  it("lève sur enveloppe d'erreur", async () => {
    const fake = async () => ({ ok: true, status: 200, json: async () => ({ error: { message: "Objet 7 introuvable" } }) });
    await expect(updateObjet(7, {} as any, fake as any)).rejects.toThrow("introuvable");
  });
});

describe("apiObjetToDraft", () => {
  it("map un ApiObjet vers un ObjetSaisi éditable", () => {
    const api: ApiObjet = {
      id: 42, categorie: "MULTIMEDIA", sous_type: null, numero_scelle: "SC-9", situation: "SAISI_NON_SCELLE", lieu: "Salon",
      champs: [{ cle: "imei", libelle: "IMEI", valeur: "123", source: null, obligatoire: false }],
      identifiants: [{ type: "IMEI", valeur: "123" }],
    };
    const d = apiObjetToDraft(api);
    expect(d.id).toBe("42");
    expect(d.categorie).toBe("MULTIMEDIA");
    expect(d.sousType).toBeUndefined();
    expect(d.numeroScelle).toBe("SC-9");
    expect(d.situation).toBe("SAISI_NON_SCELLE");
    expect(d.champs[0].source).toBe("a_completer"); // source null -> a_completer
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `npx vitest run src/features/saisies/perquisitionApi.test.ts`
Expected: FAIL — fonctions absentes.

- [ ] **Step 3: Implémenter**

Dans `src/features/saisies/perquisitionApi.ts`, ajouter (les imports de types incluent déjà `ObjetSaisi` ; ajouter `SituationScelle`, `CategorieCode`, `SousTypeTransport` depuis `./types` au besoin) :

```ts
export async function updateObjet(
  objetId: number,
  objet: ObjetSaisi,
  fetchImpl: typeof fetch = fetch
): Promise<PerquisitionDetail> {
  const res = await fetchImpl("/api/perquisition/objet/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objet_id: objetId, ...mapObjet(objet) }),
  });
  return unwrap<PerquisitionDetail>(res, "ERREUR_MAJ_OBJET");
}

export function apiObjetToDraft(o: ApiObjet): ObjetSaisi {
  return {
    id: String(o.id),
    categorie: o.categorie as CategorieCode,
    sousType: (o.sous_type as SousTypeTransport) ?? undefined,
    confiance: 1,
    numeroScelle: o.numero_scelle ?? "",
    situation: (o.situation as SituationScelle) ?? "SAISI_SOUS_SCELLE",
    lieu: o.lieu ?? "",
    champs: o.champs.map((c) => ({
      cle: c.cle,
      libelle: c.libelle,
      valeur: c.valeur,
      source: c.source === "deduit" ? "deduit" : "a_completer",
      obligatoire: c.obligatoire,
    })),
  };
}
```

- [ ] **Step 4: Lancer → succès + build**

Run: `npx vitest run src/features/saisies/perquisitionApi.test.ts && npm run build`
Expected: PASS ; build réussi.

- [ ] **Step 5: Commit**

```bash
git add src/features/saisies/perquisitionApi.ts src/features/saisies/perquisitionApi.test.ts
git commit -m "feat(saisies): clients updateObjet + apiObjetToDraft"
```

---

### Task 5: Front — sidebar cliquable + vue d'édition d'objet

**Files:**
- Modify: `src/features/saisies/SaisiesApp.tsx`

**Interfaces:**
- Consumes: `updateObjet`, `apiObjetToDraft` (Task 4), `ObjetCard`, `objetComplet`, `PerqSidebar`.
- Produces: clic objet existant → `ObjetEditor` (ObjetCard + Enregistrer/Annuler) ; sauvegarde via `updateObjet`.

- [ ] **Step 1: Imports**

Dans `src/features/saisies/SaisiesApp.tsx`, compléter l'import de `./perquisitionApi` avec `updateObjet, apiObjetToDraft`.

- [ ] **Step 2: `PerqSidebar` — objets cliquables**

Dans `PerqSidebar`, ajouter la prop `onEditObjet?: (o: ApiObjet) => void;` à la signature et au type. REMPLACER le `<li>` non cliquable :

```tsx
              <li key={o.id} style={{ padding: "8px 12px", border: `1px solid ${BORDER}`, borderRadius: 8, background: "#f6f6fb" }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{CATEGORIES[o.categorie as keyof typeof CATEGORIES]?.libelle ?? o.categorie}{o.numero_scelle ? ` · ${o.numero_scelle}` : ""}</div>
              </li>
```

par :

```tsx
              <li key={o.id}>
                <button
                  onClick={() => onEditObjet?.(o)}
                  style={{ width: "100%", textAlign: "left", padding: "8px 12px", border: `1px solid ${BORDER}`, borderRadius: 8, background: "#f6f6fb", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
                >
                  <Icon name={CATEGORIES[o.categorie as keyof typeof CATEGORIES]?.icon ?? "inventory_2"} size={16} color={BRAND} />
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{CATEGORIES[o.categorie as keyof typeof CATEGORIES]?.libelle ?? o.categorie}{o.numero_scelle ? ` · ${o.numero_scelle}` : ""}</span>
                  <Icon name="edit" size={15} color={MUTED} />
                </button>
              </li>
```

- [ ] **Step 3: `ObjetEditor` (vue d'édition)**

Dans `src/features/saisies/SaisiesApp.tsx`, ajouter (près de `PerqSidebar`) :

```tsx
function ObjetEditor({
  draft,
  perquisition,
  saveState,
  onChange,
  onSave,
  onCancel,
}: {
  draft: ObjetSaisi;
  perquisition: Perquisition;
  saveState: { status: "idle" | "saving" | "ok" | "err"; msg?: string; id?: number };
  onChange: (o: ObjetSaisi) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const complet = objetComplet(draft);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <button style={{ ...btnGhost, padding: "6px 10px", fontSize: 13 }} onClick={onCancel}><Icon name="arrow_back" size={15} /> Annuler</button>
        <h3 style={{ margin: 0, fontSize: 16 }}>Modifier l'objet</h3>
      </div>
      <ObjetCard index={0} draft={draft} previewUrl="" perquisition={perquisition} onChange={onChange} onRemove={onCancel} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
        <button style={{ ...btn, opacity: complet && saveState.status !== "saving" ? 1 : 0.5, cursor: complet ? "pointer" : "not-allowed" }} disabled={!complet || saveState.status === "saving"} onClick={onSave}>
          <Icon name="save" size={16} /> Enregistrer les modifications
        </button>
        {!complet && <span style={{ color: TODO, fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="pending" size={15} /> Complétez l'objet (scellé, lieu, champs obligatoires).</span>}
        {saveState.status === "err" && <span style={{ color: ERR, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="error" size={16} /> {saveState.msg}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `SaisiesApp` — state + handlers + rendu**

Dans `SaisiesApp()` :

(a) State (près des autres) :

```tsx
  const [editingObjet, setEditingObjet] = useState<{ objetId: number; draft: ObjetSaisi } | null>(null);
```

(b) Dans `startCreate` et `openExisting`, ajouter `setEditingObjet(null);`.

(c) Handler d'enregistrement (après `handleValiderTout`) :

```tsx
  async function handleSaveObjetEdit() {
    if (!editingObjet) return;
    if (!objetComplet(editingObjet.draft)) { setSaveState({ status: "err", msg: "Objet incomplet." }); return; }
    setSaveState({ status: "saving" });
    try {
      const refreshed = await updateObjet(editingObjet.objetId, editingObjet.draft);
      setOpened(refreshed);
      setEditingObjet(null);
      setSaveState({ status: "ok", id: refreshed.id });
    } catch (e) {
      setSaveState({ status: "err", msg: (e as Error).message });
    }
  }
```

(d) Rendu : passer `onEditObjet` à `PerqSidebar` (en consultation) et afficher `ObjetEditor` à la place de `BatchIdentify` si `editingObjet` non nul. Remplacer le `return (<div grid> … </div>)` final par :

```tsx
  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", height: "100%", minWidth: 0 }}>
      <PerqSidebar
        perquisition={perquisitionCourante!}
        objetsExistants={enConsult ? opened!.objets : undefined}
        onEditPerq={enConsult ? undefined : () => setEditingPerq(true)}
        onEditObjet={enConsult ? (o) => { setSaveState({ status: "idle" }); setEditingObjet({ objetId: o.id, draft: apiObjetToDraft(o) }); } : undefined}
        onBackToUna={() => setScreen("una")}
      />
      <div style={{ padding: "26px 30px 40px", overflowY: "auto", maxWidth: 1040 }}>
        {editingObjet ? (
          <ObjetEditor
            draft={editingObjet.draft}
            perquisition={perquisitionCourante!}
            saveState={saveState}
            onChange={(o) => setEditingObjet((prev) => (prev ? { ...prev, draft: o } : prev))}
            onSave={handleSaveObjetEdit}
            onCancel={() => setEditingObjet(null)}
          />
        ) : (
          <BatchIdentify
            key={batchKey}
            perquisition={perquisitionCourante!}
            onValiderTout={handleValiderTout}
            saveState={saveState}
            onDirty={() => setSaveState({ status: "idle" })}
          />
        )}
      </div>
    </div>
  );
```

- [ ] **Step 5: Build + tests**

Run: `npm run build && npx vitest run`
Expected: build réussi ; suite verte.

- [ ] **Step 6: Commit**

```bash
git add src/features/saisies/SaisiesApp.tsx
git commit -m "feat(saisies): éditer un objet enregistré (sidebar cliquable + ObjetEditor)"
```

---

### Task 6: Vérification E2E navigateur (CONTRÔLEUR)

- [ ] **Step 1: Stack local** : tunnel actif, proxy 8787 à jour, `npm run dev`.
- [ ] **Step 2:** Choisir un UNA → créer une perquisition → ajouter 1 objet de démo → « Valider tout » (bascule consultation).
- [ ] **Step 3:** Dans la sidebar, cliquer l'objet enregistré → `ObjetEditor` s'ouvre → changer la catégorie (vérifier recalcul des champs) → compléter scellé/lieu → « Enregistrer les modifications » → vérifier que la sidebar reflète la nouvelle catégorie.
- [ ] **Step 4:** Vérifier en base (`objet_saisi.categorie`, `objet_champ`, `objet_identifiant`). Supprimer la perquisition de test.

---

## Self-Review

**Spec coverage :**
- Endpoint update (champs+identifiants remplacés, recalcul) → Tasks 1-3. ✓
- Refactor DRY `insertChampsIdentifiants` → Task 1. ✓
- Proxy forward + openapi → Task 2. ✓
- Clients `updateObjet` + `apiObjetToDraft` (source null→a_completer, sousType absent→undefined) → Task 4. ✓
- Sidebar cliquable + vue d'édition réutilisant `ObjetCard` + catégorie modifiable + blocage incomplet → Task 5. ✓
- Photo « Sans photo » (previewUrl="") → Task 5 (`ObjetEditor`). ✓
- Hors périmètre (MinIO, suppression) : non traité. ✓

**Placeholder scan :** aucun TBD ; code complet fourni. Task 3/6 (contrôleur) décrivent les vérifications ; les commandes exactes de creds sont fournies par le contrôleur au moment de l'exécution (secrets hors repo).

**Type consistency :** `updateObjet(objetId, objet)` / `apiObjetToDraft(o)` cohérents Tasks 4-5. `insertChampsIdentifiants(client, objId, categorie, champs)` / `updateObjet(pool, body)` cohérents backend. `ObjetEditor` props (`draft, perquisition, saveState, onChange, onSave, onCancel`) cohérentes def/appel. `PerqSidebar.onEditObjet?: (o: ApiObjet) => void` cohérent. `ObjetCard` réutilisé avec sa signature existante (`draft, previewUrl, perquisition, index, onChange, onRemove`).
