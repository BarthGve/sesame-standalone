# Ariane — métadonnées déterministes, phase 1 — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre déterministes les champs vérifiables des pièces LRPGN à partir du nom de fichier, et faire la coréférence des personnes en code plutôt que par le LLM.

**Architecture:** Un module pur `server/pieceMeta.mjs` (grammaire du nom de fichier, clé d'identité, fusion des mentions), consommé par `server/ariane.mjs` entre le MAP et la construction de l'agrégat. Aucun appel réseau, aucune dépendance npm, aucun fichier de `src/features/synthese/` touché.

**Tech Stack:** Node natif (ESM `.mjs`), `node --test`. Front : React 19 + Vitest pour la seule tâche 5.

**Spec :** `docs/superpowers/specs/2026-07-20-ariane-metadonnees-pieces-design.md`

## Global Constraints

- **Aucune dépendance npm ajoutée.**
- **Interdit : emoji dans le front.** Icônes = `material-icons` ou SVG inline (`CLAUDE.md`).
- Code, commentaires, libellés d'interface et messages de commit **en français**.
- **Journalisation** : jamais de nom de personne, de nom de fichier ni de contenu de pièce dans les logs. Le nom de fichier contient l'état civil. Contenu réservé à `ARIANE_DEBUG=1` (`server/ariane.mjs`, `debugContenu()`).
- **Aucune valeur devinée** : un code de vocabulaire inconnu donne `autre` **et** un avertissement le nommant. Voir §4.2 de la spec.
- **Sens de dégradation** : dans le doute, ne pas fusionner. Une sous-fusion est visible et corrigeable ; une fusion erronée attribue les actes d'une personne à une autre.
- Ne **pas** modifier `src/features/synthese/*` — périmètre d'une autre équipe.
- Tests serveur : `node --test server/<fichier>.test.mjs`. Tests front : `npm test -- src/features/ariane`.
- Un commit par tâche.

## Hors périmètre (phases ultérieures)

- Phase 2 — lecture du XML embarqué, discriminants `naissanceDate` / `naissanceLieu`. Dépend de `parseLrpgn` (équipe `/analyse`).
- Phase 3 — envoi des métadonnées dans le prompt du MAP, allègement du schéma de sortie. Dépend d'une vérification `require_prompt` côté IAka.

**Ce que la phase 1 ne corrige pas :** la troncature du REDUCE. Elle réduit l'entrée de la consolidation, pas sa sortie — c'est la sortie qui dépasse le plafond de tokens. La fiabilité, elle, est acquise dès cette phase.

---

### Task 1 : Grammaire du nom de fichier

**Files:**
- Create: `server/pieceMeta.mjs`
- Test: `server/pieceMeta.test.mjs`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `parseNomFichier(filename: string) → { date, heure, typeActe, role, nom, prenom, avertissements: string[] } | null`

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `server/pieceMeta.test.mjs` :

```js
import test from "node:test";
import assert from "node:assert/strict";
import { parseNomFichier } from "./pieceMeta.mjs";

test("nom LRPGN conforme → champs exacts", () => {
  const m = parseNomFichier("20250221_1445_PVAudition_VIC_BIDULE_MARC.pdf");
  assert.deepEqual(m, {
    date: "2025-02-21", heure: "14:45", typeActe: "audition", role: "victime",
    nom: "BIDULE", prenom: "MARC", avertissements: [],
  });
});

test("nom libre → null", () => {
  assert.equal(parseNomFichier("01_Synthese.pdf"), null);
  assert.equal(parseNomFichier("Audition Elisabeth LE SUEUR.pdf"), null);
  assert.equal(parseNomFichier("perquisition.pdf"), null);
});

test("segment non alphabetique → null plutot qu'un decoupage douteux", () => {
  // Un chiffre ou un espace dans le nom signale un gabarit qu'on ne sait pas lire.
  assert.equal(parseNomFichier("20250221_1445_PVAudition_VIC_BIDULE2_MARC.pdf"), null);
  assert.equal(parseNomFichier("20250221_1445_PVAudition_VIC_LE SUEUR_MARC.pdf"), null);
});

test("type de piece inconnu → autre + avertissement nommant le code", () => {
  const m = parseNomFichier("20250221_1445_PVInconnu_VIC_BIDULE_MARC.pdf");
  assert.equal(m.typeActe, "autre");
  assert.deepEqual(m.avertissements, ["Type de piece inconnu : PVInconnu"]);
});

test("role inconnu → autre + avertissement nommant le code", () => {
  const m = parseNomFichier("20250221_1445_PVAudition_XYZ_BIDULE_MARC.pdf");
  assert.equal(m.role, "autre");
  assert.deepEqual(m.avertissements, ["Role inconnu : XYZ"]);
});

test("date ou heure invalide → null", () => {
  assert.equal(parseNomFichier("20251345_1445_PVAudition_VIC_BIDULE_MARC.pdf"), null);
  assert.equal(parseNomFichier("20250221_2599_PVAudition_VIC_BIDULE_MARC.pdf"), null);
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `node --test server/pieceMeta.test.mjs`
Expected: FAIL — `Cannot find module './pieceMeta.mjs'`.

- [ ] **Step 3 : Écrire l'implémentation minimale**

Créer `server/pieceMeta.mjs` :

```js
// Métadonnées déterministes d'une pièce de procédure. Module pur : aucun réseau,
// aucun disque, aucune horloge. Voir docs/superpowers/specs/2026-07-20-ariane-metadonnees-pieces-design.md
//
// Principe directeur : aucune valeur n'est devinée. Un code inconnu donne "autre"
// et un avertissement qui le nomme, pour que le vocabulaire reel se decouvre a
// l'usage au lieu d'etre silencieusement ecrase.

// Un seul echantillon confirme a ce jour (PVAudition / VIC). Les autres entrees
// seront ajoutees au vu de noms de fichiers reels, pas par supposition.
const TYPES_PIECE = { PVAudition: "audition" };
const ROLES_FICHIER = { VIC: "victime" };

// Segments strictement alphabetiques : un chiffre, un espace ou un tiret signale
// un gabarit qu'on ne sait pas decouper. Dans le doute → null → chemin LLM actuel.
const GRAMMAIRE = /^(\d{8})_(\d{4})_([A-Za-z]+)_([A-Za-z]+)_([A-Za-z]+)_([A-Za-z]+)$/;

const sansExtension = (nom) => nom.replace(/\.[^.]+$/, "");

export function parseNomFichier(filename) {
  if (typeof filename !== "string") return null;
  const m = GRAMMAIRE.exec(sansExtension(filename));
  if (!m) return null;
  const [, aaaammjj, hhmm, typePiece, codeRole, nom, prenom] = m;

  const annee = aaaammjj.slice(0, 4), mois = aaaammjj.slice(4, 6), jour = aaaammjj.slice(6, 8);
  const heures = hhmm.slice(0, 2), minutes = hhmm.slice(2, 4);
  if (+mois < 1 || +mois > 12 || +jour < 1 || +jour > 31) return null;
  if (+heures > 23 || +minutes > 59) return null;

  const avertissements = [];
  const typeActe = TYPES_PIECE[typePiece];
  if (!typeActe) avertissements.push(`Type de piece inconnu : ${typePiece}`);
  const role = ROLES_FICHIER[codeRole];
  if (!role) avertissements.push(`Role inconnu : ${codeRole}`);

  return {
    date: `${annee}-${mois}-${jour}`,
    heure: `${heures}:${minutes}`,
    typeActe: typeActe ?? "autre",
    role: role ?? "autre",
    nom, prenom, avertissements,
  };
}
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `node --test server/pieceMeta.test.mjs`
Expected: PASS — 6 tests.

- [ ] **Step 5 : Commit**

```bash
git add server/pieceMeta.mjs server/pieceMeta.test.mjs
git commit -m "feat(ariane): grammaire du nom de fichier LRPGN"
```

---

### Task 2 : Clé d'identité

**Files:**
- Modify: `server/pieceMeta.mjs`
- Test: `server/pieceMeta.test.mjs` (ajouts)

**Interfaces:**
- Consumes: rien.
- Produces:
  - `cleNoyau(nomComplet: string) → string | null`

**Pourquoi des jetons triés :** le MAP renvoie un nom entier (`"Jean DUPONT"`), le nom de fichier deux segments (`BIDULE` + `MARC`). Trier les jetons rend les deux formats comparables sans supposer lequel est le nom et lequel le prénom.

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à `server/pieceMeta.test.mjs` :

```js
import { cleNoyau } from "./pieceMeta.mjs";

test("cleNoyau : ordre des jetons indifferent", () => {
  assert.equal(cleNoyau("Marc BIDULE"), cleNoyau("BIDULE Marc"));
  assert.equal(cleNoyau("Marc BIDULE"), "BIDULE|MARC");
});

test("cleNoyau : casse et accents replies", () => {
  assert.equal(cleNoyau("élisabeth LE SUEUR"), cleNoyau("LE SUEUR Elisabeth"));
});

test("cleNoyau : les initiales sont conservees, elles discriminent", () => {
  assert.equal(cleNoyau("Jean-Pierre M. DUPONT"), "DUPONT|JEAN|M|PIERRE");
});

test("cleNoyau : deux initiales differentes ne fusionnent pas", () => {
  assert.notEqual(cleNoyau("Jean M. DUPONT"), cleNoyau("Jean P. DUPONT"));
});

test("cleNoyau : l'apostrophe lie, elle ne separe pas", () => {
  assert.notEqual(cleNoyau("Charles d'Artagnan"), cleNoyau("Charles Artagnan"));
  assert.equal(cleNoyau("Charles d'Artagnan"), "CHARLES|DARTAGNAN");
});

test("cleNoyau : vide ou sans jeton exploitable → null", () => {
  assert.equal(cleNoyau(""), null);
  assert.equal(cleNoyau("   "), null);
  assert.equal(cleNoyau("X"), null);
  assert.equal(cleNoyau("A. B."), null);
  assert.equal(cleNoyau(undefined), null);
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `node --test server/pieceMeta.test.mjs`
Expected: FAIL — `cleNoyau is not a function`.

- [ ] **Step 3 : Écrire l'implémentation minimale**

Ajouter à `server/pieceMeta.mjs` :

```js
// Cle de coreference. Accents retires, casse repliee, apostrophes (droite ou
// typographique) supprimees plutot que traitees en separateur — "d'Artagnan"
// est un patronyme lie, pas deux jetons ; le confondre avec "Artagnan" seul
// serait une sur-fusion (deux patronymes distincts). Le reste est decoupe sur
// tout ce qui n'est pas une lettre, et TOUS les jetons sont retenus, y compris
// ceux d'une seule lettre : une initiale discrimine — "Jean M. DUPONT" et
// "Jean P. DUPONT" sont deux personnes, les ecarter les fusionnerait a tort.
// En revanche un nom reduit uniquement a des initiales (aucun jeton de 2
// lettres ou plus) n'identifie personne : la cle serait trop faible pour
// fonder une fusion, donc on renvoie null plutot qu'une cle inexploitable.
export function cleNoyau(nomComplet) {
  if (typeof nomComplet !== "string") return null;
  const jetons = nomComplet
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/['’]/g, "")
    .split(/[^A-Z]+/)
    .filter((j) => j.length > 0);
  if (!jetons.some((j) => j.length >= 2)) return null;
  return [...new Set(jetons)].sort().join("|");
}
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `node --test server/pieceMeta.test.mjs`
Expected: PASS — 13 tests.

- [ ] **Step 5 : Commit**

```bash
git add server/pieceMeta.mjs server/pieceMeta.test.mjs
git commit -m "feat(ariane): cle d'identite par jetons tries"
```

---

### Task 3 : Fusion des mentions en groupes

**Files:**
- Modify: `server/pieceMeta.mjs`
- Test: `server/pieceMeta.test.mjs` (ajouts)

**Interfaces:**
- Consumes: `cleNoyau` (T2).
- Produces:
  - `fusionnerMentions(mentions) → { groupes, sansCle }`
    - `mentions` : `[{ gref, cote, nom, role_apparent }]`
    - `groupes` : `[{ cle, nom, membres: [gref], roles: [{ role, cote }], role }]`
    - `sansCle` : mentions dont `cleNoyau` vaut `null`, à laisser au REDUCE

**Rôle principal :** le plus engageant de `roles`, ordre `mis_en_cause > victime > requis > temoin > magistrat > enqueteur > autre` (spec §4.4).

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à `server/pieceMeta.test.mjs` :

```js
import { fusionnerMentions } from "./pieceMeta.mjs";

test("deux mentions du meme nom sur deux cotes → un groupe", () => {
  const { groupes } = fusionnerMentions([
    { gref: "D3:m1", cote: "D3", nom: "Marc BIDULE", role_apparent: "temoin" },
    { gref: "D9:m4", cote: "D9", nom: "BIDULE Marc", role_apparent: "mis_en_cause" },
  ]);
  assert.equal(groupes.length, 1);
  assert.deepEqual(groupes[0].membres, ["D3:m1", "D9:m4"]);
});

test("roles conserves par cote, role principal le plus engageant", () => {
  const { groupes } = fusionnerMentions([
    { gref: "D3:m1", cote: "D3", nom: "Marc BIDULE", role_apparent: "temoin" },
    { gref: "D9:m4", cote: "D9", nom: "BIDULE Marc", role_apparent: "mis_en_cause" },
  ]);
  assert.deepEqual(groupes[0].roles, [
    { role: "temoin", cote: "D3" },
    { role: "mis_en_cause", cote: "D9" },
  ]);
  assert.equal(groupes[0].role, "mis_en_cause");
});

test("noms distincts → groupes distincts", () => {
  const { groupes } = fusionnerMentions([
    { gref: "D1:m1", cote: "D1", nom: "Marc BIDULE", role_apparent: "victime" },
    { gref: "D1:m2", cote: "D1", nom: "Julie MALLIETTE", role_apparent: "enqueteur" },
  ]);
  assert.equal(groupes.length, 2);
});

test("mention sans cle exploitable → sansCle, jamais fusionnee", () => {
  const { groupes, sansCle } = fusionnerMentions([
    { gref: "D1:m1", cote: "D1", nom: "le suspect", role_apparent: "mis_en_cause" },
    { gref: "D1:m2", cote: "D1", nom: "X", role_apparent: "temoin" },
  ]);
  // "le suspect" donne LE|SUSPECT : deux jetons, donc une cle. "X" n'en donne aucune.
  assert.equal(sansCle.length, 1);
  assert.equal(sansCle[0].gref, "D1:m2");
  assert.equal(groupes.length, 1);
});

test("meme cote, meme personne citee deux fois → un seul groupe, deux membres", () => {
  const { groupes } = fusionnerMentions([
    { gref: "D1:m1", cote: "D1", nom: "Marc BIDULE", role_apparent: "victime" },
    { gref: "D1:m7", cote: "D1", nom: "Marc BIDULE", role_apparent: "victime" },
  ]);
  assert.equal(groupes.length, 1);
  assert.deepEqual(groupes[0].membres, ["D1:m1", "D1:m7"]);
  // Le meme role sur la meme cote n'est pas duplique.
  assert.deepEqual(groupes[0].roles, [{ role: "victime", cote: "D1" }]);
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `node --test server/pieceMeta.test.mjs`
Expected: FAIL — `fusionnerMentions is not a function`.

- [ ] **Step 3 : Écrire l'implémentation minimale**

Ajouter à `server/pieceMeta.mjs` :

```js
// Du plus engageant au moins engageant. Sert a choisir le role principal d'une
// partie vue sous plusieurs statuts au fil de la procedure (spec §4.4).
const ORDRE_ROLES = ["mis_en_cause", "victime", "requis", "temoin", "magistrat", "enqueteur", "autre"];
const rang = (role) => {
  const i = ORDRE_ROLES.indexOf(role);
  return i === -1 ? ORDRE_ROLES.length : i;
};

// Regroupe les mentions de personnes par cle de coreference. Une mention sans cle
// exploitable n'est jamais fusionnee : elle repart telle quelle vers le REDUCE.
export function fusionnerMentions(mentions) {
  const parCle = new Map();
  const sansCle = [];
  for (const m of mentions) {
    const cle = cleNoyau(m.nom);
    if (!cle) { sansCle.push(m); continue; }
    let g = parCle.get(cle);
    if (!g) { g = { cle, nom: m.nom, membres: [], roles: [] }; parCle.set(cle, g); }
    g.membres.push(m.gref);
    const role = m.role_apparent || "autre";
    if (!g.roles.some((r) => r.role === role && r.cote === m.cote)) {
      g.roles.push({ role, cote: m.cote });
    }
  }
  const groupes = [...parCle.values()].map((g) => ({
    ...g,
    role: [...g.roles].sort((a, b) => rang(a.role) - rang(b.role))[0]?.role ?? "autre",
  }));
  return { groupes, sansCle };
}
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `node --test server/pieceMeta.test.mjs`
Expected: PASS — 15 tests.

- [ ] **Step 5 : Commit**

```bash
git add server/pieceMeta.mjs server/pieceMeta.test.mjs
git commit -m "feat(ariane): fusion des mentions de personnes en code"
```

---

### Task 4 : Application des métadonnées aux sorties MAP

**Files:**
- Modify: `server/ariane.mjs` (`runAriane`, nouvelle fonction `appliquerMeta`)
- Test: `server/ariane.test.mjs` (ajouts)

**Interfaces:**
- Consumes: `parseNomFichier` (T1).
- Produces:
  - `appliquerMeta(mapOutput, meta) → mapOutput` — écrase les champs vérifiables, ne supprime rien.

**Ordre d'autorité (spec §3.2) :** le nom de fichier écrase la sortie du LLM sur `acte.type`, `acte.date`, et sur le `role_apparent` de la personne dont le noyau correspond. Le LLM n'est jamais autoritaire sur ces champs.

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à `server/ariane.test.mjs` :

```js
import { appliquerMeta } from "./ariane.mjs";
import { parseNomFichier } from "./pieceMeta.mjs";

test("le nom de fichier ecrase le type et la date devines par le LLM", () => {
  const meta = parseNomFichier("20250221_1445_PVAudition_VIC_BIDULE_MARC.pdf");
  const out = appliquerMeta({
    cote: "D1",
    acte: { type: "constatation", date: "2020-01-01", libelle: "l", redacteur_ref: null, concernes_refs: [] },
    personnes: [], faits: [], relations_lues: [],
  }, meta);
  assert.equal(out.acte.type, "audition");
  assert.equal(out.acte.date, "2025-02-21");
});

test("le role de la personne nommee dans le fichier ecrase celui du LLM", () => {
  const meta = parseNomFichier("20250221_1445_PVAudition_VIC_BIDULE_MARC.pdf");
  const out = appliquerMeta({
    cote: "D1", acte: null,
    personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }],
    faits: [], relations_lues: [],
  }, meta);
  assert.equal(out.personnes[0].role_apparent, "victime");
});

test("personne du fichier absente de l'extraction → ajoutee", () => {
  const meta = parseNomFichier("20250221_1445_PVAudition_VIC_BIDULE_MARC.pdf");
  const out = appliquerMeta({
    cote: "D1", acte: null,
    personnes: [{ ref: "m1", nom: "Julie MALLIETTE", role_apparent: "enqueteur" }],
    faits: [], relations_lues: [],
  }, meta);
  assert.equal(out.personnes.length, 2);
  const ajoutee = out.personnes.find((p) => p.nom === "BIDULE MARC");
  assert.equal(ajoutee.role_apparent, "victime");
});

test("meta null → sortie inchangee", () => {
  const brut = { cote: "D1", acte: { type: "constatation", date: "2020-01-01" }, personnes: [], faits: [], relations_lues: [] };
  assert.deepEqual(appliquerMeta(brut, null), brut);
});

test("runAriane applique les metadonnees et remonte leurs avertissements", async () => {
  const files = [{ base64: "AA==", mime: "application/pdf", filename: "20250221_1445_PVInconnu_VIC_BIDULE_MARC.pdf" }];
  const deps = {
    runExtraction: async ({ cote }) => ({ cote, acte: { type: "constatation", date: "2020-01-01", libelle: "l", redacteur_ref: null, concernes_refs: [] },
      personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }], faits: [], relations_lues: [] }),
    runConsolidation: async () => ({ affaire: {}, synthese: "s",
      parties: [{ id: "p1", nom: "Marc BIDULE", role: "victime", aliases: [], qualite: "", premiere_cote: "D1", membres: [] }], relations: [] }),
  };
  const avertissements = [];
  await runAriane({ files, cfg: { mapConcurrency: 1 }, deps, onAvertissement: (a) => avertissements.push(a) });
  assert.deepEqual(avertissements, ["Type de piece inconnu : PVInconnu"]);
});
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `node --test server/ariane.test.mjs`
Expected: FAIL — `appliquerMeta is not a function`.

- [ ] **Step 3 : Écrire l'implémentation**

Dans `server/ariane.mjs`, ajouter l'import en tête :

```js
import { parseNomFichier, cleNoyau } from "./pieceMeta.mjs";
```

Puis, avant `runAriane` :

```js
// Applique les metadonnees deterministes a une extraction. Le LLM n'est jamais
// autoritaire sur les champs que le nom de fichier fournit (spec §3.2) : on ecrase.
// Rien n'est supprime — une personne du nom de fichier absente de l'extraction est
// ajoutee plutot que de faire disparaitre celles que le LLM a vues.
export function appliquerMeta(out, meta) {
  if (!meta) return out;
  if (out.acte) {
    out.acte.type = meta.typeActe;
    out.acte.date = meta.date;
  }
  const cleMeta = cleNoyau(`${meta.nom} ${meta.prenom}`);
  const existante = (out.personnes || []).find((p) => cleNoyau(p.nom) === cleMeta);
  if (existante) {
    existante.role_apparent = meta.role;
  } else {
    out.personnes = [...(out.personnes || []),
      { ref: `meta_${cleMeta}`, nom: `${meta.nom} ${meta.prenom}`, role_apparent: meta.role, aliases: [] }];
  }
  return out;
}
```

Dans `runAriane`, ajouter le paramètre `onAvertissement` et appliquer la méta après extraction :

```js
export async function runAriane({ files, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep, onProgress = () => {}, onPieceIgnoree = () => {}, onAvertissement = () => {}, deps = {} }) {
```

et, dans le worker de `mapPool`, juste après `out = await extract(...)` :

```js
      const meta = parseNomFichier(u.file.filename);
      if (meta) {
        meta.avertissements.forEach(onAvertissement);
        out = appliquerMeta(out, meta);
      }
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `node --test server/ariane.test.mjs server/pieceMeta.test.mjs`
Expected: PASS — 29 + 15 tests, 0 échec.

- [ ] **Step 5 : Commit**

```bash
git add server/ariane.mjs server/ariane.test.mjs
git commit -m "feat(ariane): les metadonnees du nom de fichier ecrasent le LLM"
```

---

### Task 5 : Remontée des avertissements jusqu'au bandeau

**Files:**
- Modify: `server/ariane.mjs` (`startJob`)
- Modify: `src/features/ariane/arianeApi.ts`
- Modify: `src/features/ariane/arianeStore.ts`
- Modify: `src/features/ariane/ArianeApp.tsx:71-85` (bandeau existant)
- Test: `server/ariane.test.mjs`, `src/features/ariane/arianeStore.test.ts`, `src/features/ariane/ArianeApp.test.tsx`

**Interfaces:**
- Consumes: `onAvertissement` (T4).
- Produces: `job.avertissements: string[]`, exposé par `/api/ariane/status`, porté par l'état front sous `avertissements`.

Le bandeau d'avertissement existe déjà (livré ce jour pour `pieces_ignorees`). On y ajoute une seconde liste plutôt qu'un second bandeau : un seul endroit dans l'UI pour « ce dossier n'est pas ce qu'il paraît ».

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `server/ariane.test.mjs` :

```js
test("startJob expose les avertissements sur le job", async () => {
  const jobId = createJob();
  const deps = {
    runExtraction: async ({ cote }) => ({ cote, personnes: [], faits: [], acte: null, relations_lues: [] }),
    runConsolidation: async () => ({ affaire: {}, synthese: "s", parties: [], relations: [] }),
  };
  await startJob({ jobId, files: [{ base64: "AA==", mime: "application/pdf", filename: "20250221_1445_PVInconnu_VIC_BIDULE_MARC.pdf" }], cfg: { mapConcurrency: 1 }, deps });
  assert.deepEqual(getJob(jobId).avertissements, ["Type de piece inconnu : PVInconnu"]);
});
```

Ajouter à `src/features/ariane/arianeStore.test.ts`, dans le `describe` existant :

```ts
  it("run : les avertissements du BFF sont conservés dans l'état", async () => {
    vi.doMock("./arianeApi", () => ({
      encodePiece: vi.fn().mockResolvedValue({ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }),
      startAnalyse: vi.fn().mockResolvedValue("j1"),
      fetchStatus: vi.fn().mockResolvedValue({
        status: "done", progress: { done: 1, total: 1 }, result: dossier,
        avertissements: ["Type de piece inconnu : PVInconnu"],
      }),
    }));
    const store = await import("./arianeStore");
    store.setPieces([fakeFile("D1.pdf")]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    expect(store.snapshotForTest().avertissements).toEqual(["Type de piece inconnu : PVInconnu"]);
  });
```

Ajouter à `src/features/ariane/ArianeApp.test.tsx` :

```tsx
  it("affiche les avertissements de métadonnées dans le bandeau", async () => {
    const dossier = { affaire: { reference: "r", nature: "Vol", service: "BR", periode: { debut: null, fin: null }, nb_cotes: 1 }, synthese: "s", parties: [], evenements: [], actes: [], relations: [] };
    vi.doMock("./arianeApi", () => ({
      ACCEPT_ATTR: ".pdf", TAILLE_MAX_OCTETS: 20 * 1024 * 1024,
      encodePiece: vi.fn().mockResolvedValue({ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }),
      startAnalyse: vi.fn().mockResolvedValue("j1"),
      fetchStatus: vi.fn().mockResolvedValue({
        status: "done", progress: { done: 1, total: 1 }, result: dossier,
        avertissements: ["Type de piece inconnu : PVInconnu"],
      }),
    }));
    const store = await import("./arianeStore");
    const { default: ArianeApp } = await import("./ArianeApp");
    store.setPieces([new File([new Uint8Array([1])], "D1.pdf", { type: "application/pdf" })]);
    await store.run({ sleep: () => Promise.resolve(), intervalMs: 0 });
    render(<ArianeApp />);
    expect(screen.getByRole("alert").textContent).toMatch(/PVInconnu/);
  });
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `node --test server/ariane.test.mjs` puis `npm test -- src/features/ariane`
Expected: FAIL — `undefined` au lieu des listes attendues, et pas de `role="alert"` rendu.

- [ ] **Step 3 : Écrire l'implémentation**

Dans `server/ariane.mjs`, `startJob` — à côté de `job.pieces_ignorees` :

```js
  job.avertissements = [];
```

et dans l'appel à `runAriane` :

```js
      onAvertissement: (a) => { if (!job.avertissements.includes(a)) job.avertissements.push(a); },
```

Dans `src/features/ariane/arianeApi.ts`, compléter `JobStatus` :

```ts
export type JobStatus = { status: string; progress: { done: number; total: number }; result?: Dossier; error?: string; pieces_ignorees?: PieceIgnoree[]; avertissements?: string[] };
```

Dans `src/features/ariane/arianeStore.ts` : ajouter `avertissements: string[]` à `ArianeState`, `avertissements: []` dans l'état initial, dans `reset()` et dans le `store.set` d'ouverture de `run()`, puis au `store.set` de la boucle de polling :

```ts
      store.set({ progress: snap.progress ?? store.get().progress, statusLabel: statusLabel(snap.status), piecesIgnorees: snap.pieces_ignorees ?? store.get().piecesIgnorees, avertissements: snap.avertissements ?? store.get().avertissements });
```

Dans `src/features/ariane/ArianeApp.tsx`, extraire `avertissements` de `useAriane()`, changer la condition du bandeau en `dossier && (piecesIgnorees.length > 0 || avertissements.length > 0)`, rendre le bloc « Analyse incomplète » conditionnel à `piecesIgnorees.length > 0`, et ajouter après la liste des pièces ignorées :

```tsx
            {avertissements.length > 0 && (
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {avertissements.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `node --test server/ariane.test.mjs` puis `npm test -- src/features/ariane` puis `npx tsc -b --noEmit`
Expected: PASS partout, `tsc` silencieux.

- [ ] **Step 5 : Commit**

```bash
git add server/ariane.mjs server/ariane.test.mjs src/features/ariane/
git commit -m "feat(ariane): remonte les avertissements de metadonnees a l'ecran"
```

---

### Task 6 : Brancher la fusion dans le pipeline et livrer `roles[]`

**Files:**
- Modify: `server/ariane.mjs` (`buildAggregate`, `assembleContract`)
- Modify: `src/features/ariane/arianeApi.ts` (type `Partie`)
- Modify: `src/features/ariane/PartiesView.tsx`
- Test: `server/ariane.test.mjs`, `src/features/ariane/views.test.tsx`

**Interfaces:**
- Consumes: `fusionnerMentions` (T3).
- Produces: agrégat pré-groupé ; `Partie.roles?: { role: string; cote: string }[]` dans le contrat §4.4.

**Sans cette tâche, `fusionnerMentions` est du code mort et l'objectif « coréférence en code » n'est pas livré.** Deux effets : l'agrégat envoyé au REDUCE porte des groupes au lieu de mentions isolées (entrée réduite), et les parties renvoyées au front portent leur historique de rôles.

Le REDUCE continue de produire `parties` — son prompt est inchangé en phase 1. On ne remplace pas ses parties : on les **enrichit** de `roles[]` en appariant sur les `membres` (grefs), qu'il rend déjà.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `server/ariane.test.mjs` :

```js
test("buildAggregate regroupe les mentions d'une meme personne", () => {
  const agg = buildAggregate([
    { cote: "D3", personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }], relations_lues: [] },
    { cote: "D9", personnes: [{ ref: "m4", nom: "BIDULE Marc", role_apparent: "mis_en_cause" }], relations_lues: [] },
  ]);
  assert.equal(agg.personnes.length, 1);
  assert.deepEqual(agg.personnes[0].membres, ["D3:m1", "D9:m4"]);
});

test("buildAggregate laisse passer les mentions sans cle exploitable", () => {
  const agg = buildAggregate([
    { cote: "D1", personnes: [{ ref: "m1", nom: "X", role_apparent: "temoin" }], relations_lues: [] },
  ]);
  assert.equal(agg.personnes.length, 1);
  assert.equal(agg.personnes[0].gref, "D1:m1");
});

test("assembleContract enrichit les parties de leur historique de roles", () => {
  const mapOutputs = [
    { cote: "D3", personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }], faits: [], acte: null, relations_lues: [] },
    { cote: "D9", personnes: [{ ref: "m4", nom: "BIDULE Marc", role_apparent: "mis_en_cause" }], faits: [], acte: null, relations_lues: [] },
  ];
  const reduce = { affaire: {}, synthese: "s", relations: [],
    parties: [{ id: "p1", nom: "Marc BIDULE", role: "temoin", aliases: [], qualite: "", premiere_cote: "D3", membres: ["D3:m1", "D9:m4"] }] };
  const c = assembleContract(mapOutputs, reduce);
  assert.deepEqual(c.parties[0].roles, [
    { role: "temoin", cote: "D3" },
    { role: "mis_en_cause", cote: "D9" },
  ]);
  // Le role principal du contrat suit l'ordre d'engagement, pas celui du REDUCE.
  assert.equal(c.parties[0].role, "mis_en_cause");
});

test("assembleContract : partie sans membre connu → pas de roles, role du REDUCE conserve", () => {
  const reduce = { affaire: {}, synthese: "s", relations: [],
    parties: [{ id: "p1", nom: "Inconnu", role: "temoin", aliases: [], qualite: "", premiere_cote: "D1", membres: [] }] };
  const c = assembleContract([], reduce);
  assert.equal(c.parties[0].roles, undefined);
  assert.equal(c.parties[0].role, "temoin");
});
```

Ajouter à `src/features/ariane/views.test.tsx` :

```tsx
it("PartiesView affiche l'historique des rôles quand il existe", async () => {
  const { default: PartiesView } = await import("./PartiesView");
  const dossier = {
    affaire: { reference: "r", nature: "Vol", service: "BR", periode: { debut: null, fin: null }, nb_cotes: 2 },
    synthese: "s", evenements: [], actes: [], relations: [],
    parties: [{ id: "p1", nom: "Marc BIDULE", role: "mis_en_cause", aliases: [], qualite: "", premiere_cote: "D3",
                roles: [{ role: "temoin", cote: "D3" }, { role: "mis_en_cause", cote: "D9" }] }],
  };
  render(<PartiesView dossier={dossier as never} />);
  expect(screen.getByText(/témoin en D3/i)).toBeTruthy();
  expect(screen.getByText(/mis en cause en D9/i)).toBeTruthy();
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `node --test server/ariane.test.mjs` puis `npm test -- src/features/ariane`
Expected: FAIL — `agg.personnes.length` vaut 2 au lieu de 1 ; `c.parties[0].roles` vaut `undefined` ; le texte des rôles est absent du rendu.

- [ ] **Step 3 : Écrire l'implémentation**

Dans `server/ariane.mjs`, remplacer le corps de `buildAggregate` par une version qui pré-groupe :

```js
export function buildAggregate(mapOutputs) {
  const mentions = [];
  const relations_lues = [];
  for (const p of mapOutputs) {
    for (const pers of p.personnes || []) {
      mentions.push({
        gref: `${p.cote}:${pers.ref}`, cote: p.cote, nom: pers.nom,
        aliases: pers.aliases || [], role_apparent: pers.role_apparent,
        naissance: pers.naissance ?? null, qualite: pers.qualite ?? null, adresse: pers.adresse ?? null,
      });
    }
    for (const r of p.relations_lues || []) {
      relations_lues.push({ de: `${p.cote}:${r.de}`, vers: `${p.cote}:${r.vers}`, type: r.type, libelle: r.libelle, cote: p.cote });
    }
  }
  // Les mentions dont la cle est exploitable partent au REDUCE deja regroupees :
  // il n'a plus a les rapprocher, seulement a les nommer et a les qualifier.
  const { groupes, sansCle } = fusionnerMentions(mentions);
  const parGref = new Map(mentions.map((m) => [m.gref, m]));
  const personnes = [
    ...groupes.map((g) => {
      const premiere = parGref.get(g.membres[0]);
      return { gref: g.membres[0], membres: g.membres, cote: premiere.cote, nom: g.nom,
        aliases: premiere.aliases, role_apparent: g.role,
        naissance: premiere.naissance, qualite: premiere.qualite, adresse: premiere.adresse };
    }),
    ...sansCle,
  ];
  return { personnes, relations_lues };
}
```

Toujours dans `server/ariane.mjs`, dans `assembleContract`, après l'étape 2 (`const parties = parties0.map(...)`), enrichir :

```js
  // Historique des roles, calcule en code depuis les mentions d'origine. Le REDUCE
  // ne le produit pas : il ne voit qu'un role par groupe.
  const mentions = [];
  for (const p of mapOutputs) {
    for (const pers of p.personnes || []) {
      mentions.push({ gref: `${p.cote}:${pers.ref}`, cote: p.cote, nom: pers.nom, role_apparent: pers.role_apparent });
    }
  }
  const rolesParGref = new Map();
  for (const g of fusionnerMentions(mentions).groupes) {
    for (const gref of g.membres) rolesParGref.set(gref, g);
  }
  for (const partie of parties) {
    const source = (parties0.find((p) => p.id === partie.id)?.membres || [])
      .map((gref) => rolesParGref.get(gref)).find(Boolean);
    if (!source) continue;
    partie.roles = source.roles;
    partie.role = source.role; // ordre d'engagement, pas le choix du REDUCE
  }
```

Dans `src/features/ariane/arianeApi.ts`, compléter le type :

```ts
export type RoleCote = { role: Role; cote: string };
export type Partie = { id: string; nom: string; role: Role; roles?: RoleCote[]; aliases: string[]; qualite: string; premiere_cote: string };
```

Dans `src/features/ariane/PartiesView.tsx`, sous le nom de chaque partie, rendre l'historique quand il compte plus d'une entrée :

```tsx
{p.roles && p.roles.length > 1 && (
  <div style={{ fontSize: 12, color: "#b34000", marginTop: 4 }}>
    {p.roles.map((r) => `${ROLE_LABEL_SINGULIER[r.role]} en ${r.cote}`).join(" · ")}
  </div>
)}
```

`ROLE_LABELS`, déjà exporté par `graph.ts`, porte des intitulés **pluriels** de groupe
(`"Victimes"`, `"Témoins"`) : le réutiliser ici rendrait « Témoins en D3 ». Ajouter à
`src/features/ariane/graph.ts`, à côté des tables existantes :

```ts
// Intitulés au singulier, pour désigner une partie précise et non un groupe.
export const ROLE_LABEL_SINGULIER: Record<Role, string> = {
  mis_en_cause: "Mis en cause",
  victime: "Victime",
  temoin: "Témoin",
  enqueteur: "Enquêteur",
  requis: "Requis",
  magistrat: "Magistrat",
  autre: "Autre",
};
```

Dans `PartiesView.tsx`, importer `ROLE_LABEL_SINGULIER` depuis `./graph` en plus de
`groupByRole`, et placer le bloc ci-dessus juste avant la ligne « vue en {p.premiere_cote} ».

**Attention au groupement :** `groupByRole` filtre sur `p.role`. Une partie vue sous
plusieurs rôles n'apparaît que dans le groupe de son rôle principal — c'est voulu, sinon
elle serait comptée deux fois. L'historique affiché sur sa fiche signale les autres.

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `node --test server/ariane.test.mjs` puis `npm test -- src/features/ariane` puis `npx tsc -b --noEmit`
Expected: PASS partout, `tsc` silencieux.

- [ ] **Step 5 : Commit**

```bash
git add server/ariane.mjs server/ariane.test.mjs src/features/ariane/
git commit -m "feat(ariane): agregat pre-groupe et historique des roles"
```

---

## Vérification finale

- [ ] `node --test server/*.test.mjs` — aucun échec
- [ ] `npm test -- src/features/ariane` — aucun échec
- [ ] `npx tsc -b --noEmit` — silencieux
- [ ] `grep -n "console.error" server/pieceMeta.mjs` — aucun résultat : le module est pur et ne journalise rien
- [ ] Relire les avertissements produits : aucun ne doit contenir de nom de personne. `Type de piece inconnu : PVInconnu` est un code, pas une identité.

## Suites

Une fois la phase 1 en place, la mesure à relever sur une procédure réelle de 13 pièces : nombre de groupes issus de `fusionnerMentions` face aux 79 mentions actuelles, et taille de l'agrégat. C'est ce chiffre qui dira si la phase 3 (allègement du schéma de sortie du REDUCE) suffit à supprimer les troncatures, ou s'il faut un REDUCE hiérarchique par lots.
