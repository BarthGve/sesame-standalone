# Workflows IAka « Ariane » — câblage & prompts

Détail des workflows IAka du cas d'usage Ariane (analyse de procédure judiciaire, cf.
`docs/superpowers/specs/2026-07-19-ariane-design.md`). Architecture **map-reduce** : deux
apps, découpées par **étage** (pas par vue) — `ariane-extraction` traite **une pièce**,
`ariane-consolidation` traite **l'agrégat de toutes les pièces**. Le BFF
(`server/ariane.mjs`) orchestre le fan-out MAP, construit l'agrégat, appelle le REDUCE puis
assemble mécaniquement le contrat final consommé par le front (`src/features/ariane/`).

| Workflow | app_id (env) | Rôle | Nœud DÉBUT |
|---|---|---|---|
| **MAP — extraction** | `IAKA_ARIANE_EXTRACTION_APP_ID` | 1 pièce (PDF) → extraction compacte (schéma §4.1) | fichier joint, `require_prompt=false` |
| **REDUCE — consolidation** | `IAKA_ARIANE_CONSOLIDATION_APP_ID` | agrégat JSON → parties/relations/synthèse (schéma §4.3) | prompt texte, `require_prompt=true` |

Le BFF lance **N exécutions** du MAP en parallèle (concurrence bornée, ~4-6), une par
pièce, **puis** une seule exécution du REDUCE sur l'agrégat. Ce n'est pas un nœud boucle
IAka : l'orchestration du fan-out est côté BFF (même principe que RENS qui lance ses
workflows côté BFF).

---

## Workflow 1 — MAP : `ariane-extraction`

### Structure
```
DÉBUT (fichier joint PDF, require_prompt=false)
  ▼
[Nœud agent — modèle grand contexte]   → lit la pièce, extrait acte/personnes/faits/relations
  ▼
FIN (JSON — schéma §4.1)
```

### Config du nœud DÉBUT
| Champ | Valeur |
|---|---|
| Entrée | **fichier joint** (le PDF de la pièce, une pièce par exécution) |
| `require_prompt` | `false` — aucun texte de prompt attendu ; le BFF n'envoie que le fichier |
| Modèle | grand contexte (pièces pouvant être longues : PV multi-pages) |

Le BFF appelle ce workflow **une fois par pièce** (map-unit = 1 PDF ; découpage par
tranches de pages pour un PDF géant = extension §8.2, hors phase 1). Il **stampe lui-même
la `cote`** (nom de fichier / en-tête / index) après réception du JSON — l'agent peut
laisser `cote` vide ou l'omettre, il n'a pas besoin de la connaître.

### Schéma de sortie — §4.1 (MAP, par pièce)

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

### PROMPT (à copier tel quel dans le nœud agent)

```
Tu es un analyste de procédure judiciaire. Tu reçois UNE pièce d'une procédure (PV
d'audition, constatation, perquisition, réquisition, soit-transmis…) sous forme de fichier
PDF joint. Tu renvoies UNIQUEMENT un objet JSON décrivant cette pièce, conforme EXACTEMENT
au schéma ci-dessous. Jamais de langage naturel hors JSON.

FAIS :
- Identifie l'ACTE : type, date, libellé court, le rédacteur (enquêteur) et les
  personnes concernées (entendu, perquisitionné, requis…).
- Liste les PERSONNES citées. Résous la coréférence DANS CETTE PIÈCE (« M. Dupont »,
  « le suspect », « Jean DUPONT » = une seule personne, ref unique m1). Pour chacune,
  donne le plus d'ATTRIBUTS D'IDENTITÉ possibles (nom complet, naissance, qualité,
  adresse, aliases) — ils serviront à recouper les pièces entre elles lors de l'étape
  de consolidation.
- Liste les FAITS (événements réels rapportés) avec leur date et les personnes liées
  (refs).
- Liste les RELATIONS explicitement DÉCRITES dans le texte (famille, complicité,
  victime/auteur, connaissance) — PAS les liens procéduraux (qui entend qui, qui
  perquisitionne qui : ceux-là sont dérivés automatiquement en aval, ne les inclus pas
  dans relations_lues).

NE FAIS PAS :
- N'invente rien : tout ce qui n'est pas dans le texte de la pièce reste hors du JSON.
- N'ajoute aucun champ hors du schéma.
- Ne laisse jamais une `ref` de personne non définie dans `personnes` être utilisée
  ailleurs (redacteur_ref, concernes_refs, personnes_refs, de/vers) sans que cette
  personne figure dans le tableau `personnes`.

RÈGLES DE FORMAT :
- Dates au format `AAAA-MM-JJ`. Si seule l'année ou le mois est connu, utilise la date la
  plus précise disponible dans le texte (ne complète pas arbitrairement) et adapte
  `precision` du fait en conséquence.
- `role_apparent` ∈ {mis_en_cause, victime, temoin, enqueteur, requis, magistrat, autre}.
- `type` (acte) ∈ {audition, constatation, perquisition, requisition, gav, transport,
  soit_transmis, autre}.
- `type` (relation lue) ∈ {famille, complice, connait, victime_de, autre} — EXACTEMENT
  ces valeurs, pas de variante (`complice` et non « complicité », `connait` et non
  « connaissance »). Nuance libre dans `libelle`, jamais dans `type`.
- `precision` (fait) ∈ {annee, mois, jour, heure} — le niveau de précision réellement
  disponible dans le texte pour la date du fait.
- Le champ `cote` de la pièce est renseigné automatiquement en aval : laisse-le vide
  (`""`) ou omets-le, tu n'as pas besoin de le connaître ni de le deviner.
- Les `ref` sont des identifiants COURTS et LOCAUX à cette pièce (m1, m2, m3…) — pas
  besoin d'unicité globale, la consolidation entre pièces se fait dans une étape
  ultérieure séparée.

SCHÉMA ATTENDU (exemple, respecte exactement cette forme et ces noms de champs) :
{
  "cote": "D12",
  "acte": {
    "type": "audition",
    "date": "2026-03-06",
    "libelle": "Audition de la victime",
    "redacteur_ref": "m5",
    "concernes_refs": ["m1"]
  },
  "personnes": [
    {
      "ref": "m1",
      "nom": "Jean DUPONT",
      "aliases": ["M. Dupont", "le suspect"],
      "role_apparent": "mis_en_cause",
      "naissance": "1990-05-02",
      "qualite": "sans profession",
      "adresse": "12 rue X, Melun"
    },
    { "ref": "m5", "nom": "ADC MARTIN", "role_apparent": "enqueteur" }
  ],
  "faits": [
    { "date": "2026-03-04", "precision": "jour",
      "libelle": "Effraction du dépôt rue X", "personnes_refs": ["m1"] }
  ],
  "relations_lues": [
    { "de": "m1", "vers": "m3", "type": "famille", "libelle": "frère de" }
  ]
}

Si la pièce ne comporte pas d'acte identifiable, de personnes, de faits ou de relations,
renvoie les tableaux correspondants vides (`[]`) plutôt que d'inventer — ne renvoie
JAMAIS un JSON incomplet ou invalide.

SORTIE — STRICT :
- Ta réponse finale est EXCLUSIVEMENT l'objet JSON ci-dessus rempli pour cette pièce.
- RIEN avant, RIEN après : pas de phrase d'introduction, pas d'explication, pas de balise
  de bloc de code (pas de ```), pas de trace d'outil, un seul objet JSON et rien d'autre.
```

---

## Workflow 2 — REDUCE : `ariane-consolidation`

### Structure
```
DÉBUT (prompt texte = agrégat JSON, require_prompt=true)
  ▼
[Nœud agent]   → clustering global des personnes, relations lues consolidées, synthèse
  ▼
FIN (JSON — schéma §4.3)
```

### Config du nœud DÉBUT
| Champ | Valeur |
|---|---|
| Entrée | **prompt texte** |
| `require_prompt` | `true` — le BFF envoie l'agrégat JSON **sérialisé en texte** dans le champ `prompt` |
| Modèle | contexte suffisant pour l'agrégat complet (toutes les personnes/relations de la procédure) |

L'agrégat envoyé en `prompt` est construit par le BFF à partir de **toutes** les sorties
MAP : il préfixe chaque `ref` locale par la cote de la pièce → **gref global**
(`D12:m1`), et ne transmet que ce qui demande du jugement (`personnes`,
`relations_lues`) — `faits` et `acte` de chaque pièce restent côté BFF, reconstruits
mécaniquement (cf. Intégration BFF ci-dessous).

Format de l'agrégat (§4.2, entrée du REDUCE) :
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

### Schéma de sortie — §4.3 (REDUCE, jugement seul)

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

Notes de schéma :
- `membres` = tous les grefs fusionnés dans cette partie ; le BFF en dérive la table
  `gref → party_id` pour l'assemblage final.
- `role` ∈ {mis_en_cause, victime, temoin, enqueteur, requis, magistrat, autre}.
- `type` (relation) ∈ {famille, complice, connait, victime_de, autre} — le REDUCE ne
  produit QUE des relations lues, jamais `entendu_par`/`requis_par` (procédurales,
  dérivées par le BFF, cf. plus bas).

### PROMPT (à copier tel quel dans le nœud agent)

```
Tu reçois, dans ce message, un AGRÉGAT au format JSON issu d'extractions faites sur
TOUTES les pièces d'une procédure judiciaire : une liste de PERSONNES (chacune avec un
identifiant global « gref » = cote:ref et ses attributs d'identité) et une liste de
RELATIONS LUES entre ces personnes. Tu renvoies UNIQUEMENT un objet JSON, conforme
EXACTEMENT au schéma ci-dessous.

FORME DE L'AGRÉGAT REÇU (pour référence) :
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

FAIS :
1. CLUSTERING : regroupe les grefs qui désignent la MÊME personne physique (même nom
   complet, date de naissance, qualité/adresse concordantes ; recoupe aussi les
   aliases). Chaque personne consolidée devient une PARTIE avec un identifiant court
   `p1`, `p2`, … et un tableau `membres` listant TOUS les grefs qui lui appartiennent.
   EN CAS DE DOUTE D'HOMONYMIE, NE FUSIONNE PAS — préfère deux parties distinctes à une
   fusion erronée (mieux vaut un doublon visible qu'une confusion entre deux personnes
   réelles).
2. Pour chaque partie, détermine : le rôle canonique (si la personne apparaît sous
   plusieurs rôles apparents dans différentes pièces, choisis le plus incriminant/
   spécifique — ex. mis_en_cause l'emporte sur témoin), le nom retenu, les aliases
   consolidés (union dédupliquée), la qualité, et `premiere_cote` (la cote de la pièce
   où cette personne apparaît en premier, par ordre chronologique des pièces si
   déductible, sinon la première du tableau).
3. RELATIONS : reprends CHAQUE relation lue de l'agrégat, traduis son `de` en `source`
   et son `vers` en `cible` en utilisant les ids de parties (`p1`, `p2`…) que tu viens
   de construire (pas les grefs). DÉDUPLIQUE les relations identiques (même source,
   cible, type) en agrégeant leurs `cotes` dans un même tableau. N'AJOUTE AUCUN lien
   procédural (qui a entendu qui, qui a perquisitionné qui, qui a requis qui) — ces
   liens sont dérivés automatiquement par le système en aval à partir des actes, tu ne
   dois produire QUE les relations explicitement décrites dans les textes sources
   (famille, complicité, connaissance, victime/auteur).
4. Rédige une SYNTHÈSE narrative de l'enquête en markdown (quelques paragraphes),
   fondée uniquement sur les personnes et relations de l'agrégat. Renseigne
   `affaire.nature`, `affaire.reference`, `affaire.service` si déductibles des données
   reçues, sinon omets le champ correspondant (ne l'invente pas).

INTERDIT — IMPORTANT :
- NE PRODUIS PAS d'« événements » (faits) ni d'« actes » : ce ne sont pas des sorties de
  ce workflow, le système les assemble séparément à partir d'une autre source. N'inclus
  ces notions ni dans le JSON de sortie, ni sous d'autres noms de champs.
- NE PRODUIS PAS d'identifiants croisés autres que ceux du schéma ci-dessous (`p1`,
  `p2`… pour les parties, `source`/`cible` référençant ces mêmes ids pour les
  relations). N'invente pas d'ids d'événements ou d'actes.
- Fonde-toi UNIQUEMENT sur l'agrégat fourni dans ce message. N'invente aucune personne,
  relation ou fait qui n'y figure pas.

RÈGLES DE FORMAT :
- `role` ∈ {mis_en_cause, victime, temoin, enqueteur, requis, magistrat, autre}.
- `type` (relation) ∈ {famille, complice, connait, victime_de, autre}.
- Dates éventuelles au format `AAAA-MM-JJ`.

SCHÉMA ATTENDU (exemple, respecte exactement cette forme et ces noms de champs) :
{
  "affaire": { "reference": "PV 2026/00457", "nature": "Vol avec effraction en réunion",
               "service": "BR Melun" },
  "synthese": "…markdown narratif…",
  "parties": [
    { "id": "p1", "nom": "Jean DUPONT", "role": "mis_en_cause",
      "aliases": ["M. Dupont","le suspect"], "qualite": "né le 1990-05-02, demeurant Melun",
      "premiere_cote": "D12",
      "membres": ["D12:m1", "D247:m4", "D3:m2"] }
  ],
  "relations": [
    { "source": "p1", "cible": "p3", "type": "famille", "libelle": "frère de", "cotes": ["D12"] }
  ]
}

Si l'agrégat ne contient aucune personne ou aucune relation, renvoie des tableaux vides
(`[]`) plutôt que d'inventer, et une synthèse qui le mentionne explicitement — ne renvoie
JAMAIS un JSON incomplet ou invalide.

SORTIE — STRICT :
- Ta réponse finale est EXCLUSIVEMENT l'objet JSON ci-dessus rempli.
- RIEN avant, RIEN après : pas de phrase d'introduction, pas d'explication, pas de balise
  de bloc de code (pas de ```), pas de trace d'outil, un seul objet JSON et rien d'autre.
```

---

## Intégration BFF

`server/ariane.mjs` (à créer, cf. spec §6 et §9) orchestre le pipeline complet — c'est lui
qui fait tenir l'échelle, pas les workflows IAka pris isolément :

1. **Normalisation** en « map-units » (1 unité = 1 pièce) : petit PDF → gardé tel quel ;
   PDF géant → split par tranches de pages (extension, hors phase 1). La `cote` est
   dérivée du nom de fichier / en-tête de pièce / index — **stampée par le BFF**, jamais
   demandée à l'agent MAP.
2. **MAP** : fan-out avec concurrence bornée (~4-6), une exécution de `ariane-extraction`
   par pièce (fichier joint), `extractJson` de chaque sortie. Une pièce en échec est
   *best-effort* : notée manquante, le pipeline continue (même principe que le zoom
   RENS).
3. **Agrégation** : le BFF préfixe chaque `ref` par la cote (`D12:m1` = gref global) et
   construit l'agrégat §4.2 (`personnes` + `relations_lues` seulement — `faits` et
   `acte` de chaque pièce restent côté BFF).
4. **REDUCE** : une seule exécution de `ariane-consolidation`, agrégat sérialisé dans le
   `prompt`.
5. **Assemblage mécanique du contrat final** (§4.4, **déterministe, côté code, jamais par
   le LLM**) :
   - `parties` ← `REDUCE.parties` (sans `membres`) ; table `gref → party_id` dérivée de
     `REDUCE.parties[].membres`.
   - `evenements` ← tous les `MAP.faits` de toutes les pièces ; `personnes_refs`
     traduites (ref locale → gref → party_id) ; `cote_source` = cote de la pièce ; ids
     `e1…`.
   - `actes` ← chaque `MAP.acte` ; `redacteur`/`concernes` traduits (refs → grefs →
     party_id) ; ids `a1…`.
   - `relations` ← `REDUCE.relations` (lues) **+** relations procédurales dérivées : pour
     chaque acte, `concerné —entendu_par→ redacteur` (audition) ou `requis_par`
     (réquisition) ; fusion/dédup par (source, cible, type), agrégation des `cotes`.
   - `affaire.periode` = min/max des dates actes+événements ; `nb_cotes` = nombre de
     cotes distinctes.
   - **Validation des invariants** (filet de sécurité) : tout id référencé existe, les
     enums sont connues, sinon erreur `ARIANE_INVALIDE`.

C'est le principe **« LLM = jugement, code = comptabilité »** (spec §2.2) : le REDUCE
n'émet JAMAIS les ids croisés du contrat final (`evenements`, `actes`, relations
procédurales) — sur un agrégat de centaines de documents, lui faire produire ces
références garantirait des ids orphelins et un rejet en validation. Le LLM ne fait que
le clustering des personnes, les relations lues et la synthèse ; tout le reste du
contrat est reconstruit mécaniquement par le BFF depuis la sortie MAP + la carte de
clustering du REDUCE.

Variables d'environnement (`.env` du proxy) :
```
IAKA_ARIANE_EXTRACTION_APP_ID=<app MAP>
IAKA_ARIANE_CONSOLIDATION_APP_ID=<app REDUCE>
```

---

## Points d'attention (retours d'expérience)

- **Sortie STRICT, un seul objet JSON, rien d'autre** (leçon `docs/iaka-agent-prompt.md`) :
  les deux prompts imposent explicitement « RIEN avant, RIEN après : pas de phrase, pas
  d'explication, pas de balise de bloc de code, pas de trace d'outil ». Une sortie non
  conforme (texte autour, fence ```` ```json ````, JSON invalide) est rejetée par le BFF
  (`extractJson`) → erreur `ARIANE_UPSTREAM`.
- **Ne pas halluciner hors du texte source** : les deux prompts imposent de fonder la
  sortie exclusivement sur ce qui est fourni (la pièce pour le MAP, l'agrégat pour le
  REDUCE) — argument central de la démo (« IA agentique et sourcée », chaque item cite sa
  cote d'origine, pas de synthèse hallucinée).
- **MAP — nœud DÉBUT fichier joint, pas de `prompt`** : `require_prompt=false`, le BFF
  n'envoie que le PDF de la pièce. La `cote` est stampée par le BFF après coup ; l'agent
  n'a ni besoin de la connaître ni de la deviner.
- **REDUCE — nœud DÉBUT prompt texte** : `require_prompt=true`, le BFF sérialise
  l'agrégat JSON (§4.2) et l'envoie comme `prompt`. Le prompt système interdit
  explicitement au LLM de produire des événements, des actes, ou tout id croisé hors du
  schéma §4.3 — c'est le BFF qui assemble ces éléments de façon déterministe (cf.
  Intégration BFF ci-dessus). Un manquement à cette règle (LLM qui invente des ids
  d'événements/actes) casserait l'assemblage mécanique en aval.
- **Enum des relations lues — constater sur pièce réelle** : sans enum explicite, le MAP
  produit spontanément des variantes françaises (`complicité`, `connaissance`) hors de
  `TYPES_REL` (`server/ariane.mjs:26`), ce qui casse `validateContract` en
  `ARIANE_INVALIDE` si le REDUCE les laisse passer. D'où l'enum imposée dans les RÈGLES DE
  FORMAT du prompt MAP. Les champs *supplémentaires* hors schéma (`nationalite`,
  `profession`…) sont sans risque en revanche : `buildAggregate` filtre en liste blanche.
- **`require_prompt` mal réglé = 422, pas 401** : si le nœud DÉBUT du REDUCE reste en
  `require_prompt=false`, IAka répond
  `422 {"detail":"… champs non acceptés par ce workflow : prompt"}` et le job échoue en
  `ARIANE_UPSTREAM` *après* un MAP réussi (`progress: done=N/N`). Symptôme trompeur : la
  progression semble complète. Un 422 signifie que l'auth et le tenant sont bons — chercher
  la config du nœud DÉBUT, pas le JWT.
- **Homonymie — ne pas fusionner en cas de doute** : le prompt REDUCE le dit
  explicitement (« EN CAS DE DOUTE D'HOMONYMIE, NE FUSIONNE PAS ») ; préférer deux
  parties distinctes à une fusion erronée. Coréférence imparfaite acceptée comme dette
  connue (spec §8.2).
- **Nouveau plafond = le REDUCE** (spec §8.2) : contrairement au MAP (borné par pièce),
  l'agrégat compact envoyé au REDUCE grandit avec le nombre de pièces. Sur *vraiment*
  des centaines de documents, il peut à son tour déborder le contexte du modèle. Repli
  documenté (hors périmètre « procédure modeste », mais nommé) : **reduce hiérarchique**
  — consolider par lots, puis reduce-of-reduces.
- **Chemin XML embarqué — V2, pas la phase 1** (spec §8.1) : les pièces au format
  procédure pénale numérique (PDF A3 avec XML encapsulé par pièce) permettront à terme un
  MAP hybride — un parseur XML déterministe remplace le LLM quand la pièce jointe est
  présente (état civil des parties, type d'acte, date, rédacteur lus exactement, sans
  coût LLM ni hallucination possible), avec repli sur le MAP LLM (chemin décrit ici,
  « V1 ») si l'XML est absent. Le schéma §4.1 est la **couture** entre les deux chemins :
  ils alimentent le même schéma, à l'identique, donc le REDUCE et l'assemblage BFF ne
  changent pas. Bloquant pour V2 : caler le parseur sur le schéma XML réel nécessite un
  échantillon anonymisé (PDF A3 + XML) à fournir — non disponible à ce stade.
    