# Ariane — métadonnées déterministes, phase 2 (XML LRPGN embarqué) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alimenter la coréférence d'Ariane avec l'état civil contenu dans le XML embarqué des PDF LRPGN, pour que deux homonymes cessent d'être confondus et que les rôles cessent d'être devinés.

**Architecture:** Le front extrait le `data.xml` du PDF (`extraireXmlPdf`, déjà livré), le parse (`parseLrpgn`, déjà livré), le convertit en métadonnées Ariane et les transmet au BFF. Le serveur applique l'ordre d'autorité XML > nom de fichier > LLM, et alimente le discriminant de la clé de coréférence, déjà écrit et testé en phase 1.

**Tech Stack:** React 19 + TypeScript + Vite, Vitest (front). Node natif ESM, `node --test` (BFF).

**Spec :** `docs/superpowers/specs/2026-07-20-ariane-metadonnees-pieces-design.md`
**Phase précédente :** `docs/superpowers/plans/2026-07-20-ariane-metadonnees-phase1.md`

## Global Constraints

- **Aucune dépendance npm ajoutée.**
- **Interdit : emoji dans le front.** Icônes = `material-icons` ou SVG inline (`CLAUDE.md`).
- Code, commentaires, libellés d'interface et messages de commit **en français**.
- **Journalisation** : jamais de nom de personne, de nom de fichier, de cote ni de contenu de pièce. Contenu réservé à `ARIANE_DEBUG=1`.
- **Aucune valeur devinée** : un code de vocabulaire inconnu donne `autre` **et** un avertissement le nommant.
- **Sens de dégradation** : dans le doute, ne pas fusionner. Une sous-fusion est visible et corrigeable ; une fusion erronée attribue les actes d'une personne à une autre.
- Tests serveur : `node --test server/<fichier>.test.mjs`. Front : `npm test -- src/features/ariane`. Typage : `npx tsc -b --noEmit`.
- Un commit par tâche.

## Deux pièges identifiés avant écriture

**Formats de date incompatibles.** `parseLrpgn` rend `naissanceDate` au format français `21/02/1985`. Le MAP rend `naissance` au format ISO `1990-05-02`. Le discriminant de `fusionnerMentions` compare ces valeurs : sans normalisation commune, deux mentions de la même personne paraîtraient porter des naissances différentes et **ne fusionneraient jamais**, ou pire, la comparaison échouerait silencieusement. Toute date doit être ramenée au format ISO avant d'entrer dans une clé.

**`Personne_Implication` est une chaîne libre.** Le XSD la déclare `xs:string` avec `default="Indéterminé"`. Seule la valeur `VICTIME` est confirmée par la fixture. Toute autre valeur suit la règle du projet : `autre` + avertissement nommant le code.

---

### Task 1 : Promouvoir les modules LRPGN en module partagé

**Files:**
- Move: `src/features/synthese/pdfXml.ts` → `src/lib/lrpgn/pdfXml.ts`
- Move: `src/features/synthese/pdfXml.test.ts` → `src/lib/lrpgn/pdfXml.test.ts`
- Move: `src/features/synthese/lrpgn.ts` → `src/lib/lrpgn/lrpgn.ts`
- Move: `src/features/synthese/lrpgn.test.ts` → `src/lib/lrpgn/lrpgn.test.ts`
- Modify: `src/features/synthese/syntheseStore.ts`, `src/features/synthese/ContexteFiche.tsx`, `src/features/synthese/ContexteFiche.test.tsx` (imports)

**Interfaces:**
- Consumes: rien.
- Produces: `extraireXmlPdf`, `parseLrpgn`, `ContexteProcedure`, `PersonneContexte`, `FaitContexte` importables depuis `../../lib/lrpgn/…`.

Deux features consomment désormais ces modules. Les laisser sous `features/synthese/` forcerait Ariane à un import inter-feature, qui masquerait la dépendance réelle et compliquerait toute évolution.

- [ ] **Step 1 : Déplacer les fichiers en préservant l'historique**

```bash
mkdir -p src/lib/lrpgn
git mv src/features/synthese/pdfXml.ts src/lib/lrpgn/pdfXml.ts
git mv src/features/synthese/pdfXml.test.ts src/lib/lrpgn/pdfXml.test.ts
git mv src/features/synthese/lrpgn.ts src/lib/lrpgn/lrpgn.ts
git mv src/features/synthese/lrpgn.test.ts src/lib/lrpgn/lrpgn.test.ts
```

- [ ] **Step 2 : Lancer les tests, constater les imports cassés**

Run: `npx tsc -b --noEmit`
Expected: FAIL — modules `./pdfXml` et `./lrpgn` introuvables depuis `src/features/synthese/`.

- [ ] **Step 3 : Corriger les imports**

Dans `src/features/synthese/syntheseStore.ts` :

```ts
import { extraireXmlPdf } from "../../lib/lrpgn/pdfXml";
import { parseLrpgn, type ContexteProcedure } from "../../lib/lrpgn/lrpgn";
```

Dans `src/features/synthese/ContexteFiche.tsx` et `ContexteFiche.test.tsx` :

```ts
import type { ContexteProcedure } from "../../lib/lrpgn/lrpgn";
```

Vérifier qu'aucun autre fichier ne référence les anciens chemins :

```bash
grep -rn "from \"\./lrpgn\"\|from \"\./pdfXml\"" src/
```

Les fichiers de test déplacés important la fixture par `../../fixtures/…` conservent le même chemin relatif — `src/lib/lrpgn/` et `src/features/synthese/` sont à la même profondeur.

- [ ] **Step 4 : Vérifier**

Run: `npm test` puis `npx tsc -b --noEmit`
Expected: PASS, aucune régression. Le déplacement ne change aucun comportement.

- [ ] **Step 5 : Commit**

```bash
git add -A src/lib/lrpgn src/features/synthese
git commit -m "refactor: promeut les modules LRPGN en module partage

Deux features les consomment desormais : la page Analyse et Ariane.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2 : Conversion du contexte LRPGN en métadonnées Ariane

**Files:**
- Create: `src/features/ariane/metaXml.ts`
- Test: `src/features/ariane/metaXml.test.ts`

**Interfaces:**
- Consumes: `ContexteProcedure` (Task 1).
- Produces:
  - `type MetaPersonne = { nom: string; prenom: string; naissance: string; role: string }`
  - `type MetaPiece = { personnes: MetaPersonne[]; avertissements: string[] }`
  - `contexteVersMeta(contexte: ContexteProcedure | null): MetaPiece | null`

`naissance` est **toujours au format ISO** (`AAAA-MM-JJ`) ou chaîne vide. C'est le format du MAP, donc celui de la clé de coréférence.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `src/features/ariane/metaXml.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { contexteVersMeta } from "./metaXml";
import type { ContexteProcedure } from "../../lib/lrpgn/lrpgn";

function contexte(personnes: ContexteProcedure["personnes"]): ContexteProcedure {
  return { personnes, faits: [], procedure: { numero: "", annee: "", unite: "", typeEnquete: "", dateActe: "" }, enqueteurs: [] };
}

describe("contexteVersMeta", () => {
  it("convertit une personne et normalise la date en ISO", () => {
    const m = contexteVersMeta(contexte([
      { nom: "BIDULE", prenom: "Marc", naissanceDate: "21/02/1985", naissanceLieu: "LORIGNE", implication: "VICTIME", nationalite: "FRANÇAISE" },
    ]))!;
    expect(m.personnes).toEqual([{ nom: "BIDULE", prenom: "Marc", naissance: "1985-02-21", role: "victime" }]);
    expect(m.avertissements).toEqual([]);
  });

  it("implication inconnue → autre + avertissement nommant le code", () => {
    const m = contexteVersMeta(contexte([
      { nom: "X", prenom: "Y", naissanceDate: "", naissanceLieu: "", implication: "GREFFIER", nationalite: "" },
    ]))!;
    expect(m.personnes[0].role).toBe("autre");
    expect(m.avertissements).toEqual(["Implication inconnue : GREFFIER"]);
  });

  it("date absente ou non reconnue → naissance vide, jamais une date inventee", () => {
    const m = contexteVersMeta(contexte([
      { nom: "A", prenom: "B", naissanceDate: "", naissanceLieu: "", implication: "VICTIME", nationalite: "" },
      { nom: "C", prenom: "D", naissanceDate: "le 3 mars", naissanceLieu: "", implication: "VICTIME", nationalite: "" },
    ]))!;
    expect(m.personnes[0].naissance).toBe("");
    expect(m.personnes[1].naissance).toBe("");
  });

  it("une personne sans nom exploitable est ecartee", () => {
    const m = contexteVersMeta(contexte([
      { nom: "", prenom: "", naissanceDate: "01/01/1980", naissanceLieu: "", implication: "VICTIME", nationalite: "" },
    ]))!;
    expect(m.personnes).toEqual([]);
  });

  it("contexte nul ou sans personne → null", () => {
    expect(contexteVersMeta(null)).toBeNull();
    expect(contexteVersMeta(contexte([]))).toBeNull();
  });

  it("le meme code inconnu deux fois ne produit qu'un avertissement", () => {
    const m = contexteVersMeta(contexte([
      { nom: "A", prenom: "B", naissanceDate: "", naissanceLieu: "", implication: "GREFFIER", nationalite: "" },
      { nom: "C", prenom: "D", naissanceDate: "", naissanceLieu: "", implication: "GREFFIER", nationalite: "" },
    ]))!;
    expect(m.avertissements).toEqual(["Implication inconnue : GREFFIER"]);
  });
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `npm test -- src/features/ariane/metaXml.test.ts`
Expected: FAIL — `Failed to resolve import "./metaXml"`.

- [ ] **Step 3 : Écrire l'implémentation minimale**

Créer `src/features/ariane/metaXml.ts` :

```ts
// Conversion du contexte LRPGN (XML embarque dans le PDF) en metadonnees Ariane.
// Fonction pure : aucun acces DOM, aucun reseau. Le parsing XML a deja eu lieu.
//
// Deux regles du projet s'appliquent ici :
//  - aucune valeur devinee : une implication hors vocabulaire donne "autre" et un
//    avertissement qui la nomme, jamais une correspondance approchee ;
//  - toute date entre au format ISO, celui du MAP et donc celui de la cle de
//    coreference. Une date non reconnue vaut "" : mieux vaut pas de discriminant
//    qu'un discriminant faux, qui separerait deux mentions d'une meme personne.
import type { ContexteProcedure } from "../../lib/lrpgn/lrpgn";

export type MetaPersonne = { nom: string; prenom: string; naissance: string; role: string };
export type MetaPiece = { personnes: MetaPersonne[]; avertissements: string[] };

// Seul VICTIME est confirme par la fixture reelle. Les autres valeurs seront
// ajoutees au vu de XML reels, pas par supposition.
const IMPLICATIONS: Record<string, string> = { VICTIME: "victime" };

// "21/02/1985" → "1985-02-21". Toute autre forme rend "" plutot qu'une date fausse.
function versIso(date: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date.trim());
  if (!m) return "";
  const [, jour, mois, annee] = m;
  if (+mois < 1 || +mois > 12 || +jour < 1 || +jour > 31) return "";
  return `${annee}-${mois}-${jour}`;
}

export function contexteVersMeta(contexte: ContexteProcedure | null): MetaPiece | null {
  if (!contexte) return null;
  const personnes: MetaPersonne[] = [];
  const avertissements: string[] = [];
  for (const p of contexte.personnes) {
    const nom = p.nom.trim();
    const prenom = p.prenom.trim();
    if (!nom && !prenom) continue; // sans nom exploitable, la personne n'identifie rien
    const code = p.implication.trim().toUpperCase();
    const role = IMPLICATIONS[code];
    if (!role) {
      const message = `Implication inconnue : ${p.implication.trim()}`;
      if (!avertissements.includes(message)) avertissements.push(message);
    }
    personnes.push({ nom, prenom, naissance: versIso(p.naissanceDate), role: role ?? "autre" });
  }
  if (personnes.length === 0) return null;
  return { personnes, avertissements };
}
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `npm test -- src/features/ariane/metaXml.test.ts` puis `npx tsc -b --noEmit`
Expected: PASS — 6 tests, `tsc` silencieux.

- [ ] **Step 5 : Commit**

```bash
git add src/features/ariane/metaXml.ts src/features/ariane/metaXml.test.ts
git commit -m "feat(ariane): conversion du contexte LRPGN en metadonnees

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3 : Extraction au dépôt et transmission au BFF

**Files:**
- Modify: `src/features/ariane/arianeApi.ts`
- Modify: `src/features/ariane/arianeStore.ts`
- Test: `src/features/ariane/arianeStore.test.ts`

**Interfaces:**
- Consumes: `extraireXmlPdf` (Task 1), `parseLrpgn` (Task 1), `contexteVersMeta` (Task 2).
- Produces: `PieceEncodee` gagne un champ optionnel `meta?: MetaPiece`, transmis tel quel dans le corps de `POST /api/ariane`.

L'extraction est **best-effort de bout en bout** : un PDF sans XML, un XML illisible ou un contexte vide laissent la pièce suivre le chemin actuel. Aucune de ces situations ne doit faire échouer l'analyse ni afficher une erreur — ce sont des cas normaux.

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à `src/features/ariane/arianeStore.test.ts`, dans le `describe` existant :

```ts
  it("run : les metadonnees XML d'une piece sont transmises au BFF", async () => {
    const envoyees: unknown[] = [];
    vi.doMock("./arianeApi", () => ({
      encodePiece: vi.fn().mockResolvedValue({ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }),
      startAnalyse: vi.fn().mockImplementation((files: unknown[]) => { envoyees.push(...files); return Promise.resolve("j1"); }),
      fetchStatus: vi.fn().mockResolvedValue({ status: "done", progress: { done: 1, total: 1 }, result: dossier }),
    }));
    vi.doMock("../../lib/lrpgn/pdfXml", () => ({ extraireXmlPdf: vi.fn().mockResolvedValue("<Procedure/>") }));
    vi.doMock("../../lib/lrpgn/lrpgn", () => ({
      parseLrpgn: vi.fn().mockReturnValue({
        personnes: [{ nom: "BIDULE", prenom: "Marc", naissanceDate: "21/02/1985", naissanceLieu: "LORIGNE", implication: "VICTIME", nationalite: "" }],
        faits: [], procedure: { numero: "", annee: "", unite: "", typeEnquete: "", dateActe: "" }, enqueteurs: [],
      }),
    }));
    const store = await import("./arianeStore");
    store.setPieces([fakeFile("D1.pdf")]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    expect(envoyees[0]).toMatchObject({
      meta: { personnes: [{ nom: "BIDULE", prenom: "Marc", naissance: "1985-02-21", role: "victime" }] },
    });
  });

  it("run : un PDF sans XML part sans metadonnees, sans erreur", async () => {
    const envoyees: unknown[] = [];
    vi.doMock("./arianeApi", () => ({
      encodePiece: vi.fn().mockResolvedValue({ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }),
      startAnalyse: vi.fn().mockImplementation((files: unknown[]) => { envoyees.push(...files); return Promise.resolve("j1"); }),
      fetchStatus: vi.fn().mockResolvedValue({ status: "done", progress: { done: 1, total: 1 }, result: dossier }),
    }));
    vi.doMock("../../lib/lrpgn/pdfXml", () => ({ extraireXmlPdf: vi.fn().mockResolvedValue(null) }));
    const store = await import("./arianeStore");
    store.setPieces([fakeFile("D1.pdf")]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    expect((envoyees[0] as { meta?: unknown }).meta).toBeUndefined();
    expect(store.snapshotForTest().error).toBeUndefined();
  });

  it("run : une extraction XML qui leve n'interrompt pas l'analyse", async () => {
    vi.doMock("./arianeApi", () => ({
      encodePiece: vi.fn().mockResolvedValue({ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }),
      startAnalyse: vi.fn().mockResolvedValue("j1"),
      fetchStatus: vi.fn().mockResolvedValue({ status: "done", progress: { done: 1, total: 1 }, result: dossier }),
    }));
    vi.doMock("../../lib/lrpgn/pdfXml", () => ({ extraireXmlPdf: vi.fn().mockRejectedValue(new Error("boom")) }));
    const store = await import("./arianeStore");
    store.setPieces([fakeFile("D1.pdf")]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    expect(store.snapshotForTest().dossier).toBeDefined();
    expect(store.snapshotForTest().error).toBeUndefined();
  });
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `npm test -- src/features/ariane/arianeStore.test.ts`
Expected: FAIL — `meta` absent du premier envoi.

- [ ] **Step 3 : Écrire l'implémentation**

Dans `src/features/ariane/arianeApi.ts`, compléter le type :

```ts
import type { MetaPiece } from "./metaXml";

export type PieceEncodee = { base64: string; mime: string; filename: string; meta?: MetaPiece };
```

Dans `src/features/ariane/arianeStore.ts`, ajouter les imports :

```ts
import { extraireXmlPdf } from "../../lib/lrpgn/pdfXml";
import { parseLrpgn } from "../../lib/lrpgn/lrpgn";
import { contexteVersMeta } from "./metaXml";
```

et, dans `run()`, remplacer la ligne d'encodage :

```ts
    const encoded = await Promise.all(pieces.map(encodePiece));
```

par une version qui joint les métadonnées, sans jamais laisser une erreur d'extraction remonter :

```ts
    // Le XML LRPGN est embarque dans le PDF. Best-effort de bout en bout : une piece
    // sans XML, ou dont le XML est illisible, suit le chemin habituel sans erreur.
    const encoded = await Promise.all(
      pieces.map(async (piece) => {
        const encodee = await encodePiece(piece);
        try {
          const xml = await extraireXmlPdf(piece);
          const meta = xml ? contexteVersMeta(parseLrpgn(xml)) : null;
          return meta ? { ...encodee, meta } : encodee;
        } catch {
          return encodee;
        }
      }),
    );
```

- [ ] **Step 4 : Vérifier**

Run: `npm test -- src/features/ariane` puis `npx tsc -b --noEmit`
Expected: PASS, `tsc` silencieux.

- [ ] **Step 5 : Commit**

```bash
git add src/features/ariane/
git commit -m "feat(ariane): extrait le XML embarque et transmet ses metadonnees

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4 : Le BFF applique les métadonnées XML

**Files:**
- Modify: `server/ariane.mjs` (`appliquerMeta`, `runAriane`)
- Test: `server/ariane.test.mjs`

**Interfaces:**
- Consumes: `file.meta` transmis par le front (Task 3), de forme `{ personnes: [{ nom, prenom, naissance, role }], avertissements: [] }`.
- Produces: `appliquerMetaXml(out, metaXml)` — applique l'état civil issu du XML à une extraction MAP.

**Ordre d'autorité (spec §3.2) : XML > nom de fichier > LLM.** Le XML est appliqué **après** le nom de fichier, de sorte qu'il l'emporte en cas de divergence.

Ce que le XML apporte et que le nom de fichier ne donne pas : **la date de naissance**, qui alimente le discriminant de `fusionnerMentions`. C'est elle qui empêche deux homonymes d'être confondus. Le reste — nom, prénom, rôle — recouvre ce que le nom de fichier fournissait déjà.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `server/ariane.test.mjs` :

```js
import { appliquerMetaXml } from "./ariane.mjs";

test("la naissance du XML est portee sur la personne extraite correspondante", () => {
  const out = appliquerMetaXml({
    cote: "D1", acte: null,
    personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }],
    faits: [], relations_lues: [],
  }, { personnes: [{ nom: "BIDULE", prenom: "Marc", naissance: "1985-02-21", role: "victime" }], avertissements: [] });
  assert.equal(out.personnes[0].naissance, "1985-02-21");
  assert.equal(out.personnes[0].role_apparent, "victime");
});

test("une personne du XML absente de l'extraction est ajoutee avec sa naissance", () => {
  const out = appliquerMetaXml({
    cote: "D1", acte: null, personnes: [], faits: [], relations_lues: [],
  }, { personnes: [{ nom: "BIDULE", prenom: "Marc", naissance: "1985-02-21", role: "victime" }], avertissements: [] });
  assert.equal(out.personnes.length, 1);
  assert.equal(out.personnes[0].naissance, "1985-02-21");
});

test("un role inconnu du XML n'ecrase pas le role du LLM", () => {
  const out = appliquerMetaXml({
    cote: "D1", acte: null,
    personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }],
    faits: [], relations_lues: [],
  }, { personnes: [{ nom: "BIDULE", prenom: "Marc", naissance: "", role: "autre" }], avertissements: [] });
  assert.equal(out.personnes[0].role_apparent, "temoin");
});

test("une naissance vide du XML n'efface pas celle du LLM", () => {
  const out = appliquerMetaXml({
    cote: "D1", acte: null,
    personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin", naissance: "1985-02-21" }],
    faits: [], relations_lues: [],
  }, { personnes: [{ nom: "BIDULE", prenom: "Marc", naissance: "", role: "victime" }], avertissements: [] });
  assert.equal(out.personnes[0].naissance, "1985-02-21");
});

test("meta XML absente → sortie inchangee", () => {
  const brut = { cote: "D1", acte: null, personnes: [], faits: [], relations_lues: [] };
  assert.deepEqual(appliquerMetaXml(brut, null), brut);
});

test("runAriane applique le XML et remonte ses avertissements", async () => {
  const files = [{ base64: "AA==", mime: "application/pdf", filename: "D1.pdf",
    meta: { personnes: [{ nom: "BIDULE", prenom: "Marc", naissance: "1985-02-21", role: "victime" }],
            avertissements: ["Implication inconnue : GREFFIER"] } }];
  const deps = {
    runExtraction: async ({ cote }) => ({ cote, acte: null,
      personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }], faits: [], relations_lues: [] }),
    runConsolidation: async ({ aggregate }) => {
      // Le discriminant doit avoir voyage jusqu'a l'agregat.
      assert.equal(aggregate.personnes[0].naissance, "1985-02-21");
      return { affaire: {}, synthese: "s",
        parties: [{ id: "p1", nom: "Marc BIDULE", role: "victime", aliases: [], qualite: "", premiere_cote: "D1", membres: ["D1:m1"] }],
        relations: [] };
    },
  };
  const avertissements = [];
  await runAriane({ files, cfg: { mapConcurrency: 1 }, deps, onAvertissement: (a) => avertissements.push(a) });
  assert.deepEqual(avertissements, ["Implication inconnue : GREFFIER"]);
});

test("deux homonymes distingues par le XML ne fusionnent pas", async () => {
  const files = [
    { base64: "AA==", mime: "application/pdf", filename: "D1.pdf",
      meta: { personnes: [{ nom: "DUPONT", prenom: "Jean", naissance: "1990-05-02", role: "victime" }], avertissements: [] } },
    { base64: "AA==", mime: "application/pdf", filename: "D2.pdf",
      meta: { personnes: [{ nom: "DUPONT", prenom: "Jean", naissance: "1962-01-30", role: "temoin" }], avertissements: [] } },
  ];
  const deps = {
    runExtraction: async ({ cote }) => ({ cote, acte: null,
      personnes: [{ ref: "m1", nom: "Jean DUPONT", role_apparent: "temoin" }], faits: [], relations_lues: [] }),
    runConsolidation: async ({ aggregate }) => {
      assert.equal(aggregate.personnes.length, 2); // deux personnes, pas une
      return { affaire: {}, synthese: "s", parties: [], relations: [] };
    },
  };
  await runAriane({ files, cfg: { mapConcurrency: 1 }, deps });
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `node --test server/ariane.test.mjs`
Expected: FAIL — `appliquerMetaXml is not a function`.

- [ ] **Step 3 : Écrire l'implémentation**

Dans `server/ariane.mjs`, à côté de `appliquerMeta` :

```js
// Applique l'etat civil issu du XML LRPGN embarque dans la piece. Applique APRES
// appliquerMeta pour que le XML l'emporte sur le nom de fichier (spec §3.2).
//
// Ce que le XML apporte seul : la date de naissance, discriminant de la cle de
// coreference. C'est elle qui empeche deux homonymes d'etre confondus.
//
// Comme pour le nom de fichier, une valeur absente ou inconnue n'ecrase rien : elle
// ne nous apprend rien, elle ne peut donc pas primer sur ce que le LLM a lu.
export function appliquerMetaXml(out, metaXml) {
  if (!metaXml || !Array.isArray(metaXml.personnes)) return out;
  for (const pers of metaXml.personnes) {
    const cle = cleNoyau(`${pers.nom} ${pers.prenom}`);
    if (!cle) continue; // pas de cle exploitable : on n'apparie sur rien
    const existante = (out.personnes || []).find((p) => cleNoyau(p.nom) === cle);
    if (existante) {
      if (pers.naissance) existante.naissance = pers.naissance;
      if (pers.role && pers.role !== "autre") existante.role_apparent = pers.role;
    } else {
      out.personnes = [...(out.personnes || []), {
        ref: `xml_${cle}`, nom: `${pers.nom} ${pers.prenom}`.trim(),
        role_apparent: pers.role || "autre", aliases: [],
        naissance: pers.naissance || null,
      }];
    }
  }
  return out;
}
```

Dans `runAriane`, après l'application des métadonnées du nom de fichier :

```js
      if (u.file.meta) {
        (u.file.meta.avertissements || []).forEach(onAvertissement);
        out = appliquerMetaXml(out, u.file.meta);
      }
```

- [ ] **Step 4 : Vérifier**

Run: `node --test server/ariane.test.mjs server/pieceMeta.test.mjs`, puis `npm test`, puis `npx tsc -b --noEmit`
Expected: PASS partout.

- [ ] **Step 5 : Commit**

```bash
git add server/ariane.mjs server/ariane.test.mjs
git commit -m "feat(ariane): le XML embarque alimente le discriminant de coreference

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Vérification finale

- [ ] `node --test server/*.test.mjs` — aucun échec
- [ ] `npm test` — aucun échec
- [ ] `npx tsc -b --noEmit` — silencieux
- [ ] `grep -rn "console\." src/features/ariane/metaXml.ts src/lib/lrpgn/` — aucune journalisation ajoutée
- [ ] Relire les avertissements produits : `Implication inconnue : X` ne porte qu'un code, jamais un nom de personne

## Mesure attendue

Rejouer la procédure de 16 pièces et relever `[ariane] reduce prompt … personnes`. Le dernier relevé sans XML donnait **42 groupes**. Deux lectures possibles :

- **le nombre baisse** — des mentions que le nom seul ne rapprochait pas sont désormais réunies par l'état civil ;
- **le nombre monte** — des homonymes que le nom seul confondait sont désormais séparés.

Les deux sont des succès, et seule la liste des parties à l'écran dira lequel s'est produit. Un nombre inchangé signifierait que le XML n'apporte rien sur ce jeu de pièces, ce qui serait à comprendre avant d'aller plus loin.
