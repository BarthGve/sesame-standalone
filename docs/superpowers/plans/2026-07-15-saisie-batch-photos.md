# Saisie par lot (batch photos) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le wizard objet-par-objet par une saisie par lot : ajouter N photos → un `identifyObject` par photo en parallèle → quand tous revenus, grille de cartes éditables (gauche fiche complète + catégorie modifiable, droite photo) → « Valider tout » enregistre en base (bloqué tant qu'un objet est incomplet).

**Architecture:** Composants `BatchIdentify` + `ObjetCard` (+ sidebar `PerqSidebar`) ajoutés dans `SaisiesApp.tsx`, réutilisant `FieldRow`, styles, `catalogue`, `identifyObject`, `mockIdentify`. Helper pur `recomputeChamps`/`buildDraftFrom` extrait et testé. `Wizard`/`Stepper`/`StepPhoto`/`StepFiche`/`StepValidation`/`Inventory` retirés.

**Tech Stack:** React + Vite + TypeScript, Vitest.

## Global Constraints

- **INTERDIT : emoji dans le front** (CLAUDE.md). Icônes = composant `Icon` (Material Icons) ou SVG.
- Gate typecheck+build réel = **`npm run build`** (`tsc -b && vite build`). `npx tsc --noEmit` est un NO-OP dans ce repo (tsconfig racine `files` vide). `tsconfig.app` a `noUnusedLocals`/`noUnusedParameters` → pas de variable/param/import inutilisé. (NB : une fonction top-level non exportée et non utilisée n'est PAS signalée par `noUnusedLocals`.)
- Vitest `test.include` = `src/**/*.test.{ts,tsx}`. Lancer : `npx vitest run <fichier>`.
- Modèle : `ObjetSaisi` (types.ts) = `{ id, categorie, sousType?, confiance, categoriesAlternatives?, photo?, numeroScelle, situation, lieu, champs: Champ[], estimationPrix? }`. `Champ` = `{ cle, libelle, valeur: string|null, source: "deduit"|"a_completer", obligatoire }`. `objetComplet(o): boolean` = scellé + lieu + champs obligatoires remplis. `IdentificationResult` = `{ categorie, sousType?, confiance, categoriesAlternatives?, champs, estimationPrix? }`.
- `catalogue.ts` : `CATEGORIES: Record<CategorieCode,{libelle,icon}>`, `SOUS_TYPES_TRANSPORT: Record<SousTypeTransport,string>`, `champsCategorie(categorie, sousType?): ChampDef[]` (`ChampDef` = `{cle, libelle, obligatoire?}`).
- `identifyObject(file: File): Promise<IdentificationResult>` (`./identify`), `mockIdentify(): Promise<IdentificationResult>` (`./mockIdentify`).
- Persistance : `savePerquisition(payload): Promise<{id}>`, `addObjets(id, objets): Promise<PerquisitionDetail>`, `buildPerquisitionPayload(perq, una, objets)`, `getPerquisition(id): Promise<PerquisitionDetail>`.
- Spec : `docs/superpowers/specs/2026-07-15-saisie-batch-photos-design.md`.

---

## File Structure

- `src/features/saisies/objetChamps.ts` (nouveau) : `recomputeChamps`, `buildDraftFrom` (purs).
- `src/features/saisies/objetChamps.test.ts` (nouveau) : tests unitaires.
- `src/features/saisies/SaisiesApp.tsx` (modifié) : ajout `ObjetCard`, `BatchIdentify`, `PerqSidebar` ; réécriture du rendu `perq` + handlers ; suppression `Wizard`/`Stepper`/`StepPhoto`/`StepFiche`/`StepValidation`/`Inventory`.

---

### Task 1: Helpers purs `recomputeChamps` + `buildDraftFrom` + tests

**Files:**
- Create: `src/features/saisies/objetChamps.ts`
- Create: `src/features/saisies/objetChamps.test.ts`

**Interfaces:**
- Consumes: `champsCategorie` (catalogue), types.
- Produces:
  - `recomputeChamps(prev: Champ[], categorie: CategorieCode, sousType?: SousTypeTransport): Champ[]`
  - `buildDraftFrom(res: IdentificationResult, id: string): ObjetSaisi`

- [ ] **Step 1: Écrire les tests**

Create `src/features/saisies/objetChamps.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { recomputeChamps, buildDraftFrom } from "./objetChamps";
import type { Champ, IdentificationResult } from "./types";

describe("recomputeChamps", () => {
  it("reconstruit les champs de la nouvelle catégorie en conservant les valeurs par cle", () => {
    const prev: Champ[] = [
      { cle: "nature", libelle: "Nature", valeur: "Montre", source: "deduit", obligatoire: true },
      { cle: "marque", libelle: "Marque", valeur: "Rolex", source: "deduit", obligatoire: false },
      { cle: "titre", libelle: "Titre", valeur: "750", source: "deduit", obligatoire: false },
    ];
    // HORLOGERIE a: nature, marque, modele, numero, quantite, inscriptions, description, titre, matiere, artiste
    const out = recomputeChamps(prev, "HORLOGERIE");
    const nature = out.find((c) => c.cle === "nature");
    const titre = out.find((c) => c.cle === "titre");
    expect(nature?.valeur).toBe("Montre");     // valeur conservée
    expect(titre?.valeur).toBe("750");         // valeur conservée
    // un champ non présent avant est vide + a_completer
    const matiere = out.find((c) => c.cle === "matiere");
    expect(matiere?.valeur).toBe(null);
    expect(matiere?.source).toBe("a_completer");
  });

  it("marque source=deduit si valeur conservée non vide, a_completer sinon", () => {
    const prev: Champ[] = [{ cle: "nature", libelle: "Nature", valeur: "", source: "a_completer", obligatoire: true }];
    const out = recomputeChamps(prev, "DIVERS");
    const nature = out.find((c) => c.cle === "nature");
    expect(nature?.source).toBe("a_completer"); // valeur vide -> a_completer
  });
});

describe("buildDraftFrom", () => {
  it("construit un ObjetSaisi depuis un résultat d'identification", () => {
    const res: IdentificationResult = {
      categorie: "MULTIMEDIA", confiance: 0.9,
      champs: [{ cle: "imei", libelle: "IMEI", valeur: "123", source: "deduit", obligatoire: false }],
    };
    const o = buildDraftFrom(res, "obj_1");
    expect(o.id).toBe("obj_1");
    expect(o.categorie).toBe("MULTIMEDIA");
    expect(o.numeroScelle).toBe("");
    expect(o.situation).toBe("SAISI_SOUS_SCELLE");
    expect(o.lieu).toBe("");
    expect(o.champs[0].cle).toBe("imei");
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `npx vitest run src/features/saisies/objetChamps.test.ts`
Expected: FAIL — module absent.

- [ ] **Step 3: Implémenter le module**

Create `src/features/saisies/objetChamps.ts` :

```ts
import { champsCategorie } from "./catalogue";
import type { Champ, CategorieCode, SousTypeTransport, IdentificationResult, ObjetSaisi } from "./types";

// Reconstruit la liste des champs pour une (catégorie, sous-type), en reportant
// les valeurs existantes dont la `cle` est encore présente dans le nouveau catalogue.
export function recomputeChamps(
  prev: Champ[],
  categorie: CategorieCode,
  sousType?: SousTypeTransport
): Champ[] {
  const prevByCle = new Map(prev.map((c) => [c.cle, c]));
  return champsCategorie(categorie, sousType).map((def) => {
    const existing = prevByCle.get(def.cle);
    const valeur = existing?.valeur ?? null;
    const rempli = valeur != null && String(valeur).trim() !== "";
    return {
      cle: def.cle,
      libelle: def.libelle,
      valeur,
      source: rempli ? "deduit" : "a_completer",
      obligatoire: def.obligatoire ?? false,
    };
  });
}

// Construit un ObjetSaisi éditable depuis un résultat d'identification IAKA.
export function buildDraftFrom(res: IdentificationResult, id: string): ObjetSaisi {
  return {
    id,
    categorie: res.categorie,
    sousType: res.sousType,
    confiance: res.confiance,
    categoriesAlternatives: res.categoriesAlternatives,
    numeroScelle: "",
    situation: "SAISI_SOUS_SCELLE",
    lieu: "",
    champs: res.champs,
    estimationPrix: res.estimationPrix,
  };
}
```

- [ ] **Step 4: Lancer → succès + build**

Run: `npx vitest run src/features/saisies/objetChamps.test.ts && npm run build`
Expected: tests PASS ; build réussi.

- [ ] **Step 5: Commit**

```bash
git add src/features/saisies/objetChamps.ts src/features/saisies/objetChamps.test.ts
git commit -m "feat(saisies): helpers recomputeChamps + buildDraftFrom (batch) + tests"
```

---

### Task 2: Composant `ObjetCard` (carte éditable : fiche gauche + photo droite)

**Files:**
- Modify: `src/features/saisies/SaisiesApp.tsx`

**Interfaces:**
- Consumes: `recomputeChamps` (Task 1), `FieldRow`, styles (`card`, `field`, `label`, `btnGhost`, `BRAND`, `BORDER`, `MUTED`, `OK`, `TODO`, `ERR`), `CATEGORIES`, `SOUS_TYPES_TRANSPORT`, `objetComplet`, `Icon`, `Lbl`, types.
- Produces: `ObjetCard` (fonction composant) — non encore branchée (utilisée en Task 3).

- [ ] **Step 1: Importer les helpers**

Dans `src/features/saisies/SaisiesApp.tsx`, compléter les imports :
- ajouter `import { recomputeChamps } from "./objetChamps";`
- s'assurer que `CategorieCode`, `SousTypeTransport` sont importés depuis `./types` (ajouter au besoin).
- `champsCategorie` n'est pas requis ici (recomputeChamps l'encapsule).

- [ ] **Step 2: Ajouter le composant `ObjetCard`**

Dans `src/features/saisies/SaisiesApp.tsx`, ajouter (près de `FieldRow`, ex. juste après la fonction `FieldRow`) :

```tsx
function ObjetCard({
  draft,
  previewUrl,
  perquisition,
  index,
  onChange,
  onRemove,
}: {
  draft: ObjetSaisi;
  previewUrl: string;
  perquisition: Perquisition;
  index: number;
  onChange: (o: ObjetSaisi) => void;
  onRemove: () => void;
}) {
  const complet = objetComplet(draft);
  const listId = `pieces-card-${index}`;

  function setChamp(cle: string, valeur: string) {
    onChange({ ...draft, champs: draft.champs.map((c) => (c.cle === cle ? { ...c, valeur } : c)) });
  }
  function changeCategorie(categorie: CategorieCode) {
    const sousType = categorie === "TRANSPORT" ? draft.sousType : undefined;
    onChange({ ...draft, categorie, sousType, champs: recomputeChamps(draft.champs, categorie, sousType) });
  }
  function changeSousType(sousType: SousTypeTransport) {
    onChange({ ...draft, sousType, champs: recomputeChamps(draft.champs, "TRANSPORT", sousType) });
  }

  return (
    <section style={{ ...card, display: "grid", gridTemplateColumns: "1fr 240px", gap: 0, overflow: "hidden" }}>
      <div style={{ padding: 18, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <Icon name={CATEGORIES[draft.categorie].icon} size={20} color={BRAND} />
          <span style={{ fontSize: 12.5, color: MUTED }}>{Math.round(draft.confiance * 100)} % de confiance</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: complet ? OK : TODO }}>
            <Icon name={complet ? "check_circle" : "pending"} size={16} /> {complet ? "Complet" : "À compléter"}
          </span>
          <button aria-label="Retirer" onClick={onRemove} style={{ border: "none", background: "transparent", color: MUTED, cursor: "pointer", display: "inline-flex" }}><Icon name="delete" size={18} /></button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px", marginBottom: 14 }}>
          <div>
            <Lbl req>Catégorie</Lbl>
            <select style={field} value={draft.categorie} onChange={(e) => changeCategorie(e.target.value as CategorieCode)}>
              {(Object.keys(CATEGORIES) as CategorieCode[]).map((c) => (
                <option key={c} value={c}>{CATEGORIES[c].libelle}</option>
              ))}
            </select>
          </div>
          {draft.categorie === "TRANSPORT" && (
            <div>
              <Lbl>Sous-type</Lbl>
              <select style={field} value={draft.sousType ?? ""} onChange={(e) => changeSousType(e.target.value as SousTypeTransport)}>
                <option value="">— choisir —</option>
                {(Object.keys(SOUS_TYPES_TRANSPORT) as SousTypeTransport[]).map((s) => (
                  <option key={s} value={s}>{SOUS_TYPES_TRANSPORT[s]}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end", padding: "12px 14px", marginBottom: 16, background: BRAND_050, border: `1px solid ${BRAND}`, borderRadius: 8 }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <Lbl req>N° de scellé</Lbl>
            <input style={field} value={draft.numeroScelle} placeholder="ex. SC-2026-014" onChange={(e) => onChange({ ...draft, numeroScelle: e.target.value })} />
          </div>
          <div style={{ maxWidth: 180 }}>
            <Lbl>Situation</Lbl>
            <select style={field} value={draft.situation} onChange={(e) => onChange({ ...draft, situation: e.target.value as SituationScelle })}>
              <option value="SAISI_SOUS_SCELLE">Saisi — sous scellé</option>
              <option value="SAISI_NON_SCELLE">Saisi — non scellé</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <Lbl req>Lieu de découverte</Lbl>
            <input style={field} list={listId} value={draft.lieu} placeholder="Garage, Grenier…" onChange={(e) => onChange({ ...draft, lieu: e.target.value })} />
            <datalist id={listId}>
              {perquisition.pieces.map((p) => <option key={p} value={p} />)}
            </datalist>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px" }}>
          {draft.champs.map((c) => <FieldRow key={c.cle} champ={c} onChange={(v) => setChamp(c.cle, v)} />)}
        </div>
      </div>

      <div style={{ background: "#f6f6fb", borderLeft: `1px solid ${BORDER}`, display: "grid", placeItems: "center", padding: 12 }}>
        {previewUrl
          ? <img src={previewUrl} alt="Objet" style={{ maxWidth: "100%", maxHeight: 260, borderRadius: 6, objectFit: "contain" }} />
          : <span style={{ color: MUTED, fontSize: 12.5, textAlign: "center" }}><Icon name="image" size={28} /><br />Sans photo</span>}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build réussi (ObjetCard défini, non utilisé encore — toléré pour une fonction top-level).

- [ ] **Step 4: Commit**

```bash
git add src/features/saisies/SaisiesApp.tsx
git commit -m "feat(saisies): composant ObjetCard (fiche editable + categorie modifiable + photo)"
```

---

### Task 3: Composant `BatchIdentify` (upload + identify parallèle + grille + valider tout)

**Files:**
- Modify: `src/features/saisies/SaisiesApp.tsx`

**Interfaces:**
- Consumes: `ObjetCard` (Task 2), `buildDraftFrom` (Task 1), `identifyObject`, `mockIdentify`, `objetComplet`, `nextId`, styles, `Icon`, types.
- Produces: `BatchIdentify` (fonction composant), props `{ perquisition: Perquisition; onValiderTout: (drafts: ObjetSaisi[]) => void; saveState: { status: "idle"|"saving"|"ok"|"err"; msg?: string; id?: number } }`. Non branchée (Task 4).

- [ ] **Step 1: Ajouter `BatchIdentify`**

Dans `src/features/saisies/SaisiesApp.tsx`, ajouter (près de `ObjetCard`) :

```tsx
type BatchStatus = "pending" | "done" | "error";
interface BatchItem {
  id: string;
  previewUrl: string;
  status: BatchStatus;
  draft?: ObjetSaisi;
  error?: string;
}

function BatchIdentify({
  perquisition,
  onValiderTout,
  saveState,
}: {
  perquisition: Perquisition;
  onValiderTout: (drafts: ObjetSaisi[]) => void;
  saveState: { status: "idle" | "saving" | "ok" | "err"; msg?: string; id?: number };
}) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const importRef = useRef<HTMLInputElement>(null);
  const shootRef = useRef<HTMLInputElement>(null);

  // Révoque les object URLs au démontage.
  useEffect(() => {
    return () => { items.forEach((it) => it.previewUrl && URL.revokeObjectURL(it.previewUrl)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateItem(id: string, patch: Partial<BatchItem>) {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function runIdentify(id: string, file: File) {
    try {
      const res = await identifyObject(file);
      updateItem(id, { status: "done", draft: buildDraftFrom(res, id), error: undefined });
    } catch (e) {
      updateItem(id, { status: "error", error: IDENTIFY_MESSAGES[(e as Error).message] ?? "Erreur d'identification." });
    }
  }

  function addFiles(files: FileList | null) {
    if (!files) return;
    const arr = Array.from(files);
    const news: BatchItem[] = arr.map((f) => ({ id: nextId(), previewUrl: URL.createObjectURL(f), status: "pending" as const }));
    setItems((list) => [...list, ...news]);
    news.forEach((it, i) => runIdentify(it.id, arr[i]));
  }

  async function addDemo() {
    const id = nextId();
    setItems((list) => [...list, { id, previewUrl: "", status: "pending" }]);
    try {
      const res = await mockIdentify();
      updateItem(id, { status: "done", draft: buildDraftFrom(res, id) });
    } catch {
      updateItem(id, { status: "error", error: "Démo indisponible." });
    }
  }

  function removeItem(id: string) {
    setItems((list) => {
      const it = list.find((x) => x.id === id);
      if (it?.previewUrl) URL.revokeObjectURL(it.previewUrl);
      return list.filter((x) => x.id !== id);
    });
  }

  const pending = items.filter((it) => it.status === "pending").length;
  const doneItems = items.filter((it) => it.status === "done" && it.draft);
  const errorCount = items.filter((it) => it.status === "error").length;
  const tousComplets = doneItems.length > 0 && doneItems.every((it) => objetComplet(it.draft!));
  const peutValider = pending === 0 && doneItems.length > 0 && tousComplets && saveState.status !== "saving";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <input ref={importRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <input ref={shootRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <button style={btn} onClick={() => shootRef.current?.click()}><Icon name="photo_camera" size={18} /> Prendre une photo</button>
        <button style={btnGhost} onClick={() => importRef.current?.click()}><Icon name="upload_file" size={18} /> Importer des photos</button>
        <button style={{ background: "none", border: "none", color: MUTED, fontSize: 12, cursor: "pointer", textDecoration: "underline" }} onClick={addDemo}>Ajouter un objet de démo</button>
      </div>

      {items.length === 0 && (
        <div style={{ ...card, padding: 32, textAlign: "center", color: MUTED }}>
          <Icon name="add_a_photo" size={28} color={BRAND} />
          <p style={{ margin: "10px 0 0", fontSize: 14 }}>Ajoutez une ou plusieurs photos. Chaque photo est identifiée automatiquement par l'IA.</p>
        </div>
      )}

      {pending > 0 && (
        <div role="status" style={{ ...card, padding: 16, marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="hourglass_top" size={18} color={BRAND} />
          Identification en cours… {items.length - pending}/{items.length}
        </div>
      )}

      {pending === 0 && items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {items.map((it, i) =>
            it.status === "error" ? (
              <section key={it.id} style={{ ...card, padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
                {it.previewUrl && <img src={it.previewUrl} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6 }} />}
                <span style={{ color: ERR, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="error" size={16} /> {it.error}</span>
                <button style={{ ...btnGhost, marginLeft: "auto", padding: "6px 10px" }} onClick={() => removeItem(it.id)}>Retirer</button>
              </section>
            ) : it.status === "done" && it.draft ? (
              <ObjetCard
                key={it.id}
                index={i}
                draft={it.draft}
                previewUrl={it.previewUrl}
                perquisition={perquisition}
                onChange={(o) => updateItem(it.id, { draft: o })}
                onRemove={() => removeItem(it.id)}
              />
            ) : null
          )}
        </div>
      )}

      {items.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
          <button style={{ ...btn, opacity: peutValider ? 1 : 0.5, cursor: peutValider ? "pointer" : "not-allowed" }} disabled={!peutValider} onClick={() => onValiderTout(doneItems.map((it) => it.draft!))}>
            <Icon name="save" size={16} /> Valider tout ({doneItems.length})
          </button>
          {!tousComplets && doneItems.length > 0 && pending === 0 && (
            <span style={{ color: TODO, fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="pending" size={15} /> Complétez tous les objets (scellé, lieu, champs obligatoires).</span>
          )}
          {errorCount > 0 && <span style={{ color: MUTED, fontSize: 12.5 }}>{errorCount} photo(s) en erreur ignorée(s).</span>}
          {saveState.status === "ok" && <span style={{ color: OK, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="check_circle" size={16} /> Enregistré</span>}
          {saveState.status === "err" && <span style={{ color: ERR, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="error" size={16} /> {saveState.msg}</span>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build réussi (`BatchIdentify` défini, pas encore branché — toléré ; `useEffect`/`useRef` déjà importés en tête de fichier — sinon les ajouter à l'import React).

- [ ] **Step 3: Commit**

```bash
git add src/features/saisies/SaisiesApp.tsx
git commit -m "feat(saisies): composant BatchIdentify (upload multi + identify parallele + grille + valider tout)"
```

---

### Task 4: Intégration — brancher BatchIdentify, sidebar, retirer le wizard

**Files:**
- Modify: `src/features/saisies/SaisiesApp.tsx`

**Interfaces:**
- Consumes: `BatchIdentify` (Task 3), `savePerquisition`, `addObjets`, `getPerquisition`, `buildPerquisitionPayload`, `PerquisitionDetail`, `ApiObjet`.
- Produces: rendu `perq` = `PerqSidebar` + `BatchIdentify` ; `handleValiderTout` ; suppression du wizard.

- [ ] **Step 1: Ajouter `PerqSidebar` (sidebar contexte)**

Dans `src/features/saisies/SaisiesApp.tsx`, ajouter :

```tsx
function PerqSidebar({
  perquisition,
  objetsExistants,
  onEditPerq,
  onBackToUna,
}: {
  perquisition: Perquisition;
  objetsExistants?: ApiObjet[];
  onEditPerq?: () => void;
  onBackToUna: () => void;
}) {
  return (
    <aside style={{ background: "#fff", borderRight: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
      <div style={{ padding: "18px 18px 8px" }}>
        <button style={{ ...btnGhost, padding: "6px 10px", fontSize: 12.5, gap: 6 }} onClick={onBackToUna}><Icon name="arrow_back" size={15} /> Perquisitions de l'UNA</button>
        <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", color: MUTED, marginTop: 14 }}>Perquisition</div>
        <div style={{ fontWeight: 700, marginTop: 2 }}>{perquisition.adresse}</div>
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>{perquisition.perquisitionne} · {perquisition.commune}</div>
        {onEditPerq && <button style={{ ...btnGhost, padding: "6px 10px", fontSize: 12.5, marginTop: 8, gap: 6 }} onClick={onEditPerq}><Icon name="edit" size={15} /> Modifier la perquisition</button>}
      </div>
      {objetsExistants && objetsExistants.length > 0 && (
        <div style={{ padding: "6px 12px 16px" }}>
          <div style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".05em", color: MUTED, padding: "6px 6px" }}>Objets enregistrés ({objetsExistants.length})</div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {objetsExistants.map((o) => (
              <li key={o.id} style={{ padding: "8px 12px", border: `1px solid ${BORDER}`, borderRadius: 8, background: "#f6f6fb" }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{CATEGORIES[o.categorie as keyof typeof CATEGORIES]?.libelle ?? o.categorie}{o.numero_scelle ? ` · ${o.numero_scelle}` : ""}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Remplacer les handlers et le rendu `perq` dans `SaisiesApp()`**

Dans `SaisiesApp()` :

(a) SUPPRIMER les states devenus inutiles : `objets`, `draft`, `step`. AJOUTER `const [batchKey, setBatchKey] = useState(0);`.

(b) SUPPRIMER les handlers `handleSavePerquisition`, `handleAddObjets`, `startNew`, `loadObjet`, `saveObjet`. Dans `startCreate` et `openExisting`, SUPPRIMER les lignes `setObjets([]); setDraft(null); setStep(1);` (states supprimés) et AJOUTER `setBatchKey((k) => k + 1);`.

(c) AJOUTER le handler unifié (après `openExisting`) :

```tsx
  async function handleValiderTout(drafts: ObjetSaisi[]) {
    setSaveState({ status: "saving" });
    try {
      if (perqMode === "create") {
        if (!perquisition || !perquisition.una) { setSaveState({ status: "err", msg: "Perquisition incomplète." }); return; }
        const { id } = await savePerquisition(buildPerquisitionPayload(perquisition, perquisition.una, drafts));
        const detail = await getPerquisition(id);
        setOpened(detail);
        setPerqMode("consult");
        setBatchKey((k) => k + 1);
        setSaveState({ status: "ok", id });
      } else {
        if (!opened) return;
        const refreshed = await addObjets(opened.id, drafts);
        setOpened(refreshed);
        setBatchKey((k) => k + 1);
        setSaveState({ status: "ok", id: opened.id });
      }
    } catch (e) {
      setSaveState({ status: "err", msg: (e as Error).message });
    }
  }
```

(d) REMPLACER le bloc de rendu final (l'actuel `const enConsult = ...` jusqu'au `return (<div grid>… <Inventory/> … <Wizard/> …</div>)`) par :

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
      <PerqSidebar
        perquisition={perquisitionCourante!}
        objetsExistants={enConsult ? opened!.objets : undefined}
        onEditPerq={enConsult ? undefined : () => setEditingPerq(true)}
        onBackToUna={() => setScreen("una")}
      />
      <div style={{ padding: "26px 30px 40px", overflowY: "auto", maxWidth: 1040 }}>
        <BatchIdentify
          key={batchKey}
          perquisition={perquisitionCourante!}
          onValiderTout={handleValiderTout}
          saveState={saveState}
        />
      </div>
    </div>
  );
```

- [ ] **Step 3: Supprimer le code mort**

SUPPRIMER de `src/features/saisies/SaisiesApp.tsx` les fonctions devenues inutilisées : `Wizard`, `Stepper`, `StepPhoto`, `StepFiche`, `StepValidation`, `Inventory`. CONSERVER : `FieldRow`, `Legend`, `PriceCard`, `champLibelleObjet` (si encore utilisé — sinon supprimer), `SetupScreen`, `ObjetCard`, `BatchIdentify`, `PerqSidebar`, `AddressAutocomplete`, `Icon`, `Sec`, `Grid2`, `Full`, `Lbl`, styles. Nettoyer les imports devenus inutiles (`mockIdentify`/`identifyObject`/`IdentificationResult` restent utilisés par `BatchIdentify`/`objetChamps` — vérifier ; `SituationScelle` reste utilisé par `ObjetCard`).

NB : `noUnusedLocals` fera échouer le build si un import ou une variable devient inutilisé — se laisser guider par les erreurs `npm run build` pour nettoyer.

- [ ] **Step 4: Build (gate réel)**

Run: `npm run build`
Expected: build réussi, zéro erreur TS (aucun symbole inutilisé, aucun composant supprimé encore référencé).

- [ ] **Step 5: Vérifier les tests non régressés**

Run: `npx vitest run`
Expected: toute la suite passe (perquisitionApi + objetChamps + autres).

- [ ] **Step 6: Commit**

```bash
git add src/features/saisies/SaisiesApp.tsx
git commit -m "feat(saisies): saisie par lot branchee (sidebar + BatchIdentify), retrait du wizard"
```

---

### Task 5: Vérification E2E manuelle (CONTRÔLEUR)

**Files:** aucune modif (sauf fix éventuel).

**Interfaces:**
- Consumes: tout ce qui précède + backend en ligne + tunnel.

_Exécutée par le contrôleur (nécessite le stack local + navigateur)._

- [ ] **Step 1: Stack local**

Vérifier : tunnel actif (`./scripts/tunnel-rgp.sh`), proxy à jour sur 8787 (`node --env-file=.env server/proxy.mjs`), `npm run dev`.

- [ ] **Step 2: Parcours création**

Choisir un UNA → « Nouvelle perquisition » → remplir le lieu → dans BatchIdentify, « Ajouter un objet de démo » ×2 (mock, sans IAKA) → compléter scellé + lieu de chaque carte → changer une catégorie et vérifier le recalcul des champs → « Valider tout ».
Expected: enregistrement OK, bascule en consultation, sidebar liste les 2 objets. Vérifier en base :
```bash
ssh ovh 'docker exec -e PGPASSWORD=... brunogauville-postgres-1 psql -U rgp_api -d rgp -c "SELECT id, categorie FROM objet_saisi ORDER BY id DESC LIMIT 5"'
```

- [ ] **Step 3: Parcours consultation + ajout**

Rouvrir la perquisition créée → ajouter 1 objet de démo → compléter → « Valider tout » → vérifier que la sidebar passe à 3 objets.

- [ ] **Step 4: Nettoyage**

Supprimer la perquisition de test en base (`DELETE FROM perquisition WHERE id=<PID>`).

---

## Self-Review

**Spec coverage :**
- Upload multi-photos + capture → Task 3 (`BatchIdentify`, inputs multiple/capture). ✓
- Identify parallèle, attente globale avant grille → Task 3 (`runIdentify` par item, grille rendue si `pending === 0`). ✓
- Grille carte gauche fiche complète + photo droite → Task 2 (`ObjetCard`). ✓
- Catégorie modifiable + recalcul champs (report par cle) → Tasks 1-2 (`recomputeChamps`, `changeCategorie`). ✓
- Bloqué tant qu'incomplet (`objetComplet`) → Task 3 (`peutValider`). ✓
- Valider tout enregistre (création `POST /perquisition` ; consultation `addObjets`) + bascule consult après création → Task 4 (`handleValiderTout`). ✓
- Photos affichage seul (pas de MinIO, `photo_url` reste undefined via `mapObjet`) → inchangé. ✓
- Suppression du wizard → Task 4. ✓
- Révocation object URLs → Task 3 (`useEffect` cleanup + `removeItem`). ✓
- Aucun emoji (icônes `Icon`) → Tasks 2-4. ✓

**Placeholder scan :** aucun TBD ; code fourni intégralement. Les nettoyages Task 4 s'appuient sur les erreurs `npm run build` pour retirer précisément le mort — code complet des ajouts fourni.

**Type consistency :** `recomputeChamps(prev, categorie, sousType?)` / `buildDraftFrom(res, id)` cohérents Tasks 1-3. `ObjetCard` props (`draft, previewUrl, perquisition, index, onChange, onRemove`) cohérentes entre Task 2 (def) et Task 3 (appel). `BatchIdentify` props (`perquisition, onValiderTout, saveState`) cohérentes Tasks 3-4. `PerqSidebar` props (`perquisition, objetsExistants?, onEditPerq?, onBackToUna`) cohérentes Task 4. `handleValiderTout(drafts: ObjetSaisi[])` correspond à `onValiderTout`. `CategorieCode`/`SousTypeTransport`/`SituationScelle` importés de `./types`.
