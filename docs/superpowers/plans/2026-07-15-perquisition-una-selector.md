# Sélection UNA existant + rouvrir perquisition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Front UNA-first : choisir un UNA existant → voir ses perquisitions → en créer une (formulaire recyclé) ou en rouvrir une en consultation avec ajout de nouveaux objets.

**Architecture:** Backend : refactor DRY (`insertObjets`) + endpoint `POST /perquisition/objets`. Proxy : nouveau forward. Front : machine à états `screen` (home/una/perq) dans `SaisiesApp`, 2 nouveaux écrans (`UnaPicker`, `UnaScreen`), `SetupScreen`/`Inventory` adaptés, clients `listProcedures`/`listPerquisitions`/`getPerquisition`/`addObjets`.

**Tech Stack:** Node http+pg (CommonJS) pour rgp-api, `node:test` ; Node ESM proxy ; React+Vite+TS front, Vitest.

## Global Constraints

- **INTERDIT : emoji dans le front** (CLAUDE.md). Icônes = composant `Icon` (Material Icons) ou SVG.
- rgp-api : enveloppe `{ data }` / `{ error:{ code, message } }`. `err()` renvoie **toujours HTTP 200**. Conserver.
- Clients front : signature `fetchImpl: typeof fetch = fetch` injectable ; gérer l'enveloppe HTTP-200-`{error}` (ne pas se fier à `res.ok` seul), comme `savePerquisition`.
- Base `rgp` en ligne (OVH), app en local. Déploiement rgp-api : `scp` vers `ovh:/home/brunogauville/rgp-api/` puis `ssh ovh 'cd /home/brunogauville && docker compose up -d --build rgp-api'`. Creds via `.env` / docker-compose (jamais en clair dans le repo).
- Tunnel dev : `./scripts/tunnel-rgp.sh` (port 8080). Proxy lit `RGP_API_URL`/`RGP_API_TOKEN`.
- Spec : `docs/superpowers/specs/2026-07-15-perquisition-una-selector-design.md`.

---

## File Structure

- `server/rgp-api/perquisition.js` (modifié) : extraire `insertObjets`, ajouter `addObjets`, exporter.
- `server/rgp-api/perquisition.test.js` (modifié) : tests unitaires `addObjets` (fake pool).
- `server/rgp-api/server.js` (modifié) : route `POST /perquisition/objets`.
- `server/rgp-api/openapi.json` (modifié) : chemin `/perquisition/objets`.
- `server/proxy.mjs` (modifié) : `RGP_ROUTES` += `POST /api/perquisition/objets`.
- `server/proxy.test.mjs` (modifié) : test du nouveau forward.
- `src/features/saisies/perquisitionApi.ts` (modifié) : `mapObjet`, `listProcedures`, `listPerquisitions`, `getPerquisition`, `addObjets` + types.
- `src/features/saisies/perquisitionApi.test.ts` (modifié) : tests des nouveaux clients.
- `src/features/saisies/UnaPicker.tsx` (nouveau).
- `src/features/saisies/UnaScreen.tsx` (nouveau).
- `src/features/saisies/SaisiesApp.tsx` (modifié) : navigation + adapts `SetupScreen`/`Inventory`.

---

### Task 1: Backend — refactor `insertObjets` + `addObjets` + tests unitaires

**Files:**
- Modify: `server/rgp-api/perquisition.js`
- Modify: `server/rgp-api/perquisition.test.js`

**Interfaces:**
- Consumes: `extractIdentifiants`, `getPerquisition` (existants).
- Produces: `insertObjets(client, perqId, objets): Promise<void>` (helper), `addObjets(pool, body): Promise<{code, data?}|{code, error}>`. Exportés.

- [ ] **Step 1: Écrire les tests unitaires (fake pool, sans DB réelle)**

Ajouter à la fin de `server/rgp-api/perquisition.test.js` (avant rien — append) :

```js
const { addObjets } = require('./perquisition');

test('addObjets : perquisition_id manquant -> 400', async () => {
  const pool = { connect: async () => { throw new Error('should not connect'); } };
  const out = await addObjets(pool, { objets: [{ categorie: 'DIVERS', champs: [] }] });
  assert.equal(out.code, 400);
});

test('addObjets : objets vide -> 400', async () => {
  const pool = { connect: async () => { throw new Error('should not connect'); } };
  const out = await addObjets(pool, { perquisition_id: 5, objets: [] });
  assert.equal(out.code, 400);
});

test('addObjets : perquisition inexistante -> 404', async () => {
  const client = { query: async () => ({ rows: [] }), release() {} };
  const pool = { connect: async () => client };
  const out = await addObjets(pool, { perquisition_id: 999, objets: [{ categorie: 'DIVERS', champs: [] }] });
  assert.equal(out.code, 404);
  assert.equal(out.error.code, 'not_found');
});
```

- [ ] **Step 2: Lancer les tests → échec attendu**

Run: `cd server/rgp-api && node --test`
Expected: FAIL — `addObjets` non exporté / non défini.

- [ ] **Step 3: Extraire `insertObjets` de `createPerquisition`**

Dans `server/rgp-api/perquisition.js`, dans `createPerquisition`, REMPLACER le bloc `for (const o of body.objets) { ... }` (la boucle d'insertion d'objets, qui va de `for (const o of body.objets) {` jusqu'à sa `}` fermante juste avant `await client.query('COMMIT');`) par :

```js
    await insertObjets(client, perqId, body.objets);
```

- [ ] **Step 4: Ajouter `insertObjets` et `addObjets`**

Dans `server/rgp-api/perquisition.js`, AVANT `async function createPerquisition`, ajouter :

```js
// Insère une liste d'objets (+ champs, identifiants, estimation, alternatives) pour une
// perquisition, via un client de transaction déjà ouvert (BEGIN fait par l'appelant).
async function insertObjets(client, perqId, objets) {
  for (const o of objets) {
    const est = o.estimation || {};
    const obj = await client.query(
      `INSERT INTO objet_saisi (perquisition_id, categorie, sous_type, confiance, numero_scelle, situation, lieu, photo_url,
         estim_prix_bas, estim_prix_moyen, estim_prix_haut, estim_devise, estim_confiance, estim_avertissement)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [perqId, o.categorie, o.sous_type || null, o.confiance ?? null, o.numero_scelle || null,
       o.situation || null, o.lieu || null, o.photo_url || null,
       est.prixBas ?? null, est.prixMoyen ?? null, est.prixHaut ?? null, est.devise || null, est.confiance ?? null, est.avertissement || null]);
    const objId = obj.rows[0].id;
    const champs = o.champs || [];
    for (let i = 0; i < champs.length; i++) {
      const c = champs[i];
      await client.query('INSERT INTO objet_champ (objet_id, cle, libelle, valeur, source, obligatoire, ordre) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [objId, c.cle, c.libelle ?? c.cle, c.valeur ?? null, c.source || null, !!c.obligatoire, i]);
    }
    for (const id of extractIdentifiants(o.categorie, champs))
      await client.query('INSERT INTO objet_identifiant (objet_id, type, valeur, valeur_norm) VALUES ($1,$2,$3,$4)', [objId, id.type, id.valeur, id.valeur_norm]);
    const sources = est.sources || [];
    for (let i = 0; i < sources.length; i++)
      await client.query('INSERT INTO objet_estimation_source (objet_id, site, url, prix, ordre) VALUES ($1,$2,$3,$4,$5)', [objId, sources[i].site || null, sources[i].url || null, sources[i].prix ?? null, i]);
    const hyps = est.hypotheses || [];
    for (let i = 0; i < hyps.length; i++)
      await client.query('INSERT INTO objet_estimation_hypothese (objet_id, texte, ordre) VALUES ($1,$2,$3)', [objId, String(hyps[i]), i]);
    for (const a of (o.categoriesAlternatives || []))
      await client.query('INSERT INTO objet_categorie_alternative (objet_id, categorie, confiance) VALUES ($1,$2,$3)', [objId, a.categorie, a.confiance ?? null]);
  }
}

// Ajoute des objets à une perquisition existante (transaction dédiée).
async function addObjets(pool, body) {
  const pid = parseInt(body.perquisition_id, 10);
  if (!Number.isInteger(pid)) return { code: 400, error: { code: 'bad_request', message: 'perquisition_id (entier) requis' } };
  if (!Array.isArray(body.objets) || body.objets.length === 0) return { code: 400, error: { code: 'bad_request', message: 'objets[] non vide requis' } };
  const client = await pool.connect();
  try {
    const ex = await client.query('SELECT id FROM perquisition WHERE id=$1', [pid]);
    if (!ex.rows.length) return { code: 404, error: { code: 'not_found', message: `Perquisition ${pid} introuvable` } };
    await client.query('BEGIN');
    await insertObjets(client, pid, body.objets);
    await client.query('COMMIT');
    return await getPerquisition(client, pid);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('perq_add_error', e.message);
    return { code: 500, error: { code: 'db_error', message: 'Erreur base de données' } };
  } finally {
    client.release();
  }
}
```

- [ ] **Step 5: Exporter les nouvelles fonctions**

Dans `server/rgp-api/perquisition.js`, à la ligne `module.exports = { ... }`, ajouter `insertObjets, addObjets` :

```js
module.exports = { normalizeIdent, extractIdentifiants, insertObjets, createPerquisition, addObjets, getPerquisition, listPerquisitions, searchObjets };
```

- [ ] **Step 6: Lancer les tests → succès attendu**

Run: `cd server/rgp-api && node --test`
Expected: PASS — les 5 tests existants (identifiants) + 3 nouveaux (addObjets) OK, et `node --check perquisition.js` sans erreur.

- [ ] **Step 7: Commit**

```bash
git add server/rgp-api/perquisition.js server/rgp-api/perquisition.test.js
git commit -m "feat(rgp-api): insertObjets (refactor DRY) + addObjets (ajout à perquisition existante) + tests"
```

---

### Task 2: Backend — route `POST /perquisition/objets` + proxy forward + openapi

**Files:**
- Modify: `server/rgp-api/server.js`
- Modify: `server/rgp-api/openapi.json`
- Modify: `server/proxy.mjs`
- Modify: `server/proxy.test.mjs`

**Interfaces:**
- Consumes: `perq.addObjets` (Task 1).
- Produces: endpoint HTTP `POST /perquisition/objets` ; forward proxy `POST /api/perquisition/objets`.

- [ ] **Step 1: Écrire le test du forward proxy**

Ajouter à la fin de `server/proxy.test.mjs` (les tests y sont en `node:test` — suivre le style existant du fichier : `import { test } from "node:test"; import assert from "node:assert";` en tête sont déjà présents ; réutiliser les helpers `mockRes`/`mockReq` déjà définis dans le fichier) :

```js
test("proxy forward: POST /api/perquisition/objets -> /perquisition/objets avec Bearer", async () => {
  let captured;
  const fetchImpl = async (u, init) => { captured = { u, init }; return { status: 200, text: async () => JSON.stringify({ data: { id: 1 } }) }; };
  const h = createHandler({ cfg: { rgpApiUrl: "http://x:8080", rgpApiToken: "tok" }, fetchImpl });
  const res = mockRes();
  await h(mockReq("POST", "/api/perquisition/objets", JSON.stringify({ perquisition_id: 1, objets: [] })), res);
  assert.equal(captured.u, "http://x:8080/perquisition/objets");
  assert.equal(captured.init.headers.Authorization, "Bearer tok");
  assert.equal(res.code, 200);
});
```

(Si le fichier utilise `describe/it` de vitest au lieu de `node:test`, adapte : le fichier `server/proxy.test.mjs` a été écrit en `node:test` avec `test(...)` — vérifie l'entête et réutilise le même style et les helpers déjà présents.)

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `node --test server/proxy.test.mjs`
Expected: FAIL — route non forwardée (`captured` undefined → assertion échoue).

- [ ] **Step 3: Ajouter le forward dans proxy.mjs**

Dans `server/proxy.mjs`, dans l'objet `RGP_ROUTES`, ajouter l'entrée :

```js
  "POST /api/perquisition/objets": "/perquisition/objets",
```

- [ ] **Step 4: Lancer le test → succès attendu**

Run: `node --test server/proxy.test.mjs`
Expected: PASS (tous les tests du fichier).

- [ ] **Step 5: Ajouter la route dans server.js**

Dans `server/rgp-api/server.js`, à côté des routes perquisition existantes (après le bloc `POST /perquisition`), ajouter :

```js
  if (u.pathname === '/perquisition/objets' && req.method === 'POST') {
    const body = await readBody(req);
    if (body === null) return err(res, 400, 'bad_request', 'Corps JSON invalide');
    const out = await perq.addObjets(pool, body);
    if (out.data) return json(res, 200, { data: out.data });
    return err(res, out.code, out.error.code, out.error.message);
  }
```

IMPORTANT : placer ce bloc AVANT le bloc `if (u.pathname === '/perquisition' && ...)` n'est pas nécessaire (pathname différent), mais garder tous ces blocs APRÈS le bloc d'auth token.

- [ ] **Step 6: Vérifier syntaxe**

Run: `cd server/rgp-api && node --check server.js`
Expected: aucune sortie.

- [ ] **Step 7: Mettre à jour openapi.json**

Modify `server/rgp-api/openapi.json` — ajouter sous `paths` la clé `"/perquisition/objets"` avec un `post` (tag `Perquisitions`, `requestBody` `{ perquisition_id:int, objets:[...] }`, réponse enveloppe `{data}`/`{error}`), en suivant le style des entrées existantes. Utiliser python pour éditer + valider le JSON :

```bash
python3 - <<'PY'
import json
p='server/rgp-api/openapi.json'; d=json.load(open(p))
d['paths']['/perquisition/objets']={"post":{"tags":["Perquisitions"],"summary":"Ajouter des objets à une perquisition existante","operationId":"addObjets","requestBody":{"required":True,"content":{"application/json":{"schema":{"type":"object","required":["perquisition_id","objets"],"properties":{"perquisition_id":{"type":"integer"},"objets":{"type":"array","items":{"type":"object"}}}}}}},"responses":{"200":{"description":"Perquisition à jour (ou erreur en enveloppe {error}).","content":{"application/json":{"schema":{"type":"object","properties":{"data":{"type":"object"},"error":{"type":"object"}}}}}}}}
json.dump(d,open(p,'w'),ensure_ascii=False,indent=1)
print('ok', '/perquisition/objets' in d['paths'])
PY
python3 -c "import json;json.load(open('server/rgp-api/openapi.json'));print('valid json')"
```

- [ ] **Step 8: Commit**

```bash
git add server/rgp-api/server.js server/rgp-api/openapi.json server/proxy.mjs server/proxy.test.mjs
git commit -m "feat(rgp-api,proxy): route POST /perquisition/objets + forward + openapi"
```

---

### Task 3: Déployer + E2E curl (CONTRÔLEUR — mutation OVH)

**Files:** (déploiement — aucune modif repo hors éventuel fix)

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: rgp-api en ligne servant `POST /perquisition/objets`. Vérifie le round-trip réel.

_Note controller : cette tâche est exécutée par le contrôleur (déploiement prod), pas un subagent implémenteur._

- [ ] **Step 1: Push + rebuild**

```bash
scp server/rgp-api/server.js server/rgp-api/perquisition.js server/rgp-api/openapi.json ovh:/home/brunogauville/rgp-api/
ssh ovh 'cd /home/brunogauville && docker compose up -d --build rgp-api'
```

- [ ] **Step 2: Créer une perquisition support, puis ajouter un objet dessus, vérifier, nettoyer**

Utiliser le token via l'env du container (ne pas coller le token en clair dans le repo). Exécuter un script node dans le container qui : crée une perquisition (1 UNA existant), appelle `POST /perquisition/objets` pour ajouter un 2e objet, relit, et affiche le nombre d'objets. Puis DELETE la perquisition de test via psql. Vérifier que le retour de `/perquisition/objets` contient bien 2 objets (l'initial + l'ajouté) et que l'identifiant du nouvel objet est extrait.

Expected: la perquisition à jour renvoyée par `/perquisition/objets` liste 2 objets ; cleanup `DELETE 1`.

- [ ] **Step 3: Commit (le cas échéant, si un fix a été nécessaire ; sinon rien)**

Aucun commit si le déploiement passe sans modification.

---

### Task 4: Front — clients `listProcedures`/`listPerquisitions`/`getPerquisition`/`addObjets`

**Files:**
- Modify: `src/features/saisies/perquisitionApi.ts`
- Modify: `src/features/saisies/perquisitionApi.test.ts`

**Interfaces:**
- Consumes: types `ObjetSaisi` ; endpoints proxy.
- Produces:
  - `mapObjet(o: ObjetSaisi): ObjetPayload` (extrait de `buildPerquisitionPayload`)
  - `Procedure`, `PerquisitionSummary`, `ApiObjet`, `PerquisitionDetail` (types exportés)
  - `listProcedures(params?, fetchImpl?): Promise<Procedure[]>`
  - `listPerquisitions(una, fetchImpl?): Promise<PerquisitionSummary[]>`
  - `getPerquisition(id, fetchImpl?): Promise<PerquisitionDetail>`
  - `addObjets(perquisitionId, objets, fetchImpl?): Promise<{ id: number }>`

- [ ] **Step 1: Écrire les tests**

Ajouter à `src/features/saisies/perquisitionApi.test.ts` :

```ts
import { listProcedures, listPerquisitions, getPerquisition, addObjets } from "./perquisitionApi";

describe("listProcedures", () => {
  it("retourne la liste sur succès", async () => {
    const fake = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ una: "1/2/2024", type: "PVEJ" }] }) });
    const out = await listProcedures({}, fake as any);
    expect(out[0].una).toBe("1/2/2024");
  });
  it("passe les filtres en query", async () => {
    let url = "";
    const fake = async (u: string) => { url = u; return { ok: true, status: 200, json: async () => ({ data: [] }) }; };
    await listProcedures({ annee: "2024", unite: "15127" }, fake as any);
    expect(url).toContain("annee=2024");
    expect(url).toContain("unite=15127");
  });
});

describe("listPerquisitions", () => {
  it("retourne les perquisitions d'un UNA", async () => {
    const fake = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 3, adresse: "1 rue", nb_objets: 2 }] }) });
    const out = await listPerquisitions("1/2/2024", fake as any);
    expect(out[0].id).toBe(3);
  });
});

describe("getPerquisition", () => {
  it("retourne le détail", async () => {
    const fake = async () => ({ ok: true, status: 200, json: async () => ({ data: { id: 3, una: "1/2/2024", objets: [] } }) });
    const out = await getPerquisition(3, fake as any);
    expect(out.id).toBe(3);
  });
});

describe("addObjets", () => {
  it("poste les objets mappés et retourne l'id", async () => {
    let body: any;
    const fake = async (_u: string, init: any) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ data: { id: 9 } }) }; };
    const objet = { id: "o1", categorie: "DIVERS", numeroScelle: "SC1", champs: [] } as any;
    const out = await addObjets(9, [objet], fake as any);
    expect(out).toEqual({ id: 9 });
    expect(body.perquisition_id).toBe(9);
    expect(body.objets[0].categorie).toBe("DIVERS");
    expect(body.objets[0].numero_scelle).toBe("SC1");
  });
  it("lève sur enveloppe d'erreur", async () => {
    const fake = async () => ({ ok: true, status: 200, json: async () => ({ error: { message: "Perquisition 9 introuvable" } }) });
    await expect(addObjets(9, [], fake as any)).rejects.toThrow("introuvable");
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `npx vitest run src/features/saisies/perquisitionApi.test.ts`
Expected: FAIL — fonctions non exportées.

- [ ] **Step 3: Refactor `mapObjet` + implémenter les clients**

Dans `src/features/saisies/perquisitionApi.ts` :

(a) Extraire `mapObjet` — remplacer, dans `buildPerquisitionPayload`, `objets: objets.map((o) => ({ ... }))` par `objets: objets.map(mapObjet)`, et ajouter la fonction :

```ts
export function mapObjet(o: ObjetSaisi): ObjetPayload {
  return {
    categorie: o.categorie,
    sous_type: o.sousType,
    confiance: o.confiance,
    numero_scelle: o.numeroScelle || undefined,
    situation: o.situation,
    lieu: o.lieu || undefined,
    photo_url: undefined,
    estimation: o.estimationPrix,
    champs: o.champs.map((c) => ({ cle: c.cle, libelle: c.libelle, valeur: c.valeur, source: c.source, obligatoire: c.obligatoire })),
    categoriesAlternatives: o.categoriesAlternatives,
  };
}
```

(b) Ajouter les types et clients à la fin du fichier :

```ts
export interface Procedure {
  una: string;
  unite?: number;
  numero?: number;
  annee?: number;
  type?: string;             // type_libelle côté API (alias possible: type_libelle)
  type_libelle?: string;
  groupe_libelle?: string;
  synthese?: string;
  commune_libelle?: string;
  urgent?: boolean;
  sensible?: boolean;
}
export interface PerquisitionSummary {
  id: number;
  adresse: string;
  code_postal?: string;
  commune_libelle?: string;
  type_lieu?: string;
  date_debut?: string;
  created_at: string;
  nb_objets: number;
}
export interface ApiObjet {
  id: number;
  categorie: string;
  sous_type?: string | null;
  numero_scelle?: string | null;
  situation?: string | null;
  lieu?: string | null;
  champs: { cle: string; libelle: string; valeur: string | null; source: string | null; obligatoire: boolean }[];
  identifiants: { type: string; valeur: string }[];
}
export interface PerquisitionDetail {
  id: number;
  una: string;
  adresse: string;
  code_postal?: string | null;
  commune_libelle?: string | null;
  type_lieu?: string | null;
  perquisitionne?: string | null;
  opj?: string | null;
  date_debut?: string | null;
  intervenants: string[];
  pieces: string[];
  objets: ApiObjet[];
}

// Déballe l'enveloppe { data } / { error } (HTTP 200 même sur erreur logique).
async function unwrap<T>(res: Response | any, fallbackMsg: string): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) {
    throw new Error(body?.error?.message || body?.error || fallbackMsg);
  }
  return body.data as T;
}

export async function listProcedures(
  params: { annee?: string; unite?: string; limit?: number } = {},
  fetchImpl: typeof fetch = fetch
): Promise<Procedure[]> {
  const q = new URLSearchParams();
  if (params.annee) q.set("annee", params.annee);
  if (params.unite) q.set("unite", params.unite);
  if (params.limit) q.set("limit", String(params.limit));
  const res = await fetchImpl("/api/procedures" + (q.toString() ? "?" + q.toString() : ""));
  return unwrap<Procedure[]>(res, "ERREUR_PROCEDURES");
}

export async function listPerquisitions(
  una: string,
  fetchImpl: typeof fetch = fetch
): Promise<PerquisitionSummary[]> {
  const res = await fetchImpl("/api/perquisitions?una=" + encodeURIComponent(una));
  return unwrap<PerquisitionSummary[]>(res, "ERREUR_PERQUISITIONS");
}

export async function getPerquisition(
  id: number,
  fetchImpl: typeof fetch = fetch
): Promise<PerquisitionDetail> {
  const res = await fetchImpl("/api/perquisition?id=" + id);
  return unwrap<PerquisitionDetail>(res, "ERREUR_PERQUISITION");
}

export async function addObjets(
  perquisitionId: number,
  objets: ObjetSaisi[],
  fetchImpl: typeof fetch = fetch
): Promise<{ id: number }> {
  const res = await fetchImpl("/api/perquisition/objets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ perquisition_id: perquisitionId, objets: objets.map(mapObjet) }),
  });
  const data = await unwrap<{ id: number }>(res, "ERREUR_AJOUT_OBJETS");
  return { id: data.id };
}
```

- [ ] **Step 4: Lancer → succès attendu + tsc**

Run: `npx vitest run src/features/saisies/perquisitionApi.test.ts && npx tsc --noEmit`
Expected: PASS (tests existants + nouveaux) ; tsc sans erreur.

- [ ] **Step 5: Commit**

```bash
git add src/features/saisies/perquisitionApi.ts src/features/saisies/perquisitionApi.test.ts
git commit -m "feat(saisies): clients listProcedures/listPerquisitions/getPerquisition/addObjets + mapObjet"
```

---

### Task 5: Front — navigation UNA-first + `UnaPicker` + `UnaScreen` + création recyclée

**Files:**
- Create: `src/features/saisies/UnaPicker.tsx`
- Create: `src/features/saisies/UnaScreen.tsx`
- Modify: `src/features/saisies/SaisiesApp.tsx`

**Interfaces:**
- Consumes: `listProcedures`, `listPerquisitions`, `Procedure`, `PerquisitionSummary` (Task 4) ; `SetupScreen`, `Inventory`, `Wizard` (existants).
- Produces: écran d'accueil (choix UNA) → écran UNA (perquisitions + « Nouvelle ») → création via `SetupScreen` recyclé (UNA en prop).

- [ ] **Step 1: Créer `UnaPicker.tsx`**

Create `src/features/saisies/UnaPicker.tsx` :

```tsx
import { useEffect, useState } from "react";
import { listProcedures, type Procedure } from "./perquisitionApi";

const BRAND = "#000091";
const BORDER = "#e2e2ec";
const MUTED = "#5b5b6b";
const field: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${BORDER}`, fontFamily: "inherit", fontSize: 14 };

export default function UnaPicker({ onPick }: { onPick: (p: Procedure) => void }) {
  const [annee, setAnnee] = useState("");
  const [unite, setUnite] = useState("");
  const [rows, setRows] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    listProcedures({ annee: annee || undefined, unite: unite || undefined, limit: 200 })
      .then((r) => { if (alive) setRows(r); })
      .catch((e) => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [annee, unite]);

  return (
    <div style={{ display: "grid", placeItems: "start center", padding: "40px 20px 60px", overflowY: "auto", height: "100%" }}>
      <div style={{ width: "100%", maxWidth: 760 }}>
        <h2 style={{ margin: 0, fontSize: 24 }}>Choisir une procédure (UNA)</h2>
        <p style={{ color: MUTED, fontSize: 14, margin: "6px 0 20px" }}>
          Sélectionner l'UNA de rattachement pour créer ou consulter une perquisition.
        </p>
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <input style={field} placeholder="Année (ex. 2026)" value={annee} onChange={(e) => setAnnee(e.target.value.replace(/\D/g, ""))} />
          <input style={field} placeholder="Unité (code)" value={unite} onChange={(e) => setUnite(e.target.value.replace(/\D/g, ""))} />
        </div>
        {loading && <div style={{ color: MUTED, fontSize: 13 }}>Chargement…</div>}
        {error && <div style={{ color: "#e1000f", fontSize: 13 }}>{error}</div>}
        {!loading && !error && rows.length === 0 && <div style={{ color: MUTED, fontSize: 13 }}>Aucune procédure.</div>}
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((p) => (
            <li key={p.una}>
              <button
                onClick={() => onPick(p)}
                style={{ width: "100%", textAlign: "left", padding: "12px 14px", borderRadius: 8, border: `1px solid ${BORDER}`, background: "#fff", cursor: "pointer" }}
              >
                <div style={{ fontWeight: 700, color: BRAND }}>{p.una}</div>
                <div style={{ fontSize: 13, color: MUTED, marginTop: 3 }}>
                  {[p.type || p.type_libelle, p.commune_libelle].filter(Boolean).join(" · ")}
                </div>
                {p.synthese && <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.synthese}</div>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Créer `UnaScreen.tsx`**

Create `src/features/saisies/UnaScreen.tsx` :

```tsx
import { useEffect, useState } from "react";
import { listPerquisitions, type Procedure, type PerquisitionSummary } from "./perquisitionApi";

const BRAND = "#000091";
const BORDER = "#e2e2ec";
const MUTED = "#5b5b6b";
const btn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 18px", borderRadius: 8, fontWeight: 700, fontSize: 14, border: `1px solid ${BRAND}`, background: BRAND, color: "#fff", cursor: "pointer" };
const btnGhost: React.CSSProperties = { ...btn, background: "transparent", color: BRAND };

export default function UnaScreen({
  una,
  onBack,
  onNew,
  onOpen,
}: {
  una: Procedure;
  onBack: () => void;
  onNew: () => void;
  onOpen: (id: number) => void;
}) {
  const [rows, setRows] = useState<PerquisitionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listPerquisitions(una.una)
      .then((r) => { if (alive) setRows(r); })
      .catch((e) => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [una.una]);

  return (
    <div style={{ display: "grid", placeItems: "start center", padding: "36px 20px 60px", overflowY: "auto", height: "100%" }}>
      <div style={{ width: "100%", maxWidth: 760 }}>
        <button style={{ ...btnGhost, padding: "6px 10px", fontSize: 13, marginBottom: 14 }} onClick={onBack}>← Changer d'UNA</button>
        <h2 style={{ margin: 0, fontSize: 22 }}>UNA {una.una}</h2>
        <div style={{ fontSize: 13, color: MUTED, margin: "4px 0 20px" }}>
          {[una.type || una.type_libelle, una.commune_libelle].filter(Boolean).join(" · ")}
          {una.synthese ? ` — ${una.synthese}` : ""}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", color: MUTED }}>Perquisitions</div>
          <button style={btn} onClick={onNew}>Nouvelle perquisition</button>
        </div>

        {loading && <div style={{ color: MUTED, fontSize: 13 }}>Chargement…</div>}
        {error && <div style={{ color: "#e1000f", fontSize: 13 }}>{error}</div>}
        {!loading && !error && rows.length === 0 && <div style={{ color: MUTED, fontSize: 13 }}>Aucune perquisition. Créez-en une.</div>}
        <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => onOpen(p.id)}
                style={{ width: "100%", textAlign: "left", padding: "12px 14px", borderRadius: 8, border: `1px solid ${BORDER}`, background: "#fff", cursor: "pointer" }}
              >
                <div style={{ fontWeight: 700 }}>{p.adresse}</div>
                <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>
                  {[p.commune_libelle, `${p.nb_objets} objet(s)`].filter(Boolean).join(" · ")}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Câbler la navigation dans SaisiesApp — état + écrans home/una**

Dans `src/features/saisies/SaisiesApp.tsx` :

(a) Imports en tête :

```tsx
import UnaPicker from "./UnaPicker";
import UnaScreen from "./UnaScreen";
import type { Procedure } from "./perquisitionApi";
```

(b) Dans `SaisiesApp()`, ajouter en tête des `useState` :

```tsx
  const [screen, setScreen] = useState<"home" | "una" | "perq">("home");
  const [selectedUna, setSelectedUna] = useState<Procedure | null>(null);
```

(c) Fonction de démarrage d'une création (à placer avec les autres handlers de `SaisiesApp`) :

```tsx
  function startCreate() {
    setPerquisition(null);
    setEditingPerq(false);
    setObjets([]);
    setDraft(null);
    setStep(1);
    setSaveState({ status: "idle" });
    setScreen("perq");
  }
```

(d) Router les écrans home/una AVANT le rendu existant. Juste après les handlers, insérer :

```tsx
  if (screen === "home") {
    return <UnaPicker onPick={(p) => { setSelectedUna(p); setScreen("una"); }} />;
  }
  if (screen === "una" && selectedUna) {
    return (
      <UnaScreen
        una={selectedUna}
        onBack={() => setScreen("home")}
        onNew={startCreate}
        onOpen={(id) => { /* Task 6 : consultation */ }}
      />
    );
  }
```

- [ ] **Step 4: Adapter `SetupScreen` — UNA en prop (retirer le champ libre)**

Dans `SetupScreen` :

(a) Signature : ajouter `una` et `onBack` aux props :

```tsx
function SetupScreen({
  una,
  initial,
  onSubmit,
  onBack,
}: {
  una: string;
  initial: Perquisition | null;
  onSubmit: (p: Perquisition) => void;
  onBack: () => void;
}) {
```

(b) SUPPRIMER l'état `const [una, setUna] = useState(initial?.una ?? "");`.

(c) SUPPRIMER le bloc JSX du champ UNA libre (le `<Full>` contenant « Numéro de procédure (UNA) » avec l'`<input value={una} .../>`, lignes ~244-252).

(d) Retirer `una.trim()` du gate : `const valid = adresse.trim() && commune.trim() && perquisitionne.trim() && opj.trim();`

(e) Dans l'objet passé à `onSubmit`, `una` provient désormais de la prop (déjà nommé `una`, donc l'expression `una,` reste valide et référence la prop). Ajouter un récap lecture seule de l'UNA en tête de formulaire (après le `<h2>`), et un bouton retour :

```tsx
        <button style={{ ...btnGhost, padding: "6px 10px", fontSize: 13, marginBottom: 12 }} onClick={onBack}>← Retour</button>
        <div style={{ fontSize: 13, color: MUTED, margin: "0 0 16px" }}>Procédure : <strong>{una}</strong></div>
```

- [ ] **Step 5: Adapter le rendu `perq` (mode création) dans SaisiesApp**

Le rendu existant `if (!perquisition || editingPerq) return <SetupScreen ... />;` puis la grille `Inventory + Wizard` constitue le mode création. Le passer sous `screen === "perq"` et fournir les props UNA/retour à `SetupScreen` :

- Le bloc `if (!perquisition || editingPerq) { return (<SetupScreen initial={perquisition} onSubmit={...} />); }` devient :

```tsx
  if (!perquisition || editingPerq) {
    return (
      <SetupScreen
        una={selectedUna?.una ?? ""}
        initial={perquisition}
        onBack={() => setScreen("una")}
        onSubmit={(p) => { setPerquisition(p); setEditingPerq(false); }}
      />
    );
  }
```

(La grille `Inventory + Wizard` en dessous reste inchangée pour l'instant ; `handleSavePerquisition` inchangé.)

- [ ] **Step 6: Vérifier tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc sans erreur ; build réussi.

- [ ] **Step 7: Commit**

```bash
git add src/features/saisies/UnaPicker.tsx src/features/saisies/UnaScreen.tsx src/features/saisies/SaisiesApp.tsx
git commit -m "feat(saisies): navigation UNA-first (picker + écran UNA) + création via formulaire recyclé (UNA en prop)"
```

---

### Task 6: Front — consultation + ajout d'objets sur une perquisition existante

**Files:**
- Modify: `src/features/saisies/SaisiesApp.tsx`

**Interfaces:**
- Consumes: `getPerquisition`, `addObjets`, `PerquisitionDetail`, `ApiObjet` (Task 4) ; `Inventory`, `Wizard` (existants).
- Produces: ouverture d'une perquisition existante en lecture seule + ajout batch de nouveaux objets.

- [ ] **Step 1: État consultation + handlers dans SaisiesApp**

Dans `SaisiesApp()` :

(a) Imports : `import { getPerquisition, addObjets, type PerquisitionDetail } from "./perquisitionApi";` (compléter l'import existant de perquisitionApi).

(b) États :

```tsx
  const [perqMode, setPerqMode] = useState<"create" | "consult">("create");
  const [opened, setOpened] = useState<PerquisitionDetail | null>(null);
```

(c) Dans `startCreate`, ajouter `setPerqMode("create"); setOpened(null);`.

(d) Handler d'ouverture (remplace le `/* Task 6 */` de `UnaScreen.onOpen`) :

```tsx
  async function openExisting(id: number) {
    setSaveState({ status: "saving" });
    try {
      const detail = await getPerquisition(id);
      setOpened(detail);
      setPerqMode("consult");
      setObjets([]);
      setDraft(null);
      setStep(1);
      setSaveState({ status: "idle" });
      setScreen("perq");
    } catch (e) {
      setSaveState({ status: "err", msg: (e as Error).message });
    }
  }
```

Et brancher `onOpen={openExisting}` dans le rendu `UnaScreen`.

(e) Handler de sauvegarde des ajouts :

```tsx
  async function handleAddObjets() {
    if (!opened) return;
    if (objets.length === 0) { setSaveState({ status: "err", msg: "Aucun objet à ajouter." }); return; }
    setSaveState({ status: "saving" });
    try {
      await addObjets(opened.id, objets);
      const refreshed = await getPerquisition(opened.id);
      setOpened(refreshed);
      setObjets([]);
      setDraft(null);
      setStep(1);
      setSaveState({ status: "ok", id: opened.id });
    } catch (e) {
      setSaveState({ status: "err", msg: (e as Error).message });
    }
  }
```

- [ ] **Step 2: Rendu du mode consultation (screen perq + perqMode consult)**

Dans `SaisiesApp`, le rendu `perq` doit distinguer les modes. En mode `consult`, on n'affiche PAS `SetupScreen` ; on affiche directement la grille `Inventory + Wizard` avec les objets existants en lecture seule. Structurer le rendu final ainsi (remplacer la grille de retour existante) :

```tsx
  const enConsult = perqMode === "consult" && opened;
  const perquisitionCourante: Perquisition | null = enConsult
    ? {
        adresse: opened!.adresse,
        commune: opened!.commune_libelle ?? "",
        codePostal: opened!.code_postal ?? "",
        dateDebut: opened!.date_debut ?? "",
        typeLieu: (opened!.type_lieu as Perquisition["typeLieu"]) ?? "AUTRE",
        perquisitionne: opened!.perquisitionne ?? "",
        opj: opened!.opj ?? "",
        una: opened!.una,
        intervenants: opened!.intervenants ?? [],
        pieces: opened!.pieces ?? [],
      }
    : perquisition;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", height: "100%", minWidth: 0 }}>
      <Inventory
        perquisition={perquisitionCourante!}
        objets={objets}
        objetsExistants={enConsult ? opened!.objets : undefined}
        currentId={draft?.id}
        onAdd={startNew}
        onOpen={loadObjet}
        onEditPerq={enConsult ? undefined : () => setEditingPerq(true)}
        onBackToUna={() => setScreen("una")}
        onSavePerquisition={enConsult ? handleAddObjets : handleSavePerquisition}
        saveMode={enConsult ? "add" : "create"}
        saveState={saveState}
      />
      <div style={{ padding: "26px 30px 40px", overflowY: "auto", maxWidth: 980 }}>
        <Wizard
          key={draft?.id ?? "new"}
          perquisition={perquisitionCourante!}
          draft={draft}
          step={step}
          setStep={setStep}
          onIdentified={(o) => setDraft(o)}
          onSave={saveObjet}
        />
      </div>
    </div>
  );
```

(NB : en mode création, `if (!perquisition || editingPerq)` renvoie `SetupScreen` AVANT d'atteindre ce rendu ; en mode consult, `opened` est chargé donc on atteint ce rendu directement.)

- [ ] **Step 3: Adapter `Inventory` — objets existants lecture seule + libellé bouton + retour**

Dans le composant `Inventory` :

(a) Signature — ajouter les props :

```tsx
  objetsExistants,
  onBackToUna,
  saveMode,
```
```tsx
  objetsExistants?: ApiObjet[];
  onEditPerq?: () => void;
  onBackToUna: () => void;
  saveMode: "create" | "add";
```
(et importer `type ApiObjet` depuis `./perquisitionApi`, et rendre `onEditPerq` optionnel dans le type).

(b) En tête de l'aside, ajouter un bouton retour vers l'UNA :

```tsx
        <button style={{ ...btnGhost, padding: "6px 10px", fontSize: 12.5, gap: 6 }} onClick={onBackToUna}><Icon name="arrow_back" size={15} /> Perquisitions de l'UNA</button>
```

(c) Rendre le bouton « Modifier la perquisition » conditionnel : `{onEditPerq && (<button ... onClick={onEditPerq}>…</button>)}`.

(d) Afficher les objets existants (lecture seule) au-dessus de la liste des objets en cours, si `objetsExistants` :

```tsx
        {objetsExistants && objetsExistants.length > 0 && (
          <li style={{ listStyle: "none" }}>
            <div style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".05em", color: MUTED, padding: "4px 8px" }}>Objets enregistrés</div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {objetsExistants.map((o) => (
                <li key={`ex-${o.id}`} style={{ padding: "8px 12px", border: `1px solid ${BORDER}`, borderRadius: 8, background: "#f6f6fb" }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{o.categorie}{o.numero_scelle ? ` · ${o.numero_scelle}` : ""}</div>
                  <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>Enregistré</div>
                </li>
              ))}
            </ul>
          </li>
        )}
```

(e) Adapter le libellé du bouton d'enregistrement selon `saveMode` (repérer le bouton « Enregistrer la perquisition » ajouté au précédent incrément) :

```tsx
      <Icon name="save" size={16} /> {saveMode === "add" ? "Enregistrer les ajouts" : "Enregistrer la perquisition"}
```

- [ ] **Step 4: Vérifier tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc sans erreur ; build réussi.

- [ ] **Step 5: Commit**

```bash
git add src/features/saisies/SaisiesApp.tsx
git commit -m "feat(saisies): rouvrir une perquisition en consultation + ajout d'objets (batch)"
```

---

## Vérification E2E finale (contrôleur, après Task 6)

Avec tunnel + proxy à jour + `npm run dev` : choisir un UNA → créer une perquisition (save) → revenir sur l'UNA → rouvrir la perquisition → ajouter un objet → « Enregistrer les ajouts » → vérifier en base que le nombre d'objets a augmenté.

---

## Self-Review

**Spec coverage :**
- Navigation UNA-first (home/una/perq) → Task 5. ✓
- Picker UNA filtrable via `/procedures` → Task 5 (`UnaPicker`). ✓
- Liste perquisitions par UNA + « Nouvelle » → Task 5 (`UnaScreen`). ✓
- Création via formulaire recyclé (UNA en prop, champ libre retiré) → Task 5. ✓
- Consultation + ajout d'objets (batch) → Task 6. ✓
- Endpoint `POST /perquisition/objets` + refactor DRY `insertObjets` → Tasks 1-3. ✓
- Clients `listProcedures`/`listPerquisitions`/`getPerquisition`/`addObjets` + `mapObjet` → Task 4. ✓
- Hors périmètre (édition lieu/objets existants, MinIO, géocodage, deploy prod front) : non traité. ✓

**Placeholder scan :** aucun TBD ; code fourni intégralement. Les instructions « repérer X » (Tasks 5-6) ciblent des points d'insertion dans `SaisiesApp.tsx`/`Inventory` existants, avec le code complet à insérer.

**Type consistency :** `Procedure`/`PerquisitionSummary`/`PerquisitionDetail`/`ApiObjet` définis en Task 4 et consommés en Tasks 5-6. `addObjets(id, objets)`, `getPerquisition(id)`, `listPerquisitions(una)`, `listProcedures(params)` signatures cohérentes test/impl/usage. `insertObjets(client, perqId, objets)` / `addObjets(pool, body)` cohérents backend. `Inventory` props (`objetsExistants`, `onBackToUna`, `saveMode`, `onEditPerq?`) cohérentes entre signature et site d'appel.
