# Saisir scellé + pièce avant l'analyse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réorganiser `BatchIdentify` : à l'ajout de photos, chaque photo entre en état « préparation » (vignette + n° scellé + pièce) ; l'analyse IA d'une photo démarre automatiquement à la perte de focus du champ scellé (non vide) ; le draft résultant porte le scellé + la pièce saisis.

**Architecture:** Front seul, composant `BatchIdentify` dans `src/features/saisies/SaisiesApp.tsx`. Aucun changement backend/persistance (scellé/lieu déjà portés par le draft → `mapObjet`).

**Tech Stack:** React + Vite + TypeScript, Vitest.

## Global Constraints

- **INTERDIT : emoji dans le front** (CLAUDE.md). Icônes = `Icon` / SVG.
- Gate typecheck+build réel = **`npm run build`** (`tsc -b && vite build`). `tsc --noEmit` = NO-OP. `noUnusedLocals`/`noUnusedParameters` ON (retirer `runIdentify` devenu inutilisé, sinon échec build).
- `Lbl`, `field`, `card`, `btn`, `btnGhost`, `BRAND`, `MUTED`, `ERR`, `TODO`, `OK`, `Icon`, `nextId`, `identifyObject`, `mockIdentify`, `buildDraftFrom`, `objetComplet`, `IDENTIFY_MESSAGES`, `uploadPhoto` sont déjà en portée dans le fichier.
- Spec : `docs/superpowers/specs/2026-07-15-scelle-piece-avant-analyse-design.md`.

---

## File Structure

- `src/features/saisies/SaisiesApp.tsx` (modifié) : `BatchIdentify` (type `BatchItem`, `addFiles`, nouvelle `analyze`, suppression de `runIdentify`, gating, rendu par item).

---

### Task 1: Rework `BatchIdentify` — préparation scellé/pièce + analyse auto au blur

**Files:**
- Modify: `src/features/saisies/SaisiesApp.tsx`

**Interfaces:**
- Consumes: `identifyObject`, `buildDraftFrom`, `objetComplet`, `ObjetCard`, styles.
- Produces: flux batch avec état `staging` (scellé/pièce avant analyse) + analyse auto au blur du scellé.

- [ ] **Step 1: Type `BatchStatus` / `BatchItem`**

Remplacer :
```tsx
type BatchStatus = "pending" | "done" | "error";
interface BatchItem {
  id: string;
  previewUrl: string;
  status: BatchStatus;
  draft?: ObjetSaisi;
  error?: string;
  file?: File;
}
```
par :
```tsx
type BatchStatus = "staging" | "pending" | "done" | "error";
interface BatchItem {
  id: string;
  previewUrl: string;
  status: BatchStatus;
  numeroScelle: string;
  lieu: string;
  draft?: ObjetSaisi;
  error?: string;
  file?: File;
}
```

- [ ] **Step 2: `addFiles` (pas d'analyse immédiate) + `analyze` (remplace `runIdentify`)**

Remplacer la fonction `runIdentify` ET la fonction `addFiles` par :
```tsx
  async function analyze(id: string) {
    const item = itemsRef.current.find((x) => x.id === id);
    if (!item || item.status !== "staging" || !item.numeroScelle.trim() || !item.file) return;
    updateItem(id, { status: "pending" });
    try {
      const res = await identifyObject(item.file);
      const draft = { ...buildDraftFrom(res, id), numeroScelle: item.numeroScelle, lieu: item.lieu };
      updateItem(id, { status: "done", draft, error: undefined });
    } catch (e) {
      updateItem(id, { status: "error", error: IDENTIFY_MESSAGES[(e as Error).message] ?? "Erreur d'identification." });
    }
  }

  function addFiles(files: FileList | null) {
    if (!files) return;
    const arr = Array.from(files);
    if (arr.length > 0) onDirty?.();
    setUploadError(null);
    const news: BatchItem[] = arr.map((f) => ({ id: nextId(), previewUrl: URL.createObjectURL(f), status: "staging" as const, numeroScelle: "", lieu: "", file: f }));
    setItems((list) => [...list, ...news]);
  }
```

- [ ] **Step 3: `addDemo` — fournir les nouveaux champs**

Dans `addDemo`, remplacer l'ajout de l'item :
```tsx
    setItems((list) => [...list, { id, previewUrl: "", status: "pending" }]);
```
par :
```tsx
    setItems((list) => [...list, { id, previewUrl: "", status: "pending" as const, numeroScelle: "", lieu: "" }]);
```
(Le reste de `addDemo` — `buildDraftFrom` → `status: "done"` — inchangé.)

- [ ] **Step 4: Gating — bloquer tant qu'un item est en préparation**

Remplacer :
```tsx
  const pending = items.filter((it) => it.status === "pending").length;
  const doneItems = items.filter((it) => it.status === "done" && it.draft);
  const errorCount = items.filter((it) => it.status === "error").length;
  const tousComplets = doneItems.length > 0 && doneItems.every((it) => objetComplet(it.draft!));
  const peutValider = pending === 0 && doneItems.length > 0 && tousComplets && saveState.status !== "saving";
```
par :
```tsx
  const staging = items.filter((it) => it.status === "staging").length;
  const pending = items.filter((it) => it.status === "pending").length;
  const doneItems = items.filter((it) => it.status === "done" && it.draft);
  const errorCount = items.filter((it) => it.status === "error").length;
  const tousComplets = doneItems.length > 0 && doneItems.every((it) => objetComplet(it.draft!));
  const peutValider = staging === 0 && pending === 0 && doneItems.length > 0 && tousComplets && saveState.status !== "saving";
```

- [ ] **Step 5: Rendu — texte d'accueil + liste par item (remplace bannière + grille)**

(a) Mettre à jour le texte de l'état vide :
```tsx
          <p style={{ margin: "10px 0 0", fontSize: 14 }}>Ajoutez des photos, renseignez le n° de scellé et la pièce ; l'analyse démarre automatiquement.</p>
```

(b) REMPLACER les deux blocs — la bannière `{pending > 0 && ( … )}` ET la grille `{pending === 0 && items.length > 0 && ( … )}` — par ce **seul** bloc :
```tsx
      {items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {items.map((it, i) => {
            if (it.status === "staging") {
              return (
                <section key={it.id} style={{ ...card, padding: 14, display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
                  {it.previewUrl && <img src={it.previewUrl} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6 }} />}
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <Lbl req>N° de scellé</Lbl>
                    <input
                      style={field}
                      value={it.numeroScelle}
                      placeholder="ex. SC-2026-014"
                      onChange={(e) => updateItem(it.id, { numeroScelle: e.target.value })}
                      onBlur={() => analyze(it.id)}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <Lbl>Pièce de découverte</Lbl>
                    <input style={field} list={`pieces-stage-${i}`} value={it.lieu} placeholder="Garage, Grenier…" onChange={(e) => updateItem(it.id, { lieu: e.target.value })} />
                    <datalist id={`pieces-stage-${i}`}>
                      {perquisition.pieces.map((p) => <option key={p} value={p} />)}
                    </datalist>
                  </div>
                  <span style={{ color: MUTED, fontSize: 12, paddingBottom: 10 }}>Renseignez le scellé pour lancer l'analyse.</span>
                  <button style={{ ...btnGhost, padding: "8px 10px", marginBottom: 2 }} onClick={() => removeItem(it.id)} aria-label="Retirer"><Icon name="delete" size={16} /></button>
                </section>
              );
            }
            if (it.status === "pending") {
              return (
                <section key={it.id} role="status" style={{ ...card, padding: 14, display: "flex", gap: 12, alignItems: "center" }}>
                  {it.previewUrl && <img src={it.previewUrl} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6 }} />}
                  <Icon name="hourglass_top" size={18} color={BRAND} /> <span style={{ color: MUTED }}>Analyse en cours…</span>
                </section>
              );
            }
            if (it.status === "error") {
              return (
                <section key={it.id} style={{ ...card, padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
                  {it.previewUrl && <img src={it.previewUrl} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6 }} />}
                  <span style={{ color: ERR, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="error" size={16} /> {it.error}</span>
                  <button style={{ ...btnGhost, marginLeft: "auto", padding: "6px 10px" }} onClick={() => removeItem(it.id)}>Retirer</button>
                </section>
              );
            }
            if (it.status === "done" && it.draft) {
              return (
                <ObjetCard key={it.id} index={i} draft={it.draft} previewUrl={it.previewUrl} perquisition={perquisition} onChange={(o) => updateItem(it.id, { draft: o })} onRemove={() => removeItem(it.id)} />
              );
            }
            return null;
          })}
        </div>
      )}
```

(c) La barre d'action « Valider tout » (`{items.length > 0 && ( … )}`) reste inchangée (elle utilise `peutValider` déjà mis à jour).

- [ ] **Step 6: Build + tests**

Run: `npm run build && npx vitest run`
Expected: build réussi (aucun symbole inutilisé — `runIdentify` supprimé) ; suite verte (28/28).

- [ ] **Step 7: Commit**

```bash
git add src/features/saisies/SaisiesApp.tsx
git commit -m "feat(saisies): saisir scellé + pièce avant l'analyse (état préparation, analyse auto au blur du scellé)"
```

---

### Task 2: Vérification E2E navigateur (CONTRÔLEUR)

- [ ] **Step 1: Stack local** (tunnel rgp-api+MinIO, proxy 8787 à jour, `npm run dev`).
- [ ] **Step 2:** Perquisition → « Importer des photos » (≥ 2) → vérifier que chaque photo affiche une **ligne de préparation** (vignette + scellé + pièce), **sans analyse**.
- [ ] **Step 3:** Renseigner le scellé d'une photo + pièce → sortir du champ scellé (blur) → l'analyse démarre pour cette photo ; à la fin, la carte affiche catégorie + champs **avec le scellé et la pièce déjà remplis**.
- [ ] **Step 4:** Vérifier que « Valider tout » reste désactivé tant qu'une photo est en préparation ; l'activer une fois toutes analysées + complètes ; valider ; vérifier l'enregistrement (scellé/lieu corrects en base).
- [ ] **Step 5:** Nettoyage éventuel de la perquisition de test.

---

## Self-Review

**Spec coverage :**
- État `staging` + champs scellé/pièce par item → Task 1 (type + rendu). ✓
- Pas d'analyse à l'ajout ; analyse au blur du scellé non vide → Task 1 (`addFiles` sans identify, `analyze` sur `onBlur`). ✓
- Draft porte le scellé + la pièce saisis → Task 1 (`analyze` applique `numeroScelle`/`lieu`). ✓
- Rendu par item (staging/pending/done/error) → Task 1 Step 5. ✓
- Valider bloqué tant qu'un item en préparation → Task 1 (gating `staging === 0`). ✓
- `itemsRef` pour lire la valeur courante (pas de closure périmée) → Task 1 (`analyze` lit `itemsRef.current`). ✓
- Démo instantanée conservée → Task 1 Step 3. ✓
- Hors périmètre (pièce commune, bouton analyser manuel, backend) : non traité. ✓

**Placeholder scan :** aucun TBD ; code complet fourni.

**Type consistency :** `BatchItem` gagne `numeroScelle`/`lieu` requis, fournis à toutes les créations (`addFiles`, `addDemo`). `analyze(id: string)` remplace `runIdentify`. `peutValider` intègre `staging`. `ObjetCard`/`updateItem`/`removeItem` signatures inchangées.
