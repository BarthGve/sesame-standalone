# Évaluation des avoirs — lots 1 et 2 — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer la fausse API de cote automobile (`cote-api`) et la page « Évaluation des avoirs » qui, depuis un UNA, liste les objets des perquisitions et laisse cocher les véhicules à évaluer.

**Architecture:** `cote-api` est un microservice Node autonome calqué sur `server/rgp-api/` : modèle de prix pur et déterministe dans un module, serveur HTTP mince par-dessus, `openapi.json` destiné à dériver un serveur MCP. La page réutilise les fonctions de lecture existantes de `perquisitionApi.ts` et n'ajoute que le filtrage véhicule, la sélection et l'écran.

**Tech Stack:** Node natif (`http`, `node --test`) pour le service ; React 19 + TypeScript + Vite + Vitest pour la page.

**Spec :** `docs/superpowers/specs/2026-07-20-evaluation-avoirs-design.md`

## Global Constraints

- **Aucune dépendance npm ajoutée**, ni au front ni à `cote-api` (`rgp-api` ne dépend que de `pg`, `cote-api` ne dépendra de rien).
- **INTERDIT : emoji dans le front.** Icônes = classe `material-icons` ou SVG inline.
- Code, commentaires, libellés d'interface et messages de commit **en français**.
- `cote-api` est **déterministe** : mêmes paramètres → même réponse, au centime.
- **Fail-closed** : sans `API_TOKEN` configuré, `cote-api` refuse de démarrer (même règle que `rgp-api`).
- Enveloppe de réponse identique à `rgp-api` : succès `{ "data": … }`, erreur `{ "error": { "code", "message" } }`.
- **Sélection plafonnée à 20 véhicules** (limite de la boucle du workflow), affichée à l'utilisateur.
- Tests front : `npm test` (Vitest). Tests service : `node --test server/cote-api/*.test.js`.
- `npx tsc -b` doit rester sans sortie.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `server/cote-api/cote.js` | Catalogue, modèle de prix, génération des annonces. Pur, sans I/O. |
| `server/cote-api/server.js` | HTTP : route `/cote`, `/health`, authentification, validation. |
| `server/cote-api/openapi.json` | Contrat lisible par IAka pour dériver le serveur MCP. |
| `server/cote-api/package.json`, `Dockerfile` | Déploiement, calqués sur `rgp-api`. |
| `src/features/evaluation/evaluationApi.ts` | Chargement des objets d'un UNA, tri véhicules / non éligibles. |
| `src/features/evaluation/evaluationStore.ts` | État de l'écran : UNA, chargement, sélection, plafond. |
| `src/features/evaluation/ObjetsSelection.tsx` | Liste d'une perquisition, cases à cocher, non éligibles grisés. |
| `src/features/evaluation/EvaluationApp.tsx` | Écran complet. |
| `src/App.tsx` | Route `evaluation` et entrée de menu. |

---

### Task 1 : Modèle de prix de `cote-api`

**Files:**
- Create: `server/cote-api/cote.js`
- Test: `server/cote-api/cote.test.js`

**Interfaces:**
- Consumes: rien.
- Produces: `coter({ marque, modele, annee, km, carrosserie })` → objet `{ reference, fourchette, annonces, correspondance, methode, avertissement }`, exporté en CommonJS (`module.exports = { coter }`).

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `server/cote-api/cote.test.js` :

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { coter } = require("./cote");

const SCIROCCO = { marque: "VOLKSWAGEN", modele: "SCIROCCO", annee: 2016, km: 120000 };

test("deux appels identiques donnent exactement la meme reponse", () => {
  assert.deepEqual(coter(SCIROCCO), coter({ ...SCIROCCO }));
});

test("un modele du catalogue est reconnu exactement", () => {
  const r = coter(SCIROCCO);
  assert.equal(r.correspondance, "exacte");
  assert.equal(r.reference.marque, "VOLKSWAGEN");
  assert.equal(r.fourchette.devise, "EUR");
});

test("la casse, les accents et les espaces ne changent pas la reconnaissance", () => {
  const r = coter({ marque: " volkswagen ", modele: "Scirocco", annee: 2016, km: 120000 });
  assert.equal(r.correspondance, "exacte");
  assert.equal(r.fourchette.moyen, coter(SCIROCCO).fourchette.moyen);
});

test("un vehicule plus ancien cote moins cher", () => {
  const recent = coter({ ...SCIROCCO, annee: 2022 }).fourchette.moyen;
  const ancien = coter({ ...SCIROCCO, annee: 2010 }).fourchette.moyen;
  assert.ok(ancien < recent, `${ancien} devrait etre inferieur a ${recent}`);
});

test("un vehicule plus kilometre cote moins cher", () => {
  const peu = coter({ ...SCIROCCO, km: 40000 }).fourchette.moyen;
  const beaucoup = coter({ ...SCIROCCO, km: 250000 }).fourchette.moyen;
  assert.ok(beaucoup < peu, `${beaucoup} devrait etre inferieur a ${peu}`);
});

test("la fourchette encadre le prix moyen", () => {
  const f = coter(SCIROCCO).fourchette;
  assert.ok(f.bas < f.moyen && f.moyen < f.haut);
});

test("un modele voisin est reconnu comme approchant", () => {
  const r = coter({ marque: "VOLKSWAGEN", modele: "SCIROCCO 2.0 TSI", annee: 2016, km: 120000 });
  assert.equal(r.correspondance, "approchante");
});

test("une marque connue mais un modele inconnu tombe en repli de segment, sans erreur", () => {
  const r = coter({ marque: "VOLKSWAGEN", modele: "XYZ-INTROUVABLE", annee: 2016, km: 120000 });
  assert.equal(r.correspondance, "repli_segment");
  assert.ok(r.fourchette.moyen > 0);
});

test("une marque inconnue tombe aussi en repli, sans erreur", () => {
  const r = coter({ marque: "MARQUE-FANTOME", modele: "MODELE-FANTOME", annee: 2016, km: 120000 });
  assert.equal(r.correspondance, "repli_segment");
  assert.ok(r.fourchette.moyen > 0);
});

test("trois a cinq annonces comparables, coherentes avec la fourchette", () => {
  const r = coter(SCIROCCO);
  assert.ok(r.annonces.length >= 3 && r.annonces.length <= 5);
  for (const a of r.annonces) {
    assert.ok(a.prix >= r.fourchette.bas && a.prix <= r.fourchette.haut, `${a.prix} hors fourchette`);
    assert.ok(a.titre && a.lieu && a.url);
  }
});

test("le kilometrage absent est remplace par une hypothese d'usage moyen", () => {
  const r = coter({ marque: "VOLKSWAGEN", modele: "SCIROCCO", annee: 2016 });
  assert.ok(r.reference.km > 0);
  assert.match(r.methode, /kilom/i);
});

test("un vehicule tres ancien garde une valeur residuelle positive", () => {
  const r = coter({ ...SCIROCCO, annee: 1990, km: 400000 });
  assert.ok(r.fourchette.bas > 0);
});

test("l'avertissement de simulation est toujours present", () => {
  assert.match(coter(SCIROCCO).avertissement, /simul/i);
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `node --test server/cote-api/cote.test.js`
Expected: FAIL — `Cannot find module './cote'`.

- [ ] **Step 3 : Écrire l'implémentation**

Créer `server/cote-api/cote.js` :

```js
// Modèle de cote automobile SIMULÉ. Aucune donnée réelle : un catalogue de
// démonstration, une décote par âge et par kilométrage, et des annonces
// comparables engendrées à partir des mêmes paramètres.
//
// DÉTERMINISME : ce module ne doit jamais dépendre de l'horloge ni du hasard.
// L'âge se calcule depuis ANNEE_REFERENCE (et non l'année courante), et les
// annonces sont dérivées d'un hachage des paramètres. Une démonstration dont
// les chiffres bougent d'un jour à l'autre est intestable et ingérable.

const ANNEE_REFERENCE = 2026;
const DECOTE_ANNUELLE = 0.12; // 12 % par an
const KM_PAR_AN = 15000; // usage de référence
const PENALITE_PAR_KM = 0.0000045; // fraction du prix neuf par km au-delà de la référence
const VALEUR_RESIDUELLE = 0.06; // plancher : 6 % du prix neuf
const AMPLITUDE = 0.14; // ±14 % autour du prix moyen

const CATALOGUE = [
  { marque: "VOLKSWAGEN", modele: "SCIROCCO", segment: "COMPACTE", prixNeuf: 32000 },
  { marque: "VOLKSWAGEN", modele: "GOLF", segment: "COMPACTE", prixNeuf: 30000 },
  { marque: "VOLKSWAGEN", modele: "TOUAREG", segment: "SUV", prixNeuf: 68000 },
  { marque: "RENAULT", modele: "CLIO", segment: "CITADINE", prixNeuf: 20000 },
  { marque: "RENAULT", modele: "MEGANE", segment: "COMPACTE", prixNeuf: 28000 },
  { marque: "RENAULT", modele: "KANGOO", segment: "UTILITAIRE", prixNeuf: 24000 },
  { marque: "PEUGEOT", modele: "208", segment: "CITADINE", prixNeuf: 21000 },
  { marque: "PEUGEOT", modele: "308", segment: "COMPACTE", prixNeuf: 29000 },
  { marque: "PEUGEOT", modele: "3008", segment: "SUV", prixNeuf: 38000 },
  { marque: "CITROEN", modele: "C3", segment: "CITADINE", prixNeuf: 19000 },
  { marque: "BMW", modele: "SERIE 3", segment: "BERLINE", prixNeuf: 52000 },
  { marque: "BMW", modele: "X5", segment: "SUV", prixNeuf: 82000 },
  { marque: "MERCEDES", modele: "CLASSE C", segment: "BERLINE", prixNeuf: 54000 },
  { marque: "AUDI", modele: "A3", segment: "COMPACTE", prixNeuf: 36000 },
  { marque: "AUDI", modele: "Q5", segment: "SUV", prixNeuf: 62000 },
  { marque: "FORD", modele: "FIESTA", segment: "CITADINE", prixNeuf: 19500 },
  { marque: "TOYOTA", modele: "YARIS", segment: "CITADINE", prixNeuf: 22000 },
  { marque: "DACIA", modele: "SANDERO", segment: "CITADINE", prixNeuf: 15000 },
];

const PRIX_SEGMENT = {
  CITADINE: 19000,
  COMPACTE: 29000,
  BERLINE: 48000,
  SUV: 55000,
  UTILITAIRE: 25000,
};

const VILLES = ["Angers (49)", "Nantes (44)", "Rennes (35)", "Le Mans (72)", "Tours (37)"];

// Majuscules, sans accent, espaces réduits : « Scirocco » et " scirocco " sont
// le même modèle, et l'agent ne doit pas être pénalisé par une saisie photo.
function normaliser(v) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Hachage stable (FNV-1a 32 bits) : sert à engendrer des annonces variées mais
// reproductibles. `Math.random` casserait le déterminisme.
function empreinte(texte) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function trouverModele(marque, modele) {
  const exact = CATALOGUE.find((c) => c.marque === marque && c.modele === modele);
  if (exact) return { entree: exact, correspondance: "exacte" };

  // Modèle voisin : « SCIROCCO 2.0 TSI » ou « GOLF VII » restent identifiables.
  const proche = CATALOGUE.find(
    (c) => c.marque === marque && (modele.startsWith(c.modele) || c.modele.startsWith(modele))
  );
  if (proche) return { entree: proche, correspondance: "approchante" };

  return { entree: null, correspondance: "repli_segment" };
}

function arrondi(valeur) {
  return Math.round(valeur / 10) * 10;
}

/**
 * Cote simulée d'un véhicule terrestre.
 * @param {{marque?: string, modele?: string, annee?: number|string, km?: number|string, carrosserie?: string}} p
 */
function coter(p) {
  const marque = normaliser(p.marque);
  const modele = normaliser(p.modele);
  const annee = Number(p.annee);
  const { entree, correspondance } = trouverModele(marque, modele);

  const age = Math.max(0, ANNEE_REFERENCE - annee);
  // Kilométrage absent : usage moyen supposé, l'hypothèse est dite dans `methode`.
  const kmConnu = Number(p.km) > 0;
  const km = kmConnu ? Number(p.km) : age * KM_PAR_AN;

  const segment = entree ? entree.segment : "COMPACTE";
  const prixNeuf = entree ? entree.prixNeuf : PRIX_SEGMENT[segment];

  const apresAge = prixNeuf * Math.pow(1 - DECOTE_ANNUELLE, age);
  const kmExcedent = Math.max(0, km - age * KM_PAR_AN);
  const apresKm = apresAge - prixNeuf * PENALITE_PAR_KM * kmExcedent;
  const moyen = arrondi(Math.max(prixNeuf * VALEUR_RESIDUELLE, apresKm));

  const bas = arrondi(moyen * (1 - AMPLITUDE));
  const haut = arrondi(moyen * (1 + AMPLITUDE));

  const graine = empreinte(`${marque}|${modele}|${annee}|${km}`);
  const nombre = 3 + (graine % 3); // 3 à 5 annonces
  const annonces = Array.from({ length: nombre }, (_, i) => {
    const decalage = ((graine >>> (i * 3)) % 21) - 10; // -10 % à +10 %
    const prix = arrondi(Math.min(haut, Math.max(bas, moyen * (1 + decalage / 100))));
    const kmAnnonce = Math.max(1000, km + (((graine >>> (i * 5)) % 20000) - 10000));
    return {
      titre: `${entree ? entree.marque : marque} ${entree ? entree.modele : modele}`.trim(),
      annee: annee || ANNEE_REFERENCE - 5,
      km: kmAnnonce,
      prix,
      lieu: VILLES[(graine + i) % VILLES.length],
      url: `https://cote.local/annonce/${(graine + i).toString(16)}`,
    };
  });

  const methode =
    "Prix catalogue de démonstration, décoté de 12 % par an, corrigé du kilométrage au-delà " +
    `de ${KM_PAR_AN} km/an, puis dispersé pour engendrer des annonces comparables. ` +
    (kmConnu
      ? `Kilométrage fourni : ${km} km.`
      : `Kilométrage non fourni : usage moyen supposé, soit ${km} km.`);

  return {
    reference: { marque, modele, annee: annee || null, km, segment },
    fourchette: { bas, moyen, haut, devise: "EUR" },
    annonces,
    correspondance,
    methode,
    avertissement: "Données de démonstration — source simulée, non contractuelle.",
  };
}

module.exports = { coter, ANNEE_REFERENCE };
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `node --test server/cote-api/cote.test.js`
Expected: PASS — 13 tests.

- [ ] **Step 5 : Commit**

```bash
git add server/cote-api/cote.js server/cote-api/cote.test.js
git commit -m "feat(cote-api): modele de prix simule et deterministe"
```

---

### Task 2 : Serveur HTTP de `cote-api`

**Files:**
- Create: `server/cote-api/server.js`
- Create: `server/cote-api/package.json`
- Create: `server/cote-api/Dockerfile`
- Test: `server/cote-api/server.test.js`

**Interfaces:**
- Consumes: `coter(...)` de `./cote` (Task 1).
- Produces: `createHandler()` exporté par `server.js` — fonction `(req, res)` testable sans écouter de port.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `server/cote-api/server.test.js` :

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.API_TOKEN = "jeton-de-test";
const { createHandler } = require("./server");

// Réponse factice : capture le code HTTP et le corps JSON.
function reponse() {
  return {
    code: 0,
    entetes: null,
    corps: null,
    writeHead(code, entetes) { this.code = code; this.entetes = entetes; },
    end(texte) { this.corps = JSON.parse(texte); },
  };
}

function appeler(url, entetes = { authorization: "Bearer jeton-de-test" }) {
  const res = reponse();
  createHandler()({ url, method: "GET", headers: entetes }, res);
  return res;
}

test("/health repond sans authentification", () => {
  const res = appeler("/health", {});
  assert.equal(res.code, 200);
  assert.equal(res.corps.data.ok, true);
});

test("sans jeton, /cote est refuse", () => {
  const res = appeler("/cote?marque=RENAULT&modele=CLIO&annee=2018", {});
  assert.equal(res.code, 401);
  assert.equal(res.corps.error.code, "unauthorized");
});

test("avec un mauvais jeton, /cote est refuse", () => {
  const res = appeler("/cote?marque=RENAULT&modele=CLIO&annee=2018", { authorization: "Bearer faux" });
  assert.equal(res.code, 401);
});

test("une cote complete renvoie fourchette, annonces et correspondance", () => {
  const res = appeler("/cote?marque=RENAULT&modele=CLIO&annee=2018&km=90000");
  assert.equal(res.code, 200);
  assert.equal(res.corps.data.correspondance, "exacte");
  assert.ok(res.corps.data.fourchette.moyen > 0);
  assert.ok(res.corps.data.annonces.length >= 3);
});

test("marque, modele ou annee manquants renvoient 400", () => {
  for (const url of [
    "/cote?modele=CLIO&annee=2018",
    "/cote?marque=RENAULT&annee=2018",
    "/cote?marque=RENAULT&modele=CLIO",
  ]) {
    const res = appeler(url);
    assert.equal(res.code, 400, url);
    assert.equal(res.corps.error.code, "bad_request");
  }
});

test("une annee non numerique renvoie 400", () => {
  const res = appeler("/cote?marque=RENAULT&modele=CLIO&annee=abcd");
  assert.equal(res.code, 400);
});

test("un chemin inconnu renvoie 404", () => {
  const res = appeler("/inconnu");
  assert.equal(res.code, 404);
});

test("le modele inconnu passe en repli, sans erreur HTTP", () => {
  const res = appeler("/cote?marque=FANTOME&modele=FANTOME&annee=2018");
  assert.equal(res.code, 200);
  assert.equal(res.corps.data.correspondance, "repli_segment");
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `node --test server/cote-api/server.test.js`
Expected: FAIL — `Cannot find module './server'`.

- [ ] **Step 3 : Écrire le serveur**

Créer `server/cote-api/server.js` :

```js
// Fausse API de cote automobile — calquée sur server/rgp-api/server.js :
// serveur HTTP natif, authentification Bearer, enveloppe { data } / { error }.
// Sert de source à l'agent IAka d'évaluation des avoirs, via un serveur MCP
// dérivé de openapi.json.

const http = require("http");
const { coter } = require("./cote");

const TOKEN = process.env.API_TOKEN || "";
// Fail-closed : sans jeton configuré, refus de démarrer plutôt que de servir
// l'API ouverte en silence (même règle que rgp-api).
if (!TOKEN && require.main === module) {
  console.error("FATAL: API_TOKEN manquant — refus de démarrer");
  process.exit(1);
}

const json = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
};
const err = (res, code, c, m) => json(res, code, { error: { code: c, message: m } });

function createHandler() {
  return (req, res) => {
    const u = new URL(req.url, "http://x");
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        m: req.method,
        p: u.pathname,
        q: Object.fromEntries(u.searchParams),
        auth: !!req.headers.authorization,
      })
    );

    if (u.pathname === "/health") return json(res, 200, { data: { ok: true } });

    if ((req.headers.authorization || "") !== "Bearer " + TOKEN)
      return err(res, 401, "unauthorized", "Token invalide ou manquant");

    if (u.pathname === "/cote" && req.method === "GET") {
      const marque = (u.searchParams.get("marque") || "").trim();
      const modele = (u.searchParams.get("modele") || "").trim();
      const anneeBrute = (u.searchParams.get("annee") || "").trim();
      const annee = Number(anneeBrute);
      if (!marque || !modele || !anneeBrute)
        return err(res, 400, "bad_request", "Paramètres marque, modele et annee requis");
      if (!Number.isInteger(annee) || annee < 1900 || annee > 2100)
        return err(res, 400, "bad_request", "Paramètre annee : année à quatre chiffres attendue");

      const km = u.searchParams.get("km");
      const carrosserie = u.searchParams.get("carrosserie") || undefined;
      return json(res, 200, { data: coter({ marque, modele, annee, km, carrosserie }) });
    }

    return err(res, 404, "not_found", "Route inconnue");
  };
}

if (require.main === module) {
  http.createServer(createHandler()).listen(8082, () => console.log("cote-api sur :8082"));
}

module.exports = { createHandler };
```

Créer `server/cote-api/package.json` :

```json
{ "name": "cote-api", "version": "1.0.0", "private": true,
  "scripts": { "test": "node --test" },
  "dependencies": {} }
```

Créer `server/cote-api/Dockerfile` :

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js cote.js ./
USER node
EXPOSE 8082
CMD ["node","server.js"]
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `node --test server/cote-api/*.test.js`
Expected: PASS — 21 tests (13 de Task 1 + 8 ici).

- [ ] **Step 5 : Commit**

```bash
git add server/cote-api/server.js server/cote-api/server.test.js server/cote-api/package.json server/cote-api/Dockerfile
git commit -m "feat(cote-api): serveur HTTP, authentification et validation"
```

---

### Task 3 : Contrat `openapi.json` de `cote-api`

**Files:**
- Create: `server/cote-api/openapi.json`
- Test: `server/cote-api/openapi.test.js`

**Interfaces:**
- Consumes: le comportement du serveur (Task 2).
- Produces: le fichier dont IAka dérivera le serveur MCP.

Ce fichier n'est pas de la documentation : c'est **le texte qui pilotera l'agent**. Un paramètre mal décrit ou un `correspondance` non expliqué et l'agent ne saura pas qu'il doit retenter.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `server/cote-api/openapi.test.js` :

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const spec = require("./openapi.json");

test("le contrat decrit la route /cote en GET", () => {
  assert.ok(spec.paths["/cote"].get);
  assert.equal(spec.paths["/cote"].get.operationId, "getCote");
});

test("les parametres obligatoires sont declares obligatoires", () => {
  const params = spec.paths["/cote"].get.parameters;
  const obligatoires = params.filter((p) => p.required).map((p) => p.name).sort();
  assert.deepEqual(obligatoires, ["annee", "marque", "modele"]);
});

test("les parametres optionnels km et carrosserie sont declares", () => {
  const noms = spec.paths["/cote"].get.parameters.map((p) => p.name);
  assert.ok(noms.includes("km"));
  assert.ok(noms.includes("carrosserie"));
});

test("le champ correspondance est enumere et explique — c'est lui qui pilote la reprise de l'agent", () => {
  const champ = spec.components.schemas.Cote.properties.correspondance;
  assert.deepEqual(champ.enum, ["exacte", "approchante", "repli_segment"]);
  assert.match(champ.description, /repli|retent|reformul/i);
});

test("le schema de reponse porte fourchette, annonces et avertissement", () => {
  const props = spec.components.schemas.Cote.properties;
  for (const cle of ["reference", "fourchette", "annonces", "correspondance", "methode", "avertissement"]) {
    assert.ok(props[cle], `champ ${cle} manquant`);
  }
});

test("la description previent que les donnees sont simulees", () => {
  assert.match(spec.info.description, /simul/i);
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `node --test server/cote-api/openapi.test.js`
Expected: FAIL — `Cannot find module './openapi.json'`.

- [ ] **Step 3 : Écrire le contrat**

Créer `server/cote-api/openapi.json` :

```json
{
  "openapi": "3.0.3",
  "info": {
    "title": "Cote véhicules d'occasion (simulée)",
    "version": "1.0.0",
    "description": "API de cote automobile SIMULÉE, pour démonstration. Les prix et les annonces sont engendrés par un modèle de décote, ils ne proviennent d'aucun marché réel et n'ont aucune valeur contractuelle.\nEnveloppe de réponse uniforme : succès { \"data\": ... }, erreur { \"error\": { \"code\": \"...\", \"message\": \"...\" } }.\n"
  },
  "servers": [{ "url": "https://carnet.kerjean.net/cote-api", "description": "Production" }],
  "security": [{ "bearerAuth": [] }],
  "tags": [{ "name": "Cote", "description": "Estimation de valeur d'un véhicule terrestre" }],
  "paths": {
    "/cote": {
      "get": {
        "tags": ["Cote"],
        "summary": "Estimer la valeur d'un véhicule terrestre",
        "description": "Renvoie une fourchette de prix et des annonces comparables pour un véhicule décrit par sa marque, son modèle et son année de première mise en circulation.\nLe champ `correspondance` indique la qualité de l'identification : si sa valeur est `repli_segment`, aucun modèle n'a été reconnu et le prix ne vaut que pour le segment — il est alors utile de retenter avec une écriture normalisée de la marque et du modèle (par exemple « VW » → « VOLKSWAGEN », « Golf VII » → « GOLF »).\n",
        "operationId": "getCote",
        "parameters": [
          { "name": "marque", "in": "query", "required": true, "schema": { "type": "string" }, "description": "Marque du véhicule, par exemple VOLKSWAGEN. La casse et les accents sont sans importance.", "example": "VOLKSWAGEN" },
          { "name": "modele", "in": "query", "required": true, "schema": { "type": "string" }, "description": "Modèle du véhicule, par exemple SCIROCCO. Une version détaillée (« SCIROCCO 2.0 TSI ») est acceptée et reconnue comme approchante.", "example": "SCIROCCO" },
          { "name": "annee", "in": "query", "required": true, "schema": { "type": "integer" }, "description": "Année de première mise en circulation, à quatre chiffres.", "example": 2016 },
          { "name": "km", "in": "query", "required": false, "schema": { "type": "integer" }, "description": "Kilométrage. S'il est absent, un usage moyen est supposé et l'hypothèse est indiquée dans le champ methode.", "example": 120000 },
          { "name": "carrosserie", "in": "query", "required": false, "schema": { "type": "string" }, "description": "Type de carrosserie, à titre indicatif.", "example": "COUPE" }
        ],
        "responses": {
          "200": {
            "description": "Cote estimée",
            "content": { "application/json": { "schema": { "type": "object", "properties": { "data": { "$ref": "#/components/schemas/Cote" } } } } }
          },
          "400": { "description": "Paramètre manquant ou invalide", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Erreur" } } } },
          "401": { "description": "Jeton absent ou invalide", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Erreur" } } } }
        }
      }
    },
    "/health": {
      "get": {
        "tags": ["Cote"],
        "summary": "État du service",
        "operationId": "getHealth",
        "security": [],
        "responses": { "200": { "description": "Service disponible" } }
      }
    }
  },
  "components": {
    "securitySchemes": { "bearerAuth": { "type": "http", "scheme": "bearer" } },
    "schemas": {
      "Cote": {
        "type": "object",
        "properties": {
          "reference": {
            "type": "object",
            "description": "Paramètres retenus après normalisation.",
            "properties": {
              "marque": { "type": "string" },
              "modele": { "type": "string" },
              "annee": { "type": "integer", "nullable": true },
              "km": { "type": "integer" },
              "segment": { "type": "string" }
            }
          },
          "fourchette": {
            "type": "object",
            "description": "Fourchette de valeur estimée.",
            "properties": {
              "bas": { "type": "number" },
              "moyen": { "type": "number" },
              "haut": { "type": "number" },
              "devise": { "type": "string", "example": "EUR" }
            }
          },
          "annonces": {
            "type": "array",
            "description": "Annonces comparables simulées, cohérentes avec la fourchette.",
            "items": {
              "type": "object",
              "properties": {
                "titre": { "type": "string" },
                "annee": { "type": "integer" },
                "km": { "type": "integer" },
                "prix": { "type": "number" },
                "lieu": { "type": "string" },
                "url": { "type": "string" }
              }
            }
          },
          "correspondance": {
            "type": "string",
            "enum": ["exacte", "approchante", "repli_segment"],
            "description": "Qualité de l'identification du modèle. `exacte` : modèle trouvé au catalogue. `approchante` : modèle voisin retenu. `repli_segment` : aucun modèle reconnu, prix de segment seulement — il est alors pertinent de retenter la requête avec une marque et un modèle reformulés."
          },
          "methode": { "type": "string", "description": "Méthode de calcul et hypothèses retenues." },
          "avertissement": { "type": "string", "description": "Rappel que la source est simulée et non contractuelle." }
        }
      },
      "Erreur": {
        "type": "object",
        "properties": {
          "error": {
            "type": "object",
            "properties": { "code": { "type": "string" }, "message": { "type": "string" } }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `node --test server/cote-api/*.test.js`
Expected: PASS — 27 tests.

- [ ] **Step 5 : Commit**

```bash
git add server/cote-api/openapi.json server/cote-api/openapi.test.js
git commit -m "feat(cote-api): contrat openapi destine au serveur MCP"
```

---

### Task 4 : Chargement des véhicules d'un UNA

**Files:**
- Create: `src/features/evaluation/evaluationApi.ts`
- Modify: `src/features/saisies/perquisitionApi.ts` (interface `ApiObjet`)
- Test: `src/features/evaluation/evaluationApi.test.ts`

**Interfaces:**
- Consumes: `listPerquisitions(una, fetchImpl)` et `getPerquisition(id, fetchImpl)` de `../saisies/perquisitionApi`, types `PerquisitionSummary`, `PerquisitionDetail`, `ApiObjet`.
- Produces:
  - `type ObjetEvaluable = { objet: ApiObjet; perquisitionId: number; adresse: string }`
  - `type ChargementUna = { perquisitions: PerquisitionSummary[]; vehicules: ObjetEvaluable[]; nonEligibles: number }`
  - `chargerUna(una: string, fetchImpl?: typeof fetch): Promise<ChargementUna>`
  - `estVehiculeTerrestre(o: ApiObjet): boolean`
  - `champ(o: ApiObjet, cle: string): string`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `src/features/evaluation/evaluationApi.test.ts` :

```ts
import { expect, test } from "vitest";
import { chargerUna, estVehiculeTerrestre, champ } from "./evaluationApi";
import type { ApiObjet } from "../saisies/perquisitionApi";

const objet = (id: number, categorie: string, sousType?: string): ApiObjet => ({
  id,
  categorie,
  sous_type: sousType ?? null,
  champs: [
    { cle: "marque", libelle: "Marque", valeur: "VOLKSWAGEN", source: "deduit", obligatoire: false },
    { cle: "modele", libelle: "Modèle", valeur: "Scirocco", source: "deduit", obligatoire: false },
  ],
  identifiants: [],
});

// fetch factice : renvoie l'enveloppe { data } de rgp-api selon l'URL appelée.
function fetchFactice(perquisitions: unknown, details: Record<number, unknown>) {
  return (async (url: string) => {
    if (url.startsWith("/api/perquisitions"))
      return { ok: true, json: async () => ({ data: perquisitions }) };
    const id = Number(new URL(url, "http://x").searchParams.get("id"));
    return { ok: true, json: async () => ({ data: details[id] }) };
  }) as unknown as typeof fetch;
}

test("reconnait un vehicule terrestre", () => {
  expect(estVehiculeTerrestre(objet(1, "TRANSPORT", "VEHICULE_TERRESTRE"))).toBe(true);
  expect(estVehiculeTerrestre(objet(2, "TRANSPORT", "BATEAU"))).toBe(false);
  expect(estVehiculeTerrestre(objet(3, "ARME"))).toBe(false);
});

test("lit la valeur d'un champ, chaine vide si absent", () => {
  expect(champ(objet(1, "TRANSPORT", "VEHICULE_TERRESTRE"), "marque")).toBe("VOLKSWAGEN");
  expect(champ(objet(1, "TRANSPORT", "VEHICULE_TERRESTRE"), "kilometrage")).toBe("");
});

test("rassemble les vehicules de toutes les perquisitions de l'UNA", async () => {
  const perquisitions = [
    { id: 10, adresse: "3 rue A", created_at: "2026-01-01", nb_objets: 2 },
    { id: 11, adresse: "5 rue B", created_at: "2026-01-02", nb_objets: 1 },
  ];
  const details = {
    10: { id: 10, objets: [objet(1, "TRANSPORT", "VEHICULE_TERRESTRE"), objet(2, "ARME")] },
    11: { id: 11, objets: [objet(3, "TRANSPORT", "VEHICULE_TERRESTRE")] },
  };
  const r = await chargerUna("12345/00042/2026", fetchFactice(perquisitions, details));
  expect(r.perquisitions).toHaveLength(2);
  expect(r.vehicules.map((v) => v.objet.id)).toEqual([1, 3]);
  expect(r.vehicules[0].adresse).toBe("3 rue A");
  expect(r.nonEligibles).toBe(1);
});

test("un UNA sans perquisition renvoie des listes vides, sans lever", async () => {
  const r = await chargerUna("12345/00099/2026", fetchFactice([], {}));
  expect(r.perquisitions).toEqual([]);
  expect(r.vehicules).toEqual([]);
  expect(r.nonEligibles).toBe(0);
});

test("l'erreur de l'API remonte telle quelle", async () => {
  const impl = (async () => ({ ok: true, json: async () => ({ error: { message: "UNA introuvable" } }) })) as unknown as typeof fetch;
  await expect(chargerUna("12345/00042/2026", impl)).rejects.toThrow("UNA introuvable");
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `npm test -- src/features/evaluation/evaluationApi.test.ts`
Expected: FAIL — `Failed to resolve import "./evaluationApi"`.

- [ ] **Step 3 : Étendre le type `ApiObjet`**

Dans `src/features/saisies/perquisitionApi.ts`, l'interface `ApiObjet` ne déclare pas les champs d'estimation que `rgp-api` renvoie pourtant (`SELECT *` sur `objet_saisi`, plus les tables liées). Les ajouter — ils serviront à relire l'état de la base au lot 3 :

```ts
export interface ApiObjet {
  id: number;
  categorie: string;
  sous_type?: string | null;
  numero_scelle?: string | null;
  situation?: string | null;
  lieu?: string | null;
  photo_url?: string | null;
  champs: { cle: string; libelle: string; valeur: string | null; source: string | null; obligatoire: boolean }[];
  identifiants: { type: string; valeur: string }[];
  // Estimation déjà enregistrée en base, le cas échéant (colonnes estim_* et
  // tables liées d'objet_saisi).
  estim_prix_bas?: number | null;
  estim_prix_moyen?: number | null;
  estim_prix_haut?: number | null;
  estimation_sources?: { site: string; url: string; prix: number | null }[];
  estimation_hypotheses?: string[];
}
```

- [ ] **Step 4 : Écrire le module**

Créer `src/features/evaluation/evaluationApi.ts` :

```ts
// Chargement des objets d'un UNA en vue de leur évaluation. Réutilise les
// lectures existantes de la perquisition : rien de nouveau côté serveur.

import {
  listPerquisitions,
  getPerquisition,
  type ApiObjet,
  type PerquisitionSummary,
} from "../saisies/perquisitionApi";

export type ObjetEvaluable = {
  objet: ApiObjet;
  perquisitionId: number;
  adresse: string;
};

export type ChargementUna = {
  perquisitions: PerquisitionSummary[];
  vehicules: ObjetEvaluable[];
  /** Objets présents dans la procédure mais hors périmètre de ce premier incrément. */
  nonEligibles: number;
};

/** Seuls les véhicules terrestres sont évaluables pour l'instant. */
export function estVehiculeTerrestre(o: ApiObjet): boolean {
  return o.categorie === "TRANSPORT" && o.sous_type === "VEHICULE_TERRESTRE";
}

/** Valeur d'un champ de fiche, chaîne vide si absent — jamais null à l'affichage. */
export function champ(o: ApiObjet, cle: string): string {
  return o.champs.find((c) => c.cle === cle)?.valeur ?? "";
}

export async function chargerUna(
  una: string,
  fetchImpl: typeof fetch = fetch
): Promise<ChargementUna> {
  const perquisitions = await listPerquisitions(una, fetchImpl);
  const vehicules: ObjetEvaluable[] = [];
  let nonEligibles = 0;

  for (const p of perquisitions) {
    const detail = await getPerquisition(p.id, fetchImpl);
    for (const objet of detail.objets ?? []) {
      if (estVehiculeTerrestre(objet)) {
        vehicules.push({ objet, perquisitionId: p.id, adresse: p.adresse });
      } else {
        nonEligibles++;
      }
    }
  }

  return { perquisitions, vehicules, nonEligibles };
}
```

- [ ] **Step 5 : Lancer les tests, vérifier le succès**

Run: `npm test -- src/features/evaluation/evaluationApi.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6 : Commit**

```bash
git add src/features/evaluation/evaluationApi.ts src/features/evaluation/evaluationApi.test.ts src/features/saisies/perquisitionApi.ts
git commit -m "feat(evaluation): chargement des vehicules d'un UNA"
```

---

### Task 5 : Store de l'écran d'évaluation

**Files:**
- Create: `src/features/evaluation/evaluationStore.ts`
- Test: `src/features/evaluation/evaluationStore.test.ts`

**Interfaces:**
- Consumes: `chargerUna`, `ChargementUna`, `ObjetEvaluable` (Task 4) ; `createPersistedStore` de `../../lib/createPersistedStore`.
- Produces:
  - `MAX_SELECTION = 20`
  - `type EvaluationState = { una: string; chargement: boolean; erreur: string | null; donnees: ChargementUna | null; selection: number[] }`
  - `setUna(una: string)`, `charger(fetchImpl?)`, `basculer(objetId: number)`, `viderSelection()`, `clear()`
  - `useEvaluation()`, `lireEtat()`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `src/features/evaluation/evaluationStore.test.ts` :

```ts
import { beforeEach, expect, test, vi } from "vitest";
import type { ApiObjet } from "../saisies/perquisitionApi";

const objet = (id: number): ApiObjet => ({
  id,
  categorie: "TRANSPORT",
  sous_type: "VEHICULE_TERRESTRE",
  champs: [],
  identifiants: [],
});

function fetchFactice(nbVehicules: number) {
  const perquisitions = [{ id: 10, adresse: "3 rue A", created_at: "2026-01-01", nb_objets: nbVehicules }];
  const objets = Array.from({ length: nbVehicules }, (_, i) => objet(i + 1));
  return (async (url: string) => {
    if (url.startsWith("/api/perquisitions"))
      return { ok: true, json: async () => ({ data: perquisitions }) };
    return { ok: true, json: async () => ({ data: { id: 10, objets } }) };
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  sessionStorage.clear();
  vi.resetModules();
});

test("charge les vehicules de l'UNA saisi", async () => {
  const store = await import("./evaluationStore");
  store.setUna("12345/00042/2026");
  await store.charger(fetchFactice(3));
  expect(store.lireEtat().donnees?.vehicules).toHaveLength(3);
  expect(store.lireEtat().chargement).toBe(false);
  expect(store.lireEtat().erreur).toBeNull();
});

test("une erreur de chargement est affichee sans perdre l'UNA saisi", async () => {
  const store = await import("./evaluationStore");
  const impl = (async () => ({ ok: true, json: async () => ({ error: { message: "UNA introuvable" } }) })) as unknown as typeof fetch;
  store.setUna("12345/00099/2026");
  await store.charger(impl);
  expect(store.lireEtat().erreur).toBe("UNA introuvable");
  expect(store.lireEtat().una).toBe("12345/00099/2026");
  expect(store.lireEtat().chargement).toBe(false);
});

test("basculer coche puis decoche un vehicule", async () => {
  const store = await import("./evaluationStore");
  store.setUna("12345/00042/2026");
  await store.charger(fetchFactice(2));
  store.basculer(1);
  expect(store.lireEtat().selection).toEqual([1]);
  store.basculer(2);
  expect(store.lireEtat().selection).toEqual([1, 2]);
  store.basculer(1);
  expect(store.lireEtat().selection).toEqual([2]);
});

test("la selection est plafonnee a 20 vehicules", async () => {
  const store = await import("./evaluationStore");
  store.setUna("12345/00042/2026");
  await store.charger(fetchFactice(25));
  for (let id = 1; id <= 25; id++) store.basculer(id);
  expect(store.lireEtat().selection).toHaveLength(store.MAX_SELECTION);
  expect(store.lireEtat().erreur).toMatch(/20/);
});

test("changer d'UNA vide la selection precedente", async () => {
  const store = await import("./evaluationStore");
  store.setUna("12345/00042/2026");
  await store.charger(fetchFactice(2));
  store.basculer(1);
  store.setUna("12345/00043/2026");
  expect(store.lireEtat().selection).toEqual([]);
  expect(store.lireEtat().donnees).toBeNull();
});

test("l'UNA est retrouve apres un rechargement de page", async () => {
  const store = await import("./evaluationStore");
  store.setUna("12345/00042/2026");
  vi.resetModules();
  const recharge = await import("./evaluationStore");
  expect(recharge.lireEtat().una).toBe("12345/00042/2026");
  expect(recharge.lireEtat().chargement).toBe(false);
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `npm test -- src/features/evaluation/evaluationStore.test.ts`
Expected: FAIL — `Failed to resolve import "./evaluationStore"`.

- [ ] **Step 3 : Écrire le store**

Créer `src/features/evaluation/evaluationStore.ts` :

```ts
// État de l'écran d'évaluation, hors React : il survit aux changements de vue,
// comme les autres features. Seul l'UNA est persisté — les objets se rechargent,
// et une sélection restaurée sans ses objets n'aurait aucun sens.

import { createPersistedStore } from "../../lib/createPersistedStore";
import { chargerUna, type ChargementUna } from "./evaluationApi";

/** Limite imposée par la boucle du workflow d'évaluation (max 20 itérations). */
export const MAX_SELECTION = 20;

export type EvaluationState = {
  una: string;
  chargement: boolean;
  erreur: string | null;
  donnees: ChargementUna | null;
  selection: number[];
};

const store = createPersistedStore<EvaluationState>(
  { una: "", chargement: false, erreur: null, donnees: null, selection: [] },
  {
    key: "evaluation:una",
    keys: ["una"],
    read: (raw) => ({ una: raw }),
    write: (s) => s.una || null,
  }
);

export function setUna(una: string) {
  // Changer d'UNA invalide tout ce qui en découlait.
  store.set({ una, donnees: null, selection: [], erreur: null });
}

export async function charger(fetchImpl: typeof fetch = fetch) {
  const una = store.get().una.trim();
  if (!una || store.get().chargement) return;
  store.set({ chargement: true, erreur: null, donnees: null, selection: [] });
  try {
    const donnees = await chargerUna(una, fetchImpl);
    store.set({ donnees, chargement: false });
  } catch (e) {
    store.set({ erreur: (e as Error).message, chargement: false });
  }
}

export function basculer(objetId: number) {
  const { selection } = store.get();
  if (selection.includes(objetId)) {
    store.set({ selection: selection.filter((id) => id !== objetId), erreur: null });
    return;
  }
  if (selection.length >= MAX_SELECTION) {
    // Le workflow ne traite que MAX_SELECTION véhicules par exécution : mieux vaut
    // le refuser ici que laisser la boucle tronquer sans le dire.
    store.set({ erreur: `Sélection limitée à ${MAX_SELECTION} véhicules par évaluation.` });
    return;
  }
  store.set({ selection: [...selection, objetId], erreur: null });
}

export function viderSelection() {
  store.set({ selection: [], erreur: null });
}

export function clear() {
  store.set({ una: "", chargement: false, erreur: null, donnees: null, selection: [] });
}

export const useEvaluation = store.use;
export const lireEtat = store.get;
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `npm test -- src/features/evaluation/evaluationStore.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5 : Commit**

```bash
git add src/features/evaluation/evaluationStore.ts src/features/evaluation/evaluationStore.test.ts
git commit -m "feat(evaluation): store de l'ecran, selection plafonnee a 20"
```

---

### Task 6 : Liste des objets avec sélection

**Files:**
- Create: `src/features/evaluation/ObjetsSelection.tsx`
- Test: `src/features/evaluation/ObjetsSelection.test.tsx`

**Interfaces:**
- Consumes: `ObjetEvaluable`, `champ` (Task 4).
- Produces: `<ObjetsSelection vehicules={ObjetEvaluable[]} nonEligibles={number} selection={number[]} onBasculer={(id: number) => void} />`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `src/features/evaluation/ObjetsSelection.test.tsx` :

```tsx
import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ObjetsSelection from "./ObjetsSelection";
import type { ObjetEvaluable } from "./evaluationApi";
import type { ApiObjet } from "../saisies/perquisitionApi";

const vehicule = (id: number, marque: string, modele: string): ObjetEvaluable => ({
  perquisitionId: 10,
  adresse: "3 rue des Acacias",
  objet: {
    id,
    categorie: "TRANSPORT",
    sous_type: "VEHICULE_TERRESTRE",
    numero_scelle: `SC-${id}`,
    champs: [
      { cle: "marque", libelle: "Marque", valeur: marque, source: "deduit", obligatoire: false },
      { cle: "modele", libelle: "Modèle", valeur: modele, source: "deduit", obligatoire: false },
      { cle: "date_mec", libelle: "Date 1ʳᵉ mise en circulation", valeur: "12/03/2016", source: "deduit", obligatoire: true },
      { cle: "kilometrage", libelle: "Kilométrage", valeur: "120000", source: "a_completer", obligatoire: true },
    ],
    identifiants: [],
  } as ApiObjet,
});

test("affiche chaque vehicule avec ses elements de cote", () => {
  render(
    <ObjetsSelection vehicules={[vehicule(1, "VOLKSWAGEN", "Scirocco")]} nonEligibles={0} selection={[]} onBasculer={() => {}} />
  );
  expect(screen.getByText(/VOLKSWAGEN/)).toBeTruthy();
  expect(screen.getByText(/Scirocco/)).toBeTruthy();
  expect(screen.getByText(/120000/)).toBeTruthy();
  expect(screen.getByText(/3 rue des Acacias/)).toBeTruthy();
});

test("cocher une case remonte l'identifiant de l'objet", () => {
  const onBasculer = vi.fn();
  render(
    <ObjetsSelection vehicules={[vehicule(7, "RENAULT", "Clio")]} nonEligibles={0} selection={[]} onBasculer={onBasculer} />
  );
  screen.getByRole("checkbox").click();
  expect(onBasculer).toHaveBeenCalledWith(7);
});

test("les vehicules selectionnes sont coches", () => {
  render(
    <ObjetsSelection vehicules={[vehicule(1, "RENAULT", "Clio"), vehicule(2, "PEUGEOT", "208")]} nonEligibles={0} selection={[2]} onBasculer={() => {}} />
  );
  const cases = screen.getAllByRole("checkbox") as HTMLInputElement[];
  expect(cases[0].checked).toBe(false);
  expect(cases[1].checked).toBe(true);
});

test("le nombre d'objets hors perimetre est annonce", () => {
  render(<ObjetsSelection vehicules={[vehicule(1, "RENAULT", "Clio")]} nonEligibles={4} selection={[]} onBasculer={() => {}} />);
  expect(screen.getByText(/4 autres objets/)).toBeTruthy();
});

test("aucun objet hors perimetre : pas de mention", () => {
  render(<ObjetsSelection vehicules={[vehicule(1, "RENAULT", "Clio")]} nonEligibles={0} selection={[]} onBasculer={() => {}} />);
  expect(screen.queryByText(/autres objets/)).toBeNull();
});

test("aucun vehicule : message explicite plutot qu'une liste vide", () => {
  render(<ObjetsSelection vehicules={[]} nonEligibles={3} selection={[]} onBasculer={() => {}} />);
  expect(screen.getByText(/Aucun véhicule terrestre/)).toBeTruthy();
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `npm test -- src/features/evaluation/ObjetsSelection.test.tsx`
Expected: FAIL — `Failed to resolve import "./ObjetsSelection"`.

- [ ] **Step 3 : Écrire le composant**

Créer `src/features/evaluation/ObjetsSelection.tsx` :

```tsx
import { champ, type ObjetEvaluable } from "./evaluationApi";

// Liste des véhicules d'une procédure, à cocher pour évaluation. Composant pur :
// la sélection et son plafond sont gérés par le store.

const ligne: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "10px 12px",
  borderBottom: "1px solid var(--c--globals--colors--gray-200, #e5e5e5)",
};

const titre: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: 0 };
const detail: React.CSSProperties = { fontSize: 13, color: "#5b5b6b", margin: "2px 0 0" };

// Assemble les fragments non vides : un champ absent ne laisse pas de séparateur.
function joindre(...parts: (string | false)[]): string {
  return parts.filter(Boolean).join(" — ");
}

export default function ObjetsSelection({
  vehicules,
  nonEligibles,
  selection,
  onBasculer,
}: {
  vehicules: ObjetEvaluable[];
  nonEligibles: number;
  selection: number[];
  onBasculer: (objetId: number) => void;
}) {
  if (!vehicules.length) {
    return (
      <div style={{ padding: "12px", fontSize: 14, color: "#5b5b6b" }}>
        <p style={{ margin: 0 }}>Aucun véhicule terrestre dans cette procédure.</p>
        {nonEligibles > 0 && (
          <p style={{ margin: "4px 0 0" }}>
            {nonEligibles} autres objets saisis ne sont pas encore évaluables.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      {vehicules.map(({ objet, adresse }) => {
        const marque = champ(objet, "marque");
        const modele = champ(objet, "modele");
        const mec = champ(objet, "date_mec");
        const km = champ(objet, "kilometrage");
        const coche = selection.includes(objet.id);
        return (
          <label key={objet.id} style={ligne}>
            <input
              type="checkbox"
              checked={coche}
              onChange={() => onBasculer(objet.id)}
              aria-label={`Évaluer ${joindre(marque, modele) || `objet ${objet.id}`}`}
            />
            <span>
              <p style={titre}>{joindre(marque, modele) || `Objet ${objet.id}`}</p>
              <p style={detail}>
                {joindre(
                  mec && `1ʳᵉ mise en circulation ${mec}`,
                  km && `${km} km`,
                  objet.numero_scelle && `scellé ${objet.numero_scelle}`
                )}
              </p>
              <p style={detail}>{adresse}</p>
            </span>
          </label>
        );
      })}
      {nonEligibles > 0 && (
        <p style={{ ...detail, padding: "10px 12px", margin: 0 }}>
          {nonEligibles} autres objets saisis ne sont pas encore évaluables.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `npm test -- src/features/evaluation/ObjetsSelection.test.tsx`
Expected: PASS — 6 tests.

- [ ] **Step 5 : Commit**

```bash
git add src/features/evaluation/ObjetsSelection.tsx src/features/evaluation/ObjetsSelection.test.tsx
git commit -m "feat(evaluation): liste des vehicules avec selection"
```

---

### Task 7 : Écran « Évaluation des avoirs »

**Files:**
- Create: `src/features/evaluation/EvaluationApp.tsx`
- Modify: `src/App.tsx` (route et entrée de menu)
- Test: `src/features/evaluation/EvaluationApp.test.tsx`

**Interfaces:**
- Consumes: store (Task 5), `ObjetsSelection` (Task 6).
- Produces: écran monté sur la route `evaluation`.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `src/features/evaluation/EvaluationApp.test.tsx` :

```tsx
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import EvaluationApp from "./EvaluationApp";
import { clear, setUna, charger } from "./evaluationStore";
import type { ApiObjet } from "../saisies/perquisitionApi";

const objet = (id: number): ApiObjet => ({
  id,
  categorie: "TRANSPORT",
  sous_type: "VEHICULE_TERRESTRE",
  champs: [
    { cle: "marque", libelle: "Marque", valeur: "RENAULT", source: "deduit", obligatoire: false },
    { cle: "modele", libelle: "Modèle", valeur: "Clio", source: "deduit", obligatoire: false },
  ],
  identifiants: [],
});

function fetchFactice(nbVehicules: number, nbAutres = 0) {
  const objets = [
    ...Array.from({ length: nbVehicules }, (_, i) => objet(i + 1)),
    ...Array.from({ length: nbAutres }, (_, i) => ({ ...objet(100 + i), categorie: "ARME", sous_type: null })),
  ];
  return (async (url: string) => {
    if (url.startsWith("/api/perquisitions"))
      return { ok: true, json: async () => ({ data: [{ id: 10, adresse: "3 rue A", created_at: "2026-01-01", nb_objets: objets.length }] }) };
    return { ok: true, json: async () => ({ data: { id: 10, objets } }) };
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("l'ecran s'ouvre sur la saisie d'un UNA, sans liste", () => {
  render(<EvaluationApp />);
  expect(screen.getByLabelText(/Numéro de procédure/)).toBeTruthy();
  expect(screen.queryByRole("checkbox")).toBeNull();
});

test("apres chargement, les vehicules sont listes et le compte des autres objets affiche", async () => {
  render(<EvaluationApp />);
  act(() => setUna("12345/00042/2026"));
  await act(async () => { await charger(fetchFactice(2, 3)); });
  await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2));
  expect(screen.getByText(/3 autres objets/)).toBeTruthy();
});

test("le bouton d'evaluation reste inactif tant qu'aucun vehicule n'est coche", async () => {
  render(<EvaluationApp />);
  act(() => setUna("12345/00042/2026"));
  await act(async () => { await charger(fetchFactice(2)); });
  const bouton = screen.getByRole("button", { name: /Évaluer la sélection/ }) as HTMLButtonElement;
  expect(bouton.disabled).toBe(true);
  await act(async () => { screen.getAllByRole("checkbox")[0].click(); });
  expect((screen.getByRole("button", { name: /Évaluer la sélection/ }) as HTMLButtonElement).disabled).toBe(false);
});

test("une erreur de chargement s'affiche sans vider le champ UNA", async () => {
  const impl = (async () => ({ ok: true, json: async () => ({ error: { message: "UNA introuvable" } }) })) as unknown as typeof fetch;
  render(<EvaluationApp />);
  act(() => setUna("12345/00099/2026"));
  await act(async () => { await charger(impl); });
  expect(screen.getByRole("alert").textContent).toMatch(/UNA introuvable/);
  expect((screen.getByLabelText(/Numéro de procédure/) as HTMLInputElement).value).toBe("12345/00099/2026");
});
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `npm test -- src/features/evaluation/EvaluationApp.test.tsx`
Expected: FAIL — `Failed to resolve import "./EvaluationApp"`.

- [ ] **Step 3 : Écrire l'écran**

Créer `src/features/evaluation/EvaluationApp.tsx` :

```tsx
import { Button } from "@gouvfr-lasuite/cunningham-react";
import ObjetsSelection from "./ObjetsSelection";
import {
  useEvaluation,
  setUna,
  charger,
  basculer,
  MAX_SELECTION,
} from "./evaluationStore";

// Écran d'évaluation des avoirs : on part d'une procédure (UNA), on liste les
// objets saisis lors de ses perquisitions, et on choisit les véhicules à faire
// évaluer. Le lancement de l'évaluation elle-même arrive au lot suivant.

export default function EvaluationApp() {
  const { una, chargement, erreur, donnees, selection } = useEvaluation();

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "2rem", boxSizing: "border-box" }}>
      <h1 style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 24, color: "#000091", marginTop: 0, marginBottom: 6 }}>
        <span className="material-icons" aria-hidden style={{ color: "#000091" }}>
          savings
        </span>
        Évaluation des avoirs
      </h1>
      <p style={{ margin: "0 0 0.75rem", color: "#5b5b6b", lineHeight: 1.5 }}>
        Indiquez une procédure : l'outil réunit les objets saisis lors de ses perquisitions et
        vous laisse choisir ceux à faire évaluer.
      </p>
      <p style={{ margin: "0 0 2rem", color: "#5b5b6b", lineHeight: 1.5 }}>
        Seuls les véhicules terrestres sont évaluables pour l'instant. L'estimation est
        indicative, issue d'une source de démonstration : elle ne vaut pas expertise.
      </p>

      <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>Procédure</h2>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <input
          type="text"
          value={una}
          aria-label="Numéro de procédure (unité/numéro/année)"
          placeholder="12345/00042/2026"
          onChange={(e) => setUna(e.target.value)}
          style={{ flex: 1, fontSize: 14, padding: "8px 10px" }}
        />
        <Button
          type="button"
          onClick={() => charger()}
          disabled={!una.trim() || chargement}
          icon={
            <span className="material-icons" aria-hidden>
              search
            </span>
          }
        >
          {chargement ? "Chargement…" : "Rechercher"}
        </Button>
      </div>

      {erreur && (
        <p role="alert" style={{ color: "#e1000f", margin: "0 0 16px" }}>
          {erreur}
        </p>
      )}

      {donnees && (
        <>
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
              {donnees.perquisitions.length} perquisition(s) — {donnees.vehicules.length} véhicule(s) évaluable(s)
            </div>
            <ObjetsSelection
              vehicules={donnees.vehicules}
              nonEligibles={donnees.nonEligibles}
              selection={selection}
              onBasculer={basculer}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Le lancement de l'évaluation arrive au lot 3 (workflow IAka et
                route BFF). Le bouton est présent et correctement activé/désactivé
                dès maintenant : c'est lui que le lot 3 branchera, sans toucher au
                reste de l'écran. */}
            <Button
              type="button"
              onClick={() => {}}
              disabled={selection.length === 0}
              icon={
                <span className="material-icons" aria-hidden>
                  auto_awesome
                </span>
              }
            >
              Évaluer la sélection
            </Button>
            <span style={{ fontSize: 13, color: "#5b5b6b" }}>
              {selection.length} sélectionné(s) sur {MAX_SELECTION} au maximum
            </span>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4 : Brancher la route et le menu**

Dans `src/App.tsx` :

1. Ajouter l'import à côté des autres imports de features :

```tsx
import EvaluationApp from "./features/evaluation/EvaluationApp";
```

2. Ajouter la route à côté de `<Route path="pv-transport" … />` :

```tsx
<Route path="evaluation" element={<EvaluationApp />} />
```

3. Ajouter l'entrée de menu après celle de `pv-transport` (ligne 60) :

```tsx
{ to: "evaluation", label: "Évaluation des avoirs", icon: "savings" },
```

- [ ] **Step 5 : Lancer les tests et la compilation**

Run: `npm test -- src/features/evaluation/EvaluationApp.test.tsx`
Expected: PASS — 4 tests.

Run: `npm test`
Expected: PASS sur l'ensemble.

Run: `npx tsc -b`
Expected: aucune sortie.

Run: `node --test server/cote-api/*.test.js`
Expected: PASS — 27 tests.

- [ ] **Step 6 : Commit**

```bash
git add src/features/evaluation/EvaluationApp.tsx src/features/evaluation/EvaluationApp.test.tsx src/App.tsx
git commit -m "feat(evaluation): ecran de selection des vehicules a evaluer"
```

---

## Vérification manuelle finale

- [ ] `npm run dev`, ouvrir « Évaluation des avoirs ».
- [ ] Saisir un UNA existant portant une perquisition avec véhicule : les véhicules apparaissent, les autres objets sont comptés.
- [ ] Saisir un UNA inconnu : message d'erreur, champ conservé, pas d'écran vide.
- [ ] Cocher plus de 20 véhicules si le jeu de données le permet : le refus est affiché.
- [ ] Lancer `cote-api` en local et vérifier une cote :

```bash
API_TOKEN=demo node server/cote-api/server.js &
curl -s -H "Authorization: Bearer demo" \
  "http://localhost:8082/cote?marque=VOLKSWAGEN&modele=Scirocco&annee=2016&km=120000" | head -40
```

Attendu : `correspondance: "exacte"`, une fourchette, trois à cinq annonces, l'avertissement de simulation.

## Suite (lot 3, hors de ce plan)

L'app IAka `evaluation-avoirs`, ses deux boucles et ses tools MCP, la route BFF `/api/evaluation`, le PV d'évaluation et la relecture de la base. Ce lot suppose que l'app soit créée et ses tools attachés — configuration hors dépôt.
