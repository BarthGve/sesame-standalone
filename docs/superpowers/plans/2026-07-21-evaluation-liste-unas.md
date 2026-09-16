# Évaluation des avoirs — choix de la procédure dans une liste — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la saisie à l'aveugle d'un numéro de procédure par une liste des seules procédures exploitables — celles dont une perquisition porte au moins un objet saisi.

**Architecture:** Aucune route de `rgp-api` ne répond à « quelles procédures ont des objets » : `/perquisitions` exige un UNA. Le BFF agrège donc — il liste les procédures, interroge leurs perquisitions avec une concurrence bornée, et ne renvoie que celles portant des objets. Le navigateur ne fait qu'un appel. `rgp-api` n'est pas modifié : une autre équipe y travaille en ce moment.

**Tech Stack:** Node natif (`http`, `node --test`) pour le BFF ; React 19 + TypeScript + Vitest pour la page.

**Spec :** `docs/superpowers/specs/2026-07-20-evaluation-avoirs-design.md` (section « Parcours », amendée par ce plan)

## Global Constraints

- **Aucune dépendance npm ajoutée.**
- **INTERDIT : emoji dans le front.** Icônes = classe `material-icons` ou SVG inline.
- Code, commentaires, libellés d'interface et messages de commit **en français**.
- **Ne pas modifier `server/rgp-api/`** : fichiers en cours de modification par une autre équipe.
- Enveloppe de réponse du BFF identique à l'existant : succès `{ "data": … }`, erreur `{ "error": { "code", "message" } }`.
- Un champ absent ne doit produire ni ligne vide, ni ponctuation orpheline, ni libellé sans valeur.
- `npx tsc -b` doit rester sans sortie.
- Tests front : `npm test`. Tests BFF : `node --test server/*.test.mjs`.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `server/unasEvaluables.mjs` | Agrégation : procédures → perquisitions → ne garder que celles portant des objets. Pur, testable avec un `fetch` factice. |
| `server/proxy.mjs` | Route `GET /api/evaluation/unas`. |
| `src/features/evaluation/evaluationApi.ts` | `listerUnasEvaluables()`. |
| `src/features/evaluation/evaluationStore.ts` | Chargement et état de la liste. |
| `src/features/evaluation/UnasListe.tsx` | Rendu de la liste, sélection d'une procédure. |
| `src/features/evaluation/EvaluationApp.tsx` | Assemblage : liste au-dessus, saisie manuelle conservée en repli. |

---

### Task 1 : Agrégation des procédures exploitables (BFF)

**Files:**
- Create: `server/unasEvaluables.mjs`
- Test: `server/unasEvaluables.test.mjs`

**Interfaces:**
- Consumes: rien.
- Produces: `listerUnasEvaluables({ cfg, fetchImpl, limite, concurrence })` → `Promise<UnaEvaluable[]>` où
  `UnaEvaluable = { una, groupe, synthese, urgent, sensible, nbPerquisitions, nbObjets }`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `server/unasEvaluables.test.mjs` :

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { listerUnasEvaluables } from "./unasEvaluables.mjs";

const CFG = { rgpApiUrl: "http://rgp", rgpApiToken: "jeton" };

// fetch factice : sert les procédures, puis les perquisitions de chacune.
function stub(procedures, perquisitionsParUna, echecs = {}) {
  const appels = [];
  const fetchImpl = async (url) => {
    appels.push(url);
    if (url.includes("/procedures")) {
      return { ok: true, json: async () => ({ data: procedures }) };
    }
    const una = decodeURIComponent(new URL(url).searchParams.get("una"));
    if (echecs[una]) return { ok: false, status: echecs[una], json: async () => ({ error: { message: "boom" } }) };
    return { ok: true, json: async () => ({ data: perquisitionsParUna[una] ?? [] }) };
  };
  return { fetchImpl, appels };
}

const PROCS = [
  { una: "12345/00042/2026", groupe_libelle: "Groupe 1", synthese: "Cambriolages", urgent: true, sensible: false },
  { una: "12345/00043/2026", groupe_libelle: null, synthese: "Stupéfiants", urgent: false, sensible: true },
  { una: "12345/00044/2026", groupe_libelle: null, synthese: null, urgent: false, sensible: false },
];

test("ne garde que les procedures dont une perquisition porte des objets", async () => {
  const { fetchImpl } = stub(PROCS, {
    "12345/00042/2026": [{ id: 1, nb_objets: 3 }, { id: 2, nb_objets: 0 }],
    "12345/00043/2026": [{ id: 3, nb_objets: 0 }],
    "12345/00044/2026": [],
  });
  const r = await listerUnasEvaluables({ cfg: CFG, fetchImpl });
  assert.equal(r.length, 1);
  assert.equal(r[0].una, "12345/00042/2026");
});

test("remonte les compteurs et les elements d'identification de la procedure", async () => {
  const { fetchImpl } = stub(PROCS, {
    "12345/00042/2026": [{ id: 1, nb_objets: 3 }, { id: 2, nb_objets: 2 }],
    "12345/00043/2026": [],
    "12345/00044/2026": [],
  });
  const [una] = await listerUnasEvaluables({ cfg: CFG, fetchImpl });
  assert.deepEqual(una, {
    una: "12345/00042/2026",
    groupe: "Groupe 1",
    synthese: "Cambriolages",
    urgent: true,
    sensible: false,
    nbPerquisitions: 2,
    nbObjets: 5,
  });
});

test("le nombre de perquisitions ne compte que celles portant des objets", async () => {
  const { fetchImpl } = stub(PROCS, {
    "12345/00042/2026": [{ id: 1, nb_objets: 3 }, { id: 2, nb_objets: 0 }],
    "12345/00043/2026": [],
    "12345/00044/2026": [],
  });
  const [una] = await listerUnasEvaluables({ cfg: CFG, fetchImpl });
  assert.equal(una.nbPerquisitions, 1);
  assert.equal(una.nbObjets, 3);
});

test("une procedure dont les perquisitions sont illisibles est ignoree, les autres passent", async () => {
  const { fetchImpl } = stub(
    PROCS,
    { "12345/00042/2026": [{ id: 1, nb_objets: 3 }], "12345/00044/2026": [] },
    { "12345/00043/2026": 500 }
  );
  const r = await listerUnasEvaluables({ cfg: CFG, fetchImpl });
  assert.deepEqual(r.map((u) => u.una), ["12345/00042/2026"]);
});

test("l'ordre des procedures est conserve", async () => {
  const { fetchImpl } = stub(PROCS, {
    "12345/00042/2026": [{ id: 1, nb_objets: 1 }],
    "12345/00043/2026": [{ id: 2, nb_objets: 1 }],
    "12345/00044/2026": [{ id: 3, nb_objets: 1 }],
  });
  const r = await listerUnasEvaluables({ cfg: CFG, fetchImpl });
  assert.deepEqual(r.map((u) => u.una), PROCS.map((p) => p.una));
});

test("la limite borne le nombre de procedures interrogees", async () => {
  const { fetchImpl, appels } = stub(PROCS, {
    "12345/00042/2026": [{ id: 1, nb_objets: 1 }],
    "12345/00043/2026": [{ id: 2, nb_objets: 1 }],
    "12345/00044/2026": [{ id: 3, nb_objets: 1 }],
  });
  await listerUnasEvaluables({ cfg: CFG, fetchImpl, limite: 2 });
  const appelsPerquisitions = appels.filter((u) => u.includes("/perquisitions"));
  assert.equal(appelsPerquisitions.length, 2);
});

test("le jeton rgp accompagne chaque appel", async () => {
  const entetes = [];
  const fetchImpl = async (url, init) => {
    entetes.push(init?.headers?.Authorization);
    if (url.includes("/procedures")) return { ok: true, json: async () => ({ data: [PROCS[0]] }) };
    return { ok: true, json: async () => ({ data: [{ id: 1, nb_objets: 1 }] }) };
  };
  await listerUnasEvaluables({ cfg: CFG, fetchImpl });
  assert.ok(entetes.length >= 2);
  assert.ok(entetes.every((e) => e === "Bearer jeton"));
});

test("procedures illisibles au premier appel -> erreur explicite", async () => {
  const fetchImpl = async () => ({ ok: false, status: 502, json: async () => ({}) });
  await assert.rejects(listerUnasEvaluables({ cfg: CFG, fetchImpl }), /UNAS_UPSTREAM/);
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `node --test server/unasEvaluables.test.mjs`
Expected: FAIL — `Cannot find module './unasEvaluables.mjs'`.

- [ ] **Step 3 : Écrire le module**

Créer `server/unasEvaluables.mjs` :

```js
// Liste les procédures exploitables pour l'évaluation des avoirs : celles dont
// au moins une perquisition porte un objet saisi.
//
// Aucune route de rgp-api ne répond directement à cette question (/perquisitions
// exige un UNA), et son code appartient à un autre chantier en cours : on agrège
// donc ici. Le navigateur ne fait qu'un appel, et le jour où une requête SQL
// dédiée existera, seul ce fichier changera.

const LIMITE_PAR_DEFAUT = 50;
const CONCURRENCE_PAR_DEFAUT = 6;

async function lireJson(url, cfg, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${cfg.rgpApiToken}` },
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  if (!body || body.error) return null;
  return body.data;
}

// Exécute `traiter` sur chaque élément, au plus `concurrence` en vol.
// L'ordre du résultat suit celui des éléments, pas celui des réponses.
async function enParallele(elements, concurrence, traiter) {
  const resultats = new Array(elements.length);
  let curseur = 0;
  const ouvriers = Array.from({ length: Math.min(concurrence, elements.length) }, async () => {
    for (;;) {
      const i = curseur++;
      if (i >= elements.length) return;
      resultats[i] = await traiter(elements[i]);
    }
  });
  await Promise.all(ouvriers);
  return resultats;
}

/**
 * @param {object} p
 * @param {object} p.cfg          config (rgpApiUrl, rgpApiToken)
 * @param {number} [p.limite]     nombre maximum de procédures examinées
 * @param {number} [p.concurrence] appels simultanés vers rgp-api
 */
export async function listerUnasEvaluables({
  cfg,
  fetchImpl = globalThis.fetch,
  limite = LIMITE_PAR_DEFAUT,
  concurrence = CONCURRENCE_PAR_DEFAUT,
}) {
  const procedures = await lireJson(
    `${cfg.rgpApiUrl}/procedures?limit=${limite}`,
    cfg,
    fetchImpl
  );
  if (!procedures) throw new Error("UNAS_UPSTREAM");

  const examinees = procedures.slice(0, limite);
  const evaluees = await enParallele(examinees, concurrence, async (proc) => {
    const perquisitions = await lireJson(
      `${cfg.rgpApiUrl}/perquisitions?una=${encodeURIComponent(proc.una)}`,
      cfg,
      fetchImpl
    );
    // Procédure illisible : on l'écarte plutôt que de faire échouer toute la
    // liste. Une procédure manquante se remarque ; une liste vide, non.
    if (!perquisitions) return null;

    const avecObjets = perquisitions.filter((p) => Number(p.nb_objets) > 0);
    if (!avecObjets.length) return null;

    return {
      una: proc.una,
      groupe: proc.groupe_libelle ?? proc.groupe ?? null,
      synthese: proc.synthese ?? null,
      urgent: Boolean(proc.urgent),
      sensible: Boolean(proc.sensible),
      nbPerquisitions: avecObjets.length,
      nbObjets: avecObjets.reduce((total, p) => total + Number(p.nb_objets), 0),
    };
  });

  return evaluees.filter(Boolean);
}
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `node --test server/unasEvaluables.test.mjs`
Expected: PASS — 8 tests.

- [ ] **Step 5 : Brancher la route dans le BFF**

Dans `server/proxy.mjs` :

1. Ajouter l'import à côté des autres imports de modules serveur (vers la ligne 11) :

```js
import { listerUnasEvaluables } from "./unasEvaluables.mjs";
```

2. Ajouter le code d'erreur dans l'objet `ERROR_STATUS` :

```js
  UNAS_UPSTREAM: 502,
```

3. Ajouter la route juste avant la route `/api/synthese` (vers la ligne 251) :

```js
    if (url.pathname === "/api/evaluation/unas" && req.method === "GET") {
      try {
        const data = await listerUnasEvaluables({ cfg, fetchImpl });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data }));
      } catch (e) {
        const status = ERROR_STATUS[e.message] ?? 500;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message in ERROR_STATUS ? e.message : "INTERNAL_ERROR" }));
      }
      return;
    }
```

- [ ] **Step 6 : Vérifier l'ensemble du serveur**

Run: `node --test server/*.test.mjs`
Expected: PASS, aucune régression.

- [ ] **Step 7 : Commit**

```bash
git add server/unasEvaluables.mjs server/unasEvaluables.test.mjs server/proxy.mjs
git commit -m "feat(evaluation): liste des procedures portant des objets saisis"
```

---

### Task 2 : Liste des procédures dans l'écran

**Files:**
- Modify: `src/features/evaluation/evaluationApi.ts`
- Modify: `src/features/evaluation/evaluationStore.ts`
- Create: `src/features/evaluation/UnasListe.tsx`
- Modify: `src/features/evaluation/EvaluationApp.tsx`
- Test: `src/features/evaluation/UnasListe.test.tsx`, plus ajouts dans `evaluationStore.test.ts` et `EvaluationApp.test.tsx`

**Interfaces:**
- Consumes: `GET /api/evaluation/unas` → `{ data: UnaEvaluable[] }` (Task 1).
- Produces:
  - `type UnaEvaluable = { una: string; groupe: string | null; synthese: string | null; urgent: boolean; sensible: boolean; nbPerquisitions: number; nbObjets: number }`
  - `listerUnasEvaluables(fetchImpl?): Promise<UnaEvaluable[]>`
  - store : champs `unas: UnaEvaluable[]`, `chargementUnas: boolean` ; fonction `chargerUnas(fetchImpl?)`
  - `<UnasListe unas={UnaEvaluable[]} unaChoisi={string} onChoisir={(una: string) => void} />`

- [ ] **Step 1 : Écrire le test de la liste**

Créer `src/features/evaluation/UnasListe.test.tsx` :

```tsx
import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import UnasListe from "./UnasListe";
import type { UnaEvaluable } from "./evaluationApi";

const una = (p: Partial<UnaEvaluable> = {}): UnaEvaluable => ({
  una: "12345/00042/2026",
  groupe: "Groupe 1",
  synthese: "Cambriolages en série",
  urgent: false,
  sensible: false,
  nbPerquisitions: 2,
  nbObjets: 5,
  ...p,
});

test("affiche le numero, la synthese, le groupe et les compteurs", () => {
  render(<UnasListe unas={[una()]} unaChoisi="" onChoisir={() => {}} />);
  expect(screen.getByText(/12345\/00042\/2026/)).toBeTruthy();
  expect(screen.getByText(/Cambriolages en série/)).toBeTruthy();
  expect(screen.getByText(/Groupe 1/)).toBeTruthy();
  expect(screen.getByText(/2 perquisition/)).toBeTruthy();
  expect(screen.getByText(/5 objet/)).toBeTruthy();
});

test("signale urgent et sensible quand ils sont poses", () => {
  render(<UnasListe unas={[una({ urgent: true, sensible: true })]} unaChoisi="" onChoisir={() => {}} />);
  expect(screen.getByText("Urgent")).toBeTruthy();
  expect(screen.getByText("Sensible")).toBeTruthy();
});

test("n'affiche ni urgent ni sensible quand ils sont absents", () => {
  render(<UnasListe unas={[una()]} unaChoisi="" onChoisir={() => {}} />);
  expect(screen.queryByText("Urgent")).toBeNull();
  expect(screen.queryByText("Sensible")).toBeNull();
});

test("une procedure sans synthese ni groupe ne laisse pas de ligne vide", () => {
  const { container } = render(
    <UnasListe unas={[una({ synthese: null, groupe: null })]} unaChoisi="" onChoisir={() => {}} />
  );
  expect(screen.getByText(/12345\/00042\/2026/)).toBeTruthy();
  const vides = Array.from(container.querySelectorAll("p")).filter((p) => !p.textContent?.trim());
  expect(vides).toHaveLength(0);
});

test("choisir une procedure remonte son numero", () => {
  const onChoisir = vi.fn();
  render(<UnasListe unas={[una()]} unaChoisi="" onChoisir={onChoisir} />);
  screen.getByRole("button", { name: /12345\/00042\/2026/ }).click();
  expect(onChoisir).toHaveBeenCalledWith("12345/00042/2026");
});

test("la procedure choisie est marquee comme telle", () => {
  render(<UnasListe unas={[una()]} unaChoisi="12345/00042/2026" onChoisir={() => {}} />);
  expect(screen.getByRole("button", { name: /12345\/00042\/2026/ }).getAttribute("aria-pressed")).toBe("true");
});

test("liste vide : message explicite, pas d'ecran muet", () => {
  render(<UnasListe unas={[]} unaChoisi="" onChoisir={() => {}} />);
  expect(screen.getByText(/Aucune procédure/)).toBeTruthy();
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `npm test -- src/features/evaluation/UnasListe.test.tsx`
Expected: FAIL — `Failed to resolve import "./UnasListe"`.

- [ ] **Step 3 : Ajouter l'appel au client**

Dans `src/features/evaluation/evaluationApi.ts`, ajouter après les types existants :

```ts
export type UnaEvaluable = {
  una: string;
  groupe: string | null;
  synthese: string | null;
  urgent: boolean;
  sensible: boolean;
  nbPerquisitions: number;
  nbObjets: number;
};

/** Procédures exploitables : celles dont une perquisition porte au moins un objet. */
export async function listerUnasEvaluables(
  fetchImpl: typeof fetch = fetch
): Promise<UnaEvaluable[]> {
  const res = await fetchImpl("/api/evaluation/unas");
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) {
    throw new Error(body?.error?.message || body?.error || "ERREUR_UNAS");
  }
  return body.data as UnaEvaluable[];
}
```

- [ ] **Step 4 : Écrire le composant de liste**

Créer `src/features/evaluation/UnasListe.tsx` :

```tsx
import type { UnaEvaluable } from "./evaluationApi";

// Liste des procédures exploitables. Composant pur : le chargement et la
// sélection sont gérés par le store.

const ligne = (choisie: boolean): React.CSSProperties => ({
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  border: "none",
  borderBottom: "1px solid var(--c--globals--colors--gray-200, #e5e5e5)",
  background: choisie ? "#e3e3fd" : "#fff",
  cursor: "pointer",
  font: "inherit",
});

const titre: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: 0, color: "#000091" };
const detail: React.CSSProperties = { fontSize: 13, color: "#5b5b6b", margin: "2px 0 0" };

const marqueur = (fond: string, texte: string): React.CSSProperties => ({
  display: "inline-block",
  padding: "1px 6px",
  marginLeft: 6,
  borderRadius: 3,
  background: fond,
  color: texte,
  fontSize: 12,
  fontWeight: 700,
});

// Assemble les fragments non vides : un champ absent ne laisse pas de séparateur.
function joindre(...parts: (string | false | null)[]): string {
  return parts.filter(Boolean).join(" — ");
}

export default function UnasListe({
  unas,
  unaChoisi,
  onChoisir,
}: {
  unas: UnaEvaluable[];
  unaChoisi: string;
  onChoisir: (una: string) => void;
}) {
  if (!unas.length) {
    return (
      <p style={{ padding: "12px", margin: 0, fontSize: 14, color: "#5b5b6b" }}>
        Aucune procédure ne comporte d'objet saisi.
      </p>
    );
  }

  return (
    <div>
      {unas.map((u) => {
        const compteurs = joindre(
          `${u.nbPerquisitions} perquisition${u.nbPerquisitions > 1 ? "s" : ""}`,
          `${u.nbObjets} objet${u.nbObjets > 1 ? "s" : ""} saisi${u.nbObjets > 1 ? "s" : ""}`,
          u.groupe
        );
        return (
          <button
            key={u.una}
            type="button"
            onClick={() => onChoisir(u.una)}
            aria-pressed={u.una === unaChoisi}
            style={ligne(u.una === unaChoisi)}
          >
            <p style={titre}>
              {u.una}
              {u.urgent && <span style={marqueur("#ffe9e6", "#b34000")}>Urgent</span>}
              {u.sensible && <span style={marqueur("#fef7da", "#716043")}>Sensible</span>}
            </p>
            {u.synthese && <p style={detail}>{u.synthese}</p>}
            {compteurs && <p style={detail}>{compteurs}</p>}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5 : Lancer le test de la liste, vérifier le succès**

Run: `npm test -- src/features/evaluation/UnasListe.test.tsx`
Expected: PASS — 7 tests.

- [ ] **Step 6 : Écrire le test du store, vérifier l'échec**

Ajouter à la fin de `src/features/evaluation/evaluationStore.test.ts` :

```ts
const unasFactices = [
  { una: "12345/00042/2026", groupe: null, synthese: null, urgent: false, sensible: false, nbPerquisitions: 1, nbObjets: 2 },
];

test("charge la liste des procedures exploitables", async () => {
  const store = await import("./evaluationStore");
  const impl = (async () => ({ ok: true, json: async () => ({ data: unasFactices }) })) as unknown as typeof fetch;
  await store.chargerUnas(impl);
  expect(store.lireEtat().unas).toHaveLength(1);
  expect(store.lireEtat().chargementUnas).toBe(false);
});

test("un echec de chargement de la liste s'affiche sans bloquer l'ecran", async () => {
  const store = await import("./evaluationStore");
  const impl = (async () => ({ ok: false, json: async () => ({ error: { message: "Service indisponible" } }) })) as unknown as typeof fetch;
  await store.chargerUnas(impl);
  expect(store.lireEtat().erreur).toBe("Service indisponible");
  expect(store.lireEtat().chargementUnas).toBe(false);
  expect(store.lireEtat().unas).toEqual([]);
});
```

Run: `npm test -- src/features/evaluation/evaluationStore.test.ts`
Expected: FAIL — `store.chargerUnas is not a function`.

- [ ] **Step 7 : Étendre le store**

Dans `src/features/evaluation/evaluationStore.ts` :

1. Compléter l'import :

```ts
import { chargerUna, listerUnasEvaluables, type ChargementUna, type UnaEvaluable } from "./evaluationApi";
```

2. Ajouter les deux champs au type `EvaluationState` :

```ts
  /** Procédures exploitables, proposées au choix. */
  unas: UnaEvaluable[];
  chargementUnas: boolean;
```

3. Les ajouter à l'état initial du store (`unas: []`, `chargementUnas: false`) et à `clear()`.

4. Ajouter la fonction, sous `charger` :

```ts
export async function chargerUnas(fetchImpl: typeof fetch = fetch) {
  if (store.get().chargementUnas) return;
  store.set({ chargementUnas: true });
  try {
    store.set({ unas: await listerUnasEvaluables(fetchImpl), chargementUnas: false });
  } catch (e) {
    // La liste n'est qu'une aide au choix : son échec laisse la saisie manuelle
    // utilisable, on ne bloque pas l'écran.
    store.set({ erreur: (e as Error).message, chargementUnas: false });
  }
}
```

- [ ] **Step 8 : Lancer le test du store, vérifier le succès**

Run: `npm test -- src/features/evaluation/evaluationStore.test.ts`
Expected: PASS.

- [ ] **Step 9 : Écrire le test de l'écran, vérifier l'échec**

Ajouter à la fin de `src/features/evaluation/EvaluationApp.test.tsx` :

```tsx
test("la liste des procedures exploitables s'affiche au chargement de l'ecran", async () => {
  const unas = [
    { una: "12345/00042/2026", groupe: "Groupe 1", synthese: "Cambriolages", urgent: false, sensible: false, nbPerquisitions: 1, nbObjets: 3 },
  ];
  const impl = (async (url: string) => {
    if (url.startsWith("/api/evaluation/unas")) return { ok: true, json: async () => ({ data: unas }) };
    return { ok: true, json: async () => ({ data: [] }) };
  }) as unknown as typeof fetch;
  render(<EvaluationApp />);
  await act(async () => { await chargerUnas(impl); });
  expect(screen.getByText(/12345\/00042\/2026/)).toBeTruthy();
  expect(screen.getByText(/Cambriolages/)).toBeTruthy();
});

test("choisir une procedure dans la liste renseigne le champ de saisie", async () => {
  const unas = [
    { una: "12345/00042/2026", groupe: null, synthese: null, urgent: false, sensible: false, nbPerquisitions: 1, nbObjets: 3 },
  ];
  const impl = (async () => ({ ok: true, json: async () => ({ data: unas }) })) as unknown as typeof fetch;
  render(<EvaluationApp />);
  await act(async () => { await chargerUnas(impl); });
  await act(async () => { screen.getByRole("button", { name: /12345\/00042\/2026/ }).click(); });
  expect((screen.getByLabelText(/Numéro de procédure/) as HTMLInputElement).value).toBe("12345/00042/2026");
});
```

Compléter l'import en tête du fichier :

```tsx
import { clear, setUna, charger, chargerUnas } from "./evaluationStore";
```

Run: `npm test -- src/features/evaluation/EvaluationApp.test.tsx`
Expected: FAIL — la liste n'est pas rendue.

- [ ] **Step 10 : Brancher la liste dans l'écran**

Dans `src/features/evaluation/EvaluationApp.tsx` :

1. Compléter les imports :

```tsx
import { useEffect } from "react";
import UnasListe from "./UnasListe";
```

et ajouter `chargerUnas` et `unas`, `chargementUnas` aux éléments tirés du store.

2. Charger la liste à l'affichage de l'écran, dans le composant :

```tsx
  // La liste des procédures exploitables se charge à l'ouverture : l'enquêteur
  // choisit dans ce qui existe plutôt que de saisir un numéro à l'aveugle.
  useEffect(() => {
    if (!unas.length) chargerUnas();
  }, [unas.length]);
```

3. Insérer la liste entre le titre de section « Procédure » et le champ de saisie :

```tsx
      <div style={{ border: "1px solid var(--c--globals--colors--gray-300, #ccc)", borderRadius: 4, marginBottom: 16 }}>
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid var(--c--globals--colors--gray-300, #ddd)",
            background: "var(--c--globals--colors--gray-050, #f6f6f6)",
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          {chargementUnas ? "Chargement des procédures…" : "Procédures comportant des objets saisis"}
        </div>
        <UnasListe unas={unas} unaChoisi={una} onChoisir={(u) => { setUna(u); charger(); }} />
      </div>
```

4. Conserver le champ de saisie et son bouton « Rechercher » tels quels : une procédure connue se saisit plus vite qu'elle ne se cherche, et la saisie reste le repli si la liste ne se charge pas.

- [ ] **Step 11 : Vérifier l'ensemble**

Run: `npm test`
Expected: PASS sur l'ensemble.

Run: `npx tsc -b`
Expected: aucune sortie.

- [ ] **Step 12 : Commit**

```bash
git add src/features/evaluation/ && git commit -m "feat(evaluation): choix de la procedure dans une liste"
```

---

## Vérification manuelle finale

- [ ] `npm run dev`, ouvrir « Évaluation des avoirs ».
- [ ] La liste s'affiche seule, sans saisie préalable, et ne contient que des procédures portant des objets.
- [ ] Les marqueurs « Urgent » et « Sensible » apparaissent sur les procédures concernées, et seulement sur celles-là.
- [ ] Cliquer une procédure : le champ se remplit et les véhicules se chargent.
- [ ] Couper le BFF puis recharger : la liste échoue avec un message, et la saisie manuelle reste utilisable.
