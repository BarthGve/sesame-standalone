# Ariane — Plan B : front (5 vues, dropzone, polling, réseau cytoscape)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire la page front du cas d'usage Ariane : dépôt de N PDF, suivi de progression du job, et affichage des 5 vues (synthèse, parties, 2 lignes de temps, réseau relationnel) dérivées du contrat renvoyé par le BFF (`/api/ariane`).

**Architecture:** Feature React sous `src/features/ariane/`, calquée sur `rens`/`synthese` : un `arianeApi.ts` (types du contrat + upload + polling), un store hors-React via `createPersistedStore` qui pilote la boucle POST→poll, des composants de vue purs alimentés par le `Dossier`. Le graphe utilise `cytoscape` (nouvelle dépendance). Nav + route ajoutées dans `App.tsx`.

**Tech Stack:** React 19 + TS strict, Vite. UI : `@gouvfr-lasuite/cunningham-react` / `ui-kit`, material-icons, styles inline (convention du repo). `react-markdown` + `remark-gfm` (déjà présents) pour la synthèse. `cytoscape` (à ajouter) pour le réseau. Tests : Vitest + Testing Library (jsdom), `src/**/*.test.{ts,tsx}`.

## Global Constraints

- Cible spec : `docs/superpowers/specs/2026-07-19-ariane-design.md` §6 (front). Contrat = §4.4. Backend déjà livré (Plan A) : `POST /api/ariane` → `202 { jobId }` ; `GET /api/ariane/status?jobId=` → `{ status, progress:{done,total}, result?, error? }`.
- **AUCUNE emoji** nulle part (règle CLAUDE.md) — icônes via `<span className="material-icons">`, texte, ou SVG.
- Bleu DSFR `#000091` pour titres/accents (convention des autres features).
- Styles **inline** comme `SyntheseApp.tsx`/`RensResult.tsx` (pas de nouveau fichier CSS).
- Store via `createPersistedStore` (`src/lib/createPersistedStore.ts`) : API `{ get, set, subscribe, use }`. Hook exposé `useAriane = store.use`. Fonction `snapshotForTest()` pour les tests.
- Erreurs API : lire `res.json().error` (code), sinon `"ERREUR_INCONNUE"`. Mapper les codes en messages FR dans le store (comme `rensStore` `MESSAGES`).
- **Statut de job tolérant** : le backend émet `pending`/`map`/`reduce`/`done`/`error` (jamais `assemble`, malgré la spec §6). Le front NE doit PAS coder en dur la liste : tout statut ≠ `done` et ≠ `error` = « en cours » (afficher la progression). Seuls `done` (→ rendre) et `error` (→ alerte) sont terminaux.
- Gate de build : `npm run build` (`tsc -b && vite build`) — TS strict (`noUnusedLocals`/`noUnusedParameters`). Tests : `npx vitest run`.
- Le contrat NE fournit PAS de rendu ligne-par-ligne côté LLM : le front consomme le JSON tel quel, aucune logique métier dupliquée.

### Types du contrat (TS) — définis en Task 2, consommés partout

```ts
export type Role = "mis_en_cause" | "victime" | "temoin" | "enqueteur" | "requis" | "magistrat" | "autre";
export type Partie = { id: string; nom: string; role: Role; aliases: string[]; qualite: string; premiere_cote: string };
export type Evenement = { id: string; date: string; precision: string; libelle: string; cote_source: string; parties: string[] };
export type Acte = { id: string; date: string; type: string; cote: string; libelle: string; redacteur: string | null; concernes: string[] };
export type Relation = { source: string; cible: string; type: string; libelle: string; cotes: string[] };
export type Affaire = { reference: string; nature: string; service: string; periode: { debut: string | null; fin: string | null }; nb_cotes: number };
export type Dossier = { affaire: Affaire; synthese: string; parties: Partie[]; evenements: Evenement[]; actes: Acte[]; relations: Relation[] };
export type JobStatus = { status: string; progress: { done: number; total: number }; result?: Dossier; error?: string };
export type PieceEncodee = { base64: string; mime: string; filename: string };
```

---

## Task 1: Débloquer le build (bug de type nav pré-existant)

**Files:**
- Modify: `src/App.tsx` (composant `NavGroup`, ~ligne 114)

Le working tree contient une édition non commitée qui casse `tsc -b` : `function NavGroup({ label, icon, items }: NavGroupDef)` alors que `NavGroupDef = { group; icon; items }` (pas de `label`), et l'appelant (ligne ~148) passe `label={it.group}`. Aucune tâche gate-buildée ne peut passer tant que ce n'est pas corrigé. Correctif minimal : typer `NavGroup` sur ce qu'il reçoit réellement (un `label`, pas un `group`).

- [ ] **Step 1: Vérifier l'échec**

Run: `npm run build 2>&1 | head -5`
Expected: erreurs `TS2339: Property 'label' does not exist on type 'NavGroupDef'` (App.tsx:114 et :148).

- [ ] **Step 2: Corriger la signature de `NavGroup`**

Dans `src/App.tsx`, remplacer la signature du composant `NavGroup` :

```tsx
function NavGroup({ label, icon, items }: NavGroupDef) {
```

par une signature typée sur les props réellement passées (`label`, `icon`, `items`) :

```tsx
function NavGroup({ label, icon, items }: { label: string; icon: string; items: NavLeaf[] }) {
```

(Ne rien changer d'autre : l'appelant passe déjà `label={it.group} icon={it.icon} items={it.items}`.)

- [ ] **Step 3: Vérifier le build vert**

Run: `npm run build`
Expected: succès (`tsc -b` sans erreur, `vite build` produit `dist/`). Si une AUTRE erreur pré-existante non liée à la nav apparaît (ex. `lightningcss` sur `index.css`), NE PAS la corriger ici : la consigner dans le rapport comme pré-existante et hors périmètre, et retomber sur `npx tsc -b` comme preuve de non-régression TS.

- [ ] **Step 4: Vérifier les tests**

Run: `npx vitest run`
Expected: 81 passed (aucune régression).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "fix(nav): type NavGroup sur ses props (label) — débloque tsc -b"
```

---

## Task 2: `arianeApi.ts` — types du contrat + upload + polling

**Files:**
- Create: `src/features/ariane/arianeApi.ts`
- Test: `src/features/ariane/arianeApi.test.ts`

**Interfaces:**
- Produces: tous les types du contrat (voir Global Constraints) ; `encodePiece(file: File): Promise<PieceEncodee>` ; `startAnalyse(files: PieceEncodee[], fetchImpl?): Promise<string>` (POST `/api/ariane` → `jobId` ; throw code si `!ok`) ; `fetchStatus(jobId: string, fetchImpl?): Promise<JobStatus>` (GET `/api/ariane/status?jobId=` → JSON ; throw code si `!ok`) ; constantes `ACCEPT_ATTR = ".pdf"`, `TAILLE_MAX_OCTETS = 20*1024*1024`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/features/ariane/arianeApi.test.ts` :

```ts
import { describe, it, expect, vi } from "vitest";
import { startAnalyse, fetchStatus } from "./arianeApi";

describe("arianeApi", () => {
  it("startAnalyse POST /api/ariane renvoie le jobId", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobId: "j1" }) });
    const id = await startAnalyse([{ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }], fetchImpl as unknown as typeof fetch);
    expect(id).toBe("j1");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/ariane");
    expect(JSON.parse(init.body).files).toHaveLength(1);
  });

  it("startAnalyse propage le code d'erreur du proxy", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "FICHIERS_REQUIS" }) });
    await expect(startAnalyse([], fetchImpl as unknown as typeof fetch)).rejects.toThrow("FICHIERS_REQUIS");
  });

  it("fetchStatus GET renvoie le snapshot du job", async () => {
    const snap = { status: "done", progress: { done: 2, total: 2 }, result: { affaire: {}, parties: [] } };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => snap });
    const out = await fetchStatus("j1", fetchImpl as unknown as typeof fetch);
    expect(out.status).toBe("done");
    expect(fetchImpl.mock.calls[0][0]).toContain("jobId=j1");
  });
});
```

- [ ] **Step 2: Lancer le test — doit échouer**

Run: `npx vitest run src/features/ariane/arianeApi.test.ts`
Expected: FAIL (`Cannot find module './arianeApi'`).

- [ ] **Step 3: Écrire l'implémentation**

Créer `src/features/ariane/arianeApi.ts` :

```ts
// Client Ariane : upload des pièces au proxy (/api/ariane) puis polling du job
// (/api/ariane/status) jusqu'au contrat final. Voir docs/.../2026-07-19-ariane-design.md §4.4/§6.

export type Role = "mis_en_cause" | "victime" | "temoin" | "enqueteur" | "requis" | "magistrat" | "autre";
export type Partie = { id: string; nom: string; role: Role; aliases: string[]; qualite: string; premiere_cote: string };
export type Evenement = { id: string; date: string; precision: string; libelle: string; cote_source: string; parties: string[] };
export type Acte = { id: string; date: string; type: string; cote: string; libelle: string; redacteur: string | null; concernes: string[] };
export type Relation = { source: string; cible: string; type: string; libelle: string; cotes: string[] };
export type Affaire = { reference: string; nature: string; service: string; periode: { debut: string | null; fin: string | null }; nb_cotes: number };
export type Dossier = { affaire: Affaire; synthese: string; parties: Partie[]; evenements: Evenement[]; actes: Acte[]; relations: Relation[] };
export type JobStatus = { status: string; progress: { done: number; total: number }; result?: Dossier; error?: string };
export type PieceEncodee = { base64: string; mime: string; filename: string };

export const ACCEPT_ATTR = ".pdf";
export const TAILLE_MAX_OCTETS = 20 * 1024 * 1024;

export function encodePiece(file: File): Promise<PieceEncodee> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string; // "data:<mime>;base64,<data>"
      const comma = res.indexOf(",");
      resolve({ base64: res.slice(comma + 1), mime: file.type || "application/pdf", filename: file.name });
    };
    reader.onerror = () => reject(new Error("LECTURE_FICHIER"));
    reader.readAsDataURL(file);
  });
}

async function errorCode(res: { json: () => Promise<unknown> }): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? "ERREUR_INCONNUE";
  } catch {
    return "ERREUR_INCONNUE";
  }
}

export async function startAnalyse(files: PieceEncodee[], fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl("/api/ariane", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
  if (!res.ok) throw new Error(await errorCode(res));
  const { jobId } = (await res.json()) as { jobId?: string };
  if (!jobId) throw new Error("ARIANE_INVALIDE");
  return jobId;
}

export async function fetchStatus(jobId: string, fetchImpl: typeof fetch = fetch): Promise<JobStatus> {
  const res = await fetchImpl(`/api/ariane/status?jobId=${encodeURIComponent(jobId)}`, { method: "GET" });
  if (!res.ok) throw new Error(await errorCode(res));
  return (await res.json()) as JobStatus;
}
```

- [ ] **Step 4: Lancer le test — doit passer**

Run: `npx vitest run src/features/ariane/arianeApi.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/ariane/arianeApi.ts src/features/ariane/arianeApi.test.ts
git commit -m "feat(ariane/front): arianeApi — types contrat + upload + polling"
```

---

## Task 3: `arianeStore.ts` — état + boucle POST→poll

**Files:**
- Create: `src/features/ariane/arianeStore.ts`
- Test: `src/features/ariane/arianeStore.test.ts`

**Interfaces:**
- Consumes: `arianeApi` (`encodePiece`, `startAnalyse`, `fetchStatus`, types).
- Produces: `useAriane()` (hook) ; `snapshotForTest(): ArianeState` ; actions `setPieces(files: File[])`, `run(deps?)`, `reset()`, `setView(v: ViewKey)`, `selectCote(cote?: string)`. Type `ViewKey = "synthese" | "parties" | "faits" | "actes" | "reseau"`.
- `run` accepte `deps` optionnel `{ sleep?, intervalMs?, maxPolls? }` pour les tests (défauts : `sleep = (ms)=>new Promise(r=>setTimeout(r,ms))`, `intervalMs = 1500`, `maxPolls = 400`).
- État : `{ pieces: File[]; running: boolean; statusLabel: string; progress: {done:number;total:number}; dossier?: Dossier; error?: string; view: ViewKey; selectedCote?: string }`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/features/ariane/arianeStore.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("arianeStore", () => {
  beforeEach(() => { sessionStorage.clear(); vi.resetModules(); vi.restoreAllMocks(); });

  function fakeFile(name: string): File {
    return new File([new Uint8Array([1, 2, 3])], name, { type: "application/pdf" });
  }
  const dossier = { affaire: { reference: "r", nature: "Vol", service: "BR", periode: { debut: null, fin: null }, nb_cotes: 1 }, synthese: "s", parties: [], evenements: [], actes: [], relations: [] };

  it("run : POST puis poll jusqu'à done → dossier rempli", async () => {
    vi.doMock("./arianeApi", () => ({
      encodePiece: vi.fn().mockResolvedValue({ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }),
      startAnalyse: vi.fn().mockResolvedValue("j1"),
      fetchStatus: vi.fn()
        .mockResolvedValueOnce({ status: "map", progress: { done: 0, total: 1 } })
        .mockResolvedValueOnce({ status: "done", progress: { done: 1, total: 1 }, result: dossier }),
    }));
    const store = await import("./arianeStore");
    store.setPieces([fakeFile("D1.pdf")]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    const s = store.snapshotForTest();
    expect(s.dossier?.affaire.nature).toBe("Vol");
    expect(s.running).toBe(false);
    expect(s.error).toBeUndefined();
  });

  it("run : statut error → message mappé, pas de dossier", async () => {
    vi.doMock("./arianeApi", () => ({
      encodePiece: vi.fn().mockResolvedValue({ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }),
      startAnalyse: vi.fn().mockResolvedValue("j1"),
      fetchStatus: vi.fn().mockResolvedValue({ status: "error", progress: { done: 0, total: 1 }, error: "ARIANE_UPSTREAM" }),
    }));
    const store = await import("./arianeStore");
    store.setPieces([fakeFile("D1.pdf")]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    const s = store.snapshotForTest();
    expect(s.dossier).toBeUndefined();
    expect(s.error).toMatch(/indisponible/i);
    expect(s.running).toBe(false);
  });

  it("setView / selectCote mettent à jour l'état", async () => {
    vi.doMock("./arianeApi", () => ({ encodePiece: vi.fn(), startAnalyse: vi.fn(), fetchStatus: vi.fn() }));
    const store = await import("./arianeStore");
    store.setView("reseau");
    store.selectCote("D5");
    const s = store.snapshotForTest();
    expect(s.view).toBe("reseau");
    expect(s.selectedCote).toBe("D5");
  });
});
```

- [ ] **Step 2: Lancer le test — doit échouer**

Run: `npx vitest run src/features/ariane/arianeStore.test.ts`
Expected: FAIL (`Cannot find module './arianeStore'`).

- [ ] **Step 3: Écrire l'implémentation**

Créer `src/features/ariane/arianeStore.ts` :

```ts
import { createPersistedStore } from "../../lib/createPersistedStore";
import { encodePiece, startAnalyse, fetchStatus, type Dossier } from "./arianeApi";

// État de la page Ariane hors composant : pièces choisies, job en cours, contrat,
// vue active et cote sélectionnée. La boucle POST→poll tourne ICI.

export type ViewKey = "synthese" | "parties" | "faits" | "actes" | "reseau";

const MESSAGES: Record<string, string> = {
  ARIANE_TIMEOUT: "Délai dépassé. Réessayez.",
  ARIANE_UPSTREAM: "Service d'analyse indisponible. Réessayez.",
  ARIANE_INVALIDE: "Réponse d'analyse non conforme. Réessayez.",
  FICHIERS_REQUIS: "Ajoutez au moins une pièce PDF.",
  LECTURE_FICHIER: "Lecture d'un fichier impossible.",
  ERREUR_INCONNUE: "Erreur inconnue.",
};
const msg = (code: string) => MESSAGES[code] ?? code;

const STATUS_LABELS: Record<string, string> = {
  pending: "Préparation…",
  map: "Extraction des pièces…",
  reduce: "Consolidation…",
  assemble: "Assemblage…",
};
const statusLabel = (status: string) => STATUS_LABELS[status] ?? "Analyse en cours…";

export type ArianeState = {
  pieces: File[];
  running: boolean;
  statusLabel: string;
  progress: { done: number; total: number };
  dossier?: Dossier;
  error?: string;
  view: ViewKey;
  selectedCote?: string;
};

const store = createPersistedStore<ArianeState>({
  pieces: [], running: false, statusLabel: "", progress: { done: 0, total: 0 }, view: "synthese",
});

export function setPieces(pieces: File[]) {
  store.set({ pieces, error: undefined });
}

export function setView(view: ViewKey) {
  store.set({ view });
}

export function selectCote(selectedCote?: string) {
  store.set({ selectedCote });
}

export function reset() {
  store.set({ pieces: [], running: false, statusLabel: "", progress: { done: 0, total: 0 }, dossier: undefined, error: undefined, selectedCote: undefined });
}

type RunDeps = { sleep?: (ms: number) => Promise<void>; intervalMs?: number; maxPolls?: number };

export async function run(deps: RunDeps = {}) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const intervalMs = deps.intervalMs ?? 1500;
  const maxPolls = deps.maxPolls ?? 400;
  const { pieces, running } = store.get();
  if (running || pieces.length === 0) return;
  store.set({ running: true, error: undefined, dossier: undefined, selectedCote: undefined, statusLabel: "Préparation…", progress: { done: 0, total: pieces.length } });
  try {
    const encoded = await Promise.all(pieces.map(encodePiece));
    const jobId = await startAnalyse(encoded);
    for (let i = 0; i < maxPolls; i++) {
      const snap = await fetchStatus(jobId);
      store.set({ progress: snap.progress ?? store.get().progress, statusLabel: statusLabel(snap.status) });
      if (snap.status === "done") {
        if (!snap.result) throw new Error("ARIANE_INVALIDE");
        store.set({ dossier: snap.result, running: false, statusLabel: "" });
        return;
      }
      if (snap.status === "error") throw new Error(snap.error || "ARIANE_UPSTREAM");
      await sleep(intervalMs);
    }
    throw new Error("ARIANE_TIMEOUT");
  } catch (e) {
    store.set({ running: false, statusLabel: "", error: msg((e as Error).message) });
  }
}

export const useAriane = store.use;

export function snapshotForTest(): ArianeState {
  return store.get();
}
```

- [ ] **Step 4: Lancer le test — doit passer**

Run: `npx vitest run src/features/ariane/arianeStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/ariane/arianeStore.ts src/features/ariane/arianeStore.test.ts
git commit -m "feat(ariane/front): arianeStore — boucle POST→poll + vue/cote"
```

---

## Task 4: `graph.ts` — helpers purs (rôles, groupes, éléments cytoscape, entrées timeline)

**Files:**
- Create: `src/features/ariane/graph.ts`
- Test: `src/features/ariane/graph.test.ts`

**Interfaces:**
- Consumes: types de `arianeApi`.
- Produces :
  - `ROLE_LABELS: Record<Role,string>` (libellés FR), `ROLE_COLORS: Record<Role,string>` (couleur par rôle), `ROLE_ORDER: Role[]`.
  - `REL_LABELS: Record<string,string>` (libellés FR des types de relation).
  - `groupByRole(parties: Partie[]): { role: Role; label: string; color: string; parties: Partie[] }[]` — dans l'ordre `ROLE_ORDER`, groupes vides omis.
  - `buildElements(dossier: Dossier): ElementDefinition[]` — nœuds (parties, `data:{id,label,role}`) + arêtes (relations, `data:{id,source,target,label,cotes}`).
  - `CY_STYLE: Stylesheet[]` — style cytoscape (couleur des nœuds par rôle, arêtes avec label).
  - `TimelineEntry = { id: string; date: string; libelle: string; cote: string; tag?: string }` ; `evenementsToEntries(dossier): TimelineEntry[]` (triées par date, `cote = cote_source`) ; `actesToEntries(dossier): TimelineEntry[]` (triées par date, `cote = cote`, `tag = type`).

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/features/ariane/graph.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { groupByRole, buildElements, evenementsToEntries, actesToEntries, ROLE_ORDER } from "./graph";
import type { Dossier } from "./arianeApi";

const dossier: Dossier = {
  affaire: { reference: "r", nature: "Vol", service: "BR", periode: { debut: "2026-03-04", fin: "2026-03-06" }, nb_cotes: 2 },
  synthese: "s",
  parties: [
    { id: "p1", nom: "DUPONT", role: "mis_en_cause", aliases: [], qualite: "", premiere_cote: "D1" },
    { id: "p2", nom: "MERIDIA", role: "victime", aliases: [], qualite: "", premiere_cote: "D1" },
    { id: "p3", nom: "MARTIN", role: "enqueteur", aliases: [], qualite: "", premiere_cote: "D1" },
  ],
  evenements: [
    { id: "e1", date: "2026-03-06", precision: "jour", libelle: "fait tardif", cote_source: "D2", parties: ["p1"] },
    { id: "e2", date: "2026-03-04", precision: "jour", libelle: "fait initial", cote_source: "D1", parties: ["p1", "p2"] },
  ],
  actes: [
    { id: "a1", date: "2026-03-05", type: "audition", cote: "D2", libelle: "audition", redacteur: "p3", concernes: ["p1"] },
  ],
  relations: [
    { source: "p2", cible: "p1", type: "victime_de", libelle: "victime", cotes: ["D1"] },
    { source: "p1", cible: "p3", type: "entendu_par", libelle: "entendu par", cotes: ["D2"] },
  ],
};

describe("graph helpers", () => {
  it("groupByRole ordonne selon ROLE_ORDER et omet les rôles vides", () => {
    const groups = groupByRole(dossier.parties);
    expect(groups.map((g) => g.role)).toEqual(["mis_en_cause", "victime", "enqueteur"]);
    expect(groups[0].parties[0].nom).toBe("DUPONT");
    expect(ROLE_ORDER[0]).toBe("mis_en_cause");
  });

  it("buildElements produit nœuds + arêtes", () => {
    const els = buildElements(dossier);
    const nodes = els.filter((e) => !("source" in (e.data as Record<string, unknown>)));
    const edges = els.filter((e) => "source" in (e.data as Record<string, unknown>));
    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(2);
    expect(edges[0].data).toMatchObject({ source: "p2", target: "p1" });
  });

  it("evenementsToEntries triées par date (cote_source)", () => {
    const entries = evenementsToEntries(dossier);
    expect(entries.map((e) => e.libelle)).toEqual(["fait initial", "fait tardif"]);
    expect(entries[0].cote).toBe("D1");
  });

  it("actesToEntries : cote + tag=type", () => {
    const entries = actesToEntries(dossier);
    expect(entries[0]).toMatchObject({ cote: "D2", tag: "audition" });
  });
});
```

- [ ] **Step 2: Lancer le test — doit échouer**

Run: `npx vitest run src/features/ariane/graph.test.ts`
Expected: FAIL (`Cannot find module './graph'`).

- [ ] **Step 3: Écrire l'implémentation**

Créer `src/features/ariane/graph.ts` :

```ts
import type { ElementDefinition, Stylesheet } from "cytoscape";
import type { Role, Partie, Dossier } from "./arianeApi";

export const ROLE_ORDER: Role[] = ["mis_en_cause", "victime", "temoin", "enqueteur", "requis", "magistrat", "autre"];

export const ROLE_LABELS: Record<Role, string> = {
  mis_en_cause: "Mis en cause",
  victime: "Victimes",
  temoin: "Témoins",
  enqueteur: "Enquêteurs",
  requis: "Requis",
  magistrat: "Magistrats",
  autre: "Autres",
};

export const ROLE_COLORS: Record<Role, string> = {
  mis_en_cause: "#e1000f",
  victime: "#0063cb",
  temoin: "#716043",
  enqueteur: "#000091",
  requis: "#68a532",
  magistrat: "#6e445a",
  autre: "#929292",
};

export const REL_LABELS: Record<string, string> = {
  famille: "famille",
  complice: "complice",
  connait: "connaît",
  victime_de: "victime de",
  entendu_par: "entendu par",
  requis_par: "requis par",
  autre: "lié à",
};

export function groupByRole(parties: Partie[]) {
  return ROLE_ORDER
    .map((role) => ({ role, label: ROLE_LABELS[role], color: ROLE_COLORS[role], parties: parties.filter((p) => p.role === role) }))
    .filter((g) => g.parties.length > 0);
}

export function buildElements(dossier: Dossier): ElementDefinition[] {
  const nodes: ElementDefinition[] = dossier.parties.map((p) => ({ data: { id: p.id, label: p.nom, role: p.role } }));
  const edges: ElementDefinition[] = dossier.relations.map((r, i) => ({
    data: { id: `r${i}`, source: r.source, target: r.cible, label: REL_LABELS[r.type] ?? r.type, cotes: r.cotes },
  }));
  return [...nodes, ...edges];
}

export const CY_STYLE: Stylesheet[] = [
  { selector: "node", style: {
      "background-color": (el: cytoscape.NodeSingular) => ROLE_COLORS[(el.data("role") as Role)] ?? ROLE_COLORS.autre,
      label: "data(label)", color: "#161616", "font-size": 11, "text-valign": "bottom", "text-margin-y": 4,
      width: 26, height: 26 } as unknown as Stylesheet["style"] },
  { selector: "edge", style: {
      width: 1.5, "line-color": "#ccc", "target-arrow-color": "#ccc", "target-arrow-shape": "triangle",
      "curve-style": "bezier", label: "data(label)", "font-size": 9, color: "#5b5b6b",
      "text-rotation": "autorotate", "text-background-color": "#fff", "text-background-opacity": 1, "text-background-padding": 2 } as unknown as Stylesheet["style"] },
];

export type TimelineEntry = { id: string; date: string; libelle: string; cote: string; tag?: string };

const byDate = (a: TimelineEntry, b: TimelineEntry) => a.date.localeCompare(b.date);

export function evenementsToEntries(dossier: Dossier): TimelineEntry[] {
  return dossier.evenements
    .map((e) => ({ id: e.id, date: e.date, libelle: e.libelle, cote: e.cote_source }))
    .sort(byDate);
}

export function actesToEntries(dossier: Dossier): TimelineEntry[] {
  return dossier.actes
    .map((a) => ({ id: a.id, date: a.date, libelle: a.libelle, cote: a.cote, tag: a.type }))
    .sort(byDate);
}
```

- [ ] **Step 4: Ajouter la dépendance cytoscape (types requis pour compiler)**

Le fichier importe les types de `cytoscape`. Installer la dépendance :

Run: `npm install cytoscape@^3.30.0 && npm install -D @types/cytoscape@^3.21.0`
Expected: ajout à `package.json`, pas d'erreur.

- [ ] **Step 5: Lancer le test + typecheck**

Run: `npx vitest run src/features/ariane/graph.test.ts && npx tsc -b`
Expected: PASS (4 tests) + typecheck sans erreur.

- [ ] **Step 6: Commit**

```bash
git add src/features/ariane/graph.ts src/features/ariane/graph.test.ts package.json package-lock.json
git commit -m "feat(ariane/front): helpers graph/timeline + dépendance cytoscape"
```

---

## Task 5: Vues présentables — Synthèse, Parties, Timeline

**Files:**
- Create: `src/features/ariane/SyntheseView.tsx`
- Create: `src/features/ariane/PartiesView.tsx`
- Create: `src/features/ariane/Timeline.tsx`
- Test: `src/features/ariane/views.test.tsx`

**Interfaces:**
- Consumes: `Dossier`, `groupByRole`, `ROLE_COLORS`, `evenementsToEntries`, `actesToEntries`, `TimelineEntry`.
- Produces :
  - `SyntheseView({ dossier }: { dossier: Dossier })` — rend `dossier.synthese` en markdown (react-markdown + remarkGfm) + un entête `affaire`.
  - `PartiesView({ dossier }: { dossier: Dossier })` — parties groupées par rôle (pastille couleur, nom, qualité, aliases).
  - `Timeline({ entries, onSelectCote, selectedCote }: { entries: TimelineEntry[]; onSelectCote: (cote: string) => void; selectedCote?: string })` — frise verticale, chaque entrée : date, tag éventuel, libellé, bouton cote.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/features/ariane/views.test.tsx` :

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PartiesView from "./PartiesView";
import Timeline from "./Timeline";
import type { Dossier } from "./arianeApi";
import { evenementsToEntries } from "./graph";

const dossier: Dossier = {
  affaire: { reference: "r", nature: "Vol", service: "BR", periode: { debut: "2026-03-04", fin: "2026-03-06" }, nb_cotes: 1 },
  synthese: "## Synthèse\n\ntexte",
  parties: [{ id: "p1", nom: "DUPONT", role: "mis_en_cause", aliases: ["le suspect"], qualite: "sans profession", premiere_cote: "D1" }],
  evenements: [{ id: "e1", date: "2026-03-04", precision: "jour", libelle: "effraction", cote_source: "D2", parties: ["p1"] }],
  actes: [], relations: [],
};

describe("vues Ariane", () => {
  it("PartiesView affiche le nom et le rôle", () => {
    render(<PartiesView dossier={dossier} />);
    expect(screen.getByText("DUPONT")).toBeTruthy();
    expect(screen.getByText(/Mis en cause/i)).toBeTruthy();
  });

  it("Timeline affiche l'entrée et déclenche onSelectCote au clic sur la cote", () => {
    const onSelectCote = vi.fn();
    render(<Timeline entries={evenementsToEntries(dossier)} onSelectCote={onSelectCote} />);
    expect(screen.getByText("effraction")).toBeTruthy();
    fireEvent.click(screen.getByText("D2"));
    expect(onSelectCote).toHaveBeenCalledWith("D2");
  });
});
```

- [ ] **Step 2: Lancer le test — doit échouer**

Run: `npx vitest run src/features/ariane/views.test.tsx`
Expected: FAIL (modules absents).

- [ ] **Step 3: Écrire les 3 composants**

Créer `src/features/ariane/SyntheseView.tsx` :

```tsx
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Dossier } from "./arianeApi";

const mdComponents: Components = {
  table: ({ children }) => <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>{children}</table></div>,
  th: ({ children }) => <th style={{ textAlign: "left", padding: "6px 10px", borderBottom: "2px solid #ddd", color: "#5C5F63" }}>{children}</th>,
  td: ({ children }) => <td style={{ padding: "6px 10px", borderBottom: "1px solid #eee" }}>{children}</td>,
  p: ({ children }) => <p style={{ margin: "0 0 8px" }}>{children}</p>,
};

export default function SyntheseView({ dossier }: { dossier: Dossier }) {
  const { affaire } = dossier;
  return (
    <div style={{ lineHeight: 1.5 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16, fontSize: 13, color: "#5b5b6b" }}>
        <span><strong>Affaire :</strong> {affaire.nature}</span>
        <span><strong>Réf :</strong> {affaire.reference}</span>
        <span><strong>Service :</strong> {affaire.service}</span>
        {affaire.periode.debut && <span><strong>Période :</strong> {affaire.periode.debut} → {affaire.periode.fin}</span>}
        <span><strong>Cotes :</strong> {affaire.nb_cotes}</span>
      </div>
      <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{dossier.synthese}</Markdown>
    </div>
  );
}
```

Créer `src/features/ariane/PartiesView.tsx` :

```tsx
import type { Dossier } from "./arianeApi";
import { groupByRole } from "./graph";

export default function PartiesView({ dossier }: { dossier: Dossier }) {
  const groups = groupByRole(dossier.parties);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {groups.map((g) => (
        <section key={g.role}>
          <h3 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, margin: "0 0 8px" }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: g.color, display: "inline-block" }} aria-hidden />
            {g.label} <span style={{ color: "#929292", fontWeight: 400 }}>({g.parties.length})</span>
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
            {g.parties.map((p) => (
              <div key={p.id} style={{ border: "1px solid #e5e5e5", borderRadius: 6, padding: "10px 12px" }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{p.nom}</div>
                {p.qualite && <div style={{ fontSize: 12, color: "#5b5b6b", marginTop: 2 }}>{p.qualite}</div>}
                {p.aliases.length > 0 && <div style={{ fontSize: 12, color: "#929292", marginTop: 4 }}>alias : {p.aliases.join(", ")}</div>}
                <div style={{ fontSize: 11, color: "#929292", marginTop: 4 }}>vue en {p.premiere_cote}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

Créer `src/features/ariane/Timeline.tsx` :

```tsx
import type { TimelineEntry } from "./graph";

export default function Timeline({ entries, onSelectCote, selectedCote }: { entries: TimelineEntry[]; onSelectCote: (cote: string) => void; selectedCote?: string }) {
  if (entries.length === 0) return <p style={{ color: "#929292" }}>Aucun élément.</p>;
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, borderLeft: "2px solid #e5e5e5" }}>
      {entries.map((e) => (
        <li key={e.id} style={{ position: "relative", padding: "0 0 18px 18px" }}>
          <span aria-hidden style={{ position: "absolute", left: -6, top: 4, width: 10, height: 10, borderRadius: "50%", background: "#000091" }} />
          <div style={{ fontSize: 12, color: "#5b5b6b", fontWeight: 600 }}>
            {e.date}
            {e.tag && <span style={{ marginLeft: 8, fontWeight: 400, textTransform: "uppercase", fontSize: 10, color: "#929292" }}>{e.tag}</span>}
          </div>
          <div style={{ fontSize: 14, margin: "2px 0 4px" }}>{e.libelle}</div>
          <button
            type="button"
            onClick={() => onSelectCote(e.cote)}
            style={{
              fontSize: 11, padding: "2px 8px", borderRadius: 10, cursor: "pointer",
              border: "1px solid " + (selectedCote === e.cote ? "#000091" : "#d5d5d5"),
              background: selectedCote === e.cote ? "#ececff" : "#fff", color: "#000091",
            }}
          >
            {e.cote}
          </button>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Lancer le test — doit passer**

Run: `npx vitest run src/features/ariane/views.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/ariane/SyntheseView.tsx src/features/ariane/PartiesView.tsx src/features/ariane/Timeline.tsx src/features/ariane/views.test.tsx
git commit -m "feat(ariane/front): vues synthèse, parties, timeline"
```

---

## Task 6: `Reseau.tsx` — graphe cytoscape

**Files:**
- Create: `src/features/ariane/Reseau.tsx`
- Test: `src/features/ariane/reseau.test.tsx`

Le rendu cytoscape exige un canvas réel (indispo en jsdom) : la logique testable (`buildElements`) est déjà couverte en Task 4. Ici, le test vérifie seulement que le composant monte sans erreur et pose un conteneur (cytoscape est mocké).

**Interfaces:**
- Consumes: `Dossier`, `buildElements`, `CY_STYLE`, `ROLE_COLORS`, `ROLE_LABELS`, `groupByRole`.
- Produces: `Reseau({ dossier, onSelectCotes }: { dossier: Dossier; onSelectCotes: (cotes: string[]) => void })` — monte un graphe cytoscape (nœuds colorés par rôle, arêtes typées) ; clic sur une arête → `onSelectCotes(cotes)`. Affiche une légende des rôles présents.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/features/ariane/reseau.test.tsx` :

```tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("cytoscape", () => ({ default: vi.fn(() => ({ on: vi.fn(), destroy: vi.fn() })) }));

import Reseau from "./Reseau";
import type { Dossier } from "./arianeApi";

const dossier: Dossier = {
  affaire: { reference: "r", nature: "Vol", service: "BR", periode: { debut: null, fin: null }, nb_cotes: 1 },
  synthese: "s",
  parties: [{ id: "p1", nom: "DUPONT", role: "mis_en_cause", aliases: [], qualite: "", premiere_cote: "D1" }],
  evenements: [], actes: [],
  relations: [],
};

describe("Reseau", () => {
  it("monte sans erreur et instancie cytoscape", async () => {
    const cy = (await import("cytoscape")).default as unknown as ReturnType<typeof vi.fn>;
    const { container } = render(<Reseau dossier={dossier} onSelectCotes={vi.fn()} />);
    expect(container.querySelector("[data-cy-container]")).toBeTruthy();
    expect(cy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Lancer le test — doit échouer**

Run: `npx vitest run src/features/ariane/reseau.test.tsx`
Expected: FAIL (`Cannot find module './Reseau'`).

- [ ] **Step 3: Écrire le composant**

Créer `src/features/ariane/Reseau.tsx` :

```tsx
import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";
import type { Dossier } from "./arianeApi";
import { buildElements, CY_STYLE, groupByRole } from "./graph";

export default function Reseau({ dossier, onSelectCotes }: { dossier: Dossier; onSelectCotes: (cotes: string[]) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const cy = cytoscape({
      container: ref.current,
      elements: buildElements(dossier),
      style: CY_STYLE,
      layout: { name: "cose", animate: false, padding: 20 },
    });
    cy.on("tap", "edge", (evt) => onSelectCotes((evt.target.data("cotes") as string[]) ?? []));
    return () => cy.destroy();
  }, [dossier, onSelectCotes]);

  const groups = groupByRole(dossier.parties);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 420 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 8, fontSize: 12 }}>
        {groups.map((g) => (
          <span key={g.role} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: "50%", background: g.color, display: "inline-block" }} />
            {g.label}
          </span>
        ))}
      </div>
      <div ref={ref} data-cy-container style={{ flex: 1, minHeight: 380, border: "1px solid #e5e5e5", borderRadius: 6, background: "#fafafa" }} />
    </div>
  );
}
```

- [ ] **Step 4: Lancer le test + typecheck**

Run: `npx vitest run src/features/ariane/reseau.test.tsx && npx tsc -b`
Expected: PASS (1 test) + typecheck OK.

- [ ] **Step 5: Commit**

```bash
git add src/features/ariane/Reseau.tsx src/features/ariane/reseau.test.tsx
git commit -m "feat(ariane/front): réseau relationnel cytoscape"
```

---

## Task 7: `ArianeApp.tsx` — page (dropzone, progression, onglets, cote) + wiring nav/route

**Files:**
- Create: `src/features/ariane/ArianeApp.tsx`
- Modify: `src/App.tsx` (NAV + Route)
- Test: `src/features/ariane/ArianeApp.test.tsx`

**Interfaces:**
- Consumes: store (`useAriane`, `setPieces`, `run`, `reset`, `setView`, `selectCote`), vues (`SyntheseView`, `PartiesView`, `Timeline`, `Reseau`), helpers (`evenementsToEntries`, `actesToEntries`), api (`ACCEPT_ATTR`, `TAILLE_MAX_OCTETS`).
- Produces: `ArianeApp` (export default) monté sur la route `/app/ariane`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/features/ariane/ArianeApp.test.tsx` :

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("cytoscape", () => ({ default: vi.fn(() => ({ on: vi.fn(), destroy: vi.fn() })) }));

describe("ArianeApp", () => {
  beforeEach(() => { sessionStorage.clear(); vi.resetModules(); });

  it("état initial : titre + zone de dépôt, pas de vues", async () => {
    const { default: ArianeApp } = await import("./ArianeApp");
    render(<ArianeApp />);
    expect(screen.getByRole("heading", { name: /Analyse de procédure|Ariane/i })).toBeTruthy();
    expect(screen.getByLabelText(/pièces|procédure/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Lancer le test — doit échouer**

Run: `npx vitest run src/features/ariane/ArianeApp.test.tsx`
Expected: FAIL (`Cannot find module './ArianeApp'`).

- [ ] **Step 3: Écrire `ArianeApp.tsx`**

Créer `src/features/ariane/ArianeApp.tsx` :

```tsx
import { useRef } from "react";
import { Button } from "@gouvfr-lasuite/cunningham-react";
import { ACCEPT_ATTR, TAILLE_MAX_OCTETS } from "./arianeApi";
import { useAriane, setPieces, run, reset, setView, selectCote, type ViewKey } from "./arianeStore";
import { evenementsToEntries, actesToEntries } from "./graph";
import SyntheseView from "./SyntheseView";
import PartiesView from "./PartiesView";
import Timeline from "./Timeline";
import Reseau from "./Reseau";

const TABS: { key: ViewKey; label: string; icon: string }[] = [
  { key: "synthese", label: "Synthèse", icon: "summarize" },
  { key: "parties", label: "Parties", icon: "groups" },
  { key: "faits", label: "Faits", icon: "event" },
  { key: "actes", label: "Actes", icon: "gavel" },
  { key: "reseau", label: "Réseau", icon: "hub" },
];

export default function ArianeApp() {
  const { pieces, running, statusLabel, progress, dossier, error, view, selectedCote } = useAriane();
  const inputRef = useRef<HTMLInputElement>(null);

  function choisir(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const trop = files.find((f) => f.size > TAILLE_MAX_OCTETS);
    if (trop) return; // fichier trop lourd ignoré silencieusement (garde simple)
    setPieces(files);
  }

  function vider() {
    reset();
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "2rem", boxSizing: "border-box" }}>
      <h1 style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 24, color: "#000091", marginTop: 0, marginBottom: 6 }}>
        <span className="material-icons" aria-hidden style={{ color: "#000091" }}>account_tree</span>
        Analyse de procédure — Ariane
      </h1>
      <p style={{ margin: "0 0 1rem", color: "#5b5b6b", lineHeight: 1.5 }}>
        Déposez les pièces d'une procédure (PDF). L'outil en extrait une synthèse, les parties prenantes, deux lignes de temps (faits et actes) et le réseau relationnel. Aide à la lecture — ne remplace pas le dossier.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
        <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTR} aria-label="Pièces de la procédure" onChange={choisir} style={{ flex: 1, fontSize: 14 }} />
        <Button type="button" onClick={() => run()} disabled={!pieces.length || running}
          icon={<span className="material-icons" aria-hidden>auto_awesome</span>}>
          {running ? "Analyse en cours…" : "Analyser"}
        </Button>
        <button type="button" onClick={vider} disabled={running || (!pieces.length && !dossier)}
          style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontSize: 14 }}>
          Vider
        </button>
      </div>
      {pieces.length > 0 && !running && !dossier && (
        <p style={{ fontSize: 13, color: "#5b5b6b", margin: "0 0 12px" }}>{pieces.length} pièce(s) prête(s).</p>
      )}

      {running && (
        <div role="status" style={{ margin: "0 0 16px" }}>
          <p style={{ fontSize: 14, color: "#000091", margin: "0 0 6px" }}>{statusLabel} {progress.total > 0 ? `(${progress.done}/${progress.total})` : ""}</p>
          <div style={{ height: 6, background: "#ececff", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: progress.total ? `${Math.round((progress.done / progress.total) * 100)}%` : "0%", background: "#000091", transition: "width .3s" }} />
          </div>
        </div>
      )}

      {error && <p role="alert" style={{ color: "#e1000f", margin: "0 0 16px" }}>{error}</p>}

      {dossier && (
        <>
          <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #e5e5e5", margin: "8px 0 16px", flexWrap: "wrap" }}>
            {TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => setView(t.key)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: 14, cursor: "pointer",
                  border: "none", background: "none", borderBottom: "2px solid " + (view === t.key ? "#000091" : "transparent"),
                  color: view === t.key ? "#000091" : "#5b5b6b", fontWeight: view === t.key ? 700 : 500,
                }}>
                <span className="material-icons" aria-hidden style={{ fontSize: 18 }}>{t.icon}</span> {t.label}
              </button>
            ))}
          </div>

          {selectedCote && (
            <p style={{ fontSize: 13, margin: "0 0 12px", color: "#000091" }}>
              Cote sélectionnée : <strong>{selectedCote}</strong>{" "}
              <button type="button" onClick={() => selectCote(undefined)} style={{ border: "none", background: "none", color: "#5b5b6b", cursor: "pointer", textDecoration: "underline", fontSize: 12 }}>désélectionner</button>
            </p>
          )}

          <div style={{ minHeight: 420 }}>
            {view === "synthese" && <SyntheseView dossier={dossier} />}
            {view === "parties" && <PartiesView dossier={dossier} />}
            {view === "faits" && <Timeline entries={evenementsToEntries(dossier)} onSelectCote={selectCote} selectedCote={selectedCote} />}
            {view === "actes" && <Timeline entries={actesToEntries(dossier)} onSelectCote={selectCote} selectedCote={selectedCote} />}
            {view === "reseau" && <Reseau dossier={dossier} onSelectCotes={(cotes) => selectCote(cotes[0])} />}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Lancer le test — doit passer**

Run: `npx vitest run src/features/ariane/ArianeApp.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Câbler la nav + la route dans `src/App.tsx`**

Import (avec les autres imports de features, après `import CartePage …`) :

```tsx
import ArianeApp from "./features/ariane/ArianeApp";
```

Entrée de nav — ajouter dans le tableau `NAV` (après l'entrée `rens`) :

```tsx
  { to: "ariane", label: "Ariane", icon: "account_tree" },
```

Route — ajouter dans `<Route path="/app" …>` (après `<Route path="rens" … />`) :

```tsx
              <Route path="ariane" element={<ArianeApp />} />
```

- [ ] **Step 6: Build complet + suite de tests**

Run: `npm run build && npx vitest run`
Expected: build vert (`dist/` produit) ; toute la suite verte (81 existants + nouveaux Ariane).

- [ ] **Step 7: Commit**

```bash
git add src/features/ariane/ArianeApp.tsx src/features/ariane/ArianeApp.test.tsx src/App.tsx
git commit -m "feat(ariane/front): page Ariane (dropzone, progression, onglets) + nav/route"
```

---

## Self-review (rempli à la rédaction)

- **Couverture spec §6 front** : dropzone N PDF → Task 7 ; polling `/api/ariane/status` → Task 3 ; 5 vues (synthèse markdown, parties par rôle, 2 timelines, réseau cytoscape) → Tasks 5,6,7 ; sélection de cote partagée → store (Task 3) + Timeline/Reseau (Tasks 5,6) + panneau (Task 7) ; statut job tolérant (pending/pas d'assemble) → Task 3 (Global Constraints). Mode démo fixture (§6) : NON couvert ici (le front consomme le vrai `/api/ariane` ; charger la fixture serait un ajout — hors périmètre, à noter).
- **Placeholders** : aucun ; tout le code est fourni.
- **Cohérence des types** : `Dossier`/`ViewKey`/`TimelineEntry` définis en Tasks 2-4, réutilisés tels quels ; `onSelectCote(cote:string)` (Timeline) vs `onSelectCotes(cotes:string[])` (Reseau) — noms distincts volontaires, adaptés en Task 7 (`(cotes) => selectCote(cotes[0])`).
- **Contraintes projet** : aucune emoji (icônes material-icons) ; styles inline ; DSFR #000091 ; gate `npm run build` (Task 1 le débloque d'abord).

## Notes / dette

- **Divergence statut** (spec §6 vs backend) : le backend n'émet jamais `assemble` et démarre à `pending`. Le front est rendu tolérant (Task 3) plutôt que d'exiger un fix backend. Si on veut la barre `assemble`, corriger `startJob` côté serveur (Plan A) — non fait.
- **Mode démo fixture** `docs/ariane-exemple.json` non câblé au front (le front tape le vrai `/api/ariane`). Ajout possible ultérieur (bouton « charger un exemple »).
- **Fichier trop lourd** : ignoré silencieusement (garde simple) ; message utilisateur possible plus tard.
- **V2 XML embarqué** : hors périmètre (backend §8.1).
