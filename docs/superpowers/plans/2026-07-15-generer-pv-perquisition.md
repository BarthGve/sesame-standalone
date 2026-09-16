# Générer le PV de perquisition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depuis une perquisition en consultation, générer une vue HTML imprimable du PV de perquisition (mentions obligatoires bleues templatées + objets saisis noirs groupés par lieu), imprimable via le navigateur.

**Architecture:** Front seul. Helpers purs `pv.ts` (formatage date, rendu objet, groupage lieu) + composant `PvPerquisition.tsx` (rendu + CSS impression) + bouton dans `PerqSidebar` + état `showPv` dans `SaisiesApp`. Données depuis `opened: PerquisitionDetail`. Aucun backend.

**Tech Stack:** React + Vite + TypeScript, Vitest.

## Global Constraints

- **INTERDIT : emoji dans le front** (CLAUDE.md). Icônes = `Icon` / SVG.
- Gate typecheck+build réel = **`npm run build`** (`tsc -b && vite build`). `tsc --noEmit` = NO-OP. `noUnusedLocals`/`noUnusedParameters` ON.
- Vitest `test.include` = `src/**/*.test.{ts,tsx}`. Lancer : `npx vitest run <fichier>`.
- `ApiObjet` (perquisitionApi.ts) = `{ id, categorie, sous_type?, numero_scelle?, situation?, lieu?, champs: {cle,libelle,valeur,source,obligatoire}[], identifiants, photo_url? }`. `PerquisitionDetail` = `{ id, una, adresse, commune_libelle?, perquisitionne?, opj?, date_debut?, intervenants: string[], pieces: string[], objets: ApiObjet[] }`.
- `catalogue.ts` : `CATEGORIES`, `SOUS_TYPES_TRANSPORT`.
- Spec : `docs/superpowers/specs/2026-07-15-generer-pv-perquisition-design.md`.

---

## File Structure

- `src/features/saisies/pv.ts` (nouveau) : helpers purs.
- `src/features/saisies/pv.test.ts` (nouveau) : tests.
- `src/features/saisies/PvPerquisition.tsx` (nouveau) : composant vue PV + impression.
- `src/features/saisies/SaisiesApp.tsx` (modifié) : `PerqSidebar` bouton « Générer le PV » + état `showPv` + rendu.

---

### Task 1: Helpers purs `pv.ts` + tests

**Files:**
- Create: `src/features/saisies/pv.ts`
- Create: `src/features/saisies/pv.test.ts`

**Interfaces:**
- Produces: `PLACEHOLDER`, `formatPvDate(iso?)`, `situationLabel(s?)`, `objetLine(o)`, `groupByLieu(objets)`.

- [ ] **Step 1: Tests**

Create `src/features/saisies/pv.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { formatPvDate, situationLabel, objetLine, groupByLieu, PLACEHOLDER } from "./pv";
import type { ApiObjet } from "./perquisitionApi";

describe("formatPvDate", () => {
  it("formate une date ISO en français", () => {
    const d = formatPvDate("2026-02-12T15:45:00");
    expect(d.courte).toBe("12 février 2026");
    expect(d.heure).toBe("15 heures 45 minutes");
    expect(d.longue).toContain("12 février 2026");
    expect(d.longue.startsWith("le ")).toBe(true);
  });
  it("renvoie des placeholders si absent/invalide", () => {
    expect(formatPvDate(undefined).courte).toBe(PLACEHOLDER);
    expect(formatPvDate("pas une date").heure).toBe(PLACEHOLDER);
  });
});

describe("situationLabel", () => {
  it("mappe les situations", () => {
    expect(situationLabel("SAISI_SOUS_SCELLE")).toBe("Saisi sous scellé");
    expect(situationLabel("SAISI_NON_SCELLE")).toBe("Saisi non scellé");
    expect(situationLabel(null)).toBe("Saisi");
  });
});

describe("objetLine", () => {
  it("rend une ligne objet générique (catégorie + situation + champs non vides)", () => {
    const o = {
      id: 1, categorie: "ARME", situation: "SAISI_SOUS_SCELLE", lieu: "Garage",
      champs: [
        { cle: "nature", libelle: "Nature", valeur: "ARME A FEU", source: "deduit", obligatoire: true },
        { cle: "marque", libelle: "Marque", valeur: "", source: "a_completer", obligatoire: false },
        { cle: "calibre", libelle: "Calibre", valeur: "9MM", source: "deduit", obligatoire: true },
      ],
      identifiants: [],
    } as ApiObjet;
    const line = objetLine(o);
    expect(line).toContain("Catégorie : Arme (Saisi sous scellé)");
    expect(line).toContain("Nature : ARME A FEU");
    expect(line).toContain("Calibre : 9MM");
    expect(line).not.toContain("Marque"); // valeur vide filtrée
  });
  it("ajoute le sous-type transport", () => {
    const o = { id: 2, categorie: "TRANSPORT", sous_type: "VEHICULE_TERRESTRE", situation: "SAISI_NON_SCELLE", lieu: "", champs: [], identifiants: [] } as ApiObjet;
    expect(objetLine(o)).toContain("Type de moyen : Véhicule terrestre");
  });
});

describe("groupByLieu", () => {
  it("regroupe par lieu dans l'ordre d'apparition, vide -> Lieu non précisé", () => {
    const objets = [
      { id: 1, categorie: "ARME", lieu: "Garage", champs: [], identifiants: [] },
      { id: 2, categorie: "BIJOU", lieu: "", champs: [], identifiants: [] },
      { id: 3, categorie: "DROGUE", lieu: "Garage", champs: [], identifiants: [] },
    ] as ApiObjet[];
    const g = groupByLieu(objets);
    expect(g.map((x) => x.lieu)).toEqual(["Garage", "Lieu non précisé"]);
    expect(g[0].objets.length).toBe(2);
  });
});
```

- [ ] **Step 2: Lancer → échec attendu**

Run: `npx vitest run src/features/saisies/pv.test.ts`
Expected: FAIL — module absent.

- [ ] **Step 3: Implémenter**

Create `src/features/saisies/pv.ts` :

```ts
import type { ApiObjet } from "./perquisitionApi";
import { CATEGORIES, SOUS_TYPES_TRANSPORT } from "./catalogue";
import type { CategorieCode, SousTypeTransport } from "./types";

export const PLACEHOLDER = "_____________";

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export function formatPvDate(iso?: string | null): { longue: string; courte: string; heure: string } {
  if (!iso) return { longue: PLACEHOLDER, courte: PLACEHOLDER, heure: PLACEHOLDER };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { longue: PLACEHOLDER, courte: PLACEHOLDER, heure: PLACEHOLDER };
  const courte = `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
  const longue = `le ${JOURS[d.getDay()]} ${courte}`;
  const h = d.getHours();
  const m = d.getMinutes();
  const heure = `${h} heure${h > 1 ? "s" : ""} ${String(m).padStart(2, "0")} minute${m > 1 ? "s" : ""}`;
  return { longue, courte, heure };
}

export function situationLabel(s?: string | null): string {
  if (s === "SAISI_SOUS_SCELLE") return "Saisi sous scellé";
  if (s === "SAISI_NON_SCELLE") return "Saisi non scellé";
  return "Saisi";
}

export function objetLine(o: ApiObjet): string {
  const cat = CATEGORIES[o.categorie as CategorieCode]?.libelle ?? o.categorie;
  const parts: string[] = [`Catégorie : ${cat} (${situationLabel(o.situation)})`];
  if (o.sous_type) parts.push(`Type de moyen : ${SOUS_TYPES_TRANSPORT[o.sous_type as SousTypeTransport] ?? o.sous_type}`);
  for (const c of o.champs) {
    const v = (c.valeur ?? "").trim();
    if (v) parts.push(`${c.libelle} : ${v}`);
  }
  return parts.join(" ");
}

export function groupByLieu(objets: ApiObjet[]): { lieu: string; objets: ApiObjet[] }[] {
  const out: { lieu: string; objets: ApiObjet[] }[] = [];
  const idx = new Map<string, number>();
  for (const o of objets) {
    const lieu = (o.lieu ?? "").trim() || "Lieu non précisé";
    if (!idx.has(lieu)) { idx.set(lieu, out.length); out.push({ lieu, objets: [] }); }
    out[idx.get(lieu)!].objets.push(o);
  }
  return out;
}
```

- [ ] **Step 4: Lancer → succès + build**

Run: `npx vitest run src/features/saisies/pv.test.ts && npm run build`
Expected: PASS ; build réussi.

- [ ] **Step 5: Commit**

```bash
git add src/features/saisies/pv.ts src/features/saisies/pv.test.ts
git commit -m "feat(saisies): helpers PV (formatPvDate, situationLabel, objetLine, groupByLieu) + tests"
```

---

### Task 2: Composant `PvPerquisition` + bouton + câblage

**Files:**
- Create: `src/features/saisies/PvPerquisition.tsx`
- Modify: `src/features/saisies/SaisiesApp.tsx`

**Interfaces:**
- Consumes: `pv.ts` (Task 1), `PerquisitionDetail`, `PerqSidebar`.
- Produces: vue PV imprimable + bouton « Générer le PV » (consultation) → `showPv`.

- [ ] **Step 1: Composant `PvPerquisition.tsx`**

Create `src/features/saisies/PvPerquisition.tsx` :

```tsx
import type { PerquisitionDetail } from "./perquisitionApi";
import { formatPvDate, situationLabel, objetLine, groupByLieu, PLACEHOLDER } from "./pv";

const BLUE = "#5983b0";

export default function PvPerquisition({
  perquisition,
  onClose,
}: {
  perquisition: PerquisitionDetail;
  onClose: () => void;
}) {
  const p = perquisition;
  const date = formatPvDate(p.date_debut);
  const [unite, numero, annee] = (p.una || "").split("/");
  const perq = p.perquisitionne || PLACEHOLDER;
  const intervenants = (p.intervenants && p.intervenants.length ? p.intervenants.join(", ") : PLACEHOLDER);
  const pieces = (p.pieces && p.pieces.length ? p.pieces.join(", ") : PLACEHOLDER);
  const groupes = groupByLieu(p.objets || []);

  const legal: React.CSSProperties = { color: BLUE, margin: "8px 0" };

  return (
    <div style={{ minHeight: "100%", background: "#ececec", overflowY: "auto" }}>
      <style>{`
        @media print {
          .pv-toolbar { display: none !important; }
          .pv-page { box-shadow: none !important; margin: 0 !important; width: auto !important; }
          body { background: #fff !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="pv-toolbar" style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", gap: 12, padding: "12px 18px", background: "#fff", borderBottom: "1px solid #e2e2ec" }}>
        <button style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 16px", borderRadius: 8, fontWeight: 700, fontSize: 14, border: "1px solid #000091", background: "transparent", color: "#000091", cursor: "pointer" }} onClick={onClose}>← Retour</button>
        <button style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 16px", borderRadius: 8, fontWeight: 700, fontSize: 14, border: "1px solid #000091", background: "#000091", color: "#fff", cursor: "pointer" }} onClick={() => window.print()}>Imprimer</button>
      </div>

      <div className="pv-page" style={{ width: 794, maxWidth: "100%", margin: "20px auto", background: "#fff", padding: "48px 56px", boxShadow: "0 2px 12px rgba(0,0,0,.15)", fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 13, lineHeight: 1.5, color: "#16161d" }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>GENDARMERIE NATIONALE</div>
          <div style={{ marginTop: 6 }}>Unité {unite || PLACEHOLDER}</div>
          <div style={{ marginTop: 10, fontStyle: "italic" }}>ENQUÊTE PRÉLIMINAIRE</div>
          <h1 style={{ fontSize: 18, margin: "16px 0 0" }}>PROCÈS-VERBAL DE PERQUISITION</h1>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", margin: "16px 0", fontSize: 12 }}>
          <tbody>
            <tr>
              {["Code unité", "Nmr P.V.", "Année", "Nmr dossier justice", "N° feuillet"].map((h) => (
                <th key={h} style={{ border: "1px solid #999", padding: "4px 6px", background: "#f6f6f6", textAlign: "left" }}>{h}</th>
              ))}
            </tr>
            <tr>
              {[unite || PLACEHOLDER, numero || PLACEHOLDER, annee || PLACEHOLDER, PLACEHOLDER, PLACEHOLDER].map((v, i) => (
                <td key={i} style={{ border: "1px solid #999", padding: "4px 6px" }}>{v}</td>
              ))}
            </tr>
          </tbody>
        </table>

        <p style={legal}>Le {date.longue} à {date.heure}.</p>
        <p style={legal}>Nous soussigné {p.opj || PLACEHOLDER}, Officier de Police Judiciaire en résidence à {PLACEHOLDER}.</p>
        <p style={legal}>Vu les articles 16 à 19 et 75 à 78 du Code de Procédure Pénale.</p>
        <p style={legal}>Nous trouvant au bureau de notre unité à {PLACEHOLDER}, rapportons les opérations suivantes :</p>

        <p style={legal}>Le {date.longue} à {date.heure}, nous nous présentons pour y effectuer une perquisition au domicile de {perq}, {p.adresse || PLACEHOLDER} à {p.commune_libelle || PLACEHOLDER} (Insee : {PLACEHOLDER}), qui nous paraît détenir des pièces ou objets relatifs aux faits incriminés.</p>
        <p style={legal}>Nous sommes assistés par : {intervenants}, de notre unité.</p>
        <p style={legal}>Nous sommes accompagnés par {perq}.</p>
        <p style={legal}>L'assentiment exprès autorisant la perquisition et les saisies a été préalablement sollicité, rédigé et joint à la présente pièce.</p>
        <p style={legal}>En la présence constante de {perq}, nous procédons à la perquisition des pièces suivantes : {pieces}</p>
        <p style={legal}>Dans les lieux ci-après, nous découvrons la pièce à conviction suivante :</p>

        {groupes.map((g) => (
          <div key={g.lieu} style={{ margin: "10px 0" }}>
            <div style={{ fontWeight: 700 }}>- Lieu : {g.lieu}</div>
            <div>- Pièce à conviction :</div>
            {g.objets.map((o) => (
              <p key={o.id} style={{ margin: "6px 0" }}>{objetLine(o)}{o.numero_scelle ? ` (Scellé : ${o.numero_scelle})` : ""} -----</p>
            ))}
          </div>
        ))}

        <p style={legal}>Nous déclarons à {perq} saisie de cette pièce à conviction.</p>
        <p style={legal}>Nous en portons mention sur l'inventaire des pièces à conviction et la plaçons sous scellé que paraphe avec nous {perq}.</p>
        <p style={legal}>L'objet saisi sera mis à la disposition du magistrat compétent en même temps que les pièces de la procédure.</p>
        <p style={legal}>Nos recherches au domicile de {perq} n'amènent la découverte d'aucun autre objet susceptible de servir à la manifestation de la vérité.</p>
        <p style={legal}>Nous informons la personne présente, qu'elle pourra, conformément à l'article 77-2 du code de procédure pénale, à l'expiration d'un délai d'un an à compter de la présente perquisition effectuée à son domicile, demander au procureur de la République, par lettre recommandée avec accusé de réception ou par déclaration au greffe contre récépissé, de consulter le dossier de la procédure.</p>
        <p style={legal}>La perquisition se termine le {date.courte} à {PLACEHOLDER}.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `PerqSidebar` — bouton « Générer le PV »**

Dans `SaisiesApp.tsx`, `PerqSidebar` : ajouter la prop `onGenererPv?: () => void;` (signature + type). Sous le bloc en-tête de l'aside (près du bouton retour / après « Modifier la perquisition »), ajouter :
```tsx
        {onGenererPv && <button style={{ ...btn, padding: "8px 12px", fontSize: 13, marginTop: 10, width: "100%", justifyContent: "center" }} onClick={onGenererPv}><Icon name="description" size={16} /> Générer le PV</button>}
```

- [ ] **Step 3: `SaisiesApp` — état `showPv` + rendu**

Dans `SaisiesApp()` :

(a) Import : `import PvPerquisition from "./PvPerquisition";`

(b) État : `const [showPv, setShowPv] = useState(false);`

(c) Reset `setShowPv(false)` dans `startCreate` et `openExisting`.

(d) Rendu : AVANT le `return (<div grid> … </div>)` final, ajouter :
```tsx
  if (showPv && opened) {
    return <PvPerquisition perquisition={opened} onClose={() => setShowPv(false)} />;
  }
```

(e) Passer `onGenererPv` à `PerqSidebar` (uniquement en consultation) :
```tsx
        onGenererPv={enConsult ? () => setShowPv(true) : undefined}
```

- [ ] **Step 4: Build + tests**

Run: `npm run build && npx vitest run`
Expected: build réussi ; suite verte.

- [ ] **Step 5: Commit**

```bash
git add src/features/saisies/PvPerquisition.tsx src/features/saisies/SaisiesApp.tsx
git commit -m "feat(saisies): vue PV de perquisition imprimable + bouton Générer le PV"
```

---

### Task 3: Vérification E2E navigateur (CONTRÔLEUR)

- [ ] **Step 1: Stack local** (tunnel, proxy 8787 à jour, `npm run dev`).
- [ ] **Step 2:** Ouvrir une perquisition (consultation) avec des objets → cliquer « Générer le PV ».
- [ ] **Step 3:** Vérifier la vue : en-tête, tableau métadonnées (unité/numéro/année), mentions bleues templatées (date, perquisitionné, adresse, intervenants, pièces), objets groupés par lieu avec le rendu générique, placeholders `_____________` pour l'absent.
- [ ] **Step 4:** « Imprimer » → l'aperçu PDF ne montre que le PV (toolbar masquée), le bleu est conservé.
- [ ] **Step 5:** « Retour » → revient à la consultation.

---

## Self-Review

**Spec coverage :**
- Helpers date/situation/objet/lieu → Task 1. ✓
- Vue PV (en-tête, métadonnées, mentions bleues verbatim, objets par lieu, clôture) → Task 2 (`PvPerquisition`). ✓
- Rendu objets générique (libellé:valeur) → Task 1 `objetLine`. ✓
- Placeholders pour données absentes → Tasks 1-2 (`PLACEHOLDER`). ✓
- Bouton depuis consultation + impression navigateur → Task 2. ✓
- Hors périmètre (export .odt/PDF serveur, édition placeholders persistée, feuillets) : non traité. ✓

**Placeholder scan :** aucun TBD ; code complet. Les `_____________` sont des placeholders **produit** voulus (données absentes), pas des trous de plan.

**Type consistency :** `formatPvDate`/`situationLabel`/`objetLine`/`groupByLieu` cohérents Tasks 1-2. `PvPerquisition` props `{ perquisition: PerquisitionDetail; onClose }`. `PerqSidebar.onGenererPv?: () => void`. `showPv` + `opened` pilotent le rendu. `una` splité en unite/numero/annee pour les métadonnées.
