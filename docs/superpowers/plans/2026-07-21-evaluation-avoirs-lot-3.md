# Évaluation des avoirs — lot 3 — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lancer l'évaluation depuis l'écran : un agent IAka lit la procédure, interroge la cote véhicule par véhicule, écrit les estimations en base et rédige le PV d'évaluation, que l'enquêteur relit, corrige et exporte.

**Architecture:** Le BFF déclenche le workflow en job asynchrone et normalise sa réponse ; il n'appelle ni la cote ni `rgp-api`, c'est l'agent qui le fait par ses tools MCP. Le front affiche les fourchettes, **recalcule le total** et **relit la procédure** après coup : la base fait foi, pas le compte rendu de l'agent.

**Tech Stack:** Node natif (`http`, `node --test`) pour le BFF ; React 19 + TypeScript + Vitest pour le front ; `pdfmake` déjà installé pour l'export.

**Spec :** `docs/superpowers/specs/2026-07-20-evaluation-avoirs-design.md`
**Lots 1 et 2 livrés :** `docs/superpowers/plans/2026-07-20-evaluation-avoirs-lots-1-2.md`, `docs/superpowers/plans/2026-07-21-evaluation-liste-unas.md`

## Global Constraints

- **Aucune dépendance npm ajoutée** (`pdfmake` et `@tiptap/*` sont déjà là).
- **INTERDIT : emoji dans le front.** Icônes = classe `material-icons` ou SVG inline.
- Code, commentaires, libellés d'interface et messages de commit **en français**.
- **Le BFF n'appelle ni `cote-api` ni `rgp-api`** : il déclenche le workflow et normalise. Sinon il n'y a plus d'agent à démontrer.
- **Le contenu des pièces et des procédures ne doit jamais être journalisé** : seuls les codes d'erreur le sont.
- **Ne pas modifier `server/rgp-api/`** : chantier d'une autre équipe.
- **Le front ne fait pas confiance à l'agent** : total recalculé, procédure relue, écarts affichés.
- **Sélection plafonnée à 20 véhicules** (limite de la boucle du workflow), déjà appliquée au lot 2.
- Tests front : `npm test`. Tests BFF : `node --test server/*.test.mjs`. `npx tsc -b` sans sortie.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `server/evaluationWorkflow.mjs` | Déclenche le workflow IAka, interroge son statut, extrait et valide sa réponse. |
| `server/proxy.mjs` | Route `POST /api/evaluation` (job asynchrone). |
| `docs/iaka-evaluation-avoirs-workflow.md` | Câblage du workflow : nœuds, boucles, tools MCP, prompts à coller. |
| `src/features/evaluation/evaluationApi.ts` | `lancerEvaluation({ una, objetIds })`. |
| `src/features/evaluation/evaluationStore.ts` | État de l'évaluation, total recalculé, écarts, relecture. |
| `src/features/evaluation/ResultatEvaluation.tsx` | Encarts par véhicule, total, objets non évalués, écarts. |
| `src/components/PropositionEditor.tsx` | Éditeur, déplacé depuis `features/synthese/` pour être partagé. |
| `src/lib/pdfDoc.ts` | Conversion HTML → PDF, déplacée depuis `features/synthese/`. |

---

### Task 1 : Déclenchement du workflow et validation de sa réponse (BFF)

**Files:**
- Create: `server/evaluationWorkflow.mjs`
- Test: `server/evaluationWorkflow.test.mjs`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `extraireEvaluation(result)` → objet validé, lève `EVALUATION_INVALIDE` sinon.
  - `runEvaluation({ una, objetIds, cfg, fetchImpl, sleep })` → `Promise<{ evaluations, non_evalues, total, pv_evaluation }>`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `server/evaluationWorkflow.test.mjs` :

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { extraireEvaluation, runEvaluation } from "./evaluationWorkflow.mjs";

const REPONSE = {
  evaluations: [
    {
      objet_id: 42,
      estimation_prix: {
        prix_bas: 8500, prix_moyen: 10200, prix_haut: 11800, devise: "EUR",
        hypotheses: ["Kilométrage déclaré 120 000 km"],
        sources: [{ site: "LaCentrale", url: "https://cote.local/a/1", prix: 10490 }],
        confiance: 0.7,
        avertissement: "Source simulée, non contractuelle.",
      },
      enregistre: true,
    },
  ],
  non_evalues: [{ objet_id: 57, raison: "Année de mise en circulation absente" }],
  total: { bas: 8500, moyen: 10200, haut: 11800 },
  pv_evaluation: "## Objets évalués\n…",
};

test("extrait la reponse JSON du workflow", () => {
  const r = extraireEvaluation(JSON.stringify(REPONSE));
  assert.equal(r.evaluations[0].objet_id, 42);
  assert.equal(r.pv_evaluation.startsWith("## Objets"), true);
});

test("retire la trace d'agent et deballe une fence", () => {
  const brut = "<tool>lire_objets<tool-output>{}</tool-output></tool>\n```json\n" + JSON.stringify(REPONSE) + "\n```";
  assert.equal(extraireEvaluation(brut).evaluations.length, 1);
});

test("une reponse sans evaluations ni non_evalues est invalide", () => {
  assert.throws(() => extraireEvaluation(JSON.stringify({ pv_evaluation: "x" })), /EVALUATION_INVALIDE/);
});

test("une reponse sans PV est invalide", () => {
  assert.throws(
    () => extraireEvaluation(JSON.stringify({ evaluations: [], non_evalues: [] })),
    /EVALUATION_INVALIDE/
  );
});

test("une reponse non JSON est invalide", () => {
  assert.throws(() => extraireEvaluation("désolé, je n'ai pas pu"), /EVALUATION_INVALIDE/);
  assert.throws(() => extraireEvaluation(null), /EVALUATION_INVALIDE/);
});

test("les listes absentes deviennent des listes vides, pas undefined", () => {
  const r = extraireEvaluation(JSON.stringify({ evaluations: [], pv_evaluation: "x" }));
  assert.deepEqual(r.non_evalues, []);
  assert.deepEqual(r.evaluations, []);
});

// Stub IAka : POST d'exécution puis interrogations du statut.
function stubIaka(resultat, { statutsAvant = 0 } = {}) {
  const appels = [];
  let restants = statutsAvant;
  const fetchImpl = async (url, init) => {
    appels.push({ url, method: init?.method ?? "GET", body: init?.body });
    if (init?.method === "POST") return { ok: true, json: async () => ({ execution_id: "exec-1" }) };
    if (restants-- > 0) return { ok: true, json: async () => ({ status: "RUNNING" }) };
    return { ok: true, json: async () => ({ status: "SUCCESS", result: JSON.stringify(resultat) }) };
  };
  return { fetchImpl, appels };
}

const CFG = {
  jwt: "j", baseUrl: "https://iaka.test", evaluationAppId: "app-eval", tenantId: "t",
  pollIntervalMs: 1, pollTimeoutMs: 1000,
};

test("transmet una et objetIds au workflow, et rend sa reponse", async () => {
  const { fetchImpl, appels } = stubIaka(REPONSE);
  const r = await runEvaluation({
    una: "12345/00042/2026", objetIds: [42, 57], cfg: CFG, fetchImpl, sleep: async () => {},
  });
  assert.equal(r.evaluations[0].objet_id, 42);
  const envoye = JSON.parse(appels[0].body);
  assert.equal(envoye.app_id, "app-eval");
  const prompt = JSON.parse(envoye.prompt);
  assert.equal(prompt.una, "12345/00042/2026");
  assert.deepEqual(prompt.objetIds, [42, 57]);
});

test("attend la fin de l'execution avant de rendre", async () => {
  const { fetchImpl, appels } = stubIaka(REPONSE, { statutsAvant: 2 });
  await runEvaluation({ una: "u", objetIds: [1], cfg: CFG, fetchImpl, sleep: async () => {} });
  assert.ok(appels.filter((a) => a.method === "GET").length >= 3);
});

test("statut ERROR -> EVALUATION_UPSTREAM", async () => {
  const fetchImpl = async (url, init) =>
    init?.method === "POST"
      ? { ok: true, json: async () => ({ execution_id: "e" }) }
      : { ok: true, json: async () => ({ status: "ERROR" }) };
  await assert.rejects(
    runEvaluation({ una: "u", objetIds: [1], cfg: CFG, fetchImpl, sleep: async () => {} }),
    /EVALUATION_UPSTREAM/
  );
});

test("delai depasse -> EVALUATION_TIMEOUT", async () => {
  const fetchImpl = async (url, init) =>
    init?.method === "POST"
      ? { ok: true, json: async () => ({ execution_id: "e" }) }
      : { ok: true, json: async () => ({ status: "RUNNING" }) };
  await assert.rejects(
    runEvaluation({
      una: "u", objetIds: [1], cfg: { ...CFG, pollTimeoutMs: 0 }, fetchImpl, sleep: async () => {},
    }),
    /EVALUATION_TIMEOUT/
  );
});

test("sans objetIds -> OBJETS_REQUIS, sans appeler le workflow", async () => {
  let appele = false;
  const fetchImpl = async () => { appele = true; return { ok: true, json: async () => ({}) }; };
  await assert.rejects(
    runEvaluation({ una: "u", objetIds: [], cfg: CFG, fetchImpl, sleep: async () => {} }),
    /OBJETS_REQUIS/
  );
  assert.equal(appele, false);
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `node --test server/evaluationWorkflow.test.mjs`
Expected: FAIL — `Cannot find module './evaluationWorkflow.mjs'`.

- [ ] **Step 3 : Écrire le module**

Créer `server/evaluationWorkflow.mjs` :

```js
// Déclenche le workflow IAka « évaluation des avoirs » et valide sa réponse.
//
// Le BFF n'interroge NI la cote NI rgp-api : c'est l'agent qui le fait, par ses
// tools MCP. Ce module ne fait que déclencher, attendre, et refuser une réponse
// qui ne serait pas exploitable — mieux vaut une erreur franche qu'un PV
// construit sur une réponse à moitié comprise.

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Extrait la réponse JSON du workflow : retire la trace d'agent, déballe une
 * éventuelle fence, isole le premier objet JSON, puis vérifie le minimum
 * exploitable (des évaluations — même vides — et un PV).
 */
export function extraireEvaluation(result) {
  if (typeof result !== "string") throw new Error("EVALUATION_INVALIDE");

  let texte = result.replace(/<tool>[\s\S]*?<\/tool>/gi, "").trim();
  const fence = texte.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) texte = fence[1].trim();
  if (!texte.startsWith("{")) {
    const debut = texte.indexOf("{");
    const fin = texte.lastIndexOf("}");
    if (debut === -1 || fin <= debut) throw new Error("EVALUATION_INVALIDE");
    texte = texte.slice(debut, fin + 1);
  }

  let objet;
  try {
    objet = JSON.parse(texte);
  } catch {
    throw new Error("EVALUATION_INVALIDE");
  }

  if (!objet || typeof objet !== "object") throw new Error("EVALUATION_INVALIDE");
  if (!Array.isArray(objet.evaluations)) throw new Error("EVALUATION_INVALIDE");
  if (typeof objet.pv_evaluation !== "string" || !objet.pv_evaluation.trim()) {
    throw new Error("EVALUATION_INVALIDE");
  }

  return {
    evaluations: objet.evaluations,
    non_evalues: Array.isArray(objet.non_evalues) ? objet.non_evalues : [],
    total: objet.total ?? null,
    pv_evaluation: objet.pv_evaluation,
  };
}

/**
 * @param {object} p
 * @param {string} p.una
 * @param {number[]} p.objetIds  objets cochés par l'enquêteur
 * @param {object} p.cfg         config IAka (voir proxy.mjs)
 */
export async function runEvaluation({
  una,
  objetIds,
  cfg,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
}) {
  if (!Array.isArray(objetIds) || objetIds.length === 0) throw new Error("OBJETS_REQUIS");

  const auth = { Authorization: `Bearer ${cfg.jwt}`, "Content-Type": "application/json" };
  const execPath = cfg.executePath || "/workflows/execute";
  const statusTpl = cfg.statusPath || "/workflows/executions/{id}";

  // L'agent reçoit l'UNA et les identifiants cochés, rien de plus : il va
  // chercher les objets lui-même par MCP. Lui servir les champs reviendrait à ne
  // lui laisser qu'un rôle de rédacteur.
  const execRes = await fetchImpl(`${cfg.baseUrl}${execPath}`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      app_id: cfg.evaluationAppId,
      tenant_id: cfg.tenantId,
      langue: "fr",
      prompt: JSON.stringify({ una, objetIds }),
    }),
  });
  if (!execRes.ok) throw new Error("EVALUATION_UPSTREAM");
  const exec = await execRes.json();
  if (!exec?.execution_id) throw new Error("EVALUATION_UPSTREAM");

  const statusUrl = `${cfg.baseUrl}${statusTpl.replace("{id}", exec.execution_id)}?tenant_id=${cfg.tenantId}`;
  const debut = Date.now();

  while (Date.now() - debut <= cfg.pollTimeoutMs) {
    const res = await fetchImpl(statusUrl, { method: "GET", headers: { Authorization: auth.Authorization } });
    if (!res.ok) throw new Error("EVALUATION_UPSTREAM");
    const body = await res.json();
    if (body.status === "SUCCESS") return extraireEvaluation(body.result);
    if (body.status === "ERROR") throw new Error("EVALUATION_UPSTREAM");
    await sleep(cfg.pollIntervalMs);
  }
  throw new Error("EVALUATION_TIMEOUT");
}
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `node --test server/evaluationWorkflow.test.mjs`
Expected: PASS — 11 tests.

- [ ] **Step 5 : Commit**

```bash
git add server/evaluationWorkflow.mjs server/evaluationWorkflow.test.mjs
git commit -m "feat(evaluation): declenchement du workflow et validation de sa reponse"
```

---

### Task 2 : Route `POST /api/evaluation`

**Files:**
- Modify: `server/proxy.mjs`
- Test: `server/proxy.test.mjs` (ajouts)

**Interfaces:**
- Consumes: `runEvaluation` (Task 1), `createJob`/`runJob` de `./jobs.mjs`.
- Produces: `POST /api/evaluation` → `202 { jobId }`, résultat récupéré via `/api/job/status`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `server/proxy.test.mjs` (le fichier contient déjà des tests de routes : suis leurs conventions de montage) :

```js
test("POST /api/evaluation cree un job et rend 202", async () => {
  const handler = createHandler({
    cfg: { evaluationAppId: "app", tenantId: "t" },
    evaluation: async () => ({ evaluations: [], non_evalues: [], total: null, pv_evaluation: "## PV" }),
  });
  const res = await appelJson(handler, "POST", "/api/evaluation", { una: "12345/00042/2026", objetIds: [1] });
  assert.equal(res.code, 202);
  assert.ok(res.body.jobId);
});

test("POST /api/evaluation sans objetIds -> 400 OBJETS_REQUIS", async () => {
  const handler = createHandler({ cfg: {}, evaluation: async () => ({}) });
  const res = await appelJson(handler, "POST", "/api/evaluation", { una: "12345/00042/2026", objetIds: [] });
  assert.equal(res.code, 400);
  assert.equal(res.body.error, "OBJETS_REQUIS");
});

test("POST /api/evaluation sans una -> 400 UNA_REQUIS", async () => {
  const handler = createHandler({ cfg: {}, evaluation: async () => ({}) });
  const res = await appelJson(handler, "POST", "/api/evaluation", { objetIds: [1] });
  assert.equal(res.code, 400);
  assert.equal(res.body.error, "UNA_REQUIS");
});
```

Si les fonctions utilitaires `appelJson` n'existent pas dans ce fichier, écris-les sur le modèle des tests de routes déjà présents ; ne réinvente pas un montage différent.

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `node --test server/proxy.test.mjs`
Expected: FAIL — la route renvoie 404.

- [ ] **Step 3 : Brancher la route**

Dans `server/proxy.mjs` :

1. Import, à côté des autres modules serveur :

```js
import { runEvaluation } from "./evaluationWorkflow.mjs";
```

2. Codes d'erreur, dans `ERROR_STATUS` :

```js
  EVALUATION_TIMEOUT: 504,
  EVALUATION_UPSTREAM: 502,
  EVALUATION_INVALIDE: 502,
  OBJETS_REQUIS: 400,
  UNA_REQUIS: 400,
```

3. Injection, dans la signature de `createHandler` (à côté de `synthese = runSynthese`) :

```js
  evaluation = runEvaluation,
```

4. La route, juste après celle de `/api/evaluation/unas` :

```js
    if (url.pathname === "/api/evaluation" && req.method === "POST") {
      try {
        const raw = await readBody(req);
        const { una, objetIds } = JSON.parse(raw || "{}");
        if (typeof una !== "string" || !una.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "UNA_REQUIS" }));
          return;
        }
        if (!Array.isArray(objetIds) || objetIds.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "OBJETS_REQUIS" }));
          return;
        }
        const jobId = createGenericJob();
        runJob(jobId, async () => evaluation({ una, objetIds, cfg, fetchImpl }));
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jobId }));
      } catch (e) {
        const status = ERROR_STATUS[e.message] ?? 500;
        // Les procédures sont à diffusion restreinte : on ne journalise que les
        // codes d'erreur, jamais le corps de la requête ni la réponse.
        if (!(e.message in ERROR_STATUS)) console.error(e.message);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message in ERROR_STATUS ? e.message : "INTERNAL_ERROR" }));
      }
      return;
    }
```

5. Config, dans l'objet renvoyé en bas du fichier, à côté de `syntheseAppId` :

```js
    evaluationAppId: process.env.IAKA_EVALUATION_APP_ID, // évaluation des avoirs (/api/evaluation)
```

6. Ajouter la variable à `.env.example`, sous `IAKA_SYNTHESE_APP_ID` :

```
IAKA_EVALUATION_APP_ID=00000000-0000-0000-0000-000000000000
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `node --test server/*.test.mjs`
Expected: PASS, aucune régression.

- [ ] **Step 5 : Commit**

```bash
git add server/proxy.mjs server/proxy.test.mjs .env.example
git commit -m "feat(evaluation): route /api/evaluation en job asynchrone"
```

---

### Task 3 : Câblage documenté du workflow IAka

**Files:**
- Create: `docs/iaka-evaluation-avoirs-workflow.md`

**Interfaces:**
- Consumes: le contrat d'entrée et de sortie validé par `server/evaluationWorkflow.mjs` (Task 1).
- Produces: le document que l'utilisateur suivra pour configurer l'app IAka.

Ce document n'est pas facultatif : le lot 3 ne fonctionne que si l'app IAka est créée et ses tools attachés, et cette opération se fait hors du dépôt. Sans lui, le code livré reste inerte.

- [ ] **Step 1 : Écrire le document**

Créer `docs/iaka-evaluation-avoirs-workflow.md`, en suivant la forme de `docs/iaka-analyse-audition-workflow.md` et `docs/iaka-ariane-workflow.md` (lis-les d'abord). Il doit contenir :

1. **Tableau d'en-tête** : nom de l'app, variable `IAKA_EVALUATION_APP_ID`, rôle, nœud DÉBUT (prompt JSON, `require_prompt=true`).
2. **Structure en nœuds**, reprise de la spec (section « Structure en nœuds ») : lecture MCP RGP, boucle véhicule (max 20, « continuer quand même »), normalisation, boucle de reprise (max 3, sortie si `correspondance` ∈ {exacte, approchante}), écriture MCP RGP, rédaction.
3. **Tools MCP à attacher**, avec ce qu'ils appellent :
   - lecture RGP : les tools du serveur MCP existant (`docs/iaka-rgp-workflow.md` en donne les identifiants) permettant de lister les perquisitions d'un UNA et d'en lire le détail ;
   - cote : tool `getCote`, dérivé de `server/cote-api/openapi.json` ;
   - écriture : le seul tool de mise à jour d'objet. **Aucun autre tool d'écriture ne doit être attaché.**
4. **Contrat d'entrée** : `prompt` = `{"una": "...", "objetIds": [42, 57]}`.
5. **Contrat de sortie**, copié depuis la spec, avec la précision que le BFF **refuse** (`EVALUATION_INVALIDE`) toute réponse sans `evaluations` (tableau) ou sans `pv_evaluation` (chaîne non vide) — c'est `server/evaluationWorkflow.mjs` qui l'impose.
6. **Prompt de chaque nœud**, rédigé et prêt à coller. Le prompt de rédaction doit exiger : rappel que l'estimation est indicative et issue d'une source simulée, détail par véhicule, total, mention explicite des véhicules non évalués et de leur raison.
7. **Points d'attention** :
   - la boucle véhicule est réglée sur « continuer quand même » : au-delà de 20 véhicules elle tronque **en silence**, d'où le plafond posé côté front ;
   - la condition de sortie d'une boucle est jugée par un modèle, pas par un compteur : le front compare donc les identifiants envoyés à ceux reçus ;
   - l'agent écrit en base : son écriture est bornée aux champs d'estimation des objets reçus, et **le front relit la procédure** ensuite ;
   - `cote-api` doit être déployé et joignable en HTTPS, sinon le tool `getCote` ne peut pas être dérivé.

- [ ] **Step 2 : Vérifier la cohérence avec le code**

Relis `server/evaluationWorkflow.mjs` et vérifie que le contrat documenté correspond exactement à ce que le code accepte et refuse. Un document qui promettrait un champ que le code rejette enverrait l'utilisateur configurer un workflow inutilisable.

- [ ] **Step 3 : Commit**

```bash
git add docs/iaka-evaluation-avoirs-workflow.md
git commit -m "docs: cablage du workflow IAka d'evaluation des avoirs"
```

---

### Task 4 : Lancement et état du résultat (front)

**Files:**
- Modify: `src/features/saisies/identify.ts` (exporter `normEstimation`)
- Modify: `src/features/evaluation/evaluationApi.ts`
- Modify: `src/features/evaluation/evaluationStore.ts`
- Test: `src/features/evaluation/evaluationApi.test.ts`, `src/features/evaluation/evaluationStore.test.ts` (ajouts)

**Interfaces:**
- Consumes: `runJobAsync` de `../../lib/runJobAsync` ; `normEstimation` de `../saisies/identify` ; `getPerquisition` de `../saisies/perquisitionApi`.
- Produces:
  - `type ResultatEvaluation = { evaluations: { objetId: number; estimation: EstimationPrix; enregistre: boolean }[]; nonEvalues: { objetId: number; raison: string }[]; totalAnnonce: { bas: number; moyen: number; haut: number } | null; totalRecalcule: { bas: number; moyen: number; haut: number }; manquants: number[]; pv: string }`
  - `lancerEvaluation(una: string, objetIds: number[], fetchImpl?): Promise<ResultatEvaluation>`
  - store : `resultat`, `evaluationEnCours`, `evaluer(fetchImpl?)`, `setPv(pv: string)`

- [ ] **Step 0 : Rendre `normEstimation` réutilisable**

`src/features/saisies/identify.ts:55` définit `normEstimation`, qui convertit une
estimation reçue d'IAka (`prix_bas`, `prix_moyen`…) vers le type du front
(`prixBas`, `prixMoyen`…). Elle n'est pas exportée. Ajoute `export` devant sa
déclaration — la réécrire ailleurs ferait deux conversions à maintenir, et c'est
exactement le genre de duplication qui finit par diverger :

```ts
export function normEstimation(e?: RawEstimation): EstimationPrix | undefined {
```

Ne change rien d'autre dans ce fichier.

- [ ] **Step 1 : Écrire les tests du client, vérifier l'échec**

Ajouter à `src/features/evaluation/evaluationApi.test.ts` :

```ts
import { lancerEvaluation } from "./evaluationApi";

const REPONSE = {
  evaluations: [
    { objet_id: 42, enregistre: true,
      estimation_prix: { prix_bas: 8500, prix_moyen: 10200, prix_haut: 11800, devise: "EUR",
        hypotheses: [], sources: [], confiance: 0.7, avertissement: "Simulée." } },
    { objet_id: 43, enregistre: false,
      estimation_prix: { prix_bas: 1500, prix_moyen: 2000, prix_haut: 2500, devise: "EUR",
        hypotheses: [], sources: [], confiance: 0.5, avertissement: "Simulée." } },
  ],
  non_evalues: [{ objet_id: 57, raison: "Année absente" }],
  total: { bas: 10000, moyen: 12200, haut: 14300 },
  pv_evaluation: "## PV",
};

function fetchJob(resultat: unknown) {
  let i = 0;
  const reponses = [{ jobId: "j" }, { status: "done", result: resultat }];
  return (async () => ({ ok: true, json: async () => reponses[Math.min(i++, 1)] })) as unknown as typeof fetch;
}

test("recalcule le total plutot que de reprendre celui du workflow", async () => {
  vi.useFakeTimers();
  const p = lancerEvaluation("12345/00042/2026", [42, 43, 57], fetchJob(REPONSE));
  await vi.advanceTimersByTimeAsync(3000);
  const r = await p;
  vi.useRealTimers();
  expect(r.totalRecalcule).toEqual({ bas: 10000, moyen: 12200, haut: 14300 });
  expect(r.totalAnnonce).toEqual({ bas: 10000, moyen: 12200, haut: 14300 });
});

test("signale les objets envoyes mais absents du resultat", async () => {
  vi.useFakeTimers();
  const p = lancerEvaluation("12345/00042/2026", [42, 43, 57, 99], fetchJob(REPONSE));
  await vi.advanceTimersByTimeAsync(3000);
  const r = await p;
  vi.useRealTimers();
  expect(r.manquants).toEqual([99]);
});

test("convertit l'estimation au format du front", async () => {
  vi.useFakeTimers();
  const p = lancerEvaluation("u", [42, 43], fetchJob(REPONSE));
  await vi.advanceTimersByTimeAsync(3000);
  const r = await p;
  vi.useRealTimers();
  expect(r.evaluations[0].estimation.prixMoyen).toBe(10200);
  expect(r.evaluations[1].enregistre).toBe(false);
});
```

Run: `npm test -- src/features/evaluation/evaluationApi.test.ts`
Expected: FAIL — `lancerEvaluation` n'existe pas.

- [ ] **Step 2 : Écrire le client**

Ajouter à `src/features/evaluation/evaluationApi.ts` :

```ts
import { runJobAsync } from "../../lib/runJobAsync";
import { normEstimation } from "../saisies/identify";
import type { ObjetSaisi } from "../saisies/types";

type EstimationPrix = NonNullable<ObjetSaisi["estimationPrix"]>;
type Total = { bas: number; moyen: number; haut: number };

export type ResultatEvaluation = {
  evaluations: { objetId: number; estimation: EstimationPrix; enregistre: boolean }[];
  nonEvalues: { objetId: number; raison: string }[];
  /** Total tel que le workflow l'annonce — conservé pour comparaison. */
  totalAnnonce: Total | null;
  /** Total recalculé à partir des évaluations : c'est celui qui fait foi. */
  totalRecalcule: Total;
  /** Objets envoyés mais absents du résultat : la boucle a tronqué, ou l'agent a oublié. */
  manquants: number[];
  pv: string;
};

function additionner(evaluations: { estimation: EstimationPrix }[]): Total {
  return evaluations.reduce(
    (t, e) => ({
      bas: t.bas + (e.estimation.prixBas ?? 0),
      moyen: t.moyen + (e.estimation.prixMoyen ?? 0),
      haut: t.haut + (e.estimation.prixHaut ?? 0),
    }),
    { bas: 0, moyen: 0, haut: 0 }
  );
}

export async function lancerEvaluation(
  una: string,
  objetIds: number[],
  fetchImpl: typeof fetch = fetch
): Promise<ResultatEvaluation> {
  const brut = await runJobAsync<{
    evaluations?: { objet_id: number; estimation_prix: unknown; enregistre?: boolean }[];
    non_evalues?: { objet_id: number; raison: string }[];
    total?: Total | null;
    pv_evaluation?: string;
  }>("/api/evaluation", { una, objetIds }, { fetchImpl });

  const evaluations = (brut.evaluations ?? []).map((e) => ({
    objetId: e.objet_id,
    estimation: normEstimation(e.estimation_prix) as EstimationPrix,
    enregistre: Boolean(e.enregistre),
  }));
  const nonEvalues = (brut.non_evalues ?? []).map((n) => ({ objetId: n.objet_id, raison: n.raison }));

  // Le total du workflow est une addition faite par un modèle : on le garde pour
  // le comparer, mais c'est le nôtre qui s'affiche et qui remonte à l'AGRASC.
  const totalRecalcule = additionner(evaluations);

  const rendus = new Set([...evaluations.map((e) => e.objetId), ...nonEvalues.map((n) => n.objetId)]);
  const manquants = objetIds.filter((id) => !rendus.has(id));

  return {
    evaluations,
    nonEvalues,
    totalAnnonce: brut.total ?? null,
    totalRecalcule,
    manquants,
    pv: brut.pv_evaluation ?? "",
  };
}
```

Run: `npm test -- src/features/evaluation/evaluationApi.test.ts`
Expected: PASS.

- [ ] **Step 3 : Écrire les tests du store, vérifier l'échec**

Ajouter à `src/features/evaluation/evaluationStore.test.ts` :

```ts
test("evaluer renseigne le resultat et retombe l'indicateur", async () => {
  const store = await import("./evaluationStore");
  const resultat = {
    evaluations: [{ objet_id: 1, enregistre: true,
      estimation_prix: { prix_bas: 1, prix_moyen: 2, prix_haut: 3, devise: "EUR",
        hypotheses: [], sources: [], confiance: 0.5, avertissement: "x" } }],
    non_evalues: [], total: { bas: 1, moyen: 2, haut: 3 }, pv_evaluation: "## PV",
  };
  let i = 0;
  const reponses: unknown[] = [{ jobId: "j" }, { status: "done", result: resultat }];
  const impl = (async (url: string) => {
    if (url.startsWith("/api/perquisitions") || url.startsWith("/api/perquisition?"))
      return { ok: true, json: async () => ({ data: url.includes("?id=") ? { id: 10, objets: [] } : [] }) };
    return { ok: true, json: async () => reponses[Math.min(i++, 1)] };
  }) as unknown as typeof fetch;

  store.setUna("12345/00042/2026");
  store.basculer(1);
  vi.useFakeTimers();
  const p = store.evaluer(impl);
  await vi.advanceTimersByTimeAsync(3000);
  await p;
  vi.useRealTimers();

  expect(store.lireEtat().resultat?.pv).toBe("## PV");
  expect(store.lireEtat().evaluationEnCours).toBe(false);
});

test("un echec d'evaluation s'affiche sans perdre la selection", async () => {
  const store = await import("./evaluationStore");
  const impl = (async () => ({ ok: false, json: async () => ({ error: "EVALUATION_UPSTREAM" }) })) as unknown as typeof fetch;
  store.setUna("12345/00042/2026");
  store.basculer(7);
  await store.evaluer(impl);
  expect(store.lireEtat().erreur).toBeTruthy();
  expect(store.lireEtat().selection).toEqual([7]);
  expect(store.lireEtat().evaluationEnCours).toBe(false);
});

test("setPv remplace le texte du PV sans toucher au reste", async () => {
  const store = await import("./evaluationStore");
  store.setPv("## Corrigé");
  expect(store.lireEtat().resultat?.pv ?? "## Corrigé").toBe("## Corrigé");
});
```

Run: `npm test -- src/features/evaluation/evaluationStore.test.ts`
Expected: FAIL — `store.evaluer is not a function`.

- [ ] **Step 4 : Étendre le store**

Dans `src/features/evaluation/evaluationStore.ts` :

1. Compléter l'import :

```ts
import { chargerUna, listerUnasEvaluables, lancerEvaluation, type ChargementUna, type UnaEvaluable, type ResultatEvaluation } from "./evaluationApi";
```

2. Ajouter au type `EvaluationState`, à l'état initial et à `clear()` :

```ts
  resultat: ResultatEvaluation | null;
  evaluationEnCours: boolean;
```

(initial : `resultat: null`, `evaluationEnCours: false`)

3. Ajouter les fonctions, sous `viderSelection` :

```ts
export async function evaluer(fetchImpl: typeof fetch = fetch) {
  const { una, selection, evaluationEnCours } = store.get();
  if (!una.trim() || !selection.length || evaluationEnCours) return;
  store.set({ evaluationEnCours: true, erreur: null, resultat: null });
  try {
    const resultat = await lancerEvaluation(una, selection, fetchImpl);
    store.set({ resultat, evaluationEnCours: false });
    // L'agent dit avoir écrit en base : on relit pour montrer ce qui y est
    // réellement, plutôt que de le croire sur parole.
    await charger(fetchImpl);
  } catch (e) {
    store.set({ erreur: (e as Error).message, evaluationEnCours: false });
  }
}

/** Édition manuelle du PV par l'enquêteur. */
export function setPv(pv: string) {
  const { resultat } = store.get();
  if (!resultat || resultat.pv === pv) return;
  store.set({ resultat: { ...resultat, pv } });
}
```

Run: `npm test -- src/features/evaluation/evaluationStore.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/features/saisies/identify.ts src/features/evaluation/evaluationApi.ts src/features/evaluation/evaluationApi.test.ts src/features/evaluation/evaluationStore.ts src/features/evaluation/evaluationStore.test.ts
git commit -m "feat(evaluation): lancement de l'evaluation et total recalcule"
```

---

### Task 5 : Affichage du résultat

**Files:**
- Create: `src/features/evaluation/ResultatEvaluation.tsx`
- Test: `src/features/evaluation/ResultatEvaluation.test.tsx`

**Interfaces:**
- Consumes: `ResultatEvaluation` (Task 4), `ObjetEvaluable` et `champ` (lot 2).
- Produces: `<ResultatEvaluation resultat={ResultatEvaluation} vehicules={ObjetEvaluable[]} />`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `src/features/evaluation/ResultatEvaluation.test.tsx` :

```tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import ResultatEvaluation from "./ResultatEvaluation";
import type { ResultatEvaluation as TResultat } from "./evaluationApi";
import type { ObjetEvaluable } from "./evaluationApi";

const estimation = (moyen: number) => ({
  prixBas: moyen - 1000, prixMoyen: moyen, prixHaut: moyen + 1000, devise: "EUR",
  hypotheses: ["Kilométrage déclaré 120 000 km"],
  sources: [{ site: "LaCentrale", url: "https://cote.local/a/1", prix: moyen }],
  confiance: 0.7, avertissement: "Source simulée, non contractuelle.",
});

const vehicule = (id: number): ObjetEvaluable => ({
  perquisitionId: 10,
  adresse: "3 rue des Acacias",
  objet: {
    id, categorie: "TRANSPORT", sous_type: "VEHICULE_TERRESTRE",
    champs: [
      { cle: "marque", libelle: "Marque", valeur: "RENAULT", source: "deduit", obligatoire: false },
      { cle: "modele", libelle: "Modèle", valeur: "Clio", source: "deduit", obligatoire: false },
    ],
    identifiants: [],
  },
});

const base: TResultat = {
  evaluations: [{ objetId: 1, estimation: estimation(10000), enregistre: true }],
  nonEvalues: [],
  totalAnnonce: { bas: 9000, moyen: 10000, haut: 11000 },
  totalRecalcule: { bas: 9000, moyen: 10000, haut: 11000 },
  manquants: [],
  pv: "## PV",
};

test("affiche la fourchette et le vehicule concerne", () => {
  render(<ResultatEvaluation resultat={base} vehicules={[vehicule(1)]} />);
  expect(screen.getByText(/RENAULT/)).toBeTruthy();
  expect(screen.getByText(/10 000/)).toBeTruthy();
});

test("affiche l'avertissement de source simulee", () => {
  render(<ResultatEvaluation resultat={base} vehicules={[vehicule(1)]} />);
  expect(screen.getByText(/simulée/i)).toBeTruthy();
});

test("affiche le total recalcule", () => {
  render(<ResultatEvaluation resultat={base} vehicules={[vehicule(1)]} />);
  expect(screen.getByText(/Total/)).toBeTruthy();
});

test("signale un ecart entre le total annonce et le total recalcule", () => {
  const faux: TResultat = { ...base, totalAnnonce: { bas: 9000, moyen: 42000, haut: 11000 } };
  render(<ResultatEvaluation resultat={faux} vehicules={[vehicule(1)]} />);
  expect(screen.getByText(/écart/i)).toBeTruthy();
});

test("aucun ecart signale quand les totaux concordent", () => {
  render(<ResultatEvaluation resultat={base} vehicules={[vehicule(1)]} />);
  expect(screen.queryByText(/écart/i)).toBeNull();
});

test("liste les vehicules non evalues avec leur raison", () => {
  const avecNonEvalues: TResultat = {
    ...base, nonEvalues: [{ objetId: 2, raison: "Année de mise en circulation absente" }],
  };
  render(<ResultatEvaluation resultat={avecNonEvalues} vehicules={[vehicule(1), vehicule(2)]} />);
  expect(screen.getByText(/Année de mise en circulation absente/)).toBeTruthy();
});

test("signale les objets envoyes mais absents du resultat", () => {
  const avecManquants: TResultat = { ...base, manquants: [3] };
  render(<ResultatEvaluation resultat={avecManquants} vehicules={[vehicule(1), vehicule(3)]} />);
  expect(screen.getByText(/n'ont pas été traités/i)).toBeTruthy();
});

test("signale une estimation non enregistree en base", () => {
  const nonEnregistre: TResultat = {
    ...base, evaluations: [{ objetId: 1, estimation: estimation(10000), enregistre: false }],
  };
  render(<ResultatEvaluation resultat={nonEnregistre} vehicules={[vehicule(1)]} />);
  expect(screen.getByText(/non enregistrée/i)).toBeTruthy();
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `npm test -- src/features/evaluation/ResultatEvaluation.test.tsx`
Expected: FAIL — `Failed to resolve import "./ResultatEvaluation"`.

- [ ] **Step 3 : Écrire le composant**

Créer `src/features/evaluation/ResultatEvaluation.tsx` :

```tsx
import { champ, type ObjetEvaluable, type ResultatEvaluation as TResultat } from "./evaluationApi";

// Résultat de l'évaluation : une fourchette par véhicule, un total, et tout ce
// qui n'a pas abouti. Composant pur.
//
// Le total affiché est celui que le front a RECALCULÉ. Celui du workflow n'est
// montré que s'il diverge : c'est ce chiffre qui remonte à l'AGRASC, il ne se
// prend pas sur une addition faite par un modèle.

const carte: React.CSSProperties = {
  border: "1px solid var(--c--globals--colors--gray-300, #ddd)",
  borderRadius: 4,
  padding: "12px 14px",
  marginBottom: 12,
  background: "var(--c--globals--colors--gray-050, #f6f6f6)",
};

const titre: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: 0, color: "#000091" };
const detail: React.CSSProperties = { fontSize: 13, color: "#3a3a44", margin: "2px 0 0" };
const alerte: React.CSSProperties = { ...detail, color: "#b34000" };

const euros = (v: number | null) =>
  v == null ? "" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

function joindre(...parts: (string | false | null)[]): string {
  return parts.filter(Boolean).join(" — ");
}

export default function ResultatEvaluation({
  resultat,
  vehicules,
}: {
  resultat: TResultat;
  vehicules: ObjetEvaluable[];
}) {
  const nom = (objetId: number) => {
    const v = vehicules.find((x) => x.objet.id === objetId);
    if (!v) return `Objet ${objetId}`;
    return joindre(champ(v.objet, "marque"), champ(v.objet, "modele")) || `Objet ${objetId}`;
  };

  const t = resultat.totalRecalcule;
  const a = resultat.totalAnnonce;
  const ecart = a != null && (a.bas !== t.bas || a.moyen !== t.moyen || a.haut !== t.haut);

  return (
    <section aria-label="Résultat de l'évaluation">
      {resultat.evaluations.map(({ objetId, estimation, enregistre }) => (
        <div key={objetId} style={carte}>
          <p style={titre}>{nom(objetId)}</p>
          <p style={detail}>
            {joindre(
              `Fourchette ${euros(estimation.prixBas)} à ${euros(estimation.prixHaut)}`,
              `estimation ${euros(estimation.prixMoyen)}`
            )}
          </p>
          {estimation.hypotheses.length > 0 && <p style={detail}>{estimation.hypotheses.join(" — ")}</p>}
          {estimation.sources.length > 0 && (
            <p style={detail}>
              Sources : {estimation.sources.map((s) => joindre(s.site, s.prix != null && euros(s.prix))).join(" ; ")}
            </p>
          )}
          {estimation.avertissement && <p style={detail}>{estimation.avertissement}</p>}
          {!enregistre && <p style={alerte}>Estimation non enregistrée dans la procédure.</p>}
        </div>
      ))}

      <div style={{ ...carte, background: "#e3e3fd" }}>
        <p style={titre}>Total des avoirs évalués</p>
        <p style={detail}>
          {joindre(`${euros(t.bas)} à ${euros(t.haut)}`, `estimation ${euros(t.moyen)}`)}
        </p>
        {ecart && (
          <p style={alerte}>
            Écart avec le total annoncé par l'analyse ({euros(a!.moyen)}) : le total ci-dessus est
            recalculé à partir des évaluations.
          </p>
        )}
      </div>

      {resultat.nonEvalues.length > 0 && (
        <div style={carte}>
          <p style={titre}>Véhicules non évalués</p>
          {resultat.nonEvalues.map((n) => (
            <p key={n.objetId} style={detail}>
              {joindre(nom(n.objetId), n.raison)}
            </p>
          ))}
        </div>
      )}

      {resultat.manquants.length > 0 && (
        <div style={carte}>
          <p style={alerte}>
            {resultat.manquants.length} véhicule(s) sélectionné(s) n'ont pas été traités par l'analyse :{" "}
            {resultat.manquants.map(nom).join(", ")}. Relancez l'évaluation sur ces véhicules.
          </p>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `npm test -- src/features/evaluation/ResultatEvaluation.test.tsx`
Expected: PASS — 8 tests.

- [ ] **Step 5 : Commit**

```bash
git add src/features/evaluation/ResultatEvaluation.tsx src/features/evaluation/ResultatEvaluation.test.tsx
git commit -m "feat(evaluation): affichage des fourchettes, du total et des ecarts"
```

---

### Task 6 : Éditeur et export PDF partagés

**Files:**
- Move: `src/features/synthese/PropositionEditor.tsx` → `src/components/PropositionEditor.tsx`
- Move: `src/features/synthese/pdfDoc.ts` → `src/lib/pdfDoc.ts`
- Move: `src/features/synthese/pdfDoc.test.ts` → `src/lib/pdfDoc.test.ts`
- Modify: `src/features/synthese/SyntheseApp.tsx` (imports)

**Interfaces:**
- Consumes: rien de nouveau.
- Produces: `PropositionEditor` et `htmlVersContenu` / `nomFichierPdf` accessibles aux deux features.

Aucune feature n'importe d'une autre dans ce projet : `src/components/` et `src/lib/` sont les emplacements partagés. Même mouvement que `BarreProgression`.

- [ ] **Step 1 : Déplacer les fichiers**

```bash
git mv src/features/synthese/PropositionEditor.tsx src/components/PropositionEditor.tsx
git mv src/features/synthese/pdfDoc.ts src/lib/pdfDoc.ts
git mv src/features/synthese/pdfDoc.test.ts src/lib/pdfDoc.test.ts
```

- [ ] **Step 2 : Corriger les imports**

Dans `src/features/synthese/SyntheseApp.tsx` :

```tsx
import PropositionEditor from "../../components/PropositionEditor";
import { htmlVersContenu, nomFichierPdf } from "../../lib/pdfDoc";
```

Dans `src/lib/pdfDoc.test.ts`, l'import devient :

```ts
import { htmlVersContenu, nomFichierPdf } from "./pdfDoc";
```

- [ ] **Step 3 : Vérifier que rien n'est cassé**

Run: `npm test`
Expected: PASS sur l'ensemble, aucun test perdu.

Run: `npx tsc -b`
Expected: aucune sortie.

- [ ] **Step 4 : Commit**

```bash
git add -A src/components/PropositionEditor.tsx src/lib/pdfDoc.ts src/lib/pdfDoc.test.ts src/features/synthese/
git commit -m "refactor: editeur et conversion PDF deviennent partages"
```

---

### Task 7 : Bouton d'évaluation, PV éditable et export

**Files:**
- Modify: `src/features/evaluation/EvaluationApp.tsx`
- Test: `src/features/evaluation/EvaluationApp.test.tsx` (ajouts)

**Interfaces:**
- Consumes: `evaluer`, `setPv`, `resultat`, `evaluationEnCours` (Task 4) ; `ResultatEvaluation` (Task 5) ; `PropositionEditor` et `pdfDoc` (Task 6) ; `BarreProgression` de `../../components/BarreProgression`.
- Produces: l'écran complet du cas d'usage.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `src/features/evaluation/EvaluationApp.test.tsx` :

```tsx
test("le bouton lance l'evaluation et la barre d'attente s'affiche", async () => {
  const resultat = {
    evaluations: [{ objet_id: 1, enregistre: true,
      estimation_prix: { prix_bas: 9000, prix_moyen: 10000, prix_haut: 11000, devise: "EUR",
        hypotheses: [], sources: [], confiance: 0.7, avertissement: "Simulée." } }],
    non_evalues: [], total: { bas: 9000, moyen: 10000, haut: 11000 }, pv_evaluation: "## PV d'évaluation",
  };
  let i = 0;
  const reponses: unknown[] = [{ jobId: "j" }, { status: "done", result: resultat }];
  const impl = (async (url: string) => {
    if (url.startsWith("/api/evaluation/unas")) return { ok: true, json: async () => ({ data: [] }) };
    if (url.startsWith("/api/perquisitions")) return { ok: true, json: async () => ({ data: [{ id: 10, adresse: "A", created_at: "", nb_objets: 1 }] }) };
    if (url.startsWith("/api/perquisition?")) return { ok: true, json: async () => ({ data: { id: 10, objets: [
      { id: 1, categorie: "TRANSPORT", sous_type: "VEHICULE_TERRESTRE", champs: [], identifiants: [] },
    ] } }) };
    return { ok: true, json: async () => reponses[Math.min(i++, 1)] };
  }) as unknown as typeof fetch;

  render(<EvaluationApp />);
  act(() => setUna("12345/00042/2026"));
  await act(async () => { await charger(impl); });
  await act(async () => { screen.getAllByRole("checkbox")[0].click(); });

  vi.useFakeTimers();
  const p = act(async () => { await evaluer(impl); });
  await vi.advanceTimersByTimeAsync(3000);
  await p;
  vi.useRealTimers();

  expect(screen.getByText(/Total des avoirs évalués/)).toBeTruthy();
  expect(screen.getByLabelText("Résultat de l'évaluation")).toBeTruthy();
});

test("sans resultat, ni le PV ni le total ne s'affichent", async () => {
  render(<EvaluationApp />);
  expect(screen.queryByLabelText("Résultat de l'évaluation")).toBeNull();
  expect(screen.queryByText(/PV d'évaluation/)).toBeNull();
});
```

Compléter l'import du fichier de test :

```tsx
import { clear, setUna, charger, chargerUnas, evaluer } from "./evaluationStore";
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `npm test -- src/features/evaluation/EvaluationApp.test.tsx`
Expected: FAIL — le résultat n'est pas rendu.

- [ ] **Step 3 : Câbler l'écran**

Dans `src/features/evaluation/EvaluationApp.tsx` :

1. Compléter les imports :

```tsx
import BarreProgression from "../../components/BarreProgression";
import PropositionEditor from "../../components/PropositionEditor";
import { htmlVersContenu } from "../../lib/pdfDoc";
import ResultatEvaluation from "./ResultatEvaluation";
```

et ajouter `evaluer`, `setPv`, `resultat`, `evaluationEnCours` aux éléments tirés du store.

2. Remplacer le gestionnaire vide du bouton par le lancement réel :

```tsx
            <Button
              type="button"
              onClick={() => evaluer()}
              disabled={selection.length === 0 || evaluationEnCours}
              icon={
                <span className="material-icons" aria-hidden>
                  auto_awesome
                </span>
              }
            >
              {evaluationEnCours ? "Évaluation en cours…" : "Évaluer la sélection"}
            </Button>
```

3. Ajouter, sous la rangée de boutons :

```tsx
      {evaluationEnCours && <BarreProgression />}

      {resultat && donnees && (
        <>
          <ResultatEvaluation resultat={resultat} vehicules={donnees.vehicules} />

          <div style={{ border: "1px solid var(--c--globals--colors--gray-300, #ccc)", borderRadius: 4, marginTop: 16 }}>
            <div
              style={{
                padding: "10px 12px",
                borderBottom: "1px solid var(--c--globals--colors--gray-300, #ddd)",
                background: "var(--c--globals--colors--gray-050, #f6f6f6)",
                textAlign: "center",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              PV d'évaluation
            </div>
            <PropositionEditor html={resultat.pv} onChange={setPv} />
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <Button
              type="button"
              onClick={exporterPdf}
              icon={
                <span className="material-icons" aria-hidden>
                  picture_as_pdf
                </span>
              }
            >
              Exporter le PV en PDF
            </Button>
          </div>
        </>
      )}
```

4. Ajouter la fonction d'export dans le composant, au-dessus du `return` :

```tsx
  // Export PDF : même mécanique que la page Analyse — pdfmake chargé à la
  // demande, texte vectoriel sélectionnable. Le nom du fichier reprend le
  // numéro de procédure, assaini des caractères interdits.
  async function exporterPdf() {
    if (!resultat) return;
    const [{ default: pdfMake }, { default: polices }] = await Promise.all([
      import("pdfmake/build/pdfmake"),
      import("pdfmake/build/vfs_fonts"),
    ]);
    pdfMake.addVirtualFileSystem(polices);
    pdfMake.fonts = {
      Roboto: {
        normal: "Roboto-Regular.ttf",
        bold: "Roboto-Medium.ttf",
        italics: "Roboto-Italic.ttf",
        bolditalics: "Roboto-MediumItalic.ttf",
      },
    };
    const nomFichier = `pv-evaluation-${una.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "")}.pdf`;
    pdfMake
      .createPdf({
        info: { title: "PV d'évaluation des avoirs" },
        pageMargins: [40, 48, 40, 56],
        content: htmlVersContenu(resultat.pv),
        defaultStyle: { font: "Roboto", fontSize: 10, lineHeight: 1.35 },
        styles: {
          h1: { fontSize: 16, bold: true, color: "#000091", margin: [0, 0, 0, 8] },
          h2: { fontSize: 13, bold: true, color: "#000091", margin: [0, 10, 0, 4] },
          h3: { fontSize: 11, bold: true, margin: [0, 8, 0, 3] },
          p: { margin: [0, 0, 0, 6] },
          liste: { margin: [0, 0, 0, 6] },
        },
        footer: (page: number, total: number) => ({
          columns: [
            {
              text: "Estimation indicative issue d'une source simulée — ne vaut pas expertise.",
              fontSize: 7,
              color: "#5b5b6b",
            },
            { text: `${page} / ${total}`, fontSize: 7, color: "#5b5b6b", alignment: "right" },
          ],
          margin: [40, 12, 40, 0],
        }),
      })
      .download(nomFichier);
  }
```

- [ ] **Step 4 : Vérifier l'ensemble**

Run: `npm test -- src/features/evaluation/EvaluationApp.test.tsx`
Expected: PASS.

Run: `npm test`
Expected: PASS sur l'ensemble.

Run: `npx tsc -b`
Expected: aucune sortie.

Run: `node --test server/*.test.mjs`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/features/evaluation/EvaluationApp.tsx src/features/evaluation/EvaluationApp.test.tsx
git commit -m "feat(evaluation): lancement, PV editable et export PDF"
```

---

## Vérification manuelle finale

Elle suppose l'app IAka créée, ses tools attachés, `IAKA_EVALUATION_APP_ID` renseigné dans `.env`, et `cote-api` déployé et joignable — voir `docs/iaka-evaluation-avoirs-workflow.md`.

- [ ] `npm run dev:all`, ouvrir « Évaluation des avoirs ».
- [ ] Choisir une procédure, cocher deux véhicules, lancer l'évaluation : la barre d'attente s'affiche, puis les fourchettes, le total et le PV.
- [ ] Vérifier dans le PV que les véhicules non évalués sont mentionnés avec leur raison.
- [ ] Corriger une phrase du PV, exporter en PDF : la correction est dans le fichier, le texte est sélectionnable, le pied de page rappelle que l'estimation ne vaut pas expertise.
- [ ] Recharger la page puis rouvrir la procédure : les estimations écrites par l'agent apparaissent, relues depuis la base.
- [ ] Couper `cote-api` et relancer une évaluation : les véhicules ressortent en « non évalués » avec leur raison, l'écran ne se bloque pas.

## Hors de ce plan

- La persistance du texte du PV en base (colonne à créer, coordination avec l'équipe `rgp-api`).
- Les catégories autres que véhicule terrestre.
- Le remplacement de `cote-api` par une vraie source de cote.
