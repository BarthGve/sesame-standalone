# Valorisation du XML LRPGN dans la page Analyse — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher sur `/analyse` les données structurées certaines extraites du `data.xml` embarqué dans les PDF d'audition LRPGN, et transmettre ce XML au workflow IAka pour ancrer l'analyse.

**Architecture:** Extraction dans le navigateur dès le choix du fichier (`DecompressionStream` natif, aucune dépendance), parsing en un type `ContexteProcedure`, rendu par un composant pur, état porté par le store existant. Le XML brut part vers `/api/synthese`, que `runSynthese` envoie en champ `prompt` avec repli automatique si le workflow le refuse.

**Tech Stack:** React 19 + TypeScript + Vite, Vitest + @testing-library/react (front), Node natif + `node --test` (BFF).

**Spec :** `docs/superpowers/specs/2026-07-20-analyse-xml-lrpgn-design.md`

## Global Constraints

- **Interdit : emoji dans le front.** Icônes = `material-icons` ou SVG inline (`CLAUDE.md`).
- **Aucune dépendance npm ajoutée.** `DecompressionStream` / `CompressionStream` sont natifs.
- Code, commentaires, libellés d'interface et messages de commit **en français**.
- Tout le chemin XML est best-effort : aucune de ses erreurs ne doit faire échouer l'analyse ni afficher un message d'erreur.
- Champs sensibles **jamais affichés** : téléphone, adresse personnelle, profession, situation familiale, consentement, GPS.
- Tests front : `npm test` (Vitest, jsdom). Tests serveur : `node --test server/<fichier>.test.mjs`.
- Commits fréquents, un par tâche.

---

### Task 1 : Extraction du XML embarqué d'un PDF

**Files:**
- Create: `src/test/pdfAvecXml.ts` (fabrique de PDF de test, réutilisée aux tâches 4 et 5)
- Create: `src/features/synthese/pdfXml.ts`
- Test: `src/features/synthese/pdfXml.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `extraireXmlPdf(file: File): Promise<string | null>` — XML décompressé, ou `null`.
  - `pdfAvecXml(xml: string, nom?: string): Promise<File>` (helper de test) — PDF minimal portant `xml` en pièce jointe deflate.
  - `pdfSansPieceJointe(nom?: string): Promise<File>` (helper de test) — PDF sans pièce jointe.

- [ ] **Step 1 : Écrire le helper de test**

Créer `src/test/pdfAvecXml.ts` :

```ts
// Fabrique un PDF minimal portant une pièce jointe compressée deflate, à
// l'image des PDF LRPGN (flux /Type/EmbeddedFile + /Filter/FlateDecode).
// Évite d'embarquer un binaire de 100 Ko dans le dépôt pour les tests.

async function deflate(texte: string): Promise<Uint8Array> {
  const flux = new Blob([texte]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

function concat(morceaux: Uint8Array[]): Uint8Array {
  const total = morceaux.reduce((n, m) => n + m.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const m of morceaux) {
    out.set(m, pos);
    pos += m.length;
  }
  return out;
}

export async function pdfAvecXml(xml: string, nom = "pv.pdf"): Promise<File> {
  const enc = new TextEncoder();
  const comprime = await deflate(xml);
  const octets = concat([
    enc.encode(
      "%PDF-1.7\n27 0 obj\n<</Length " +
        comprime.length +
        "/Type/EmbeddedFile/Filter/FlateDecode>>stream\n"
    ),
    comprime,
    // Saut de ligne avant endstream : c'est ce que produisent les PDF réels,
    // et l'extraction doit le supporter.
    enc.encode("\nendstream\nendobj\n%%EOF\n"),
  ]);
  return new File([octets], nom, { type: "application/pdf" });
}

export async function pdfSansPieceJointe(nom = "pv.pdf"): Promise<File> {
  const octets = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<</Type/Page>>\nendobj\n%%EOF\n");
  return new File([octets], nom, { type: "application/pdf" });
}
```

- [ ] **Step 2 : Écrire le test qui échoue**

Créer `src/features/synthese/pdfXml.test.ts` :

```ts
import { expect, test } from "vitest";
import { extraireXmlPdf } from "./pdfXml";
import { pdfAvecXml, pdfSansPieceJointe } from "../../test/pdfAvecXml";

const XML = '<?xml version="1.0" encoding="UTF-8"?><Procedure><Entete><Code_Unite>04340</Code_Unite></Entete></Procedure>';

test("restitue le XML embarqué d'un PDF", async () => {
  expect(await extraireXmlPdf(await pdfAvecXml(XML))).toBe(XML);
});

test("PDF sans pièce jointe → null", async () => {
  expect(await extraireXmlPdf(await pdfSansPieceJointe())).toBeNull();
});

test("flux compressé corrompu → null, sans lever", async () => {
  const sain = new Uint8Array(await (await pdfAvecXml(XML)).arrayBuffer());
  // Casse les octets du flux compressé, après l'en-tête de l'objet PDF.
  const debut = sain.indexOf(0x0a, sain.indexOf(0x3e)) + 1; // après "stream\n"
  sain.fill(0x41, debut + 2, debut + 12);
  const casse = new File([sain], "pv.pdf", { type: "application/pdf" });
  expect(await extraireXmlPdf(casse)).toBeNull();
});

test("pièce jointe qui n'est pas une procédure LRPGN → null", async () => {
  expect(await extraireXmlPdf(await pdfAvecXml("<Autre>rien</Autre>"))).toBeNull();
});
```

- [ ] **Step 3 : Lancer le test, vérifier l'échec**

Run: `npm test -- src/features/synthese/pdfXml.test.ts`
Expected: FAIL — `Failed to resolve import "./pdfXml"`.

Si l'échec est `DecompressionStream is not defined` ou `CompressionStream is not defined` (jsdom trop ancien), ajouter en première ligne du fichier de test :
`// @vitest-environment node`
puis relancer. Le module reste destiné au navigateur, où l'API est standard.

- [ ] **Step 4 : Écrire l'implémentation minimale**

Créer `src/features/synthese/pdfXml.ts` :

```ts
// Les PDF d'audition produits par LRPGN embarquent un `data.xml` (données
// structurées de la procédure) dans un flux PDF `/Type/EmbeddedFile` compressé
// deflate. On le récupère sans dépendance : recherche sur les octets +
// DecompressionStream natif.
//
// Best-effort de bout en bout : PDF chiffré, flux non-deflate, XML inattendu →
// null. L'appelant continue sans contexte, l'analyse n'est jamais bloquée.

const MARQUEUR = "/Type/EmbeddedFile";

function chercher(octets: Uint8Array, motif: string, depuis: number): number {
  const cible = new TextEncoder().encode(motif);
  boucle: for (let i = depuis; i <= octets.length - cible.length; i++) {
    for (let j = 0; j < cible.length; j++) if (octets[i + j] !== cible[j]) continue boucle;
    return i;
  }
  return -1;
}

async function decompresser(octets: Uint8Array): Promise<string> {
  const flux = new Blob([octets]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Response(flux).text();
}

export async function extraireXmlPdf(file: File): Promise<string | null> {
  try {
    const octets = new Uint8Array(await file.arrayBuffer());
    let curseur = 0;
    for (;;) {
      const marque = chercher(octets, MARQUEUR, curseur);
      if (marque < 0) return null;
      const motStream = chercher(octets, "stream", marque);
      if (motStream < 0) return null;
      let debut = motStream + "stream".length;
      if (octets[debut] === 0x0d) debut++;
      if (octets[debut] === 0x0a) debut++;
      const fin = chercher(octets, "endstream", debut);
      if (fin < 0) {
        curseur = marque + 1;
        continue;
      }
      curseur = fin;
      // Le saut de ligne qui précède `endstream` appartient au PDF, pas au flux.
      let borne = fin;
      while (borne > debut && (octets[borne - 1] === 0x0a || octets[borne - 1] === 0x0d)) borne--;
      try {
        const texte = await decompresser(octets.subarray(debut, borne));
        if (texte.includes("<Procedure")) return texte;
      } catch {
        /* flux illisible : on tente la pièce jointe suivante */
      }
    }
  } catch {
    return null;
  }
}
```

- [ ] **Step 5 : Lancer le test, vérifier le succès**

Run: `npm test -- src/features/synthese/pdfXml.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6 : Commit**

```bash
git add src/test/pdfAvecXml.ts src/features/synthese/pdfXml.ts src/features/synthese/pdfXml.test.ts
git commit -m "feat(analyse): extraction du XML embarque dans les PDF LRPGN"
```

---

### Task 2 : Parsing du XML LRPGN en `ContexteProcedure`

**Files:**
- Create: `src/fixtures/lrpgn-audition.xml`
- Create: `src/features/synthese/lrpgn.ts`
- Test: `src/features/synthese/lrpgn.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `type ContexteProcedure` (voir Step 3) — utilisé par les tâches 3, 4, 5.
  - `parseLrpgn(xml: string): ContexteProcedure | null`.

- [ ] **Step 1 : Créer la fixture**

Le `data.xml` a déjà été extrait du PDF d'exemple. Le copier :

```bash
cp /private/tmp/claude-501/-Users-brunogauville-Developpeur-XP-IAka/36fd2034-a14f-4785-82ed-acd75e5796ba/scratchpad/data.xml src/fixtures/lrpgn-audition.xml
```

Si ce fichier n'existe plus, le régénérer depuis le PDF d'exemple :

```bash
node -e '
const fs=require("fs"),zlib=require("zlib");
const raw=fs.readFileSync("/Users/brunogauville/Downloads/20250221_1445_PVAudition_VIC_BIDULE_MARC.pdf");
const m=/\/Type\/EmbeddedFile[\s\S]*?stream\r?\n/.exec(raw.toString("latin1"));
const debut=m.index+m[0].length, fin=raw.indexOf("endstream",debut);
fs.writeFileSync("src/fixtures/lrpgn-audition.xml",zlib.inflateSync(raw.subarray(debut,fin)));
'
```

Vérifier : `head -c 120 src/fixtures/lrpgn-audition.xml` doit afficher le prologue XML suivi de `<Procedure`.

Ces données sont fictives (procédure marquée `PREPRODUCTION`).

- [ ] **Step 2 : Écrire le test qui échoue**

Créer `src/features/synthese/lrpgn.test.ts` :

```ts
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseLrpgn } from "./lrpgn";

const XML = readFileSync("src/fixtures/lrpgn-audition.xml", "utf8");

test("extrait la personne entendue et son implication", () => {
  const c = parseLrpgn(XML)!;
  expect(c.personnes).toHaveLength(1);
  expect(c.personnes[0]).toMatchObject({
    nom: "BIDULE",
    prenom: "Marc",
    implication: "VICTIME",
    naissanceDate: "21/02/1985",
    naissanceLieu: "LORIGNE",
    nationalite: "FRANÇAISE",
  });
});

test("extrait le fait, sa qualification et sa période", () => {
  const c = parseLrpgn(XML)!;
  expect(c.faits).toHaveLength(1);
  expect(c.faits[0]).toMatchObject({
    libelle: "VOL EN BANDE ORGANISEE",
    natinf: "10832",
    debut: "20/02/2025 à 14:47",
    fin: "21/02/2025 à 14:47",
    localisation: "Rue des Plantes",
    commune: "ATHIS MONS",
    codePostal: "91200",
  });
});

test("extrait l'entête de procédure", () => {
  const c = parseLrpgn(XML)!;
  expect(c.procedure).toMatchObject({
    numero: "00059",
    annee: "2025",
    unite: "COB LE-LION-D-ANGERS",
    typeEnquete: "ENQUÊTE PRÉLIMINAIRE",
    dateActe: "vendredi 21 février 2025",
  });
});

test("ne garde que les enquêteurs nommés", () => {
  const c = parseLrpgn(XML)!;
  expect(c.enqueteurs).toEqual([
    { nom: "Adjudant Julie MALLIETTE", qualite: "Officier de Police Judiciaire" },
  ]);
});

test("XML vide, malformé ou étranger → null", () => {
  expect(parseLrpgn("")).toBeNull();
  expect(parseLrpgn("<Procedure><Entete>")).toBeNull();
  expect(parseLrpgn("<Autre><Personne/></Autre>")).toBeNull();
});

test("procédure sans personnes ni faits → listes vides", () => {
  const c = parseLrpgn("<Procedure><Entete><Unite_L4>COB X</Unite_L4></Entete></Procedure>")!;
  expect(c.personnes).toEqual([]);
  expect(c.faits).toEqual([]);
  expect(c.procedure.unite).toBe("COB X");
  expect(c.procedure.numero).toBe("");
});
```

- [ ] **Step 3 : Lancer le test, vérifier l'échec**

Run: `npm test -- src/features/synthese/lrpgn.test.ts`
Expected: FAIL — `Failed to resolve import "./lrpgn"`.

- [ ] **Step 4 : Écrire l'implémentation minimale**

Créer `src/features/synthese/lrpgn.ts` :

```ts
// Mapping du XML LRPGN (racine <Procedure>) vers les seules données utiles à la
// relecture d'une audition. Le schéma autorise N personnes et N faits.
//
// Volontairement ABSENTS du type : téléphone, adresse personnelle, profession,
// situation familiale, consentement, coordonnées GPS. Ils sont dans le XML mais
// n'aident pas la relecture et n'ont pas à s'afficher.

export type PersonneContexte = {
  nom: string;
  prenom: string;
  naissanceDate: string;
  naissanceLieu: string;
  implication: string;
  nationalite: string;
};

export type FaitContexte = {
  libelle: string;
  natinf: string;
  debut: string;
  fin: string;
  localisation: string;
  commune: string;
  codePostal: string;
};

export type ContexteProcedure = {
  personnes: PersonneContexte[];
  faits: FaitContexte[];
  procedure: {
    numero: string;
    annee: string;
    unite: string;
    typeEnquete: string;
    dateActe: string;
  };
  enqueteurs: { nom: string; qualite: string }[];
};

function txt(racine: ParentNode, balise: string): string {
  return racine.querySelector(balise)?.textContent?.trim() ?? "";
}

export function parseLrpgn(xml: string): ContexteProcedure | null {
  try {
    if (!xml.trim()) return null;
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) return null;
    if (doc.documentElement?.nodeName !== "Procedure") return null;

    return {
      personnes: Array.from(doc.querySelectorAll("Personnes_Physiques > Personne")).map((p) => ({
        nom: txt(p, "Personne_Nom"),
        prenom: txt(p, "Personne_Prenom"),
        naissanceDate: txt(p, "Personne_Naissance_Date"),
        naissanceLieu: txt(p, "Personne_Naissance_Lieu"),
        implication: txt(p, "Personne_Implication"),
        nationalite: txt(p, "Personne_Nationalite"),
      })),
      faits: Array.from(doc.querySelectorAll("Faits > Fait")).map((f) => ({
        libelle: txt(f, "Libelle_Fait"),
        natinf: txt(f, "Natinf"),
        debut: txt(f, "Periode_Affaire_Debut"),
        fin: txt(f, "Periode_Affaire_Fin"),
        localisation: txt(f, "Localisation_Fait"),
        commune: txt(f, "Commune_Fait"),
        codePostal: txt(f, "Code_Postal_Commune_Fait"),
      })),
      procedure: {
        numero: txt(doc, "Procedure_Numero"),
        annee: txt(doc, "Procedure_Annee"),
        unite: txt(doc, "Unite_L4"),
        typeEnquete: txt(doc, "Enquete_Type"),
        dateActe: txt(doc, "Acte_Enquete_Date"),
      },
      // Le second <Enqueteur> du schéma ne porte qu'un article de code : sans nom,
      // il n'a rien à afficher.
      enqueteurs: Array.from(doc.querySelectorAll("Enqueteurs > Enqueteur"))
        .map((e) => ({ nom: txt(e, "Enqueteur_Nom"), qualite: txt(e, "Enqueteur_Qualite") }))
        .filter((e) => e.nom),
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5 : Lancer le test, vérifier le succès**

Run: `npm test -- src/features/synthese/lrpgn.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 6 : Commit**

```bash
git add src/fixtures/lrpgn-audition.xml src/features/synthese/lrpgn.ts src/features/synthese/lrpgn.test.ts
git commit -m "feat(analyse): parsing du XML LRPGN en contexte de procedure"
```

---

### Task 3 : Composant de fiche contexte

**Files:**
- Create: `src/features/synthese/ContexteFiche.tsx`
- Test: `src/features/synthese/ContexteFiche.test.tsx`

**Interfaces:**
- Consumes: `ContexteProcedure` de `./lrpgn`.
- Produces: `<ContexteFiche contexte={ContexteProcedure} />` — composant par défaut du module.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `src/features/synthese/ContexteFiche.test.tsx` :

```tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import ContexteFiche from "./ContexteFiche";
import type { ContexteProcedure } from "./lrpgn";

const CONTEXTE: ContexteProcedure = {
  personnes: [
    {
      nom: "BIDULE",
      prenom: "Marc",
      naissanceDate: "21/02/1985",
      naissanceLieu: "LORIGNE",
      implication: "VICTIME",
      nationalite: "FRANÇAISE",
    },
  ],
  faits: [
    {
      libelle: "VOL EN BANDE ORGANISEE",
      natinf: "10832",
      debut: "20/02/2025 à 14:47",
      fin: "21/02/2025 à 14:47",
      localisation: "Rue des Plantes",
      commune: "ATHIS MONS",
      codePostal: "91200",
    },
  ],
  procedure: {
    numero: "00059",
    annee: "2025",
    unite: "COB LE-LION-D-ANGERS",
    typeEnquete: "ENQUÊTE PRÉLIMINAIRE",
    dateActe: "vendredi 21 février 2025",
  },
  enqueteurs: [{ nom: "Adjudant Julie MALLIETTE", qualite: "Officier de Police Judiciaire" }],
};

test("affiche la personne, son rôle, le fait et sa qualification", () => {
  render(<ContexteFiche contexte={CONTEXTE} />);
  expect(screen.getByText(/BIDULE Marc/)).toBeTruthy();
  expect(screen.getByText("VICTIME")).toBeTruthy();
  expect(screen.getByText(/VOL EN BANDE ORGANISEE/)).toBeTruthy();
  expect(screen.getByText(/10832/)).toBeTruthy();
  expect(screen.getByText(/COB LE-LION-D-ANGERS/)).toBeTruthy();
});

test("un champ absent ne produit pas de ligne vide", () => {
  const sansEnqueteur: ContexteProcedure = { ...CONTEXTE, enqueteurs: [] };
  render(<ContexteFiche contexte={sansEnqueteur} />);
  expect(screen.queryByText("Enquêteur")).toBeNull();
});

test("contexte sans personne ni fait : la fiche reste lisible", () => {
  render(<ContexteFiche contexte={{ ...CONTEXTE, personnes: [], faits: [] }} />);
  expect(screen.queryByText("Personne entendue")).toBeNull();
  expect(screen.getByText(/COB LE-LION-D-ANGERS/)).toBeTruthy();
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `npm test -- src/features/synthese/ContexteFiche.test.tsx`
Expected: FAIL — `Failed to resolve import "./ContexteFiche"`.

- [ ] **Step 3 : Écrire l'implémentation minimale**

Créer `src/features/synthese/ContexteFiche.tsx` :

```tsx
import type { ContexteProcedure } from "./lrpgn";

// Rendu des données certaines de la procédure (issues du XML LRPGN), affichées
// à part de la proposition rédigée par l'IA : ici rien n'est généré, tout est lu.
// Composant pur : aucun accès au store.

const carte: React.CSSProperties = {
  border: "1px solid var(--c--globals--colors--gray-300, #ddd)",
  borderRadius: 4,
  padding: "12px 14px",
  marginBottom: 16,
  background: "var(--c--globals--colors--gray-050, #f6f6f6)",
};

const titreBloc: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  margin: "0 0 4px",
  color: "#000091",
};

const ligne: React.CSSProperties = { margin: "0 0 2px", fontSize: 13, color: "#3a3a44" };

const roleStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 6px",
  borderRadius: 3,
  background: "#e3e3fd",
  color: "#000091",
  fontSize: 12,
  fontWeight: 700,
};

// Assemble les fragments non vides ; une donnée absente ne laisse pas de trou.
function joindre(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export default function ContexteFiche({ contexte }: { contexte: ContexteProcedure }) {
  const { personnes, faits, procedure, enqueteurs } = contexte;
  const refProcedure = joindre(
    procedure.numero && `Procédure ${procedure.numero}`,
    procedure.annee && `/ ${procedure.annee}`,
    procedure.unite && `— ${procedure.unite}`
  );

  return (
    <section style={carte} aria-label="Contexte de la procédure">
      {personnes.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <p style={titreBloc}>Personne entendue</p>
          {personnes.map((p, i) => (
            <p key={i} style={ligne}>
              {joindre(p.nom, p.prenom)}{" "}
              {p.implication && <span style={roleStyle}>{p.implication}</span>}
              {p.naissanceDate && ` — né(e) le ${p.naissanceDate}`}
              {p.naissanceLieu && ` à ${p.naissanceLieu}`}
              {p.nationalite && ` — ${p.nationalite}`}
            </p>
          ))}
        </div>
      )}

      {faits.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <p style={titreBloc}>Faits</p>
          {faits.map((f, i) => (
            <p key={i} style={ligne}>
              {joindre(f.libelle, f.natinf && `(natinf ${f.natinf})`)}
              {f.debut && ` — du ${f.debut}`}
              {f.fin && ` au ${f.fin}`}
              {joindre(
                f.localisation && ` — ${f.localisation}`,
                f.commune && `, ${f.commune}`,
                f.codePostal && `(${f.codePostal})`
              )}
            </p>
          ))}
        </div>
      )}

      <div>
        <p style={titreBloc}>Procédure</p>
        {refProcedure && <p style={ligne}>{refProcedure}</p>}
        {(procedure.typeEnquete || procedure.dateActe) && (
          <p style={ligne}>{joindre(procedure.typeEnquete, procedure.dateActe && `— ${procedure.dateActe}`)}</p>
        )}
        {enqueteurs.length > 0 && (
          <>
            <p style={{ ...titreBloc, marginTop: 8 }}>Enquêteur</p>
            {enqueteurs.map((e, i) => (
              <p key={i} style={ligne}>
                {joindre(e.nom, e.qualite && `— ${e.qualite}`)}
              </p>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `npm test -- src/features/synthese/ContexteFiche.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5 : Commit**

```bash
git add src/features/synthese/ContexteFiche.tsx src/features/synthese/ContexteFiche.test.tsx
git commit -m "feat(analyse): fiche contexte de procedure"
```

---

### Task 4 : Branchement de l'extraction dans le store

**Files:**
- Modify: `src/features/synthese/syntheseStore.ts` (état, `setPieces`, `clear`)
- Test: `src/features/synthese/syntheseStore.test.ts` (ajouts)

**Interfaces:**
- Consumes: `extraireXmlPdf` (T1), `parseLrpgn` / `ContexteProcedure` (T2), `pdfAvecXml` (T1).
- Produces: `SyntheseState` gagne `xml: string | null` et `contexte: ContexteProcedure | null`, lus par la tâche 5 et envoyés par la tâche 6.

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `src/features/synthese/syntheseStore.test.ts`, ajouter ces lignes **en tête de fichier**, sous les imports existants :

```ts
import { readFileSync } from "node:fs";
import { pdfAvecXml, pdfSansPieceJointe } from "../../test/pdfAvecXml";

const XML_LRPGN = readFileSync("src/fixtures/lrpgn-audition.xml", "utf8");
```

puis ces trois tests **à la fin du fichier** :

```ts
test("une pièce porteuse de XML alimente contexte et xml", async () => {
  const store = await import("./syntheseStore");
  store.setPieces([await pdfAvecXml(XML_LRPGN)]);
  await vi.waitFor(() => {
    expect(store.lireEtat().contexte?.personnes[0].nom).toBe("BIDULE");
  });
  expect(store.lireEtat().xml).toContain("<Procedure");
});

test("une pièce sans XML laisse contexte à null, sans erreur", async () => {
  const store = await import("./syntheseStore");
  store.setPieces([await pdfSansPieceJointe()]);
  await new Promise((r) => setTimeout(r, 20));
  expect(store.lireEtat().contexte).toBeNull();
  expect(store.lireEtat().xml).toBeNull();
  expect(store.lireEtat().error).toBeNull();
  expect(store.lireEtat().pieces).toHaveLength(1);
});

test("clear remet le contexte à zéro", async () => {
  const store = await import("./syntheseStore");
  store.setPieces([await pdfAvecXml(XML_LRPGN)]);
  await vi.waitFor(() => expect(store.lireEtat().contexte).not.toBeNull());
  store.clear();
  expect(store.lireEtat().contexte).toBeNull();
  expect(store.lireEtat().xml).toBeNull();
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `npm test -- src/features/synthese/syntheseStore.test.ts`
Expected: FAIL — `store.lireEtat is not a function`.

- [ ] **Step 3 : Étendre le store**

Dans `src/features/synthese/syntheseStore.ts` :

1. Ajouter les imports en tête du fichier :

```ts
import { extraireXmlPdf } from "./pdfXml";
import { parseLrpgn, type ContexteProcedure } from "./lrpgn";
```

2. Étendre le type :

```ts
export type SyntheseState = {
  pieces: File[];
  loading: boolean;
  error: string | null;
  html: string;
  // Données certaines lues dans la pièce jointe XML des PDF LRPGN. Non
  // persistées : elles se redéduisent du fichier, qui n'est lui-même pas
  // persistable.
  xml: string | null;
  contexte: ContexteProcedure | null;
};
```

3. Compléter l'état initial du store (la clé de persistance et `keys: ["html"]` restent inchangées) :

```ts
const store = createPersistedStore<SyntheseState>(
  { pieces: [], loading: false, error: null, html: "", xml: null, contexte: null },
```

4. Remplacer `setPieces` :

```ts
export function setPieces(pieces: File[]) {
  store.set({ pieces, error: null, xml: null, contexte: null });
  const piece = pieces[0];
  if (!piece) return;
  // Extraction best-effort et hors du chemin critique : la pièce est déjà posée,
  // l'analyse peut être lancée sans attendre, et un échec ne se voit pas.
  extraireXmlPdf(piece)
    .then((xml) => {
      // La sélection a pu changer pendant l'extraction : résultat périmé ignoré.
      if (store.get().pieces[0] !== piece || !xml) return;
      store.set({ xml, contexte: parseLrpgn(xml) });
    })
    .catch(() => {});
}
```

5. Remplacer `clear` :

```ts
export function clear() {
  store.set({ pieces: [], html: "", error: null, xml: null, contexte: null });
}
```

6. Exposer la lecture d'état pour les tests, sous le `export const useSynthese` existant :

```ts
// Lecture hors React (tests, appelants non-composants).
export const lireEtat = store.get;
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `npm test -- src/features/synthese/syntheseStore.test.ts`
Expected: PASS — 5 tests (2 existants + 3 nouveaux).

- [ ] **Step 5 : Commit**

```bash
git add src/features/synthese/syntheseStore.ts src/features/synthese/syntheseStore.test.ts
git commit -m "feat(analyse): extraction du contexte au choix de la piece"
```

---

### Task 5 : Badge et fiche dans l'écran Analyse

**Files:**
- Modify: `src/features/synthese/SyntheseApp.tsx`
- Test: `src/features/synthese/SyntheseApp.test.tsx` (création)

**Interfaces:**
- Consumes: `useSynthese` / `setPieces` / `clear` (T4), `ContexteFiche` (T3), `pdfAvecXml` (T1).
- Produces: rien pour les tâches suivantes.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `src/features/synthese/SyntheseApp.test.tsx` :

```tsx
import { readFileSync } from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SyntheseApp from "./SyntheseApp";
import { setPieces, clear } from "./syntheseStore";
import { pdfAvecXml, pdfSansPieceJointe } from "../../test/pdfAvecXml";

const XML_LRPGN = readFileSync("src/fixtures/lrpgn-audition.xml", "utf8");

beforeEach(() => {
  clear();
  sessionStorage.clear();
});

test("badge et fiche apparaissent quand la pièce porte un XML LRPGN", async () => {
  render(<SyntheseApp />);
  setPieces([await pdfAvecXml(XML_LRPGN)]);
  await vi.waitFor(() => {
    expect(screen.getByText(/Données LRPGN détectées/)).toBeTruthy();
  });
  expect(screen.getByText(/BIDULE Marc/)).toBeTruthy();
  expect(screen.getByText("VICTIME")).toBeTruthy();
});

test("pièce sans XML : ni badge ni fiche, écran inchangé", async () => {
  render(<SyntheseApp />);
  setPieces([await pdfSansPieceJointe()]);
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByText(/Données LRPGN détectées/)).toBeNull();
  expect(screen.queryByLabelText("Contexte de la procédure")).toBeNull();
  expect(screen.getByRole("button", { name: /Analyser/ })).toBeTruthy();
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `npm test -- src/features/synthese/SyntheseApp.test.tsx`
Expected: FAIL — le texte « Données LRPGN détectées » est introuvable.

- [ ] **Step 3 : Câbler le composant**

Dans `src/features/synthese/SyntheseApp.tsx` :

1. Ajouter l'import après celui de `PropositionEditor` :

```tsx
import ContexteFiche from "./ContexteFiche";
```

2. Lire le contexte dans le composant — remplacer la ligne existante :

```tsx
  const { pieces, loading, error, html } = useSynthese();
```

par :

```tsx
  const { pieces, loading, error, html, contexte } = useSynthese();
```

3. Ajouter la constante de style du badge à côté de `btnStyle`, avant la définition du composant :

```tsx
const badgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 8px",
  borderRadius: 12,
  background: "#e3e3fd",
  color: "#000091",
  fontSize: 12,
  fontWeight: 700,
};
```

4. Insérer badge et fiche entre le bloc `{error && …}` et le cadre « Proposition » — c'est-à-dire juste avant la `<div>` qui contient le titre « Proposition » :

```tsx
      {contexte && (
        <>
          <p style={{ margin: "0 0 8px" }}>
            <span style={badgeStyle}>
              <span className="material-icons" aria-hidden style={{ fontSize: 14 }}>
                verified
              </span>
              Données LRPGN détectées
            </span>
          </p>
          <ContexteFiche contexte={contexte} />
        </>
      )}
```

Ne rien ajouter pour le cas sans XML : c'est le cas normal.

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `npm test -- src/features/synthese/SyntheseApp.test.tsx`
Expected: PASS — 2 tests.

- [ ] **Step 5 : Vérifier la non-régression de toute la suite front**

Run: `npm test`
Expected: PASS sur l'ensemble.

- [ ] **Step 6 : Commit**

```bash
git add src/features/synthese/SyntheseApp.tsx src/features/synthese/SyntheseApp.test.tsx
git commit -m "feat(analyse): affiche le badge et la fiche contexte LRPGN"
```

---

### Task 6 : Transmission du XML au BFF

**Files:**
- Modify: `src/features/synthese/syntheseApi.ts` (signature de `sendSynthese`)
- Modify: `src/features/synthese/syntheseStore.ts` (`run`)
- Test: `src/features/synthese/syntheseApi.test.ts` (mise à jour des 3 appels + 2 tests)

**Interfaces:**
- Consumes: `xml` du store (T4).
- Produces: `sendSynthese(files: PieceEncodee[], contexte?: string | null, fetchImpl?: typeof fetch): Promise<string>` — le corps POST devient `{ files, contexte? }`, consommé par la tâche 7.

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `src/features/synthese/syntheseApi.test.ts` :

1. Le troisième argument devient `fetchImpl`. Corriger les deux appels existants qui passent `impl` en 2ᵉ position :

```ts
  expect(await run(sendSynthese([piece], null, impl))).toBe("## Faits");
```

```ts
  await expect(run(sendSynthese([piece], null, impl))).rejects.toThrow("SYNTHESE_TIMEOUT");
```

```ts
  await expect(run(sendSynthese([piece], null, impl))).rejects.toThrow("SYNTHESE_INVALIDE");
```

2. Ajouter à la fin du fichier :

```ts
test("le contexte XML est joint au corps quand il est fourni", async () => {
  const calls: [string, RequestInit?][] = [];
  let i = 0;
  const responses = [{ jobId: "j" }, { status: "done", result: { texte: "## Faits" } }];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    return { ok: true, json: async () => responses[Math.min(i++, responses.length - 1)] };
  }) as unknown as typeof fetch;

  await run(sendSynthese([piece], "<Procedure/>", impl));
  expect(JSON.parse(calls[0][1]!.body as string)).toEqual({
    files: [piece],
    contexte: "<Procedure/>",
  });
});

test("aucun champ contexte quand il n'y a pas de XML", async () => {
  const calls: [string, RequestInit?][] = [];
  let i = 0;
  const responses = [{ jobId: "j" }, { status: "done", result: { texte: "## Faits" } }];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    return { ok: true, json: async () => responses[Math.min(i++, responses.length - 1)] };
  }) as unknown as typeof fetch;

  await run(sendSynthese([piece], null, impl));
  expect(JSON.parse(calls[0][1]!.body as string)).toEqual({ files: [piece] });
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `npm test -- src/features/synthese/syntheseApi.test.ts`
Expected: FAIL — le corps ne contient pas `contexte`, et les appels à 3 arguments ne passent pas le bon `fetchImpl`.

- [ ] **Step 3 : Modifier le client**

Dans `src/features/synthese/syntheseApi.ts`, remplacer `sendSynthese` :

```ts
export async function sendSynthese(
  files: PieceEncodee[],
  contexte: string | null = null,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const { texte } = await runJobAsync<{ texte?: string }>(
    "/api/synthese",
    // Le contexte n'est envoyé que s'il existe : le workflow ne doit pas voir de
    // champ vide.
    contexte ? { files, contexte } : { files },
    { fetchImpl }
  );
  if (!texte) throw new Error("SYNTHESE_INVALIDE");
  return texte;
}
```

- [ ] **Step 4 : Alimenter l'appel depuis le store**

Dans `src/features/synthese/syntheseStore.ts`, dans `run`, remplacer :

```ts
    const texte = await sendSynthese(encodees);
```

par :

```ts
    const texte = await sendSynthese(encodees, store.get().xml);
```

- [ ] **Step 5 : Lancer les tests, vérifier le succès**

Run: `npm test -- src/features/synthese/syntheseApi.test.ts src/features/synthese/syntheseStore.test.ts`
Expected: PASS — 5 tests d'API, 5 de store.

- [ ] **Step 6 : Commit**

```bash
git add src/features/synthese/syntheseApi.ts src/features/synthese/syntheseApi.test.ts src/features/synthese/syntheseStore.ts
git commit -m "feat(analyse): transmet le XML LRPGN au BFF"
```

---

### Task 7 : Envoi au workflow IAka avec repli

**Files:**
- Modify: `server/synthese.mjs` (`runSynthese`)
- Modify: `server/proxy.mjs:251-264` (route `/api/synthese`)
- Test: `server/synthese.test.mjs` (ajouts)

**Interfaces:**
- Consumes: corps `{ files, contexte? }` (T6).
- Produces: `runSynthese({ files, contexte, cfg, fetchImpl, sleep })` — `contexte` optionnel, défaut `null`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à la fin de `server/synthese.test.mjs` :

```js
import { runSynthese } from "./synthese.mjs";

const CFG = {
  jwt: "j",
  baseUrl: "https://iaka.test",
  syntheseAppId: "app",
  tenantId: "t",
  pollIntervalMs: 1,
  pollTimeoutMs: 1000,
};
const FILES = [{ base64: "AAAA", mime: "application/pdf", filename: "pv.pdf" }];
const SUCCES = { ok: true, json: async () => ({ status: "SUCCESS", result: "## Analyse" }) };

// Enregistre chaque POST d'exécution et sa valeur du champ `prompt`.
function stub(reponsesExec) {
  const prompts = [];
  let i = 0;
  const fetchImpl = async (url, init) => {
    if (init?.method === "POST") {
      prompts.push(init.body.get("prompt"));
      const r = reponsesExec[Math.min(i++, reponsesExec.length - 1)];
      return r.ok
        ? { ok: true, status: 200, json: async () => ({ execution_id: "e" }) }
        : { ok: false, status: r.status, json: async () => ({}) };
    }
    return SUCCES;
  };
  return { fetchImpl, prompts };
}

test("le contexte part en champ prompt", async () => {
  const { fetchImpl, prompts } = stub([{ ok: true }]);
  const texte = await runSynthese({
    files: FILES,
    contexte: "<Procedure/>",
    cfg: CFG,
    fetchImpl,
    sleep: async () => {},
  });
  assert.equal(texte, "## Analyse");
  assert.deepEqual(prompts, ["<Procedure/>"]);
});

test("un refus 422 déclenche un second envoi sans contexte", async () => {
  const { fetchImpl, prompts } = stub([{ ok: false, status: 422 }, { ok: true }]);
  const texte = await runSynthese({
    files: FILES,
    contexte: "<Procedure/>",
    cfg: CFG,
    fetchImpl,
    sleep: async () => {},
  });
  assert.equal(texte, "## Analyse");
  assert.deepEqual(prompts, ["<Procedure/>", null]);
});

test("sans contexte, un seul envoi", async () => {
  const { fetchImpl, prompts } = stub([{ ok: true }]);
  await runSynthese({ files: FILES, cfg: CFG, fetchImpl, sleep: async () => {} });
  assert.deepEqual(prompts, [null]);
});

test("une panne 500 ne déclenche pas de rejeu", async () => {
  const { fetchImpl, prompts } = stub([{ ok: false, status: 500 }]);
  await assert.rejects(
    runSynthese({
      files: FILES,
      contexte: "<Procedure/>",
      cfg: CFG,
      fetchImpl,
      sleep: async () => {},
    }),
    /SYNTHESE_UPSTREAM/
  );
  assert.equal(prompts.length, 1);
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `node --test server/synthese.test.mjs`
Expected: FAIL — `assert.deepEqual(prompts, ["<Procedure/>"])` échoue : le champ `prompt` vaut `null`, `runSynthese` ne l'envoie pas encore.

- [ ] **Step 3 : Modifier `runSynthese`**

Dans `server/synthese.mjs`, remplacer la signature et le bloc de construction/envoi (de `export async function runSynthese` jusqu'au `if (!execRes.ok) throw new Error("SYNTHESE_UPSTREAM");` inclus) par :

```js
/**
 * Déclenche le workflow IAka de synthèse avec les pièces de procédure en
 * pièces jointes (multipart/form-data), attend le résultat et en extrait le texte.
 *
 * @param {object} p
 * @param {{base64: string, mime: string, filename: string}[]} p.files
 * @param {string|null} [p.contexte]  XML LRPGN extrait de la pièce, envoyé en `prompt`
 * @param {object} p.cfg  config IAka (voir proxy.mjs)
 */
export async function runSynthese({ files, contexte = null, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  const auth = { Authorization: `Bearer ${cfg.jwt}` };
  const execPath = cfg.executePath || "/workflows/execute";
  const statusTpl = cfg.statusPath || "/workflows/executions/{id}";

  // CONVENTION MULTI-FICHIERS NON VÉRIFIÉE : le workflow de synthèse n'existe pas
  // encore, on ne sait pas s'il attend le champ répété (ci-dessous), un champ
  // `files[]`, ou une exécution par pièce. À confirmer à la mise en place du
  // workflow — c'est le seul endroit à corriger.
  function construireForm(avecContexte) {
    const form = new FormData();
    form.set("app_id", cfg.syntheseAppId);
    form.set("tenant_id", cfg.tenantId);
    form.set("langue", "fr");
    if (avecContexte) form.set("prompt", contexte);
    const field = cfg.syntheseFileField || cfg.imageField || "file";
    for (const [i, f] of files.entries()) {
      const bytes = Buffer.from(f.base64, "base64");
      const blob = new Blob([bytes], { type: f.mime || "application/octet-stream" });
      form.append(field, blob, f.filename || `piece-${i + 1}`);
    }
    return form;
  }

  const postExec = (avecContexte) =>
    fetchImpl(`${cfg.baseUrl}${execPath}`, {
      method: "POST",
      headers: auth, // pas de Content-Type : fetch pose la boundary multipart
      body: construireForm(avecContexte),
    });

  // Le contexte XML n'est envoyé qu'au mieux : certains workflows IAka rejettent
  // en 4xx tout champ qu'ils ne déclarent pas (cf. iaka.mjs). Un refus fait
  // rejouer l'exécution sans contexte, pour ne jamais dégrader l'analyse. Un 5xx
  // est une panne amont : rejouer n'y changerait rien.
  let execRes = await postExec(Boolean(contexte));
  if (!execRes.ok && contexte && execRes.status >= 400 && execRes.status < 500) {
    console.error(`[synthese] contexte refusé par le workflow (${execRes.status}) → nouvel essai sans`);
    execRes = await postExec(false);
  }
  if (!execRes.ok) throw new Error("SYNTHESE_UPSTREAM");
```

Le reste de la fonction (lecture de `execution_id`, boucle de polling) est inchangé.

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `node --test server/synthese.test.mjs`
Expected: PASS — 8 tests (4 existants + 4 nouveaux).

- [ ] **Step 5 : Relayer le contexte dans le proxy**

Dans `server/proxy.mjs`, route `/api/synthese` (vers la ligne 251), remplacer :

```js
        const { files } = JSON.parse(raw || "{}");
```

par :

```js
        const { files, contexte } = JSON.parse(raw || "{}");
        // Garde-fou de taille : le XML LRPGN observé fait 5 ko.
        const contexteXml = typeof contexte === "string" ? contexte.slice(0, 100_000) : null;
```

et remplacer :

```js
        runJob(jobId, async () => ({ texte: await synthese({ files, cfg, fetchImpl }) }));
```

par :

```js
        runJob(jobId, async () => ({ texte: await synthese({ files, contexte: contexteXml, cfg, fetchImpl }) }));
```

- [ ] **Step 6 : Vérifier l'ensemble**

Run: `node --test server/*.test.mjs`
Expected: PASS.

Run: `npm test`
Expected: PASS.

Run: `npm run build`
Expected: succès `tsc -b && vite build`.

- [ ] **Step 7 : Commit**

```bash
git add server/synthese.mjs server/synthese.test.mjs server/proxy.mjs
git commit -m "feat(analyse): envoie le contexte XML au workflow avec repli"
```

---

## Vérification manuelle finale

- [ ] `npm run dev` puis ouvrir `/analyse`.
- [ ] Déposer `/Users/brunogauville/Downloads/20250221_1445_PVAudition_VIC_BIDULE_MARC.pdf` : le badge « Données LRPGN détectées » et la fiche (BIDULE Marc, VICTIME, VOL EN BANDE ORGANISEE natinf 10832, COB LE-LION-D-ANGERS) apparaissent **sans** cliquer sur Analyser.
- [ ] Déposer une image ou un PDF quelconque : aucun badge, aucune fiche, écran identique à avant.
- [ ] Cliquer « Vider » : badge et fiche disparaissent.
- [ ] Vérifier qu'aucune donnée sensible (téléphone, adresse, profession) n'apparaît à l'écran.
