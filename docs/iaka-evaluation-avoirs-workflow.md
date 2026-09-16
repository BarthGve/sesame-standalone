# Workflow IAka « Évaluation des avoirs » — câblage & prompts

> **Évolution — affichage seul (démonstrateur).** L'évaluation **n'écrit plus rien en
> base** : l'estimation est affichée à titre indicatif pour l'information de l'enquêteur.
> Conséquences côté IAka : retirer le nœud `[Agent écriture]` (§ 4) et son tool
> `updateObjet` ; utiliser le prompt `[Agent rédaction]` (§ 5) révisé, qui ne référence
> plus `enregistre` et interdit au PV d'affirmer un enregistrement. Côté front, le calque
> « relecture » a été retiré (`construireResultat` ne lit plus `enregistre`). Le reste de
> ce document (schéma en nœuds, contrat de sortie, section MCP) décrit encore l'ancien
> pipeline avec écriture — toilettage à faire, non bloquant.

Détail du workflow IAka du cas d'usage *Évaluation des avoirs saisis* (page
`/evaluation`, front `src/features/evaluation/`, cf.
`docs/superpowers/specs/2026-07-20-evaluation-avoirs-design.md`). **Un seul workflow**,
déclenché une fois par demande d'évaluation : le BFF (`server/evaluationWorkflow.mjs`,
route `POST /api/evaluation` dans `server/proxy.mjs`) envoie l'UNA et les identifiants
d'objets cochés, attend le résultat et le normalise. C'est l'agent, pas le BFF, qui relit
la procédure, interroge la cote et écrit les estimations : « lecture, normalisation,
cote, écriture, rédaction » forme un seul pipeline porté par le workflow, avec deux
boucles imbriquées.

> **État du dépôt.** `server/evaluationWorkflow.mjs` (fonctions `runEvaluation` et
> `extraireEvaluation`) et la route BFF `POST /api/evaluation` (`server/proxy.mjs`) sont
> implémentés et revus : ce document a été relu contre ce code, pas contre le plan
> d'implémentation qui l'a précédé. Les sections [Contrat d'entrée](#contrat-dentrée),
> [Contrat de sortie](#contrat-de-sortie) et [Intégration BFF](#intégration-bff)
> décrivent le comportement réel du code, pas une intention. Reste, en revanche,
> entièrement à câbler côté IAka : les nœuds, les tools MCP et les prompts détaillés
> plus bas n'existent que dans ce document tant que la configuration n'a pas été faite
> dans le builder. **Un blocage sérieux, découvert en vérifiant
> `server/rgp-api/perquisition.js`, est signalé en premier point d'attention : à lire
> avant de configurer l'écriture.**

| Workflow | app_id (env) | Rôle | Nœud DÉBUT |
|---|---|---|---|
| **Évaluation des avoirs** | `IAKA_EVALUATION_APP_ID` | `{una, objetIds}` → estimations écrites en base + PV d'évaluation rédigé | prompt JSON, `require_prompt=true` |

Pas de map-reduce, pas de fan-out côté BFF (à la différence d'Ariane) : tout le pipeline —
boucle véhicule comprise — se déroule **à l'intérieur d'une seule exécution** du workflow,
via le nœud « Créer une boucle » d'IAka.

---

## Structure en nœuds

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

Reprise textuelle de `docs/superpowers/specs/2026-07-20-evaluation-avoirs-design.md`,
section « Structure en nœuds » — ce document ne fait qu'y ajouter les prompts et les
tools à attacher.

**Non documenté ailleurs dans le dépôt, à découvrir dans le builder IAka au moment de la
config** : la mécanique précise du nœud « Créer une boucle » (comment lier la collection
qui alimente l'itération à la sortie de l'`[Agent lecture]`, comment nommer la variable
d'itération dans les nœuds imbriqués, où se règle le sélecteur « au max : continuer
quand même » vs « échouer », comment la sortie de chaque itération se réagrège en tableau
pour l'`[Agent rédaction]`). Aucun des workflows déjà câblés (`docs/iaka-rgp-workflow.md`,
`docs/iaka-ariane-workflow.md`, `docs/iaka-analyse-audition-workflow.md`) n'utilise ce
nœud — Ariane fait son fan-out côté BFF précisément pour l'éviter. C'est le premier
workflow du projet à en dépendre.

## Config du nœud DÉBUT

| Champ | Valeur |
|---|---|
| Entrée | **prompt texte** (JSON sérialisé) |
| `require_prompt` | **`true`** — le BFF envoie toujours `{una, objetIds}`, jamais de fichier joint |
| `prompt` | `{"una": "15127/42/2026", "objetIds": [42, 57]}` — voir [Contrat d'entrée](#contrat-dentrée) |
| `langue` | `fr` |
| Modèle | grand contexte conseillé sur le nœud `[Agent lecture]` (une procédure peut porter plusieurs perquisitions et de nombreux objets) ; les autres nœuds peuvent rester sur un modèle standard |

---

## Tools MCP à attacher

Trois familles de tools, à répartir précisément sur les nœuds qui en ont besoin — pas un
agent unique avec tous les tools, pour que chaque nœud ne puisse faire que ce que son rôle
autorise.

### 1. Lecture RGP — nœud `[Agent lecture]`

Serveur MCP `MCP API_2395053d-dbcd-4993-be46-05e577c2b394`, déjà actif, dérivé de
`server/rgp-api/openapi.json` (cf. `docs/iaka-rgp-workflow.md`). Ce même `openapi.json`
déclare `listPerquisitions` (`GET /perquisitions`) et `getPerquisition`
(`GET /perquisition/{id}`) — les tools existent donc en théorie sur ce serveur MCP.

**À confirmer à la configuration :** `docs/iaka-rgp-workflow.md` ne donne les `tool_id`
que pour les tools *procédure* (`createProcedure`, `modifyProcedure`, `getProcedure`,
`listProcedures`, `searchCommunes`, `getHealth`) — aucun `tool_id` n'y est enregistré pour
`listPerquisitions` ou `getPerquisition`. Dans l'écran de config de l'app IAka, chercher
ces deux tools par leur nom (correspondant aux `operationId` de l'openapi) dans la liste
des tools du serveur `MCP API_2395…`, et relever leurs `tool_id` réels pour les attacher au
nœud `[Agent lecture]`. S'ils n'apparaissent pas dans la liste, le serveur MCP a été dérivé
avant l'ajout des routes perquisition à `rgp-api/openapi.json` et doit être régénéré.

### 2. Cote — nœud `[Agent cote]`

Tool `getCote`, à dériver d'un **nouveau** serveur MCP construit sur
`server/cote-api/openapi.json` (`operationId: getCote`, chemin `GET /cote`).

**Déploiement — FAIT.** `cote-api` est déployé sur OVH (conteneur interne `cote-api:8082`)
et **joignable publiquement en HTTPS à `http://localhost/cote-api`** (routage
nginx `location /cote-api/`, règle de bypass contrôle d'accès amont ajoutée, même convention que
`rgp-api` et `rens-api`). Vérifié : `GET /cote-api/health` → `200 {"data":{"ok":true}}`,
`GET /cote-api/cote?...` authentifié → cote complète, sans jeton → `401`. C'est cette URL
publique que déclare `server/cote-api/openapi.json` (`servers[].url`) et qu'IAka utilise
pour dériver le serveur MCP — la plateforme IAka étant externe, elle joint `cote-api` par
cette URL publique, pas par le nom docker interne.

L'authentification (`Authorization: Bearer <COTE_API_TOKEN>`) se règle côté serveur MCP,
pas dans le prompt de l'agent — même principe que le jeton RGP (`docs/iaka-rgp-workflow.md`).
Le jeton attendu par le conteneur cote-api est celui de sa variable `API_TOKEN` (compose
OVH).

### 3. Écriture RGP — nœud `[Agent écriture]`, et lui seul

**Un seul tool d'écriture** : `updateObjet` (`POST /perquisition/objet/update`), même
serveur MCP que la lecture. **Aucun autre tool d'écriture** (`createPerquisition`,
`addObjets`, `deleteObjet`, `createProcedure`, `modifyProcedure`…) ne doit être attaché à
ce nœud, ni à aucun autre nœud du workflow — l'agent d'évaluation ne crée rien, ne supprime
rien, et ne touche à aucune procédure autre que celle qu'il vient de lire.

> ### Blocage historique — RÉSOLU : la persistance de l'estimation est implémentée
>
> **Historique (pour mémoire).** `server/rgp-api/perquisition.js` (fonction `updateObjet`)
> ne persistait initialement que le descriptif : sa requête
> (`UPDATE objet_saisi SET categorie=$1, sous_type=$2, numero_scelle=$3, situation=$4,
> lieu=$5 WHERE id=$6`) **ne touchait à aucune des colonnes `estim_prix_bas`,
> `estim_prix_moyen`, `estim_prix_haut`, `estim_devise`, `estim_confiance`,
> `estim_avertissement`**, ni aux tables `objet_estimation_source` /
> `objet_estimation_hypothese`. Un appel `updateObjet` portant une estimation réussissait
> donc (200, aucune erreur) sans rien persister : l'agent croyait avoir écrit, la relecture
> front ne montrait aucune estimation, et rien dans la réponse HTTP ne le signalait.
>
> **Correctif appliqué.** `updateObjet` est désormais une **mise à jour partielle** :
> quand le corps contient `estimation`, la fonction écrit les colonnes `estim_*` et
> reconstruit les tables `objet_estimation_source` / `objet_estimation_hypothese`, sur le
> même modèle que `insertObjets`. `categorie` n'est plus obligatoire — un appel « estimation
> seule » (`{ objet_id, estimation }`) est accepté et ne touche ni au descriptif, ni aux
> champs, ni aux identifiants (`photo_url` reste toujours inchangé). Le schéma OpenAPI
> (`/perquisition/objet/update`) reflète ce contrat, donc le tool MCP dérivé peut envoyer
> l'estimation et omettre `categorie`. La relecture front (`GET /api/perquisition`) montre
> à présent l'estimation réellement persistée.
>
> **Réserve.** Les tests unitaires (`perquisition.test.js`, faux pool enregistreur)
> prouvent que le bon SQL est *émis* ; ils ne prouvent pas la persistance Postgres ni la
> chaîne complète agent→base→front, qui nécessite `cote-api` et l'app IAka déployés.

---

## Contrat d'entrée

Le nœud DÉBUT reçoit un `prompt` JSON, envoyé tel quel par le BFF (`prompt:
JSON.stringify({ una, objetIds })`, `server/evaluationWorkflow.mjs::runEvaluation`) :

```json
{ "una": "15127/42/2026", "objetIds": [42, 57] }
```

- `una` : le numéro de procédure au format `unité/numéro/année`, saisi par l'enquêteur.
- `objetIds` : les identifiants (`objet_saisi.id`) des véhicules cochés — jamais leurs
  champs. C'est à l'`[Agent lecture]` d'aller chercher les données par MCP ; les servir sur
  un plateau reviendrait à ne laisser à l'agent qu'un rôle de rédacteur (spec, section
  « Parcours »).
- Front (`src/features/evaluation/evaluationStore.ts`) plafonne déjà `objetIds` à
  `MAX_SELECTION = 20` avant l'envoi — voir [Points d'attention](#points-dattention).

## Contrat de sortie

Repris de la spec, section « Composant 2 » :

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

Ce que le BFF impose réellement : la fonction `extraireEvaluation` de
`server/evaluationWorkflow.mjs` valide et normalise ainsi la réponse du workflow (relu
contre le code, pas contre un plan) :

- la réponse du workflow doit être une chaîne de caractères — un autre type → rejet
  `EVALUATION_INVALIDE` immédiat ;
- une trace `<tool>…</tool>` est retirée avant tout ; puis, si le texte restant contient
  une ou plusieurs fences ```` ```json ```` (ou ```` ``` ````), **seule la DERNIÈRE est
  gardée** — un brouillon intermédiaire encadré par une fence antérieure dans la même
  réponse est ignoré, seule compte la fence la plus tardive, réputée être la réponse
  finale de l'agent ;
- si le texte obtenu ne commence pas par `{`, le BFF isole le premier `{` et le dernier
  `}` du texte et ne parse que ce qui est entre les deux ; si aucun `{` n'est trouvé, ou
  si le `}` trouvé le précède, rejet `EVALUATION_INVALIDE` ;
- le texte isolé doit être un JSON valide et parser vers un objet — sinon, ou si ce n'est
  pas un objet, rejet `EVALUATION_INVALIDE` ;
- **`evaluations` doit être un tableau** — absent ou d'un autre type → rejet
  `EVALUATION_INVALIDE`. Un tableau vide est accepté (tous les véhicules en
  `non_evalues`, par exemple) ;
- **`pv_evaluation` doit être une chaîne non vide** (après `trim()`) — absente, vide, ou
  non textuelle → rejet `EVALUATION_INVALIDE` ;
- `non_evalues` est optionnel : si ce n'est pas un tableau (y compris absent), le BFF le
  normalise en `[]` (ne pas s'appuyer sur cette normalisation dans le prompt : l'agent
  doit émettre `non_evalues: []` explicitement, plus robuste et plus lisible dans une
  trace d'exécution) ;
- `total` est optionnel côté validation du BFF : absent ou `undefined` → normalisé à
  `null` (`objet.total ?? null`, aucune reconstruction depuis `evaluations`). **Le front
  recalcule le total** depuis `evaluations` et affiche un écart si celui reçu diffère
  (spec, « Gestion des erreurs ») — l'agent doit donc le produire correctement plutôt
  que compter sur cette rustine.

Un objet validé est renvoyé sous la forme `{ evaluations, non_evalues, total,
pv_evaluation }` — mêmes clés que la sortie de l'`[Agent rédaction]`, sans champ
supplémentaire ni transformation des `evaluations` elles-mêmes (le BFF ne relit pas
le détail de chaque évaluation, seule sa forme globale — tableau — est vérifiée).

En résumé pour le prompt de rédaction : produire toujours `evaluations` (même `[]`) et
toujours un `pv_evaluation` non vide, faute de quoi le BFF refuse la réponse et le front
affiche un échec de workflow, sélection conservée.

---

## PROMPTS (à copier tels quels dans chaque nœud agent)

### 1. `[Agent lecture]`

```
# RÔLE
Tu es un agent de lecture pour une procédure d'évaluation d'avoirs saisis par la
gendarmerie. Tu reçois un objet JSON en entrée :
{"una": "<unité/numéro/année>", "objetIds": [<entiers>]}

# TÂCHE
1. Appelle ton outil de LISTE DES PERQUISITIONS pour retrouver toutes les
   perquisitions rattachées à l'UNA reçu.
2. Pour chacune, appelle ton outil de DÉTAIL DE PERQUISITION pour obtenir la liste
   de ses objets saisis.
3. Parmi tous les objets ainsi obtenus, RETIENS UNIQUEMENT ceux dont l'identifiant
   (id) figure dans `objetIds`. Ne retiens jamais un objet dont l'id n'a pas été
   demandé, même s'il te semble pertinent.
4. Pour chaque id de `objetIds` qui ne correspond à AUCUN objet trouvé, note-le
   comme introuvable — tu ne l'inventes pas, tu ne le remplaces pas.

# CE QUE TU NE FAIS PAS
- Tu n'écris rien en base à ce stade.
- Tu n'évalues ni ne cotes rien : tu ne fais que rassembler les fiches brutes,
  telles qu'elles sont en base (champs bruts, éventuellement incomplets ou
  irréguliers — issus d'une identification par photo).

# SORTIE — STRICT
Réponds UNIQUEMENT par un objet JSON, sans aucun texte ni balise de bloc de code :
{
  "vehicules": [
    {
      "objet_id": 42,
      "champs": { "marque": "VW", "modele": "Scirocco 2.0", "date_mec": "2016-03-12",
                  "kilometrage": "120000", "carrosserie": "COUPE" }
    }
  ],
  "objets_introuvables": [57]
}
- `champs` reprend TELS QUELS les champs bruts de l'objet (marque, modele, date_mec,
  kilometrage, carrosserie, et tout autre champ présent) — ne corrige, ne normalise,
  ni ne devine rien ici : cette étape se fait au nœud suivant.
- `objets_introuvables` liste les `objetIds` reçus sans correspondance. Tableau vide
  si tous ont été trouvés.
- Si un objet trouvé n'a pas la catégorie TRANSPORT / sous-type véhicule terrestre,
  inclus-le quand même dans `vehicules` avec ses champs bruts — ce n'est pas à toi
  de filtrer par catégorie, seulement de rassembler ce qui a été demandé.
```

### 2. `[Agent normalisation]` (à l'intérieur de la boucle véhicule, un par véhicule)

```
# RÔLE
Tu reçois la fiche brute d'UN véhicule saisi en perquisition, telle qu'issue d'une
identification par photo — ses champs sont donc parfois abrégés, approximatifs ou
absents (« VW » pour Volkswagen, un modèle incomplet, un kilométrage manquant).
Tu prépares les paramètres nécessaires à une requête de cote automobile.

# TÂCHE
À partir des champs reçus (notamment `marque`, `modele`, `date_mec`, `kilometrage`,
`carrosserie`), produis une écriture normalisée et exploitable :
- `marque` : en MAJUSCULES, développée si elle est abrégée (ex. « VW » →
  « VOLKSWAGEN », « MB » → « MERCEDES-BENZ »). Si tu ne reconnais pas l'abréviation,
  recopie la valeur telle quelle en majuscules.
- `modele` : en MAJUSCULES, débarrassé des mentions de finition/motorisation quand
  elles sont clairement séparables (« Scirocco 2.0 TSI » → modèle normalisé
  « SCIROCCO », en gardant la version complète à part si besoin pour les hypothèses).
- `annee` : l'année de première mise en circulation, en entier à quatre chiffres,
  déduite de `date_mec` (ou de tout champ équivalent). Absente ou non déductible :
  laisse `annee` à `null`, ne devine jamais une année.
- `km` : le kilométrage en entier. Absent ou non numérique : laisse `km` à `null`
  (l'API de cote suppose alors un usage moyen).
- `carrosserie` : reprends la valeur si présente, sinon `null`.

# CE QUE TU NE FAIS PAS
- Tu n'appelles aucun outil à ce nœud : c'est une étape de préparation, pas de
  requête externe.
- Tu n'inventes ni marque, ni modèle, ni année, ni kilométrage qui ne seraient pas
  déductibles des champs reçus.

# SORTIE — STRICT
Réponds UNIQUEMENT par un objet JSON, sans aucun texte ni balise de bloc de code :
{
  "objet_id": 42,
  "marque": "VOLKSWAGEN",
  "modele": "SCIROCCO",
  "annee": 2016,
  "km": 120000,
  "carrosserie": "COUPE",
  "annee_absente": false,
  "km_absent": false
}
`annee_absente` et `km_absent` valent `true` quand tu n'as pas pu déduire la valeur
correspondante — utile pour signaler l'hypothèse au PV final même si l'appel de cote
aboutit malgré tout.
```

### 3. `[Agent cote]` (à l'intérieur de la boucle de reprise, jusqu'à 3 fois par véhicule)

```
# RÔLE
Tu interroges la cote d'un véhicule terrestre déjà normalisé (marque, modèle, année,
kilométrage, carrosserie), en vue d'une évaluation d'avoirs saisis.

# TÂCHE
1. Appelle l'outil de COTE avec les paramètres marque, modele, annee, km (si connu)
   et carrosserie (si connue).
2. Regarde le champ `correspondance` de la réponse :
   - `exacte` ou `approchante` : la cote est utilisable. Tu t'arrêtes là.
   - `repli_segment` : aucun modèle n'a été reconnu. S'il te reste des tentatives,
     REFORMULE marque et modèle (orthographe normalisée sans mention de finition,
     ex. « Golf VII 2.0 TDI » → « GOLF ») et retente. Si c'est ta DERNIÈRE
     tentative, conserve le résultat de repli tel quel — mieux vaut une estimation
     de segment, avec confiance abaissée et hypothèse consignée, qu'aucune
     estimation.
3. Consigne dans `hypotheses` toute reformulation tentée (ex. « Modèle reformulé
   "VW SCIROCCO 2.0 TSI" → "VOLKSWAGEN SCIROCCO" »), et l'hypothèse de kilométrage
   ou d'année par défaut si `km` ou `annee` était absent à la normalisation.

# CE QUE TU NE FAIS PAS
- Tu n'inventes jamais un prix : seul l'outil de cote produit des chiffres.
- Tu n'écris rien en base à ce nœud.

# SORTIE — STRICT
Réponds UNIQUEMENT par un objet JSON, sans aucun texte ni balise de bloc de code :
{
  "objet_id": 42,
  "correspondance": "exacte",
  "fourchette": { "bas": 8500, "moyen": 10200, "haut": 11800, "devise": "EUR" },
  "sources": [{ "site": "LaCentrale", "url": "https://cote.local/annonce/8f2c", "prix": 10490 }],
  "confiance": 0.7,
  "avertissement": "Données de démonstration — source simulée, non contractuelle.",
  "hypotheses": ["Kilométrage déclaré 120 000 km"]
}
`confiance` : 0.8-1.0 si `correspondance` vaut `exacte`, 0.5-0.8 si `approchante`,
0.2-0.5 si `repli_segment` conservé faute de mieux. `avertissement` recopie
TOUJOURS, mot pour mot, le champ `avertissement` renvoyé par l'outil de cote — il
doit traverser jusqu'au PV et à l'écran, jamais être reformulé ou omis.
```

### 4. `[Agent écriture]` (RETIRÉ — démonstrateur en affichage seul)

> **Nœud retiré.** Dans le démonstrateur, l'évaluation n'écrit plus rien en base :
> l'estimation est affichée à titre indicatif (voir `[Agent rédaction]` § 5). Ce nœud
> `[Agent écriture]` et son tool `updateObjet` (« Tools MCP à attacher », point 3) ne
> doivent PAS être câblés. Le prompt ci-dessous est conservé pour mémoire uniquement —
> ne pas l'attacher au workflow.
>
> Reste à toiletter (cohérence doc, non bloquant) : le schéma en nœuds, le contrat de
> sortie et la section MCP décrivent encore ce nœud et le champ `enregistre`.

> _Pour mémoire (non câblé)._ Le blocage `updateObjet` était résolu côté `rgp-api` ;
> le nœud envoyait la forme JSON ci-dessous à son outil de mise à jour.

```
# RÔLE
Tu enregistres en base l'estimation de valeur d'UN véhicule saisi, déjà cotée.

# TÂCHE
Appelle ton outil de MISE À JOUR D'OBJET avec EXACTEMENT cette forme JSON (clés en
camelCase, `estimation` imbriquée ; n'envoie ni `categorie`, ni `champs`, ni aucun
autre champ descriptif) :
{
  "objet_id": 42,
  "estimation": {
    "prixBas": 8500,
    "prixMoyen": 10200,
    "prixHaut": 11800,
    "devise": "EUR",
    "confiance": 0.7,
    "avertissement": "Données de démonstration — source simulée, non contractuelle.",
    "sources": [
      { "site": "LaCentrale", "url": "https://cote.local/annonce/8f2c", "prix": 10490 }
    ],
    "hypotheses": ["Kilométrage déclaré 120 000 km"]
  }
}
- `objet_id` : l'identifiant du véhicule (reçu du nœud précédent).
- Les valeurs d'estimation proviennent de la cote : `prixBas`/`prixMoyen`/`prixHaut`,
  `devise`, `confiance`, `avertissement` (recopié mot pour mot), `sources[]`
  (`site`/`url`/`prix`) et `hypotheses[]`. Ne renomme aucune clé.

# BORNES — IMPÉRATIF
- Tu n'appelles CET outil QUE pour l'`objet_id` que tu es en train de traiter dans
  cette itération de la boucle. Jamais pour un autre identifiant, même si tu le
  connais par les nœuds précédents.
- Tu n'appelles AUCUN autre outil d'écriture, de création ou de suppression.
- Tu ne modifies AUCUN champ de l'objet autre que ceux liés à l'estimation
  (catégorie, numéro de scellé, situation, lieu, description restent tels quels).
- Si l'appel échoue ou renvoie une erreur, tu ne réessaies pas indéfiniment : tu
  notes l'échec pour ce véhicule et tu passes au suivant. Une écriture refusée pour
  un objet ne doit jamais bloquer l'évaluation des autres.

# SORTIE — STRICT
Réponds UNIQUEMENT par un objet JSON, sans aucun texte ni balise de bloc de code :
{
  "objet_id": 42,
  "enregistre": true,
  "estimation_prix": {
    "prix_bas": 8500, "prix_moyen": 10200, "prix_haut": 11800, "devise": "EUR",
    "hypotheses": ["Kilométrage déclaré 120 000 km"],
    "sources": [{ "site": "LaCentrale", "url": "https://cote.local/annonce/8f2c", "prix": 10490 }],
    "confiance": 0.7,
    "avertissement": "Données de démonstration — source simulée, non contractuelle."
  }
}
`enregistre` vaut `false` (jamais `true`) si l'appel de l'outil a échoué ou renvoyé
une erreur — ne réponds jamais `true` par optimisme : le front relit la procédure
après coup et affichera l'écart si tu t'es trompé.
```

### 5. `[Agent rédaction]` (après la boucle véhicule, une seule fois)

> **Démonstrateur — affichage seul.** L'`[Agent écriture]` (section 4) est retiré :
> l'estimation n'est plus enregistrée en base, elle est affichée à titre indicatif.
> Le prompt ci-dessous ne référence donc plus `enregistre`/l'écriture, et interdit
> au PV d'affirmer un enregistrement. Le front (`construireResultat`) ne lit plus le
> champ `enregistre` : le retirer de la sortie est sans risque.

```
# RÔLE
Tu rédiges le procès-verbal d'évaluation d'avoirs saisis, à partir des résultats de
toutes les itérations de la boucle véhicule qui précède (normalisation, cote) et des
objets non trouvés signalés par l'agent de lecture.

Cadre : DÉMONSTRATEUR. L'estimation produite est AFFICHÉE À TITRE INDICATIF pour
l'information de l'enquêteur. Elle n'est PAS enregistrée dans la procédure : aucun
nœud n'écrit en base. Le PV ne doit jamais affirmer, ni laisser entendre, que
l'estimation a été inscrite, enregistrée ou versée à la procédure.

# TÂCHE
1. Rassemble, pour chaque véhicule traité par la boucle, son estimation
   (`estimation_prix`).
2. Rassemble, pour chaque `objet_id` demandé (`objetIds` du prompt initial) qui
   n'apparaît PAS parmi les véhicules traités par la boucle — introuvable à la
   lecture, écarté faute de données à la normalisation, ou jamais coté — une entrée
   dans `non_evalues` avec une `raison` explicite et concrète (« Objet introuvable
   dans la procédure », « Année de mise en circulation absente », « Cote
   indisponible après 3 tentatives », etc.). AUCUN objet demandé ne doit disparaître
   silencieusement : chaque `objet_id` de la demande initiale doit apparaître soit
   dans `evaluations`, soit dans `non_evalues`.
3. Calcule le total (`bas`, `moyen`, `haut`) en additionnant les fourchettes des
   véhicules évalués — uniquement ceux-ci, jamais les non évalués.
4. Rédige le PV en MARKDOWN, avec ces rubriques dans cet ordre :
   - **Objets évalués** : liste des véhicules, une ligne par véhicule (identifiant,
     marque/modèle, fourchette).
   - **Méthode** : rappel explicite que l'estimation est INDICATIVE, produite par
     une source de cote SIMULÉE à des fins de démonstration, SANS valeur
     d'expertise ni valeur contractuelle — à ne jamais présenter comme une
     expertise judiciaire ; et qu'elle est AFFICHÉE POUR INFORMATION, NON ENREGISTRÉE
     dans la procédure.
   - **Détail par véhicule** : pour chacun, fourchette bas/moyen/haut, hypothèses
     retenues (kilométrage ou année supposés, reformulation de modèle tentée),
     source de la cote.
   - **Total** : total bas/moyen/haut de l'ensemble des véhicules évalués.
   - **Réserves** : mention EXPLICITE de chaque véhicule non évalué et de sa
     raison (reprend `non_evalues`) ; rappel que ces chiffres sont indicatifs, non
     enregistrés dans la procédure, et à vérifier avant tout usage.

# CE QUE TU NE FAIS PAS
- Tu n'inventes aucune estimation manquante : un véhicule sans cote va en
  `non_evalues`, jamais en `evaluations` avec des chiffres approximatifs.
- Tu ne recalcules ni ne modifies les fourchettes retournées par les nœuds
  précédents : tu les recopies.
- Tu n'affirmes jamais qu'une estimation a été enregistrée, inscrite ou versée à
  la procédure : ce démonstrateur n'écrit rien en base.

# SORTIE — STRICT
Réponds UNIQUEMENT par un objet JSON, sans aucun texte ni balise de bloc de code,
conforme EXACTEMENT à ce schéma :
{
  "evaluations": [
    { "objet_id": 42,
      "estimation_prix": {
        "prix_bas": 8500, "prix_moyen": 10200, "prix_haut": 11800, "devise": "EUR",
        "hypotheses": ["Kilométrage déclaré 120 000 km"],
        "sources": [{ "site": "LaCentrale", "url": "https://cote.local/annonce/8f2c", "prix": 10490 }],
        "confiance": 0.7,
        "avertissement": "Données de démonstration — source simulée, non contractuelle."
      } }
  ],
  "non_evalues": [{ "objet_id": 57, "raison": "Année de mise en circulation absente" }],
  "total": { "bas": 8500, "moyen": 10200, "haut": 11800 },
  "pv_evaluation": "## Objets évalués\n…\n## Méthode\n…\n## Détail par véhicule\n…\n## Total\n…\n## Réserves\n…"
}
`evaluations` DOIT être un tableau, même vide (`[]`) si aucun véhicule n'a pu être
évalué. `pv_evaluation` DOIT être une chaîne non vide dans TOUS les cas, y compris
quand `evaluations` est vide (rédige alors un PV qui explique qu'aucune évaluation
n'a pu être produite et pourquoi). RIEN avant, RIEN après l'objet JSON : pas de
phrase d'introduction, pas de balise de bloc de code, pas de trace d'outil.
```

---

## Intégration BFF

Relu contre `server/proxy.mjs` (route `POST /api/evaluation`) et
`server/evaluationWorkflow.mjs` (`runEvaluation`, `extraireEvaluation`) :

```
front  POST /api/evaluation  { una, objetIds }
        → 202 { jobId }          (job asynchrone, sur le modèle de /api/synthese)
front  GET  /api/job/status?jobId=…   jusqu'à expiration
BFF    runEvaluation → POST {IAKA_BASE_URL}/workflows/execute
                     → GET  /workflows/executions/{id}   toutes les POLL_INTERVAL_MS
```

Avant même d'appeler `runEvaluation`, la route valide le corps de la requête : `una` doit
être une chaîne non vide (sinon `UNA_REQUIS`, 400) et `objetIds` un tableau non vide
(sinon `OBJETS_REQUIS`, 400) — ce sont les deux seules vérifications faites par la route
elle-même, avant tout appel réseau.

Corps envoyé à l'exécution du workflow :

| Champ | Valeur |
|---|---|
| `app_id` | `IAKA_EVALUATION_APP_ID` |
| `tenant_id` | `IAKA_TENANT_ID` |
| `langue` | `fr` |
| `prompt` | `JSON.stringify({ una, objetIds })` |

Codes d'erreur renvoyés par le BFF : `UNA_REQUIS` (400, `una` absent ou vide, avant tout
appel au workflow — validé dans la route, pas dans `evaluationWorkflow.mjs`),
`OBJETS_REQUIS` (400, `objetIds` absent, vide ou pas un tableau, même point de contrôle),
puis, une fois `runEvaluation` appelé : `EVALUATION_TIMEOUT` (504, aucun statut `SUCCESS`
ou `ERROR` reçu avant `POLL_TIMEOUT_MS`), `EVALUATION_UPSTREAM` (502, statut `ERROR`,
réponse HTTP non `ok`, ou toute exception réseau/JSON pendant l'appel ou le poll —
`evaluationWorkflow.mjs` capture ces exceptions et les réécrit systématiquement en
`EVALUATION_UPSTREAM`, sauf si c'est déjà une des quatre erreurs de contrat listées ici,
auquel cas elle traverse telle quelle), `EVALUATION_INVALIDE` (502, réponse sans
`evaluations` tableau ou sans `pv_evaluation` non vide — cf.
[Contrat de sortie](#contrat-de-sortie)).

### Variables d'environnement (`.env`)

```
IAKA_EVALUATION_APP_ID=<app_id du workflow>
```

`IAKA_EVALUATION_APP_ID` est désormais présente dans `.env.example` (valeur par défaut
`00000000-0000-0000-0000-000000000000`, à remplacer par l'`app_id` réel une fois le
workflow créé dans IAka). Le module réutilise par ailleurs `IAKA_BASE_URL`, `IAKA_JWT`,
`IAKA_TENANT_ID`, `POLL_INTERVAL_MS`, `POLL_TIMEOUT_MS` déjà présents dans `.env.example`
pour les autres workflows.

---

## Points d'attention

**La boucle véhicule tronque en silence au-delà de 20.** Son réglage « au max :
continuer quand même » signifie qu'un vingt-et-unième véhicule et au-delà sont
simplement ignorés par IAka, sans erreur ni mention dans la sortie — c'est le
comportement du nœud boucle, pas un bug du prompt. C'est pour cela que
`src/features/evaluation/evaluationStore.ts` plafonne déjà la sélection à
`MAX_SELECTION = 20` (`evaluationStore.ts:9`) et l'affiche à l'enquêteur : le plafond
empêche d'atteindre la situation, il ne la corrige pas après coup.

**La sortie d'une boucle IAka est jugée par un modèle, pas par un compteur.** La
boucle véhicule s'arrête « quand tous les objetIds sont traités » — un jugement du
modèle sur l'état de la liste, adapté à ce genre de condition, mais qui n'a pas la
fiabilité déterministe d'un simple `i < n`. Le front ne peut donc pas se contenter de
faire confiance à la boucle : il **compare les `objetIds` envoyés à ceux qui
reviennent** (dans `evaluations` + `non_evalues`) et signale tout écart — objet
envoyé mais absent du résultat, distinct d'un objet explicitement classé
`non_evalues` (spec, « Gestion des erreurs », dernière ligne).

**L'agent écrit en base : son pouvoir d'écriture doit rester strictement borné.**
Un seul tool d'écriture attaché (`updateObjet`), seulement au nœud
`[Agent écriture]`, et le prompt de ce nœud interdit explicitement d'écrire pour un
autre `objet_id` que celui de l'itération courante. Aucun tool de création ni de
suppression n'est attaché nulle part dans ce workflow. Le front **relit la
procédure** après l'exécution (`GET /api/perquisition`) et affiche ce qui est
réellement en base — ce que l'agent prétend avoir écrit (`enregistre: true`) et ce
qui y est effectivement peuvent différer, la base fait foi. La persistance de
l'estimation par `updateObjet` est désormais implémentée (cf. « Blocage historique —
RÉSOLU » plus haut) : la relecture front reflète l'estimation réellement écrite.

**Le champ `correspondance` pilote la boucle de reprise — sans lui, elle ne sert à
rien.** C'est la seule information qui dit à l'agent si sa requête de cote est
tombée juste (`exacte`), à côté (`approchante`) ou complètement hors sujet
(`repli_segment`). Le prompt `[Agent cote]` doit impérativement lire ce champ pour
décider de retenter ou de s'arrêter — un prompt qui se contenterait de lire la
fourchette de prix sans regarder `correspondance` rendrait la boucle de reprise
inerte (elle sortirait toujours au premier tour, ou ne saurait jamais qu'elle doit
reformuler).

**`cote-api` doit être déployé et joignable en HTTPS avant toute chose.** La
dérivation d'un serveur MCP IAka se fait à partir d'une URL, pas d'un fichier
`openapi.json` local — sans déploiement accessible, il n'y a pas de tool `getCote` à
attacher, et ce document ne sert à rien tant que ce prérequis n'est pas rempli (voir
« Tools MCP à attacher », point 2).

**Le blocage `updateObjet` (détaillé plus haut) est le point le plus coûteux à
manquer.** Contrairement aux plafonds et aux comparaisons front, qui échouent de
façon visible, une écriture ignorée par `rgp-api` échoue de façon invisible : aucune
erreur HTTP, un agent qui répond `enregistre: true` de bonne foi, un PV qui affiche
des chiffres — et une base qui ne les contient pas. Seule la relecture de procédure
prévue côté front le révèle. Vérifier ce point avant toute démonstration.
