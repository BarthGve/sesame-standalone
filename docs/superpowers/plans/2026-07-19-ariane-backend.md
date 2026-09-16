# Ariane — Plan A : backend map-reduce + workflow + fixture

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire le BFF du cas d'usage Ariane (analyse de procédure judiciaire) — pipeline map-reduce déterministe qui, à partir de N pièces PDF, produit le contrat JSON des 5 vues — plus les prompts des 2 apps IAka et une fixture d'exemple.

**Architecture:** MAP (1 exécution IAka `ariane-extraction` par pièce, fan-out concurrence bornée côté BFF) → agrégation (grefs `cote:ref`) → REDUCE (1 exécution IAka `ariane-consolidation` sur l'agrégat compact) → **assemblage mécanique du contrat par le BFF** (le LLM ne produit jamais les ids croisés). Job asynchrone en mémoire + endpoint de progression.

**Tech Stack:** Node natif (http, sans framework), tests `node --test` + `node:assert/strict`. Mocks réseau via `fetchImpl` injecté (comme `server/synthese.test.mjs`). Aucune dépendance nouvelle en V1.

## Global Constraints

- Cible spec : `docs/superpowers/specs/2026-07-19-ariane-design.md` (source de vérité).
- **Aucune emoji nulle part** (règle projet CLAUDE.md).
- Pièces à **diffusion restreinte** : sur erreur *connue*, ne jamais `console.error` le contenu (cf. route `/api/synthese`, proxy.mjs:256). Logger seulement le code d'erreur pour les erreurs inconnues.
- Codes d'erreur Ariane : `ARIANE_UPSTREAM` (502), `ARIANE_TIMEOUT` (504), `ARIANE_INVALIDE` (502).
- **LLM = jugement, code = comptabilité** : le REDUCE n'émet pas d'events/actes/ids croisés ; le BFF les assemble (spec §2.2, §4.4).
- Contrat final = schéma spec §4.4. Enums exactes :
  - role ∈ `mis_en_cause|victime|temoin|enqueteur|requis|magistrat|autre`
  - type(acte) ∈ `audition|constatation|perquisition|requisition|gav|transport|soit_transmis|autre`
  - type(relation) ∈ `famille|complice|connait|victime_de|entendu_par|requis_par|autre`
  - precision ∈ `annee|mois|jour|heure`
- Tests serveur **non** couverts par `npm test` (front only). Lancer : `node --test server/ariane.test.mjs`.
- Format de commit du repo : messages FR concis type `feat(ariane): …` / `test(ariane): …` / `docs(ariane): …`.

### Formes de données (objets JS, server .mjs — pas de TS)

```
// MAP output (après extractJson d'une exécution ariane-extraction ; cote STAMPÉE par le BFF)
{ cote:"D12",
  acte:{ type:"audition", date:"2026-03-06", libelle:"Audition victime",
         redacteur_ref:"m5", concernes_refs:["m1"] },              // acte peut être null
  personnes:[ { ref:"m1", nom:"Jean DUPONT", aliases:["le suspect"],
                role_apparent:"mis_en_cause", naissance:"1990-05-02",
                qualite:"...", adresse:"..." } ],
  faits:[ { date:"2026-03-04", precision:"jour", libelle:"...", personnes_refs:["m1"] } ],
  relations_lues:[ { de:"m1", vers:"m3", type:"famille", libelle:"frère de" } ] }

// Aggregate (buildAggregate → entrée REDUCE)
{ personnes:[ { gref:"D12:m1", cote:"D12", nom, aliases, role_apparent, naissance, qualite, adresse } ],
  relations_lues:[ { de:"D12:m1", vers:"D12:m3", type, libelle, cote:"D12" } ] }

// REDUCE output (après extractJson d'une exécution ariane-consolidation)
{ affaire:{ reference, nature, service },
  synthese:"...markdown...",
  parties:[ { id:"p1", nom, role, aliases:[], qualite, premiere_cote:"D12",
              membres:["D12:m1","D247:m4"] } ],
  relations:[ { source:"p1", cible:"p3", type:"famille", libelle, cotes:["D12"] } ] }

// Contrat FINAL (assembleContract → réponse) : schéma spec §4.4
```

---

## Task 1: Doc des 2 workflows IAka + prompts finalisés

**Files:**
- Create: `docs/iaka-ariane-workflow.md`

Deliverable documentaire (base pour configurer les apps sur la plateforme IAka). Pas de cycle de test — revue manuelle.

- [ ] **Step 1: Écrire `docs/iaka-ariane-workflow.md`**

Structure calquée sur `docs/iaka-rens-workflows.md` (tableau des apps, structure de chaque workflow, config du nœud DÉBUT, prompt système complet à coller, schéma de sortie, notes). Contenu à produire :

1. En-tête : rôle des 2 apps.

   | Workflow | app_id (env) | Rôle |
   |---|---|---|
   | **MAP — extraction** | `IAKA_ARIANE_EXTRACTION_APP_ID` | 1 pièce → extraction compacte (schéma §4.1) |
   | **REDUCE — consolidation** | `IAKA_ARIANE_CONSOLIDATION_APP_ID` | agrégat → parties/relations/synthèse (schéma §4.3) |

2. **MAP** : nœud DÉBUT = **fichier joint** (PDF), `require_prompt=false`. Nœud agent modèle grand contexte. Prompt système = le brouillon spec §5.1 **finalisé** (reprendre le texte, ajouter le schéma §4.1 en clair, insister « réponds UNIQUEMENT le JSON, rien avant/après, pas de trace outil », dates `AAAA-MM-JJ`, enums exactes). Préciser : **la `cote` est stampée par le BFF** ; l'agent peut la laisser vide.

3. **REDUCE** : nœud DÉBUT = **prompt texte** (`require_prompt=true`), le BFF envoie l'agrégat JSON comme `prompt`. Prompt système = brouillon spec §5.2 finalisé + schéma §4.3 en clair. Insister : « ne produis NI événements NI actes (le système les assemble) », « en cas de doute d'homonymie, NE fusionne PAS ».

4. Section **Intégration BFF** : renvoyer vers `server/ariane.mjs` (assemblage §4.4, job async). Rappeler l'assemblage déterministe (le LLM ne fait pas les ids croisés).

5. Section **Points d'attention** : reprendre les leçons de `iaka-agent-prompt.md` (sortie STRICTE, un seul objet JSON, pas de fence). Noter le nouveau plafond = REDUCE (spec §8.2) et le chemin XML V2 (spec §8.1).

- [ ] **Step 2: Relecture**

Vérifier : les 2 prompts sont copiables tels quels, les schémas §4.1 et §4.3 y figurent en toutes lettres, aucune emoji. Cohérence des noms de champs avec les « Formes de données » ci-dessus.

- [ ] **Step 3: Commit**

```bash
git add docs/iaka-ariane-workflow.md
git commit -m "docs(ariane): workflows IAka extraction + consolidation (prompts finalisés)"
```

---

## Task 2: `extractJson` — déballage de la sortie IAka

**Files:**
- Create: `server/ariane.mjs`
- Test: `server/ariane.test.mjs`

**Interfaces:**
- Produces: `extractJson(result: string) -> object` — retire les traces `<tool>…</tool>` et les fences ```` ```json ````, isole le premier objet `{…}`, `JSON.parse`. Lève `Error("ARIANE_INVALIDE")` si non-string, vide, ou JSON invalide.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `server/ariane.test.mjs` :

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJson } from "./ariane.mjs";

test("extractJson retire la trace <tool> et parse l'objet", () => {
  const r = '<tool>lire<tool-output>x</tool-output></tool>\n{"cote":"D1","personnes":[]}';
  assert.deepEqual(extractJson(r), { cote: "D1", personnes: [] });
});

test("extractJson déballe une fence ```json", () => {
  const r = '```json\n{"a":1}\n```';
  assert.deepEqual(extractJson(r), { a: 1 });
});

test("extractJson non-string ou JSON invalide → ARIANE_INVALIDE", () => {
  assert.throws(() => extractJson(null), /ARIANE_INVALIDE/);
  assert.throws(() => extractJson(""), /ARIANE_INVALIDE/);
  assert.throws(() => extractJson("pas de json ici"), /ARIANE_INVALIDE/);
});
```

- [ ] **Step 2: Lancer le test — doit échouer**

Run: `node --test server/ariane.test.mjs`
Expected: FAIL (`Cannot find module './ariane.mjs'` ou `extractJson is not a function`).

- [ ] **Step 3: Implémenter le minimum**

Créer `server/ariane.mjs` :

```js
// Pipeline map-reduce du cas d'usage Ariane (analyse de procédure judiciaire).
// Voir docs/superpowers/specs/2026-07-19-ariane-design.md et docs/iaka-ariane-workflow.md.

// Déballe la sortie brute d'une exécution IAka en objet JSON :
// retire les traces <tool>…</tool>, une éventuelle fence ```json, puis parse
// du premier '{' au dernier '}'.
export function extractJson(result) {
  if (typeof result !== "string" || !result.trim()) throw new Error("ARIANE_INVALIDE");
  let text = result.replace(/<tool>[\s\S]*?<\/tool>/gi, "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("ARIANE_INVALIDE");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("ARIANE_INVALIDE");
  }
}
```

- [ ] **Step 4: Lancer le test — doit passer**

Run: `node --test server/ariane.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/ariane.mjs server/ariane.test.mjs
git commit -m "feat(ariane): extractJson — déballe la sortie IAka en objet"
```

---

## Task 3: `validateContract` — invariants du contrat final

**Files:**
- Modify: `server/ariane.mjs`
- Test: `server/ariane.test.mjs`

**Interfaces:**
- Produces: `validateContract(contract: object) -> object` — renvoie le contrat inchangé si valide ; lève `Error("ARIANE_INVALIDE")` si : id de partie dupliqué ; référence d'id (evenements[].parties, actes[].redacteur non-null, actes[].concernes, relations[].source/cible) absente de `parties` ; enum inconnue (role, type acte, type relation, precision).

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `server/ariane.test.mjs` :

```js
import { validateContract } from "./ariane.mjs";

const contratOk = {
  affaire: { reference: "X", nature: "Vol", service: "BR", periode: { debut: "2026-03-04", fin: "2026-03-06" }, nb_cotes: 2 },
  synthese: "s",
  parties: [{ id: "p1", nom: "A", role: "mis_en_cause", aliases: [], qualite: "", premiere_cote: "D1" }],
  evenements: [{ id: "e1", date: "2026-03-04", precision: "jour", libelle: "f", cote_source: "D1", parties: ["p1"] }],
  actes: [{ id: "a1", date: "2026-03-06", type: "audition", cote: "D2", libelle: "au", redacteur: null, concernes: ["p1"] }],
  relations: [],
};

test("validateContract accepte un contrat cohérent", () => {
  assert.equal(validateContract(contratOk), contratOk);
});

test("validateContract rejette un id de partie orphelin", () => {
  const bad = structuredClone(contratOk);
  bad.evenements[0].parties = ["pX"];
  assert.throws(() => validateContract(bad), /ARIANE_INVALIDE/);
});

test("validateContract rejette une enum inconnue", () => {
  const bad = structuredClone(contratOk);
  bad.actes[0].type = "photocopie";
  assert.throws(() => validateContract(bad), /ARIANE_INVALIDE/);
});

test("validateContract rejette un id de partie dupliqué", () => {
  const bad = structuredClone(contratOk);
  bad.parties.push({ id: "p1", nom: "B", role: "temoin", aliases: [], qualite: "", premiere_cote: "D2" });
  assert.throws(() => validateContract(bad), /ARIANE_INVALIDE/);
});
```

- [ ] **Step 2: Lancer le test — doit échouer**

Run: `node --test server/ariane.test.mjs`
Expected: FAIL (`validateContract is not a function`).

- [ ] **Step 3: Implémenter le minimum**

Ajouter à `server/ariane.mjs` :

```js
const ROLES = new Set(["mis_en_cause", "victime", "temoin", "enqueteur", "requis", "magistrat", "autre"]);
const TYPES_ACTE = new Set(["audition", "constatation", "perquisition", "requisition", "gav", "transport", "soit_transmis", "autre"]);
const TYPES_REL = new Set(["famille", "complice", "connait", "victime_de", "entendu_par", "requis_par", "autre"]);
const PRECISIONS = new Set(["annee", "mois", "jour", "heure"]);

// Filet de sécurité : le contrat est déjà cohérent par construction (assembleContract),
// on vérifie qu'aucun id n'est orphelin et qu'aucune enum n'est inconnue.
export function validateContract(contract) {
  const ids = new Set();
  for (const p of contract.parties) {
    if (ids.has(p.id)) throw new Error("ARIANE_INVALIDE");
    ids.add(p.id);
    if (!ROLES.has(p.role)) throw new Error("ARIANE_INVALIDE");
  }
  const ref = (id) => { if (!ids.has(id)) throw new Error("ARIANE_INVALIDE"); };
  for (const e of contract.evenements) {
    if (!PRECISIONS.has(e.precision)) throw new Error("ARIANE_INVALIDE");
    e.parties.forEach(ref);
  }
  for (const a of contract.actes) {
    if (!TYPES_ACTE.has(a.type)) throw new Error("ARIANE_INVALIDE");
    if (a.redacteur != null) ref(a.redacteur);
    a.concernes.forEach(ref);
  }
  for (const r of contract.relations) {
    if (!TYPES_REL.has(r.type)) throw new Error("ARIANE_INVALIDE");
    ref(r.source); ref(r.cible);
  }
  return contract;
}
```

- [ ] **Step 4: Lancer le test — doit passer**

Run: `node --test server/ariane.test.mjs`
Expected: PASS (tests Task 2 + 4 nouveaux).

- [ ] **Step 5: Commit**

```bash
git add server/ariane.mjs server/ariane.test.mjs
git commit -m "feat(ariane): validateContract — invariants ids + enums"
```

---

## Task 4: Fixture d'exemple conforme au contrat

**Files:**
- Create: `docs/ariane-exemple.json`
- Test: `server/ariane.test.mjs`

Une procédure jouet cohérente, consommée par le front (Plan B) et servant de jeu de test du contrat. Elle DOIT passer `validateContract`.

**Interfaces:**
- Consumes: `validateContract` (Task 3).

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `server/ariane.test.mjs` :

```js
import { readFileSync } from "node:fs";

test("la fixture docs/ariane-exemple.json passe validateContract", () => {
  const fixture = JSON.parse(readFileSync(new URL("../docs/ariane-exemple.json", import.meta.url)));
  assert.equal(validateContract(fixture), fixture);
  assert.ok(fixture.parties.length >= 6, "au moins 6 parties");
  assert.ok(fixture.actes.length >= 8, "au moins 8 actes");
  assert.ok(fixture.relations.length >= 5, "au moins 5 relations");
});
```

- [ ] **Step 2: Lancer le test — doit échouer**

Run: `node --test server/ariane.test.mjs`
Expected: FAIL (`ENOENT ariane-exemple.json`).

- [ ] **Step 3: Créer la fixture**

Créer `docs/ariane-exemple.json` — une affaire « Vol avec effraction en réunion » cohérente : ~8 parties (2 mis_en_cause, 1 victime, 2 témoins, 2 enquêteurs, 1 magistrat), ~10 événements, ~12 actes, ~8 relations. Toutes les références d'id doivent exister. Exemple d'ossature à compléter jusqu'aux quantités du test :

```json
{
  "affaire": { "reference": "PV 2026/00457", "nature": "Vol avec effraction en réunion", "service": "BR Melun", "periode": { "debut": "2026-03-04", "fin": "2026-03-21" }, "nb_cotes": 14 },
  "synthese": "## Synthèse\n\nDans la nuit du 4 mars 2026, le dépôt logistique de la société MERIDIA, rue des Frères-Lumière à Melun, est cambriolé après effraction du rideau métallique. Le préjudice porte sur du matériel électronique. L'exploitation de la vidéosurveillance et de la téléphonie conduit à l'interpellation de Jean DUPONT et Karim BENALI, mis en cause, le 18 mars. Les auditions établissent une action concertée ; une partie du matériel est retrouvée en perquisition au domicile de DUPONT.",
  "parties": [
    { "id": "p1", "nom": "Jean DUPONT", "role": "mis_en_cause", "aliases": ["M. Dupont", "le suspect"], "qualite": "né le 02/05/1990 à Melun, sans profession", "premiere_cote": "D3" },
    { "id": "p2", "nom": "Karim BENALI", "role": "mis_en_cause", "aliases": ["le second individu"], "qualite": "né le 14/11/1988 à Meaux", "premiere_cote": "D3" },
    { "id": "p3", "nom": "Société MERIDIA (représentée par Paul MOREAU)", "role": "victime", "aliases": ["la victime", "le plaignant"], "qualite": "gérant du dépôt", "premiere_cote": "D2" },
    { "id": "p4", "nom": "Lucie FONTAINE", "role": "temoin", "aliases": [], "qualite": "riveraine", "premiere_cote": "D5" },
    { "id": "p5", "nom": "Marc GIRARD", "role": "temoin", "aliases": [], "qualite": "vigile", "premiere_cote": "D6" },
    { "id": "p6", "nom": "ADC Sophie MARTIN", "role": "enqueteur", "aliases": ["l'enquêteur"], "qualite": "BR Melun", "premiere_cote": "D1" },
    { "id": "p7", "nom": "MDC Thomas PETIT", "role": "enqueteur", "aliases": [], "qualite": "BR Melun", "premiere_cote": "D4" },
    { "id": "p8", "nom": "Mme le Procureur de Melun", "role": "magistrat", "aliases": ["le parquet"], "qualite": "TJ Melun", "premiere_cote": "D1" }
  ],
  "evenements": [
    { "id": "e1", "date": "2026-03-04", "precision": "jour", "libelle": "Effraction du rideau métallique du dépôt MERIDIA", "cote_source": "D2", "parties": ["p1", "p2"] },
    { "id": "e2", "date": "2026-03-04", "precision": "heure", "libelle": "Deux individus filmés chargeant des cartons dans une camionnette", "cote_source": "D7", "parties": ["p1", "p2"] },
    { "id": "e3", "date": "2026-03-04", "precision": "jour", "libelle": "Découverte du vol par le gérant à l'ouverture", "cote_source": "D2", "parties": ["p3"] },
    { "id": "e4", "date": "2026-03-05", "precision": "jour", "libelle": "Témoignage d'une riveraine ayant entendu un véhicule vers 3h", "cote_source": "D5", "parties": ["p4"] },
    { "id": "e5", "date": "2026-03-10", "precision": "jour", "libelle": "Exploitation téléphonie : bornage compatible des deux lignes", "cote_source": "D9", "parties": ["p1", "p2"] },
    { "id": "e6", "date": "2026-03-18", "precision": "jour", "libelle": "Interpellation des deux mis en cause", "cote_source": "D10", "parties": ["p1", "p2"] },
    { "id": "e7", "date": "2026-03-18", "precision": "jour", "libelle": "Perquisition au domicile de DUPONT, matériel retrouvé", "cote_source": "D11", "parties": ["p1"] },
    { "id": "e8", "date": "2026-03-19", "precision": "jour", "libelle": "DUPONT reconnaît partiellement les faits", "cote_source": "D12", "parties": ["p1"] },
    { "id": "e9", "date": "2026-03-19", "precision": "jour", "libelle": "BENALI conteste toute implication", "cote_source": "D13", "parties": ["p2"] },
    { "id": "e10", "date": "2026-03-04", "precision": "jour", "libelle": "Le vigile signale une ronde sans anomalie à 1h", "cote_source": "D6", "parties": ["p5"] }
  ],
  "actes": [
    { "id": "a1", "date": "2026-03-04", "type": "soit_transmis", "cote": "D1", "libelle": "Soit-transmis du parquet, saisine BR Melun", "redacteur": null, "concernes": ["p8"] },
    { "id": "a2", "date": "2026-03-04", "type": "constatation", "cote": "D2", "libelle": "PV de constatations sur les lieux", "redacteur": "p6", "concernes": ["p3"] },
    { "id": "a3", "date": "2026-03-04", "type": "audition", "cote": "D3", "libelle": "Audition du plaignant", "redacteur": "p6", "concernes": ["p3"] },
    { "id": "a4", "date": "2026-03-05", "type": "audition", "cote": "D5", "libelle": "Audition témoin FONTAINE", "redacteur": "p7", "concernes": ["p4"] },
    { "id": "a5", "date": "2026-03-05", "type": "audition", "cote": "D6", "libelle": "Audition vigile GIRARD", "redacteur": "p7", "concernes": ["p5"] },
    { "id": "a6", "date": "2026-03-06", "type": "constatation", "cote": "D7", "libelle": "Exploitation de la vidéosurveillance", "redacteur": "p6", "concernes": [] },
    { "id": "a7", "date": "2026-03-09", "type": "requisition", "cote": "D9", "libelle": "Réquisition opérateur téléphonique", "redacteur": "p6", "concernes": ["p1", "p2"] },
    { "id": "a8", "date": "2026-03-18", "type": "gav", "cote": "D10", "libelle": "Placement en garde à vue des deux mis en cause", "redacteur": "p6", "concernes": ["p1", "p2"] },
    { "id": "a9", "date": "2026-03-18", "type": "perquisition", "cote": "D11", "libelle": "Perquisition domicile DUPONT", "redacteur": "p7", "concernes": ["p1"] },
    { "id": "a10", "date": "2026-03-19", "type": "audition", "cote": "D12", "libelle": "Audition en GAV de DUPONT", "redacteur": "p6", "concernes": ["p1"] },
    { "id": "a11", "date": "2026-03-19", "type": "audition", "cote": "D13", "libelle": "Audition en GAV de BENALI", "redacteur": "p7", "concernes": ["p2"] },
    { "id": "a12", "date": "2026-03-21", "type": "soit_transmis", "cote": "D14", "libelle": "PV de synthèse et compte rendu au parquet", "redacteur": "p6", "concernes": ["p8"] }
  ],
  "relations": [
    { "source": "p1", "cible": "p2", "type": "complice", "libelle": "auraient agi ensemble", "cotes": ["D7", "D12"] },
    { "source": "p1", "cible": "p3", "type": "victime_de", "libelle": "victime du vol commis par", "cotes": ["D2", "D12"] },
    { "source": "p2", "cible": "p3", "type": "victime_de", "libelle": "victime du vol commis par", "cotes": ["D2"] },
    { "source": "p3", "cible": "p6", "type": "entendu_par", "libelle": "entendu par", "cotes": ["D3"] },
    { "source": "p4", "cible": "p7", "type": "entendu_par", "libelle": "entendu par", "cotes": ["D5"] },
    { "source": "p5", "cible": "p7", "type": "entendu_par", "libelle": "entendu par", "cotes": ["D6"] },
    { "source": "p1", "cible": "p6", "type": "entendu_par", "libelle": "entendu par", "cotes": ["D12"] },
    { "source": "p2", "cible": "p7", "type": "entendu_par", "libelle": "entendu par", "cotes": ["D13"] }
  ]
}
```

- [ ] **Step 4: Lancer le test — doit passer**

Run: `node --test server/ariane.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/ariane-exemple.json server/ariane.test.mjs
git commit -m "feat(ariane): fixture d'exemple conforme au contrat"
```

---

## Task 5: `buildAggregate` — grefs globaux pour le REDUCE

**Files:**
- Modify: `server/ariane.mjs`
- Test: `server/ariane.test.mjs`

**Interfaces:**
- Consumes: MAP outputs (Formes de données).
- Produces: `buildAggregate(mapOutputs: object[]) -> { personnes, relations_lues }` — aplatit toutes les personnes/relations lues des pièces, préfixe chaque ref locale par la cote (`gref = "<cote>:<ref>"`).

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `server/ariane.test.mjs` :

```js
import { buildAggregate } from "./ariane.mjs";

const mapOut = [
  { cote: "D3", acte: { type: "audition", date: "2026-03-04", libelle: "au", redacteur_ref: "m9", concernes_refs: ["m1"] },
    personnes: [{ ref: "m1", nom: "Jean DUPONT", aliases: [], role_apparent: "mis_en_cause", naissance: "1990-05-02", qualite: "", adresse: "" },
                { ref: "m9", nom: "ADC MARTIN", aliases: [], role_apparent: "enqueteur" }],
    faits: [{ date: "2026-03-04", precision: "jour", libelle: "vol", personnes_refs: ["m1"] }],
    relations_lues: [{ de: "m1", vers: "m2", type: "complice", libelle: "avec" }] },
];

test("buildAggregate préfixe les refs par la cote (gref)", () => {
  const agg = buildAggregate(mapOut);
  assert.equal(agg.personnes[0].gref, "D3:m1");
  assert.equal(agg.personnes[0].cote, "D3");
  assert.equal(agg.personnes.length, 2);
  assert.deepEqual(agg.relations_lues[0], { de: "D3:m1", vers: "D3:m2", type: "complice", libelle: "avec", cote: "D3" });
});
```

- [ ] **Step 2: Lancer le test — doit échouer**

Run: `node --test server/ariane.test.mjs`
Expected: FAIL (`buildAggregate is not a function`).

- [ ] **Step 3: Implémenter le minimum**

Ajouter à `server/ariane.mjs` :

```js
// Construit l'agrégat compact envoyé au REDUCE. Chaque ref locale devient un
// identifiant global gref = "<cote>:<ref>". On ne pousse que personnes + relations
// lues (faits et méta-actes restent au BFF pour l'assemblage §4.4).
export function buildAggregate(mapOutputs) {
  const personnes = [];
  const relations_lues = [];
  for (const p of mapOutputs) {
    for (const pers of p.personnes || []) {
      personnes.push({
        gref: `${p.cote}:${pers.ref}`, cote: p.cote, nom: pers.nom,
        aliases: pers.aliases || [], role_apparent: pers.role_apparent,
        naissance: pers.naissance ?? null, qualite: pers.qualite ?? null, adresse: pers.adresse ?? null,
      });
    }
    for (const r of p.relations_lues || []) {
      relations_lues.push({ de: `${p.cote}:${r.de}`, vers: `${p.cote}:${r.vers}`, type: r.type, libelle: r.libelle, cote: p.cote });
    }
  }
  return { personnes, relations_lues };
}
```

- [ ] **Step 4: Lancer le test — doit passer**

Run: `node --test server/ariane.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/ariane.mjs server/ariane.test.mjs
git commit -m "feat(ariane): buildAggregate — grefs globaux pour le REDUCE"
```

---

## Task 6: `assembleContract` — assemblage mécanique du contrat final

**Files:**
- Modify: `server/ariane.mjs`
- Test: `server/ariane.test.mjs`

Le cœur du « code = comptabilité ». À partir des MAP outputs et de la sortie REDUCE, reconstruit le contrat §4.4 sans laisser le LLM produire d'ids croisés.

**Interfaces:**
- Consumes: `mapOutputs` (Formes de données), `reduce` (REDUCE output).
- Produces: `assembleContract(mapOutputs: object[], reduce: object) -> object` (contrat §4.4).
  - `gref→party_id` depuis `reduce.parties[].membres` ; helper interne `refToParty(cote, ref)`.
  - `evenements` : issus de tous les `faits`, `cote_source` = cote de la pièce, `parties` = refs traduits en party ids (dédup, non-null), date requise ; ids `e1…`.
  - `actes` : un par pièce ayant `acte` ; `redacteur`/`concernes` traduits ; ids `a1…`.
  - `relations` : `reduce.relations` (lues) **+** dérivées procédurales (`audition`→`entendu_par`, `requisition`→`requis_par` : `concerné → redacteur`), fusionnées par clé `source|cible|type` (union des cotes).
  - `affaire` : `reduce.affaire` + `periode` (min/max dates events+actes) + `nb_cotes` (cotes distinctes).

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `server/ariane.test.mjs` :

```js
import { assembleContract } from "./ariane.mjs";

const MAP = [
  { cote: "D2", acte: { type: "constatation", date: "2026-03-04", libelle: "constat", redacteur_ref: "m9", concernes_refs: ["m3"] },
    personnes: [{ ref: "m3", nom: "MERIDIA", role_apparent: "victime" }, { ref: "m9", nom: "ADC MARTIN", role_apparent: "enqueteur" }],
    faits: [{ date: "2026-03-04", precision: "jour", libelle: "effraction", personnes_refs: ["m1"] }],
    relations_lues: [] },
  { cote: "D3", acte: { type: "audition", date: "2026-03-06", libelle: "audition DUPONT", redacteur_ref: "m9b", concernes_refs: ["m1b"] },
    personnes: [{ ref: "m1b", nom: "Jean DUPONT", role_apparent: "mis_en_cause" }, { ref: "m9b", nom: "ADC MARTIN", role_apparent: "enqueteur" }],
    faits: [], relations_lues: [] },
];
const REDUCE = {
  affaire: { reference: "PV 1", nature: "Vol", service: "BR" },
  synthese: "s",
  parties: [
    { id: "p1", nom: "Jean DUPONT", role: "mis_en_cause", aliases: [], qualite: "", premiere_cote: "D3", membres: ["D2:m1", "D3:m1b"] },
    { id: "p2", nom: "MERIDIA", role: "victime", aliases: [], qualite: "", premiere_cote: "D2", membres: ["D2:m3"] },
    { id: "p3", nom: "ADC MARTIN", role: "enqueteur", aliases: [], qualite: "", premiere_cote: "D2", membres: ["D2:m9", "D3:m9b"] },
  ],
  relations: [{ source: "p1", cible: "p2", type: "victime_de", libelle: "vol", cotes: ["D2"] }],
};

test("assembleContract construit events/actes avec party ids", () => {
  const c = assembleContract(MAP, REDUCE);
  assert.equal(c.evenements.length, 1);
  assert.equal(c.evenements[0].id, "e1");
  assert.equal(c.evenements[0].cote_source, "D2");
  assert.deepEqual(c.evenements[0].parties, ["p1"]);   // D2:m1 → p1
  assert.equal(c.actes.length, 2);
  assert.equal(c.actes[1].redacteur, "p3");            // D3:m9b → p3
  assert.deepEqual(c.actes[1].concernes, ["p1"]);      // D3:m1b → p1
});

test("assembleContract dérive les relations procédurales + calcule affaire", () => {
  const c = assembleContract(MAP, REDUCE);
  // audition D3 : concerné p1 entendu_par redacteur p3
  const proc = c.relations.find((r) => r.type === "entendu_par");
  assert.deepEqual({ s: proc.source, c: proc.cible, cotes: proc.cotes }, { s: "p1", c: "p3", cotes: ["D3"] });
  assert.ok(c.relations.some((r) => r.type === "victime_de")); // relation lue conservée
  assert.deepEqual(c.affaire.periode, { debut: "2026-03-04", fin: "2026-03-06" });
  assert.equal(c.affaire.nb_cotes, 2);
});

test("assembleContract → contrat valide", () => {
  assert.doesNotThrow(() => validateContract(assembleContract(MAP, REDUCE)));
});
```

- [ ] **Step 2: Lancer le test — doit échouer**

Run: `node --test server/ariane.test.mjs`
Expected: FAIL (`assembleContract is not a function`).

- [ ] **Step 3: Implémenter le minimum**

Ajouter à `server/ariane.mjs` :

```js
// Assemble le contrat final §4.4 depuis les extractions MAP + la sortie REDUCE.
// Le LLM ne produit jamais les ids croisés : c'est ici, en code, qu'on les pose.
export function assembleContract(mapOutputs, reduce) {
  // 1. table gref → party_id
  const grefToParty = new Map();
  for (const p of reduce.parties) for (const g of p.membres || []) grefToParty.set(g, p.id);
  const refToParty = (cote, ref) => (ref == null ? null : grefToParty.get(`${cote}:${ref}`) ?? null);

  // 2. parties (sans membres)
  const parties = reduce.parties.map(({ membres, ...p }) => p);

  // 3. événements ← faits
  const evenements = [];
  for (const piece of mapOutputs) {
    for (const f of piece.faits || []) {
      if (!f.date) continue;
      const ps = [...new Set((f.personnes_refs || []).map((r) => refToParty(piece.cote, r)).filter(Boolean))];
      evenements.push({ id: `e${evenements.length + 1}`, date: f.date, precision: f.precision || "jour", libelle: f.libelle, cote_source: piece.cote, parties: ps });
    }
  }

  // 4. actes ← méta-acte de chaque pièce
  const actes = [];
  for (const piece of mapOutputs) {
    const a = piece.acte;
    if (!a) continue;
    actes.push({ id: `a${actes.length + 1}`, date: a.date, type: a.type, cote: piece.cote, libelle: a.libelle,
      redacteur: refToParty(piece.cote, a.redacteur_ref),
      concernes: [...new Set((a.concernes_refs || []).map((r) => refToParty(piece.cote, r)).filter(Boolean))] });
  }

  // 5. relations : lues (REDUCE) + procédurales dérivées, fusion par clé source|cible|type
  const relByKey = new Map();
  const addRel = (r) => {
    const k = `${r.source}|${r.cible}|${r.type}`;
    const cur = relByKey.get(k);
    if (cur) cur.cotes = [...new Set([...cur.cotes, ...r.cotes])];
    else relByKey.set(k, { source: r.source, cible: r.cible, type: r.type, libelle: r.libelle, cotes: [...r.cotes] });
  };
  for (const r of reduce.relations || []) addRel(r);
  const PROC = { audition: "entendu_par", requisition: "requis_par" };
  for (const piece of mapOutputs) {
    const a = piece.acte;
    const type = a && PROC[a.type];
    if (!type) continue;
    const red = refToParty(piece.cote, a.redacteur_ref);
    if (!red) continue;
    for (const ref of a.concernes_refs || []) {
      const c = refToParty(piece.cote, ref);
      if (c && c !== red) addRel({ source: c, cible: red, type, libelle: type === "entendu_par" ? "entendu par" : "requis par", cotes: [piece.cote] });
    }
  }
  const relations = [...relByKey.values()];

  // 6. affaire : periode (min/max) + nb_cotes (cotes distinctes)
  const dates = [...evenements.map((e) => e.date), ...actes.map((a) => a.date)].filter(Boolean).sort();
  const cotes = new Set(mapOutputs.map((p) => p.cote));
  const affaire = { ...reduce.affaire, periode: { debut: dates[0] ?? null, fin: dates[dates.length - 1] ?? null }, nb_cotes: cotes.size };

  return { affaire, synthese: reduce.synthese, parties, evenements, actes, relations };
}
```

- [ ] **Step 4: Lancer le test — doit passer**

Run: `node --test server/ariane.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/ariane.mjs server/ariane.test.mjs
git commit -m "feat(ariane): assembleContract — assemblage mécanique du contrat"
```

---

## Task 7: Wrappers réseau IAka — `runExtraction` + `runConsolidation`

**Files:**
- Modify: `server/ariane.mjs`
- Test: `server/ariane.test.mjs`

**Interfaces:**
- Consumes: `extractJson` (Task 2).
- Produces:
  - `runExtraction({ file, cote, cfg, fetchImpl, sleep }) -> Promise<mapOutput>` — POST multipart (champ `file`, `app_id=cfg.arianeExtractionAppId`, `tenant_id`) sur `/workflows/execute`, poll `/workflows/executions/{id}` jusqu'à `SUCCESS`, `extractJson`, **stampe `result.cote = cote`**. Erreurs `ARIANE_UPSTREAM` / `ARIANE_TIMEOUT`.
  - `runConsolidation({ aggregate, cfg, fetchImpl, sleep }) -> Promise<reduceOutput>` — POST JSON (`app_id=cfg.arianeConsolidationAppId`, `tenant_id`, `prompt=JSON.stringify(aggregate)`, `langue="fr"`), même poll, `extractJson`.
- `file` = `{ base64, mime, filename }`. `cfg` réutilise `baseUrl, jwt, tenantId, pollIntervalMs, pollTimeoutMs, executePath?, statusPath?`.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `server/ariane.test.mjs` :

```js
import { runExtraction, runConsolidation } from "./ariane.mjs";

const cfg = { baseUrl: "http://iaka", jwt: "j", tenantId: "t", arianeExtractionAppId: "extract", arianeConsolidationAppId: "consol", pollIntervalMs: 0, pollTimeoutMs: 1000 };
const noSleep = () => Promise.resolve();

function fakeFetch(execBody, statusResult) {
  return async (urlArg, init) => {
    const url = String(urlArg);
    if (url.endsWith("/workflows/execute")) return { ok: true, json: async () => ({ execution_id: "x1" }), ...execBody };
    return { ok: true, json: async () => ({ status: "SUCCESS", result: statusResult }) };
  };
}

test("runExtraction poll → extractJson + stampe la cote", async () => {
  const out = await runExtraction({ file: { base64: "AA==", mime: "application/pdf", filename: "D7.pdf" }, cote: "D7", cfg, fetchImpl: fakeFetch({}, '{"personnes":[],"faits":[],"acte":null,"relations_lues":[]}'), sleep: noSleep });
  assert.equal(out.cote, "D7");
  assert.deepEqual(out.personnes, []);
});

test("runConsolidation envoie l'agrégat en prompt et parse la sortie", async () => {
  let sentBody;
  const fetchImpl = async (urlArg, init) => {
    const url = String(urlArg);
    if (url.endsWith("/workflows/execute")) { sentBody = JSON.parse(init.body); return { ok: true, json: async () => ({ execution_id: "x2" }) }; }
    return { ok: true, json: async () => ({ status: "SUCCESS", result: '{"parties":[],"relations":[],"synthese":"s","affaire":{}}' }) };
  };
  const out = await runConsolidation({ aggregate: { personnes: [], relations_lues: [] }, cfg, fetchImpl, sleep: noSleep });
  assert.equal(out.synthese, "s");
  assert.equal(sentBody.app_id, "consol");
  assert.ok(typeof sentBody.prompt === "string");
});

test("runExtraction upstream non-ok → ARIANE_UPSTREAM", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => "boom" });
  await assert.rejects(() => runExtraction({ file: { base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }, cote: "D1", cfg, fetchImpl, sleep: noSleep }), /ARIANE_UPSTREAM/);
});
```

- [ ] **Step 2: Lancer le test — doit échouer**

Run: `node --test server/ariane.test.mjs`
Expected: FAIL (`runExtraction is not a function`).

- [ ] **Step 3: Implémenter le minimum**

Ajouter à `server/ariane.mjs` :

```js
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll commun : attend le result brut d'une exécution IAka.
async function pollResult({ executionId, cfg, fetchImpl, sleep, headers }) {
  const statusTpl = cfg.statusPath || "/workflows/executions/{id}";
  const statusUrl = `${cfg.baseUrl}${statusTpl.replace("{id}", executionId)}?tenant_id=${cfg.tenantId}`;
  const startMs = Date.now();
  while (Date.now() - startMs <= cfg.pollTimeoutMs) {
    const res = await fetchImpl(statusUrl, { method: "GET", headers });
    if (!res.ok) throw new Error("ARIANE_UPSTREAM");
    const body = await res.json();
    if (body.status === "SUCCESS") return body.result;
    if (body.status === "ERROR") throw new Error("ARIANE_UPSTREAM");
    await sleep(cfg.pollIntervalMs);
  }
  throw new Error("ARIANE_TIMEOUT");
}

// MAP : une pièce PDF → extraction (schéma §4.1). La cote est stampée par le BFF.
export async function runExtraction({ file, cote, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  const auth = { Authorization: `Bearer ${cfg.jwt}` };
  const execPath = cfg.executePath || "/workflows/execute";
  const form = new FormData();
  form.set("app_id", cfg.arianeExtractionAppId);
  form.set("tenant_id", cfg.tenantId);
  const bytes = Buffer.from(file.base64, "base64");
  form.append("file", new Blob([bytes], { type: file.mime || "application/pdf" }), file.filename || `${cote}.pdf`);
  const execRes = await fetchImpl(`${cfg.baseUrl}${execPath}`, { method: "POST", headers: auth, body: form });
  if (!execRes.ok) throw new Error("ARIANE_UPSTREAM");
  const { execution_id } = await execRes.json();
  if (!execution_id) throw new Error("ARIANE_UPSTREAM");
  const result = await pollResult({ executionId: execution_id, cfg, fetchImpl, sleep, headers: auth });
  const out = extractJson(result);
  out.cote = cote; // BFF autoritaire sur la cote
  return out;
}

// REDUCE : agrégat compact (envoyé en prompt) → parties/relations/synthèse (schéma §4.3).
export async function runConsolidation({ aggregate, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  const headers = { Authorization: `Bearer ${cfg.jwt}`, "Content-Type": "application/json" };
  const execPath = cfg.executePath || "/workflows/execute";
  const payload = { app_id: cfg.arianeConsolidationAppId, tenant_id: cfg.tenantId, prompt: JSON.stringify(aggregate), langue: "fr" };
  const execRes = await fetchImpl(`${cfg.baseUrl}${execPath}`, { method: "POST", headers, body: JSON.stringify(payload) });
  if (!execRes.ok) throw new Error("ARIANE_UPSTREAM");
  const { execution_id } = await execRes.json();
  if (!execution_id) throw new Error("ARIANE_UPSTREAM");
  const result = await pollResult({ executionId: execution_id, cfg, fetchImpl, sleep, headers });
  return extractJson(result);
}
```

- [ ] **Step 4: Lancer le test — doit passer**

Run: `node --test server/ariane.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/ariane.mjs server/ariane.test.mjs
git commit -m "feat(ariane): wrappers IAka runExtraction + runConsolidation"
```

---

## Task 8: `runAriane` — orchestration map-reduce (fan-out borné, best-effort)

**Files:**
- Modify: `server/ariane.mjs`
- Test: `server/ariane.test.mjs`

**Interfaces:**
- Consumes: `runExtraction`, `runConsolidation`, `buildAggregate`, `assembleContract`, `validateContract`.
- Produces: `runAriane({ files, cfg, fetchImpl, sleep, onProgress, deps }) -> Promise<contract>`.
  - `files` = `[{ base64, mime, filename }]`. Normalisation V1 : **1 fichier = 1 map-unit**, `cote` = nom de fichier sans extension (fallback `piece-<i>`).
  - MAP en concurrence bornée (`cfg.mapConcurrency ?? 4`) ; une pièce en échec est **best-effort** (ignorée, on continue), `onProgress({ done, total })` après chaque pièce.
  - Puis `buildAggregate` → `runConsolidation` → `assembleContract` → `validateContract`.
  - `deps` (optionnel) permet d'injecter `{ runExtraction, runConsolidation }` pour les tests.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `server/ariane.test.mjs` :

```js
import { runAriane } from "./ariane.mjs";

test("runAriane : MAP best-effort + assemblage, progression rapportée", async () => {
  const files = [
    { base64: "AA==", mime: "application/pdf", filename: "D2.pdf" },
    { base64: "AA==", mime: "application/pdf", filename: "D3.pdf" },
    { base64: "AA==", mime: "application/pdf", filename: "D4.pdf" }, // celle-ci échoue
  ];
  const deps = {
    runExtraction: async ({ cote }) => {
      if (cote === "D4") throw new Error("ARIANE_UPSTREAM");
      if (cote === "D2") return { cote: "D2", acte: { type: "constatation", date: "2026-03-04", libelle: "c", redacteur_ref: "m9", concernes_refs: ["m3"] },
        personnes: [{ ref: "m3", nom: "V", role_apparent: "victime" }, { ref: "m9", nom: "E", role_apparent: "enqueteur" }],
        faits: [{ date: "2026-03-04", precision: "jour", libelle: "vol", personnes_refs: ["m3"] }], relations_lues: [] };
      return { cote: "D3", acte: { type: "audition", date: "2026-03-06", libelle: "a", redacteur_ref: "m9b", concernes_refs: ["m1"] },
        personnes: [{ ref: "m1", nom: "S", role_apparent: "mis_en_cause" }, { ref: "m9b", nom: "E", role_apparent: "enqueteur" }],
        faits: [], relations_lues: [] };
    },
    runConsolidation: async ({ aggregate }) => ({
      affaire: { reference: "r", nature: "Vol", service: "BR" }, synthese: "s",
      parties: [
        { id: "p1", nom: "S", role: "mis_en_cause", aliases: [], qualite: "", premiere_cote: "D3", membres: ["D3:m1"] },
        { id: "p2", nom: "V", role: "victime", aliases: [], qualite: "", premiere_cote: "D2", membres: ["D2:m3"] },
        { id: "p3", nom: "E", role: "enqueteur", aliases: [], qualite: "", premiere_cote: "D2", membres: ["D2:m9", "D3:m9b"] },
      ], relations: [],
    }),
  };
  const progress = [];
  const c = await runAriane({ files, cfg: { mapConcurrency: 2 }, deps, onProgress: (p) => progress.push({ ...p }) });
  assert.equal(c.affaire.nb_cotes, 2);        // D4 échouée exclue
  assert.equal(c.actes.length, 2);
  assert.ok(c.relations.some((r) => r.type === "entendu_par"));
  assert.deepEqual(progress[progress.length - 1], { done: 3, total: 3 });
});
```

- [ ] **Step 2: Lancer le test — doit échouer**

Run: `node --test server/ariane.test.mjs`
Expected: FAIL (`runAriane is not a function`).

- [ ] **Step 3: Implémenter le minimum**

Ajouter à `server/ariane.mjs` :

```js
// Exécute un pool de tâches avec une concurrence bornée.
async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

const coteFromFilename = (name, i) => (name ? name.replace(/\.[^.]+$/, "") : `piece-${i + 1}`);

// Orchestration complète : normalisation → MAP fan-out (best-effort) → agrégat →
// REDUCE → assemblage → validation. deps injectables pour les tests.
export async function runAriane({ files, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep, onProgress = () => {}, deps = {} }) {
  const extract = deps.runExtraction || runExtraction;
  const consolidate = deps.runConsolidation || runConsolidation;
  const units = files.map((file, i) => ({ file, cote: coteFromFilename(file.filename, i) }));
  const total = units.length;
  let done = 0;
  const mapResults = await mapPool(units, cfg.mapConcurrency ?? 4, async (u) => {
    let out = null;
    try {
      out = await extract({ file: u.file, cote: u.cote, cfg, fetchImpl, sleep });
    } catch {
      out = null; // best-effort : pièce ignorée
    }
    onProgress({ done: ++done, total });
    return out;
  });
  const mapOutputs = mapResults.filter(Boolean);
  const aggregate = buildAggregate(mapOutputs);
  const reduce = await consolidate({ aggregate, cfg, fetchImpl, sleep });
  return validateContract(assembleContract(mapOutputs, reduce));
}
```

- [ ] **Step 4: Lancer le test — doit passer**

Run: `node --test server/ariane.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/ariane.mjs server/ariane.test.mjs
git commit -m "feat(ariane): runAriane — orchestration map-reduce best-effort"
```

---

## Task 9: Store de jobs + routes BFF + wiring cfg/env

**Files:**
- Modify: `server/ariane.mjs` (store de jobs)
- Modify: `server/proxy.mjs` (import, ERROR_STATUS, routes, cfg)
- Modify: `.env.example`
- Test: `server/ariane.test.mjs`

**Interfaces:**
- Consumes: `runAriane` (Task 8).
- Produces (store de jobs, en mémoire) :
  - `createJob() -> jobId: string`
  - `getJob(jobId) -> { status, progress, result?, error? } | undefined`
  - `startJob({ jobId, files, cfg, fetchImpl })` — lance `runAriane` en arrière-plan, met à jour le job (`status` : `map`→`reduce`→`done`/`error`, `progress`).
- Routes proxy : `POST /api/ariane` (`{ files }`) → `{ jobId }` ; `GET /api/ariane/status?jobId=` → snapshot du job.

- [ ] **Step 1: Écrire le test qui échoue (store de jobs)**

Ajouter à `server/ariane.test.mjs` :

```js
import { createJob, getJob, startJob } from "./ariane.mjs";

test("startJob mène un job jusqu'à done avec le contrat en result", async () => {
  const jobId = createJob();
  assert.equal(getJob(jobId).status, "pending");
  const deps = {
    runExtraction: async ({ cote }) => ({ cote, acte: { type: "audition", date: "2026-03-06", libelle: "a", redacteur_ref: "m9", concernes_refs: ["m1"] },
      personnes: [{ ref: "m1", nom: "S", role_apparent: "mis_en_cause" }, { ref: "m9", nom: "E", role_apparent: "enqueteur" }], faits: [], relations_lues: [] }),
    runConsolidation: async () => ({ affaire: { reference: "r", nature: "Vol", service: "BR" }, synthese: "s",
      parties: [{ id: "p1", nom: "S", role: "mis_en_cause", aliases: [], qualite: "", premiere_cote: "D1", membres: ["D1:m1"] },
                { id: "p2", nom: "E", role: "enqueteur", aliases: [], qualite: "", premiere_cote: "D1", membres: ["D1:m9"] }], relations: [] }),
  };
  await startJob({ jobId, files: [{ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }], cfg: { mapConcurrency: 1 }, deps });
  const job = getJob(jobId);
  assert.equal(job.status, "done");
  assert.equal(job.result.actes.length, 1);
});

test("startJob passe en error si le pipeline lève", async () => {
  const jobId = createJob();
  const deps = { runExtraction: async () => ({ cote: "D1", personnes: [], faits: [], acte: null, relations_lues: [] }),
                 runConsolidation: async () => { throw new Error("ARIANE_UPSTREAM"); } };
  await startJob({ jobId, files: [{ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }], cfg: {}, deps });
  assert.equal(getJob(jobId).status, "error");
  assert.equal(getJob(jobId).error, "ARIANE_UPSTREAM");
});
```

- [ ] **Step 2: Lancer le test — doit échouer**

Run: `node --test server/ariane.test.mjs`
Expected: FAIL (`createJob is not a function`).

- [ ] **Step 3: Implémenter le store de jobs**

Ajouter à `server/ariane.mjs` :

```js
import { randomUUID } from "node:crypto";

// Store de jobs en mémoire (démo, pas de persistance). Chaque job suit la progression
// du pipeline pour l'endpoint de polling.
const jobs = new Map();

export function createJob() {
  const jobId = randomUUID();
  jobs.set(jobId, { status: "pending", progress: { done: 0, total: 0 } });
  return jobId;
}

export function getJob(jobId) {
  return jobs.get(jobId);
}

// Lance le pipeline en arrière-plan et met à jour le job. Résout quand le job est
// terminé (done/error) — la route n'attend pas ce résultat, elle a déjà renvoyé le jobId.
export async function startJob({ jobId, files, cfg, fetchImpl, deps }) {
  const job = jobs.get(jobId);
  job.status = "map";
  job.progress = { done: 0, total: files.length };
  try {
    const contract = await runAriane({
      files, cfg, fetchImpl, deps,
      onProgress: (p) => {
        job.progress = p;
        if (p.done === p.total && p.total > 0) job.status = "reduce";
      },
    });
    job.result = contract;
    job.status = "done";
  } catch (e) {
    job.status = "error";
    job.error = e.message;
  }
}
```

- [ ] **Step 4: Lancer le test — doit passer**

Run: `node --test server/ariane.test.mjs`
Expected: PASS (toute la suite).

- [ ] **Step 5: Câbler les routes dans `server/proxy.mjs`**

Import (après la ligne 6, `import { runSynthese } …`) :

```js
import { createJob, getJob, startJob } from "./ariane.mjs";
```

Codes d'erreur — ajouter dans `ERROR_STATUS` (après `RENS_INVALIDE`) :

```js
  ARIANE_UPSTREAM: 502,
  ARIANE_TIMEOUT: 504,
  ARIANE_INVALIDE: 502,
```

Routes — ajouter juste avant `if (url.pathname === "/api/pvtcmp" …)` (proxy.mjs:264) :

```js
    if (url.pathname === "/api/ariane" && req.method === "POST") {
      try {
        const raw = await readBody(req);
        const { files } = JSON.parse(raw || "{}");
        if (!Array.isArray(files) || files.length === 0 || files.some((f) => !f?.base64)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "FICHIERS_REQUIS" }));
          return;
        }
        const jobId = createJob();
        // Fire-and-forget : le pipeline tourne en arrière-plan, le front poll /status.
        startJob({ jobId, files, cfg, fetchImpl });
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jobId }));
      } catch (e) {
        if (!(e.message in ERROR_STATUS)) console.error(e.message);
        res.writeHead(ERROR_STATUS[e.message] ?? 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message in ERROR_STATUS ? e.message : "INTERNAL_ERROR" }));
      }
      return;
    }
    if (url.pathname === "/api/ariane/status" && req.method === "GET") {
      const job = getJob(url.searchParams.get("jobId"));
      if (!job) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "JOB_INCONNU" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(job));
      return;
    }
```

cfg — ajouter dans le bloc `cfg` du démarrage direct (après `pvtcmpAppId`, proxy.mjs:384) :

```js
    arianeExtractionAppId: process.env.IAKA_ARIANE_EXTRACTION_APP_ID, // Ariane MAP
    arianeConsolidationAppId: process.env.IAKA_ARIANE_CONSOLIDATION_APP_ID, // Ariane REDUCE
    mapConcurrency: Number(process.env.ARIANE_MAP_CONCURRENCY ?? 4),
```

- [ ] **Step 6: `.env.example`**

Ajouter à `.env.example` (près des autres `IAKA_*_APP_ID`) :

```
IAKA_ARIANE_EXTRACTION_APP_ID=
IAKA_ARIANE_CONSOLIDATION_APP_ID=
ARIANE_MAP_CONCURRENCY=4
```

- [ ] **Step 7: Vérifier la non-régression du proxy + toute la suite**

Run: `node --test server/ariane.test.mjs server/proxy.test.mjs`
Expected: PASS (aucune régression proxy ; suite Ariane complète verte).

- [ ] **Step 8: Commit**

```bash
git add server/ariane.mjs server/proxy.mjs .env.example server/ariane.test.mjs
git commit -m "feat(ariane): job async + routes /api/ariane & /status + wiring cfg/env"
```

---

## Self-review (rempli à la rédaction)

- **Couverture spec** : §2 map-reduce → Tasks 5-8 ; §2.2 LLM/code → Task 6 ; §4.1/4.2/4.3/4.4 schémas → Tasks 5,6,7 ; §5 prompts → Task 1 ; §6 BFF (job async, routes, env, best-effort, extractJson, validation) → Tasks 2,3,7,8,9 ; fixture → Task 4 ; §8.1 XML V2 / §8.2 dette → documentés Task 1 (hors code V1). Front (§6 front) = **Plan B**, hors de ce plan.
- **Placeholders** : aucun « TBD » ; tout le code est fourni. La fixture Task 4 donne une ossature explicite + quantités minimales vérifiées par test.
- **Cohérence des types** : `mapOutput`/`aggregate`/`reduce`/contrat définis en tête ; `refToParty`, grefs `cote:ref`, enums cohérents entre Tasks 3, 5, 6, 7, 8. `cfg.arianeExtractionAppId`/`arianeConsolidationAppId`/`mapConcurrency` identiques Tasks 7-9.

## Suite

- **Plan B — Front Ariane** (`src/features/ariane/`) : dropzone N PDF, polling `/api/ariane/status`, 5 vues (synthèse markdown, parties par rôle, 2 timelines, réseau **cytoscape**), sélection de cote partagée, mode démo sur la fixture. Backé par le contrat de ce plan.
- **V2** : chemin XML embarqué (spec §8.1) — nécessite un échantillon PDF A3 + XML anonymisé.
