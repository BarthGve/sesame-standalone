# Design — Cas d'usage « Ariane » (analyse de procédure judiciaire)

> Date : 2026-07-19 · Statut : design validé, à implémenter.
> Démonstrateur IAka / SÉSAME. Nouvelle page = nouveau cas d'usage = nouveau workflow IAka.

## 1. But

À partir d'une **procédure judiciaire** — qui peut aller d'**une liasse en 1 PDF**
jusqu'à **des centaines de PDF** (un par acte) —, donner à l'utilisateur une
**compréhension rapide** via cinq livrables dérivés d'une analyse agentique :

1. **Synthèse** rapide de l'enquête (narratif).
2. **Parties prenantes** — entendus, témoins, enquêteurs, requis, magistrats, autres,
   avec leur rôle.
3. **Ligne de temps des faits** — chronologie des événements réels.
4. **Ligne de temps des actes** — chronologie procédurale (auditions, perquiz,
   réquisitions, GAV…).
5. **Réseau relationnel** — graphe des interactions entre protagonistes.

Argument de démo central : IA **agentique et sourcée** — chaque item cite sa **cote**
d'origine, pas de synthèse hallucinée.

> **Réalité des entrées** : les pièces arrivent en plusieurs PDF ; certaines sont des
> **PDF A3 avec un XML encapsulé** (procédure pénale numérique LRPGN/PPN — le PDF porte
> en pièce jointe embarquée un XML déjà structuré, **par pièce**). Exploiter ce XML =
> **V2** (§8.1) : il court-circuite le LLM pour la structure. **V1 lit le texte** de
> toutes les pièces via le MAP LLM. Le schéma d'extraction §4.1 est la **couture** : les
> deux chemins (texte LLM / XML déterministe) l'alimentent à l'identique.

## 2. Contrainte d'échelle → architecture map-reduce

Une procédure réelle = potentiellement **des centaines de PDF / milliers de pages**.
Aucun contexte n'avale ça, et la qualité s'effondre bien avant. Le **passage unique
est impossible**. Deux étages obligatoires :

- **MAP** (fan-out, 1 exécution par pièce) : extrait de chaque pièce une **extraction
  compacte** (mentions de personnes avec attributs d'identité, faits, méta-acte) —
  **pas le texte brut**.
- **REDUCE** (1 exécution) : opère sur l'**agrégat compact** (pas les milliers de
  pages) → résout la coréférence **globalement, une fois** → parties canoniques,
  relations lues, synthèse.

Insight qui fait tenir l'échelle : le REDUCE ne voit que des extractions compactes, il
tient donc en un seul contexte même pour des centaines de docs.

### 2.1 Deux apps IAka, découpage par ÉTAGE (≠ par vue)

On provisionne **2 apps** : `ariane-extraction` (MAP) et `ariane-consolidation`
(REDUCE). Ce n'est PAS le découpage « une app par vue » écarté auparavant : celui-là
faisait résoudre les entités N fois → divergence. Ici le découpage est **temporel
(extract puis consolidate)**, et la coréférence globale se fait **une seule fois**, au
REDUCE. Cohérence préservée. C'est la philo RENS (« deux étages, c'est ce qui tient
l'échelle »).

### 2.2 LLM = jugement, code = comptabilité (décision structurante)

Le REDUCE **n'émet PAS** les ids croisés du contrat final. Si le LLM devait produire
`evenements`/`actes`/`relations` en référençant correctement les `parties[]` qu'il
vient de construire, sur un agrégat de centaines de docs, il générerait des **ids
orphelins** → rejet total par la validation. Mode d'échec garanti sur gros volumes.

Donc (principe déjà appliqué à la carte : *« jamais de sérialisation ligne par ligne
par le LLM »*) :

| Fait par | Quoi |
|---|---|
| **LLM (REDUCE)** | clustering `gref → partie canonique`, `parties[]`, relations **lues** (famille/complice/connaît/victime_de), `synthese`, `affaire.nature/reference/service` |
| **Code (BFF)** | assemble le contrat final : réécrit `faits → evenements`, `méta-acte → actes`, **dérive** `entendu_par`/`requis_par` des métadonnées d'acte, remplace tous les grefs par les party ids, calcule `periode`/`nb_cotes` |

Zéro id orphelin par construction. Plus sûr **et** plus simple : tout le contrat sauf
`synthese` et le typage des relations lues est **reconstruit mécaniquement** depuis la
sortie MAP + la carte de clustering.

## 3. Pipeline complet

```
Entrée : N PDF (1 liasse géante … OU centaines de petits actes)
  │
  ▼ BFF — NORMALISATION en « map-units » (1 unité = 1 pièce)
     - petit PDF (cas principal) → gardé tel quel
     - PDF géant (cas extrême) → split par tranches de pages (extension, §8)
     - cote = nom de fichier / en-tête de pièce / index
  │
  ▼ MAP — fan-out concurrence bornée · app `ariane-extraction` · 1 exéc / pièce
     texte → extraction locale compacte (coréférence LOCALE déjà faite)
  │
  ▼ BFF — AGRÉGATION : grefs globaux = `cote:ref` ; ne pousse au REDUCE que
     `personnes` + `relations_lues` (le reste reste en BFF pour l'assemblage)
  │
  ▼ REDUCE — 1 exéc · app `ariane-consolidation`
     coréférence GLOBALE (clustering), parties[], relations lues, synthèse
  │
  ▼ BFF — ASSEMBLAGE mécanique du contrat final (evenements, actes, relations
     procédurales, party ids, periode/nb_cotes) + validation invariants
  │
  ▼ contrat JSON final (les 5 vues)
```

Orchestration du fan-out = **BFF** (comme RENS lance ses workflows), concurrence
bornée. IAka ne garantit pas de nœud boucle sur N pièces.

## 4. Schémas

### 4.1 MAP — sortie de `ariane-extraction` (par pièce)

**Coréférence LOCALE déjà résolue** dans la pièce. Chaque personne porte ses
**attributs d'identité** en champs de premier ordre — c'est ce qui permet au REDUCE de
fusionner « le suspect » (D3) et « Jean DUPONT » (D247). Mentions maigres = mauvaises
fusions.

```jsonc
{
  "cote": "D12",
  "acte": {
    "type": "audition",          // audition|constatation|perquisition|requisition|gav|transport|soit_transmis|autre
    "date": "2026-03-06",
    "libelle": "Audition de la victime",
    "redacteur_ref": "m5",       // ref d'une personne de rôle enqueteur (ou null)
    "concernes_refs": ["m1"]     // personnes visées par l'acte (entendu, perquisitionné, requis…)
  },
  "personnes": [
    {
      "ref": "m1",
      "nom": "Jean DUPONT",
      "aliases": ["M. Dupont", "le suspect"],
      "role_apparent": "mis_en_cause",
      "naissance": "1990-05-02", // attributs d'identité pour la coréférence
      "qualite": "sans profession",
      "adresse": "12 rue X, Melun"
    },
    { "ref": "m5", "nom": "ADC MARTIN", "role_apparent": "enqueteur" }
  ],
  "faits": [
    { "date": "2026-03-04", "precision": "jour",
      "libelle": "Effraction du dépôt rue X", "personnes_refs": ["m1"] }
  ],
  "relations_lues": [           // liens explicitement DÉCRITS dans le texte (non procéduraux)
    { "de": "m1", "vers": "m3", "type": "famille", "libelle": "frère de" }
  ]
}
```

### 4.2 Agrégat — entrée du REDUCE (construit par le BFF)

Le BFF préfixe chaque `ref` par la cote → **gref global** (`D12:m1`). Il ne transmet
au REDUCE que ce qui demande du **jugement** :

```jsonc
{
  "personnes": [
    { "gref": "D12:m1", "cote": "D12", "nom": "Jean DUPONT",
      "aliases": ["M. Dupont","le suspect"], "role_apparent": "mis_en_cause",
      "naissance": "1990-05-02", "qualite": "sans profession", "adresse": "12 rue X, Melun" }
  ],
  "relations_lues": [
    { "de": "D12:m1", "vers": "D12:m3", "type": "famille", "libelle": "frère de", "cote": "D12" }
  ]
}
```

(`faits` et `acte` de chaque pièce **restent côté BFF** — reconstruits mécaniquement.)

### 4.3 REDUCE — sortie de `ariane-consolidation` (jugement seul)

```jsonc
{
  "affaire": { "reference": "PV 2026/00457", "nature": "Vol avec effraction en réunion",
               "service": "BR Melun" },
  "synthese": "…markdown narratif…",
  "parties": [
    { "id": "p1", "nom": "Jean DUPONT", "role": "mis_en_cause",
      "aliases": ["M. Dupont","le suspect"], "qualite": "né le 1990-05-02, demeurant Melun",
      "premiere_cote": "D12",
      "membres": ["D12:m1", "D247:m4", "D3:m2"] }   // ← la carte de clustering (grefs de cette personne)
  ],
  "relations": [   // relations LUES seulement, dédupliquées, avec party ids canoniques
    { "source": "p1", "cible": "p3", "type": "famille", "libelle": "frère de", "cotes": ["D12"] }
  ]
}
```

- `membres` = tous les grefs fusionnés dans cette partie → le BFF en dérive la table
  `gref → party_id`.
- Réconciliation de rôle : une personne témoin puis mise en cause → le REDUCE tranche
  le rôle canonique (priorité au plus incriminant/spécifique). Documenté dans le prompt.

### 4.4 Contrat FINAL — assemblé par le BFF (inchangé, = ce que consomme le front)

```jsonc
{
  "affaire": { "reference","nature","service","periode":{debut,fin},"nb_cotes" },
  "synthese": "…markdown…",
  "parties":   [{ id, nom, role, aliases[], qualite, premiere_cote }],
  "evenements":[{ id, date, precision, libelle, cote_source, parties[] }],   // ← BFF depuis MAP.faits
  "actes":     [{ id, date, type, cote, libelle, redacteur, concernes[] }],  // ← BFF depuis MAP.acte
  "relations": [{ source, cible, type, libelle, cotes[] }]                   // ← REDUCE (lues) + BFF (procédurales)
}
// role ∈ mis_en_cause|victime|temoin|enqueteur|requis|magistrat|autre
// type(acte) ∈ audition|constatation|perquisition|requisition|gav|transport|soit_transmis|autre
// type(relation) ∈ famille|complice|connait|victime_de|entendu_par|requis_par|autre
// precision ∈ annee|mois|jour|heure
```

**Assemblage BFF (déterministe) :**
- `parties` ← REDUCE.parties (sans `membres`).
- `gref→party_id` ← REDUCE.parties[].membres.
- `evenements` ← toutes les `MAP.faits` ; `personnes_refs` (locaux → gref → party_id),
  `cote_source` = cote de la pièce ; ids `e1…`.
- `actes` ← chaque `MAP.acte` ; `redacteur`/`concernes` (refs → grefs → party_id) ;
  ids `a1…`.
- `relations` ← REDUCE.relations (lues) **+** dérivées procédurales : pour chaque acte,
  `concerné —entendu_par→ redacteur` (audition) ou `requis_par` (réquisition) ;
  fusion/dédup par (source,cible,type), agrégation des `cotes`.
- `affaire.periode` = min/max des dates actes+événements ; `nb_cotes` = cotes distinctes.
- **Validation invariants** (filet de sécurité, désormais garanti par construction) :
  tout id référencé existe, enums connues → sinon `ARIANE_INVALIDE`.

### 4.5 Dérivation des 5 vues (front, aucun retraitement)

| Vue | Source | Rendu |
|---|---|---|
| Synthèse | `synthese` | markdown |
| Parties | `parties` groupées par `role` | cartes par rôle, couleur = rôle |
| Timeline faits | `evenements` triés par `date` | frise, item → `cote_source` |
| Timeline actes | `actes` triés par `date` | frise, item → `cote` |
| Réseau | nœuds = `parties` (couleur = rôle), arêtes = `relations` (label = type) | **cytoscape**, clic arête → `cotes` |

## 5. Prompts système (brouillons — finalisés dans `docs/iaka-ariane-workflow.md`)

### 5.1 App `ariane-extraction` (MAP, une pièce)
```
Tu es un analyste de procédure judiciaire. Tu reçois UNE pièce d'une procédure (PV
d'audition, constatation, perquisition, réquisition, soit-transmis…). Tu renvoies
UNIQUEMENT un objet JSON décrivant cette pièce. Jamais de langage naturel hors JSON.

FAIS :
- Identifie l'ACTE : type, date, libellé court, le rédacteur (enquêteur) et les
  personnes concernées (entendu, perquisitionné, requis…).
- Liste les PERSONNES citées. Résous la coréférence DANS CETTE PIÈCE (« M. Dupont »,
  « le suspect », « Jean DUPONT » = une seule personne, ref unique m1). Pour chacune,
  donne le plus d'ATTRIBUTS D'IDENTITÉ possibles (nom complet, naissance, qualité,
  adresse, aliases) — ils serviront à recouper les pièces entre elles.
- Liste les FAITS (événements réels) avec leur date et les personnes liées (refs).
- Liste les RELATIONS explicitement DÉCRITES dans le texte (famille, complicité,
  victime/auteur, connaissance) — PAS les liens procéduraux (qui entend qui).

RÈGLES : réponds par le seul JSON du schéma. N'invente rien : hors du texte = hors du
JSON. Dates AAAA-MM-JJ. Rôles ∈ {mis_en_cause,victime,temoin,enqueteur,requis,
magistrat,autre}. [schéma §4.1]
```

### 5.2 App `ariane-consolidation` (REDUCE, agrégat)
```
Tu reçois un AGRÉGAT d'extractions issues de toutes les pièces d'une procédure : une
liste de PERSONNES (chacune avec un identifiant global « gref » = cote:ref et ses
attributs) et une liste de RELATIONS LUES. Tu renvoies UNIQUEMENT un objet JSON.

FAIS :
1. CLUSTERING : regroupe les grefs qui désignent la MÊME personne (même nom complet,
   naissance, qualité/adresse concordantes ; recoupe les aliases). Chaque personne =
   une partie avec un id p1, p2… et la liste "membres" de ses grefs. En cas de doute
   d'homonymie, NE fusionne PAS.
2. Pour chaque partie : rôle canonique (si plusieurs rôles apparents, prends le plus
   incriminant/spécifique), nom, aliases consolidés, qualité, premiere_cote.
3. RELATIONS : reprends les relations lues, traduis de→source / vers→cible en party
   ids, DÉDUPLIQUE, agrège les cotes. N'ajoute PAS de liens procéduraux (le système
   les dérive).
4. SYNTHÈSE narrative de l'enquête (markdown) + affaire.nature/reference/service si
   déductibles.

RÈGLES : réponds par le seul JSON du schéma §4.3. Ne produis PAS d'événements ni
d'actes (le système les assemble). Fonde-toi UNIQUEMENT sur l'agrégat.
```

## 6. Intégration BFF & front

### BFF — `server/ariane.mjs` + routes
Analyse longue (dizaines d'exécutions) → **job asynchrone + polling** (feedback de
progression, qui vend la démo : « Extraction D12… 12/40 pièces »). Minimal : **map de
jobs en mémoire**, pas de file d'attente.

- `POST /api/ariane` (multipart, N fichiers) → crée un job, lance le pipeline en
  arrière-plan, renvoie `{ jobId }`.
- `GET /api/ariane/status?jobId=` → `{ status: 'map'|'reduce'|'assemble'|'done'|'error',
  progress: {done, total}, result? }`.
- Pipeline : normalisation → MAP (fan-out concurrence bornée ~4-6, app extraction, 1
  exéc/pièce, `extractJson` de chaque) → agrégation grefs → REDUCE (app consolidation)
  → assemblage mécanique §4.4 → validation.
- Erreurs : `ARIANE_UPSTREAM` / `ARIANE_TIMEOUT` / `ARIANE_INVALIDE`. Une pièce MAP qui
  échoue = *best-effort* (on la note manquante, on continue) — cf. RENS zoom.
- Tests `server/ariane.test.mjs` (node --test) : extraction MAP, construction grefs,
  **assemblage déterministe** (faits→evenements, actes, relations procédurales,
  periode/nb_cotes), validation invariants, best-effort pièce en échec.

### Env (`.env.example` + `cfg` de `server/proxy.mjs`)
```
IAKA_ARIANE_EXTRACTION_APP_ID=<app MAP>
IAKA_ARIANE_CONSOLIDATION_APP_ID=<app REDUCE>
```

### Fixture — `docs/ariane-exemple.json`
Une procédure jouet **conforme au contrat final §4.4** (~6-10 parties, ~10 événements,
~12 actes, ~8 relations, cohérente). Développe/démontre le front sans IAka + jeu de
test du contrat.

### Front — `src/features/ariane/`
- `arianeApi.ts` (upload + polling status, types du contrat), `arianeStore.ts`,
  `ArianeApp.tsx` (dropzone N PDF + barre de progression + onglets 5 vues).
- Vues : `SyntheseView`, `PartiesView`, `TimelineFaits`, `TimelineActes`,
  `ReseauView` (cytoscape).
- **Sélection de cote partagée** : clic item (fait/acte/arête) → surligne la cote.
- UI Cunningham / DSFR, **aucune emoji** (règle projet) — icônes Material / SVG.
- Mode démo : sans app IAka configurée, charge la fixture.

## 7. Périmètre — hors sujet (YAGNI)

- Pas d'OCR (hypothèse : PDF texte ; scan image → rien lu).
- Pas de persistance (analyse à la volée, job en mémoire).
- Pas de nœud boucle IAka : fan-out orchestré par le BFF.
- Pas d'ouverture réelle de la pièce à la cote en phase 1 (surlignage d'abord ;
  navigation intra-PDF = amélioration ultérieure).

## 8. Extensions & dette

### 8.1 Chemin XML embarqué (V2) — le vrai gisement

Les pièces au format **procédure pénale numérique** (PDF A3, XML encapsulé **par
pièce**) portent leur structure en clair. V2 rend le MAP **hybride** :

```
pièce PDF
  ├─ XML embarqué présent ? ──oui──▶ parseur XML déterministe → extraction §4.1
  │                                   (LLM optionnel : faits narratifs / relations lues)
  └─ non ────────────────────────▶ MAP LLM (chemin V1)
```

- BFF : nouvelle étape de normalisation = **extraction des pièces jointes embarquées**
  du PDF (`pdf-lib` liste/extrait les attachments) ; si XML → chemin déterministe.
- Gain : type d'acte, date, rédacteur, **état civil des parties** (nom, naissance,
  qualité, adresse) lus **exactement**, gratuitement — bien meilleure coréférence au
  REDUCE, coût LLM réduit. Le format A3 (mise en page) devient sans objet : on lit le
  XML, pas le rendu.
- **Bloquant V2** : caler le parseur sur le **schéma XML réel** → nécessite un
  **échantillon anonymisé** (PDF A3 + XML, ou XML extrait). À fournir en V2.
- Additif : le REDUCE et l'assemblage §4.4 **ne changent pas** (couture = schéma §4.1).

### 8.2 Dette / limites connues

- **Nouveau plafond = le REDUCE.** L'agrégat compact sur *vraiment* des centaines de
  docs peut à son tour déborder le contexte. Repli documenté = **reduce hiérarchique**
  (consolider par lots, puis reduce-of-reduces). Hors périmètre « procédure modeste »,
  mais nommé.
- **PDF géant** (1 fichier = milliers de pages) : normalisation par **split de pages**
  (lib `pdf-lib`) — **extension**, pas la phase 1. Le cas poussé par le besoin (centaines
  de petits PDF) est couvert sans split (1 pièce = 1 map-unit).
- **Coréférence imparfaite** : homonymes/attributs manquants → fusions ou dédoublements
  erronés. Le prompt REDUCE ne fusionne pas en cas de doute. Acceptable en démo.
- **Coût/latence** : N+1 exécutions IAka par procédure. Le job async + progression rend
  l'attente lisible.

## 9. Ordre d'implémentation (app IAka d'abord)

1. `docs/iaka-ariane-workflow.md` — doc des **2 workflows** (structure, config nœuds,
   **prompts finalisés** §5, schémas, assemblage BFF, notes) → base pour configurer les
   apps sur la plateforme IAka.
2. `docs/ariane-exemple.json` — fixture conforme au contrat final.
3. BFF : `server/ariane.mjs` (normalisation, MAP fan-out, agrégation, REDUCE,
   assemblage, validation) + `server/ariane.test.mjs` + routes `/api/ariane` &
   `/api/ariane/status` + env.
4. Front : `src/features/ariane/` (dropzone, progression, 5 vues cytoscape) + navigation.
```
