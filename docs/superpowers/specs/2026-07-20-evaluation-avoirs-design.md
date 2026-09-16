# Évaluation des avoirs saisis — estimation de valeur et PV d'évaluation

Date : 2026-07-20
Portée : nouvelle page `src/features/evaluation/`, nouveau microservice `server/cote-api/`,
route BFF `/api/evaluation`, nouvelle app IAka `evaluation-avoirs`.

## Contexte

Une perquisition produit des objets saisis, déjà décrits dans l'application (photo →
identification → fiche → base `rgp-api`). Rien n'en donne la **valeur**. Or la valeur commande
trois choses : le montant des avoirs criminels d'une procédure (AGRASC), le champ « valeur
estimée » d'une pièce, et l'arbitrage sur ce qu'il vaut la peine de saisir et de garder sous
scellé.

Aujourd'hui, l'estimation est renseignée à la main, ou pas du tout.

Ce cas d'usage démontre une capacité que les autres pages n'exercent pas : un agent qui
**lit une procédure, interroge une API métier plusieurs fois, corrige sa requête quand elle
échoue, écrit son résultat en base et rédige la pièce correspondante**.

## Ce qui existe déjà

À ne pas réécrire :

| Élément | Où |
|---|---|
| Type `EstimationPrix` (bas/moyen/haut, devise, hypothèses, sources, confiance, avertissement) | `src/features/saisies/types.ts` |
| Colonnes `estim_prix_bas/moyen/haut` et table `objet_estimation_source` | `server/rgp-api/migrations/001_perquisitions.sql` |
| Normalisation d'une estimation venue d'IAka (`normEstimation`) | `src/features/saisies/identify.ts` |
| `GET /api/perquisitions?una=…`, `GET /api/perquisition?id=` | proxifiées par `server/proxy.mjs` |
| `POST /api/perquisition/objet/update` (estimation comprise) | proxifiée |
| **Serveur MCP dérivé de `rgp-api/openapi.json`**, tools `getProcedure`, `listProcedures`… | `docs/iaka-rgp-workflow.md` |

Ce dernier point est structurant : un serveur MCP se dérive **automatiquement** d'un
`openapi.json`. `cote-api` en obtiendra un de la même façon, sans code supplémentaire.

## Parcours

```
Front : saisie d'un UNA (unité/numéro/année)
  → GET /api/perquisitions?una=…    perquisitions du dossier
  → GET /api/perquisition?id=…      objets de chacune
  → l'utilisateur coche les véhicules terrestres à évaluer
  → POST /api/evaluation { una, objetIds }        (job asynchrone)

Agent IAka :
  1. relit la procédure et les objets par MCP RGP
  2. normalise les champs de chaque véhicule (marque, modèle, année, kilométrage)
  3. interroge la cote par MCP cote-api, une fois par véhicule, avec reprise si repli
  4. écrit les estimations en base par MCP RGP (objet/update)
  5. rédige le PV d'évaluation et renvoie le tout

Front : affiche les fourchettes, le total, le PV éditable et exportable
  → puis RELIT la procédure pour montrer ce qui est réellement en base
```

Le front ne transmet que l'UNA et les identifiants cochés. C'est l'agent qui va chercher les
données : lui servir les champs sur un plateau reviendrait à ne lui laisser qu'un rôle de
rédacteur.

## Décisions

- **Page dédiée** `src/features/evaluation/`, entrée de menu « Évaluation des avoirs ».
  L'évaluation se fait après coup, parfois par quelqu'un d'autre, souvent sur plusieurs
  perquisitions d'un même dossier : ce n'est pas le geste de terrain de `/perquisition`.
- **L'agent porte le pipeline** : lecture, normalisation, cote, écriture, rédaction. Le BFF ne
  fait que déclencher et normaliser la réponse ; il n'appelle ni la cote ni `rgp-api`.
- **La sélection reste humaine.** L'agent ne décide pas quels objets valoriser : un enquêteur
  coche. Ce premier incrément ne rend sélectionnables que les véhicules terrestres ; les
  autres objets sont listés, non cochables, avec leur nombre affiché.
- **Vingt véhicules au maximum par évaluation**, plafond imposé par la boucle du workflow.
  Le front l'affiche et empêche d'aller au-delà, plutôt que de laisser la boucle tronquer.
- **Un seul PV** pour toute la sélection, avec un détail par véhicule et un total.
- **Le texte du PV n'est pas persisté.** Les fourchettes le sont (colonnes existantes).
  Ajouter une colonne pour le texte imposerait une migration sur une base qu'une autre équipe
  utilise actuellement, pour un besoin non encore éprouvé.

## Bornes de l'écriture par l'agent

Un agent qui écrit dans la base d'une procédure judiciaire demande des garde-fous. Le projet
a déjà tranché ce débat pour RGP — branche *write* limitée aux tools MCP-API, jamais de SQL
libre. On applique la même discipline, resserrée :

- l'agent n'écrit **que** les champs d'estimation, **que** pour les `objetIds` reçus ;
- aucun tool d'écriture autre que `objet/update` ne lui est attaché ;
- il ne crée ni ne supprime rien ;
- **le front relit la procédure après l'exécution** et affiche ce qui est réellement en base.
  Ce que l'agent prétend avoir écrit et ce qui y est effectivement peuvent différer : c'est la
  base qui fait foi, pas le compte rendu de l'agent.

## Composant 1 — `server/cote-api/` (fausse API LaCentrale)

Microservice Node autonome, calqué sur `server/rgp-api/` : serveur HTTP natif, Bearer,
`openapi.json`, `Dockerfile`, tests `node --test`. Exposé en HTTPS, et **son `openapi.json`
sert à dériver le serveur MCP** qu'utilisera l'agent — il doit donc décrire précisément
paramètres et réponses, c'est ce texte qui pilotera l'agent.

```
GET /cote?marque=VOLKSWAGEN&modele=Scirocco&annee=2016&km=120000&carrosserie=COUPE
Authorization: Bearer <COTE_API_TOKEN>

200 {
  "reference": { "marque": "VOLKSWAGEN", "modele": "Scirocco", "annee": 2016, "km": 120000 },
  "fourchette": { "bas": 8500, "moyen": 10200, "haut": 11800, "devise": "EUR" },
  "annonces": [
    { "titre": "Volkswagen Scirocco 2.0 TSI", "annee": 2016, "km": 118000,
      "prix": 10490, "lieu": "Angers (49)", "url": "https://cote.local/annonce/8f2c" }
  ],
  "correspondance": "exacte",          // exacte | approchante | repli_segment
  "methode": "Prix catalogue décoté par âge et kilométrage, ajusté sur les annonces comparables.",
  "avertissement": "Données de démonstration — source simulée, non contractuelle."
}
```

Exigences :

- **Déterministe** : mêmes paramètres → même réponse, au centime. Une démo dont les chiffres
  bougent à chaque appel est ingérable, et aucun test ne peut l'attraper.
- **Modèle de prix assumé et documenté** : prix catalogue par modèle, décote annuelle,
  correction kilométrique, dispersion pour engendrer 3 à 5 annonces comparables. Le champ
  `methode` l'énonce dans la réponse.
- **`correspondance` dit à l'agent ce qu'il a obtenu** : `exacte`, `approchante` (modèle voisin
  retenu) ou `repli_segment` (aucun modèle reconnu, prix de segment). C'est ce champ qui lui
  permet de décider s'il retente avec une autre écriture du modèle. Sans lui, il ne peut pas
  savoir que sa requête est tombée à côté.
- **Modèle inconnu → jamais d'erreur** : repli de segment, `correspondance: "repli_segment"`,
  confiance abaissée. Une évaluation portant sur cinq véhicules ne doit pas échouer parce que
  le sixième est exotique.
- **Marque, modèle ou année manquants** → `400`. Sans eux il n'y a rien à coter.
- **`avertissement` traverse toute la chaîne** jusqu'au PV et à l'écran. Ces chiffres finiront
  dans une procédure : leur origine simulée ne doit pas se perdre en route.

## Composant 2 — App IAka `evaluation-avoirs`

**Entrée** : `{ una, objetIds }` en `prompt` (JSON).

**Tools attachés** : lecture RGP (`getPerquisition`, `listPerquisitions` ou équivalents du
serveur MCP existant), cote (`getCote`, dérivé de `cote-api/openapi.json`), et le seul tool
d'écriture `updateObjet`.

**Déroulé attendu de l'agent** :

1. retrouver les perquisitions de l'UNA, puis les objets correspondant aux `objetIds` ;
2. pour chacun, reconstituer marque, modèle, année de première mise en circulation,
   kilométrage, carrosserie — les champs viennent d'une identification par photo, ils sont
   irréguliers (« VW » pour Volkswagen, modèle approximatif, kilométrage parfois absent) ;
3. interroger la cote ; si `correspondance` vaut `repli_segment`, retenter une fois avec une
   écriture normalisée du modèle, puis consigner ce qui a été tenté dans les hypothèses ;
4. écrire l'estimation de chaque véhicule par `updateObjet` ;
5. rédiger le PV et renvoyer le résultat.

**Structure en nœuds** — deux boucles imbriquées, le nœud « Créer une boucle » d'IAka :

```
DÉBUT (prompt = { una, objetIds })
  ▼
[Agent lecture]        MCP RGP : perquisitions de l'UNA, objets des objetIds
  ▼
┌─ BOUCLE VÉHICULE ────────────────────── max 20 · au max : continuer ─┐
│   [Agent normalisation]   marque / modèle / année / km exploitables  │
│     ▼                                                                │
│   ┌─ BOUCLE REPRISE ─────────────── max 3 · au max : continuer ─┐    │
│   │   [Agent cote]  MCP cote-api : getCote                      │    │
│   │   sortie si correspondance ∈ { exacte, approchante }        │    │
│   │   sinon : reformuler marque/modèle et retenter              │    │
│   └─────────────────────────────────────────────────────────────┘    │
│     ▼                                                                │
│   [Agent écriture]  MCP RGP : updateObjet (champs d'estimation)      │
│   sortie de boucle quand tous les objetIds sont traités              │
└──────────────────────────────────────────────────────────────────────┘
  ▼
[Agent rédaction]      PV d'évaluation + total
  ▼
FIN (JSON)
```

Deux réglages qui ne sont pas des détails :

- **Boucle de reprise, « continuer quand même » au maximum.** Après trois tentatives, on
  conserve le repli de segment avec une confiance basse et l'hypothèse consignée. Échouer
  serait pire : un modèle exotique ne doit pas faire tomber l'évaluation des autres.
- **Boucle véhicule, plafond de 20.** « Continuer quand même » tronquerait **en silence** :
  25 véhicules cochés, 5 jamais évalués, et rien ne le dirait. Deux garde-fous obligatoires :
  le front **plafonne la sélection à 20** en l'affichant, et tout objet reçu mais non traité
  doit ressortir en `non_evalues` avec la raison. La troncature doit être visible, jamais
  déduite d'une absence.

La condition de sortie d'une boucle est **jugée par un modèle**, pas par un compteur : c'est
adapté à « la correspondance est-elle satisfaisante ? », moins à « ai-je traité les douze
véhicules ? ». D'où le second garde-fou ci-dessus — le front compare les `objetIds` envoyés à
ce qui revient, et signale l'écart.

**Sortie** (JSON) :

```jsonc
{
  "evaluations": [
    { "objet_id": 42,
      "estimation_prix": {
        "prix_bas": 8500, "prix_moyen": 10200, "prix_haut": 11800, "devise": "EUR",
        "hypotheses": ["Kilométrage déclaré 120 000 km", "Modèle normalisé « Scirocco »"],
        "sources": [{ "site": "LaCentrale", "url": "…", "prix": 10490 }],
        "confiance": 0.7,
        "avertissement": "Source simulée, non contractuelle."
      },
      "enregistre": true }
  ],
  "non_evalues": [{ "objet_id": 57, "raison": "Année de mise en circulation absente" }],
  "total": { "bas": 8500, "moyen": 10200, "haut": 11800 },
  "pv_evaluation": "## Objets évalués\n…\n## Méthode\n…\n## Détail par véhicule\n…\n## Total\n…\n## Réserves\n…"
}
```

`non_evalues` est aussi important que `evaluations` : un véhicule écarté faute de données doit
apparaître à l'écran et dans le PV, pas disparaître silencieusement.

Le PV rappelle qu'il s'agit d'une estimation indicative, issue d'une source simulée, sans
valeur d'expertise.

## Composant 3 — BFF `/api/evaluation`

Job asynchrone, sur le modèle de `/api/synthese` : `POST` renvoie `202 { jobId }`, le front
interroge `/api/job/status`. Le corps porte `{ una, objetIds }`. Le BFF transmet au workflow et
normalise la réponse ; il **n'appelle ni la cote ni `rgp-api`**.

Codes d'erreur : `EVALUATION_TIMEOUT` (504), `EVALUATION_UPSTREAM` (502),
`EVALUATION_INVALIDE` (502), `OBJETS_REQUIS` (400).

## Composant 4 — Page `src/features/evaluation/`

| Fichier | Rôle |
|---|---|
| `EvaluationApp.tsx` | écran : UNA, listes, sélection, résultats |
| `evaluationStore.ts` | état hors React, persisté (UNA, sélection, résultat) |
| `evaluationApi.ts` | `/api/perquisitions`, `/api/perquisition`, `/api/evaluation` |
| `ObjetsSelection.tsx` | objets d'une perquisition, cases à cocher, non éligibles grisés |
| `ResultatEvaluation.tsx` | encart par véhicule, total, objets non évalués |

Le PV s'affiche dans l'éditeur existant, copiable et exportable en PDF. Cela suppose de
déplacer `PropositionEditor` et `pdfDoc` de `features/synthese/` vers `components/` — même
mouvement que `BarreProgression`. Refactoring assumé : sans lui, on duplique un éditeur et un
convertisseur PDF.

Deux vérifications que le front fait **sans faire confiance à l'agent** :

- **le total est recalculé** depuis les évaluations ; un écart avec le total annoncé est
  signalé. C'est ce chiffre qui remonte à l'AGRASC ;
- **la procédure est relue** après l'exécution : l'écran montre les estimations réellement
  enregistrées, pas celles que l'agent dit avoir écrites.

## Gestion des erreurs

Aucune erreur d'évaluation ne doit faire perdre le travail en cours.

| Situation | Comportement |
|---|---|
| UNA introuvable (404) | message précis, champ conservé |
| UNA sans perquisition | « Aucune perquisition dans cette procédure. » |
| Aucun véhicule terrestre | liste affichée, sélection vide, compte des objets non éligibles |
| Cote indisponible pour un véhicule | les autres sont évalués ; le véhicule figure en `non_evalues` |
| Écriture en base refusée pour un objet | `enregistre: false` ; la relecture le confirme et l'écran le signale |
| Workflow en échec ou expiré | message, sélection conservée |
| Écart entre total annoncé et total recalculé | le total recalculé prime, l'écart est affiché |
| Objet envoyé mais absent du résultat | signalé à l'écran : la boucle a tronqué ou l'agent l'a oublié |

## Tests

**`server/cote-api/` (`node --test`)**
- même requête → réponse identique (déterminisme) ;
- véhicule plus ancien ou plus kilométré → cote inférieure à son homologue récent ;
- modèle inconnu → `correspondance: "repli_segment"`, confiance abaissée, pas d'erreur ;
- modèle voisin reconnu → `correspondance: "approchante"` ;
- marque, modèle ou année manquants → `400` ; sans jeton → `401` ;
- `openapi.json` décrit bien les paramètres et le champ `correspondance` (c'est lui qui pilote
  l'agent).

**BFF (`node --test`)**
- `/api/evaluation` sans `objetIds` → `OBJETS_REQUIS` ;
- réponse workflow non conforme → `EVALUATION_INVALIDE` ;
- job asynchrone : `202` puis statut `done` portant le résultat.

**Front (Vitest)**
- UNA saisi → perquisitions et objets listés ; UNA inconnu → message, pas d'écran vide ;
- seuls les véhicules terrestres sont cochables, le compte des autres est affiché ;
- bouton d'évaluation inactif tant que la sélection est vide ;
- sélection plafonnée à 20 véhicules, avec le motif affiché ;
- objet envoyé mais absent du résultat → signalé, jamais passé sous silence ;
- résultat affiché par véhicule, objets non évalués visibles, total recalculé ;
- total annoncé faux → l'écart est signalé et le total recalculé s'affiche ;
- relecture après exécution : l'écran montre l'état de la base ;
- échec du workflow → message, sélection conservée.

## Découpage

Trois lots, chacun livrable et vérifiable seul :

1. **`cote-api`** — service, modèle de prix, `openapi.json`, tests. Aucune dépendance au reste.
2. **La page** — UNA, listes, sélection, relecture. Sans IAka : bouton d'évaluation inactif.
3. **Le pipeline** — app IAka et ses tools, route BFF, PV, vérifications du front.

Le lot 3 suppose que l'app IAka soit créée et ses tools MCP attachés — opération de
configuration, hors du dépôt.

## Hors périmètre

- Catégories autres que véhicule terrestre (armes, multimédia, monnaie…).
- Persistance du texte du PV.
- Vraie API LaCentrale ou leboncoin : le contrat de `cote-api` est conçu pour qu'un
  remplacement ultérieur ne touche ni l'agent ni le front.
- Toute automatisation d'une décision de saisie ou de vente : l'outil informe, il ne décide pas.
