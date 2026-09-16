# Workflows IAka « RENS » — câblage & prompts

Détail des workflows IAka du cas d'usage RENS (cf. `docs/cas-usage-rens.md`). Deux workflows
**autonomes** (pas d'entrée `prompt` : ils appellent eux-mêmes l'API rens-api). Le front les
déclenche tous les deux en parallèle via le BFF (`server/proxy.mjs`, `/api/rens/synthese`) et
concatène les deux markdowns.

| Workflow | app_id | Rôle |
|---|---|---|
| **1 — Synthèse quotidienne** | `b0af076a-f6d5-41b6-addd-32e4e054461c` | panorama de la veille + signaux faibles |
| **2 — Zoom signal** | `95e7542e-2063-4f01-8a8f-9150829e69f6` | analyse détaillée d'un signal (lecture des textes) |

Base API commune : `http://localhost/rens-api`, auth `Authorization: Bearer <RENS_API_TOKEN>`.
Réponses enveloppées `{ "data": ... }` → pointer sur le champ `data` en aval.

---

## Workflow 1 — Synthèse quotidienne

### Structure
```
DÉBUT
  ├──▶ [Nœud API] GET /agregats     ┐  (en parallèle)
  ├──▶ [Nœud API] GET /signaux      ┘
  ▼
[Jointure — pilotée en langage naturel]   → rédige la synthèse
  ▼
FIN (markdown)
```

### Nœud API — agregats (panorama du jour)
| Champ | Valeur |
|---|---|
| Méthode | `GET` |
| URL | `http://localhost/rens-api/agregats` |
| Format de réponse | `JSON` |
| Headers | `Authorization` = `Bearer <RENS_API_TOKEN>` |
| Paramètres http | *(aucun)* → synthèse de la **veille** par défaut |

Sortie `data` : `{ date, total, total_veille, top_mots:[{mot,n}], par_ggd:[{code_ggd,n}], top_communes:[{commune,n}] }`.

### Nœud API — signaux (signaux faibles)
| Champ | Valeur |
|---|---|
| Méthode | `GET` |
| URL | `http://localhost/rens-api/signaux` |
| Format de réponse | `JSON` |
| Headers | `Authorization` = `Bearer <RENS_API_TOKEN>` |
| Paramètres http | `window` = `30` (fenêtre glissante en jours) |

Sortie `data` : `[ { mot, n, depts, communes, jours, debut, fin, emergent } ]`.

### Prompt de la Jointure (skill langage naturel)
```
Tu es analyste renseignement. Tu reçois DEUX blocs JSON déjà agrégés par la base (tu ne vois JAMAIS
les fiches brutes) :
(A) PANORAMA DU JOUR : { date, total, total_veille, top_mots:[{mot,n}], par_ggd:[{code_ggd,n}],
    top_communes:[{commune,n}] }.
(B) SIGNAUX FAIBLES (fenêtre glissante) : [ { mot, n, depts, communes, jours, debut, fin, emergent } ].

Tu produis une SYNTHÈSE QUOTIDIENNE en markdown, en deux parties :

1. PANORAMA DU JOUR — à partir de (A) :
   - le volume total et son évolution vs la veille (total vs total_veille : hausse/baisse) ;
   - les SUJETS DOMINANTS du jour, lus dans top_mots (regroupe les mots-clés proches en 3-5
     tendances lisibles, ex. plusieurs mots liés aux stupéfiants → « trafic de stupéfiants ») ;
   - la géographie marquante : GGD et communes les plus cités.
   Rends un court paragraphe + un tableau markdown GFM (mot-clé | nombre) des principaux top_mots.

2. SIGNAUX FAIBLES — à partir de (B) :
   Pour chaque candidat saillant (dispersion élevée : plusieurs départements et communes,
   plusieurs jours, MAIS faible volume — donc noyé dans le panorama), nomme le phénomène (d'après
   le mot-clé, entre backticks), donne sa fenêtre (debut→fin), le nombre de départements et de
   communes touchés, et signale-le comme ÉMERGENT si emergent=true. Explique en une phrase
   pourquoi il mérite attention alors qu'il est invisible dans le panorama.

Fonde-toi UNIQUEMENT sur les JSON fournis. Ne réclame jamais les fiches brutes. Si un bloc est
vide, dis-le. Termine par 1-3 recommandations d'approfondissement (quel signal creuser).
```

---

## Workflow 2 — Zoom signal (lecture des textes)

### Structure
```
DÉBUT
  ▼
[Nœud API] GET /signaux
  ▼
[Agent lecteur + outil MCP listFiches]   → choisit un signal, lit ~15 fiches, rédige le zoom
  ▼
FIN (markdown)
```

### Nœud API — signaux
Identique au nœud signaux du workflow 1 (`GET /signaux`, `window=30`, Bearer).

### Outil MCP — listFiches (connecteur MCP API)
L'agent lecteur dispose d'un **MCP API** dérivé de l'OpenAPI de rens-api :

| Champ du connecteur MCP API | Valeur |
|---|---|
| Base Url | `http://localhost/rens-api` |
| Authorization | `Bearer <RENS_API_TOKEN>` |
| OpenAPI | `server/rens-api/openapi.json` |

Tools dérivés : `listFiches`, `getFiche`, `agregats`, `signaux`. **Attacher à l'agent lecteur
uniquement `listFiches`** (et éventuellement `getFiche`). `listFiches(q, limit, from, to, ggd,
commune)` renvoie les fiches AVEC leur corps de texte.

### Prompt de l'agent lecteur (skill)
```
Tu reçois la LISTE DES SIGNAUX FAIBLES (JSON : [{mot, n, depts, communes, jours, debut, fin,
emergent}]) issue d'un appel API en amont. Tu disposes du tool listFiches(q, limit, from, to, ggd,
commune) qui renvoie des fiches AVEC leur corps de texte (titre, date, unite, code_ggd, commune,
texte, mots_cles).

DÉMARCHE :
1. Choisis le signal LE PLUS SAILLANT : priorité aux émergents (emergent=true), puis à la plus
   forte dispersion (depts et communes élevés, jours nombreux). Un seul, deux au max.
2. Appelle RÉELLEMENT listFiches(q=<le mot du signal>, limit=15) (optionnel : from/to = debut→fin).
3. LIS les textes et rédige un ZOOM en markdown :
   - le phénomène en une phrase ;
   - le MODE OPÉRATOIRE / points récurrents observés DANS LES TEXTES — cite des éléments concrets
     (véhicules, plaques, cibles, horaires, procédés) SANS rien inventer ;
   - étendue géographique et temporelle (communes/départements, période) ;
   - caractère émergent le cas échéant ; 1-2 recommandations (surveillance, recoupement, unités à
     alerter).

Tu DOIS réellement APPELER listFiches (appel d'outil). Fonde le zoom UNIQUEMENT sur les textes
renvoyés. Si aucune fiche, dis-le. SORTIE : « ## Zoom — <nom du signal> » + ton analyse (rien
d'autre).
```

---

## Intégration côté application (BFF)

`server/proxy.mjs`, route `POST /api/rens/synthese` :

1. Ne transmet **aucun** `prompt` aux workflows (ils sont autonomes ; envoyer un champ `prompt`
   provoque un 422 « champ non accepté »).
2. Lance les **deux** workflows en **parallèle** (`app_id` synthèse + `app_id` zoom).
3. Extrait le markdown de chaque résultat (retrait de la trace `<tool>…</tool>`), puis
   **concatène** : `synthèse` + `---` + `zoom`. Le zoom est *best-effort* : s'il échoue, la
   synthèse est renvoyée seule.

Variables d'environnement (`.env` du proxy) :
```
IAKA_RENS_SYNTHESE_APP_ID=b0af076a-f6d5-41b6-addd-32e4e054461c
IAKA_RENS_ZOOM_APP_ID=95e7542e-2063-4f01-8a8f-9150829e69f6
RENS_API_URL=http://localhost/rens-api
RENS_API_TOKEN=<token Bearer rens-api>
```

---

## Points d'attention (retours d'expérience)

- **Host d'exposition — les deux vhosts ont un défaut, arbitrer en connaissance de cause.**
  - `localhost` : `carnet.conf` est régénéré à chaque redéploiement de carnet et **perd
    ses `location /rens-api/` et `/rgp-api/`**. Les requêtes retombent dans le `location /` →
    carnet-app → `302` vers `/login`. IAka suit la redirection, récupère du HTML, fait un
    `json.loads` dessus et échoue avec
    `Le service n'a pas répondu : Expecting value: line 1 column 1 (char 0)`.
  - `localhost` : vhost propre à cette app, jamais écrasé. Les **connecteurs MCP** y
    accèdent sans problème (`POST /rgp-api/procedure` → `200`). Les **nœuds API (`call_api`)**, eux,
    échouent en `L'appel n'est pas autorisé` **sans qu'aucune requête n'atteigne nginx** — cause non
    tranchée, cf. plus bas.
  - **contrôle d'accès amont protège `localhost`** — pas `localhost`.
    C'est la cause de la panne du 20/07/2026 : une requête refusée par Access est arrêtée **à
    l'edge** et n'apparaît donc **ni dans les logs nginx ni dans ceux du microservice**, ce qui
    ressemble à s'y méprendre à « IAka n'émet rien ». Côté IAka le refus se rend en
    `L'appel n'est pas autorisé`.
  - **Piège de configuration Access : une application = un préfixe.** Une application Access
    déclarant plusieurs domaines (ici `/rgp-api/*` **et** `/rens-api/*`) ne voit sa stratégie
    appliquée qu'au **premier** — le champ « URL de l'application » montre lequel. D'où l'asymétrie
    observée : `rgp-api` joignable par IAka, `rens-api` non. Correctif : **une application Access
    distincte par préfixe**, chacune avec sa stratégie `bypass-api`, wildcard `/*` inclus.
  - Vérification : `curl -D- http://localhost/<préfixe>/health` — un `302` vers
    `*.cloudflareaccess.com` signifie protégé, un `200` signifie bypass effectif. Et
    **Zero Trust → Logs → Access**, filtré sur l'IP source d'IAka (`91.134.36.11`), montre la
    décision et la stratégie qui a matché. C'est le seul endroit où un blocage edge est visible.
  - Diagnostic côté serveur : les appels sortants d'IAka viennent de `91.134.36.11`, avec deux
    user-agents distincts — `python-requests/2.32.5` pour les nœuds API, `python-httpx/0.28.1` pour
    les connecteurs MCP. `docker logs brunogauville-nginx-1 | grep python-` sur ovh permet de voir
    immédiatement si la requête est partie, et laquelle.
- **Pas de `prompt` aux workflows autonomes** : le nœud DÉBUT n'a pas d'entrée `prompt` → l'API
  `/workflows/execute` renvoie 422 si on en envoie un. Le BFF n'envoie que `app_id` + `tenant_id`.
- **Nœud API — pas de variable** : les paramètres http sont des valeurs fixes. `/agregats` et
  `/signaux` sans date visent automatiquement **la veille** (dernier jour complet) → pas besoin de
  calculer une date côté workflow.
- **Headers propres** : la clé du header doit être exactement `Authorization` (aucun espace
  parasite en tête), sinon la requête n'est pas émise.
- **Lire l'`error` du statut IAka pour situer la panne** — deux signatures distinctes :
  - `Le service n'a pas répondu : Expecting value: line 1 column 1 (char 0)` → la réponse n'était
    pas du JSON. En pratique : mauvaise URL (host `carnet`, cf. ci-dessus) et donc du HTML de login.
  - `L'appel n'est pas autorisé` → **échec pré-socket, à l'intérieur d'IAka**. Ce n'est PAS un 401
    de rens-api : sur tout l'historique nginx, `91.134.36.11` n'a jamais reçu un seul 401, et
    l'exécution zoom `6a271247` (workflow à **un seul** nœud `call_api`) échoue en ~6 s avec zéro
    ligne côté nginx comme côté applicatif. Deux causes possibles, non départagées faute d'accès à
    la config réelle du nœud : soit la configuration du nœud est abîmée (header `Authorization`
    perdu à l'édition, clés avec espace parasite), soit `call_api` applique une restriction d'hôte
    qui n'a jamais pu être observée.
  Penser au **connecteur MCP API** en plus des nœuds API : le workflow 2 a une `Base Url` propre au
  connecteur, changer le seul nœud API laisse `listFiches` sur l'ancien host.
- **Corruption de clés à l'édition — vérifiable côté serveur.** Le nœud `signaux` a émis
  `?+window=30`, reçu par rens-api comme `q:{" window":"30"}` : un espace parasite s'est glissé dans
  la clé du paramètre. Même classe de bug que le piège `Authorization` ci-dessus. Toute clé saisie
  dans l'UI est à re-vérifier caractère par caractère après édition.
- **`call_api` vs MCP — c'est la vraie ligne de fracture.** Le workflow RGP fonctionne non pas parce
  que `rgp-api` serait différent de `rens-api`, mais parce qu'il **n'utilise aucun nœud `call_api`**
  (abandonnés après un bug `body:""`) : lecture via MCP Toolbox Postgres, écriture via connecteur
  MCP API. Les workflows RENS ont un `call_api` en tête de graphe — d'où l'asymétrie.
- **`/rens-api/openapi.json` répond `401`** alors que `/rgp-api/openapi.json` répond `200`. Le
  bridge OpenAPI→MCP ne pourra pas dériver les tools RENS tant que ce fichier est derrière le Bearer.
  À corriger avant toute bascule de RENS vers un connecteur MCP.
- **OpenAPI → MCP, fragile sur `enum`** : le bridge OpenAPI→MCP d'IaKa échoue au démarrage sur un
  `enum` dans un champ d'entrée. Les schémas d'entrée de rens-api n'utilisent **pas** d'enum
  (valeurs listées en description).
- **Deux étages** : le workflow 1 ne lit jamais les textes (agrégats seulement) ; seul le workflow
  2 lit un petit sous-ensemble ciblé via `listFiches`. C'est ce qui tient l'échelle (1000+/jour).
