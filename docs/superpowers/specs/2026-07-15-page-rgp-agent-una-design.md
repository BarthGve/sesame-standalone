# Design — Page « RGP » : agent conversationnel d'allocation/consultation d'UNA

Date : 2026-07-15
Statut : validé (design), prêt pour plan d'implémentation

## 1. Objectif

Ajouter à SÉSAME une page **« RGP »** composée d'une zone de prompt. L'utilisateur
y interagit en langage naturel pour, sur la base RGP :

- **créer** un UNA (procédure) ;
- **modifier** un UNA existant ;
- **consulter** des UNA (fiche d'un numéro, liste filtrée).

Le traitement (compréhension + exécution) est délégué à un **workflow IAka** dédié.
Le front et le proxy restent minces : ils relaient le prompt et affichent le résultat.

## 2. Décisions verrouillées (contexte)

| Sujet | Décision |
|---|---|
| Périmètre v1 | create + modify + consult, **exécution autonome** |
| Confirmation avant écriture | **Aucune** (choix explicite de l'utilisateur) |
| Moteur | **Workflow IAka** : routage → condition write/read → **agents à tools MCP** |
| Écriture (create/modify) | agent + **MCP API RGP** (tools wrappant `POST /procedure`, `/modifier`) |
| Lecture | agent + **MCP Postgres read-only** (SQL) sur la base `rgp` |
| Nœuds API HTTP | **abandonnés** (body non mappable de façon fiable — bug reproduit 2× en test) |
| Unité | **fixe : 15127** (COB de Segré-en-Anjou Bleu) |
| Transport | `/workflows/execute` (poll) — **un seul `prompt`**, pas d'historique |
| Mémoire conversation | **hors v1** (chaque prompt est indépendant) |

### Risque accepté (documenté, non rediscuté)
Sans gate de confirmation, une **mauvaise classification read→write** alloue un UNA
irréversible. Mitigations : (1) routage **binaire write/read**, l'agent de routage classe en
`read` par défaut (n'émet `write` que sur intention d'écriture **explicite**) ; (2) **read =
branche `Else`** ; (3) **isolation des tools** : l'agent read n'a que le tool SQL read-only
(aucune écriture possible), l'agent write n'a que les tools MCP-API (pas de SQL arbitraire).
Acceptable en contexte test.

## 3. Architecture

```
Front (page RGP, zone de prompt)
   │  POST /api/rgp/chat  { prompt }
   ▼
Proxy (server/proxy.mjs)
   │  runWorkflowRaw({ prompt, appId: IAKA_RGP_APP_ID })   → renvoie result BRUT
   ▼
IAka  /workflows/execute  (app = workflow RGP)
   DEBUT (require_prompt)
     → AGENT de routage : classe l'intention → { "action":"write|read" }  (défaut read)
     → CONDITION (nœud LLM, Qwen 3.6 27b) : If write / Else read
         ├─ write → AGENT + MCP API RGP : choisit et appelle creer_procedure OU
         │          modifier_procedure (tools wrappant l'API HTTP → allocation atomique)
         └─ read  → AGENT + MCP Postgres read-only (base rgp) : une seule requête SQL
                    construit le JSON final (json_agg), renvoyé VERBATIM
     → FIN : renvoie le résultat de la branche
   │
   ▼  result (string)
Proxy → normalise (cf. §6) → renvoie au front { text, parsed }
   ▼
Front : parsed → cartes (fiche/liste/UNA créé) ; parsed null → texte brut
```

Le workflow IAka lui-même est **construit par l'utilisateur dans le builder IAka**.
Ce repo fournit : le front, le proxy, la config, et un **document de câblage** du workflow
(`docs/iaka-rgp-workflow.md`, cf. §7).

## 4. Composant proxy (`server/proxy.mjs`)

### 4.1 Nouvelle route
`POST /api/rgp/chat`
- Corps : `{ "prompt": "<texte utilisateur>" }`.
- Appelle une variante `runWorkflowRaw` (cf. 4.2) avec `app_id = cfg.rgpAppId`.
- Réponse : `{ "text": "<result brut>", "parsed": <objet|null> }`
  où `parsed` = normalisation réussie du result (cf. §6), sinon `null`.
- Erreurs : réutilise `ERROR_STATUS` (IAKA_TIMEOUT 504, IAKA_UPSTREAM 502).

### 4.2 `runWorkflowRaw` (nouveau, `server/iaka.mjs`)
Copie de `runWorkflow` **sans** `extractGeoJSON` : renvoie `body.result` tel quel
(string). Même mécanique exec + polling que l'existant. Raison : le résultat RGP n'est
pas un GeoJSON.

### 4.3 Config (proxy `cfg`, à partir de `process.env`)
- `rgpAppId: process.env.IAKA_RGP_APP_ID` — le workflow RGP à branches.
- Réutilise `IAKA_BASE_URL`, `IAKA_JWT`, `IAKA_TENANT_ID`, `POLL_*` existants.
- `.env.example` : ajouter `IAKA_RGP_APP_ID=00000000-0000-0000-0000-000000000000`.

## 5. Composant front (`src/features/rgp/`)

- **`src/App.tsx`** : ajouter une vue `"rgp"` dans le type `View` et dans `AppNav`
  (libellé « RGP », icône Material `gavel` ou `folder_shared` — **pas d'emoji**, cf. CLAUDE.md).
- **`RgpApp.tsx`** : conteneur de la page.
  - Zone de prompt (réutiliser le style de `SearchBar`).
  - Fil vertical : chaque entrée = { prompt envoyé, réponse rendue }. **Pas de mémoire**
    (chaque envoi est indépendant côté IAka).
  - État `loading` pendant le poll (message « Traitement en cours… »).
- **`RgpResult.tsx`** : rendu d'une réponse.
  - Si `parsed` est un enregistrement UNA (création/fiche) → **carte** (una, numero, type,
    synthèse, urgent, sensible, groupe, commune).
  - Si `parsed` est une **liste** → tableau/cartes de fiches.
  - Si `parsed.error` → message d'erreur (code + message).
  - Si `parsed === null` → afficher `text` brut (repli, cf. §6).
- **`rgpApi.ts`** : `sendRgpPrompt(prompt): Promise<{ text, parsed }>` (fetch `/api/rgp/chat`).

Aucune icône emoji ; Material Icons (déjà importé) ou SVG inline uniquement.

## 6. Format du `result` — clivage lecture / écriture

Origine du problème (test réel 05-RGP) : le résultat d'un **nœud API** est round-trippé par
IAka (JSON RGP → dict Python → `str()`), donnant du **repr Python** (guillemets simples) :
```
"result":"{'error': {'code': 'bad_request', 'message': 'Champ \"unite\" ...'}}"
```
`JSON.parse()` échoue, et le quoting **dépend du contenu** (une apostrophe française —
`synthese`, `commune_libelle` — fait basculer les quotes). Aucun `replace` naïf ne marche.

### Lecture (branche read, MCP-SQL via execute_sql) → wrapper tool + JSON propre
CONSTATÉ EN TEST (exec ada28b23). L'agent read appelle le tool `execute_sql`, donc le result a
le MÊME wrapper que l'écriture : `<tool>execute_sql…<tool-output>{…}</tool-output></tool>` +
texte de fin. Le `<tool-output>` contient du **JSON propre** (`{"json_build_object":{"data":
[…]}}` ou `{"data":[…]}`). Cible de parsing = le `<tool-output>` (idem écriture) — pas le texte
de fin de l'agent, variable (JSON nu ou enrobé ```json```).

### Écriture (branche write, tool MCP-API) → wrapper tool + JSON propre
CONSTATÉ EN TEST (exec cc32d442, UNA 15127/126/2026 créé). Le `result` d'écriture a la forme :
```
<tool>createProcedure<tool-input>{…}</tool-input><tool-output>{"data":{…}}</tool-output></tool>
<phrase LLM en langage naturel>
```
Le bloc `<tool-output>…</tool-output>` contient du **JSON propre (double quotes)** — le tool
output est embarqué verbatim, **pas** de repr Python. Le proxy doit **extraire ce bloc** et le
`JSON.parse`. La phrase LLM qui suit sert de message ; les données de la carte viennent du
`<tool-output>` (fiable).

### Stratégie proxy — `normalizeResult(text)`
1. **Bloc `<tool-output>…</tool-output>`** présent (écriture via tool MCP) → extraire son
   contenu, `JSON.parse` (JSON propre constaté). Renvoyer `{ parsed, message: texte hors
   balises }`.
2. Sinon **`JSON.parse(text)`** → succès sur les lectures (agent verbatim `json_agg`).
3. Sinon (repr Python éventuel) : parseur tolérant `None→null`/`True→true`/`False→false`
   avec tokenizer dédié (apostrophes). Tests dédiés.
4. Échec → `parsed = null`, le front affiche `text` brut.

### 6.a À valider pendant l'implémentation
- **Le nœud FIN supporte-t-il `format: JSON`** (config a `schema_sortie`) ? Si oui sur la
  branche write, la normalisation repr Python devient inutile.
- **La branche read renvoie bien un JSON parsable** (agent verbatim) — à confirmer sur le
  workflow réel (risque d'intégration #1).

## 7. Workflow IAka — construit par l'utilisateur (câblage : `docs/iaka-rgp-workflow.md`)

Le workflow est bâti dans le builder IAka. Le doc `docs/iaka-rgp-workflow.md` est autoritatif
et contient les prompts et le câblage détaillés. Résumé :
- **Agent de routage** → `{ "action":"write|read" }`, défaut `read`.
- **Condition** : `If` write / `Else` read.
- **Branche write** : agent + **MCP API RGP** (tools `creer_procedure` / `modifier_procedure`).
- **Branche read** : agent + **MCP Postgres read-only** (`iaka_ro`) sur `rgp`, SQL `json_agg`
  verbatim.

## 7bis. Serveur MCP API RGP — DÉJÀ FOURNI (aucun build)

Le serveur MCP existe dans IAka : `MCP API_2395053d-dbcd-4993-be46-05e577c2b394` (privé,
actif), dérivé de `server/rgp-api/openapi.json`. Tools à attacher à l'agent write
(`outils_ids`) :
- `createProcedure` (`f27ec536-bb37-46c4-b9ff-71baa5acb521`) → `POST /procedure` (alloue)
- `modifyProcedure` (`05a7b25e-0bb1-4be8-824e-867a9a8d7b56`) → `POST /procedure/modifier`
- lecture (option simple) : `getProcedure` (`33f59a82-…`), `listProcedures` (`f2d0b3f1-…`).

Token RGP géré côté serveur MCP — dette : cf. mémoire `rgp-api-security-debt`. Le serveur ne
transmet que les champs réellement passés (l'API `updateUna` applique tout champ présent).

## 8. Périmètre de consultation

Via MCP-SQL read-only, la consultation couvre : **fiche d'un UNA**, **listes filtrées**, et
**questions analytiques** (« combien de PVEJ ce mois », « lesquelles sont sensibles ET
urgentes », agrégats/tri) — l'agent écrit le `SELECT` adapté. Limites : lecture seule
(aucune écriture possible via cette branche), et périmètre = la base `rgp` (table `una` +
jointures). Prudence attendue de l'agent : ne pas inventer de valeur absente de la base.

## 9. Gestion des erreurs

- IAka `ERROR`/timeout → 502/504, message front « service RGP indisponible ».
- `result` contenant `error` (repr) → normalisé puis affiché comme erreur métier.
- `normalizeResult` échoue → `parsed:null`, affichage `text` brut (pas de crash).
- Le proxy ne lève jamais sur un result mal formé.

## 10. Tests

- **Proxy** (`server/proxy.test.mjs` étendu, IAka mické) :
  - `/api/rgp/chat` relaie le prompt, renvoie `{text, parsed}`.
  - `normalizeResult` : JSON strict OK ; **repr Python avec apostrophes** (ex.
    `{'synthese': "vol à l'étalage", 'commune_libelle': "Segré-en-Anjou"}`) → objet correct ;
    `None/True/False` ; result inparsable → `null`.
  - Erreur IAka → statut correct.
- **Front** (`*.test.tsx`) :
  - `RgpResult` : carte UNA, liste, erreur, repli texte.
  - `RgpApp` : envoi prompt → loading → rendu ; envois indépendants (pas de mémoire).

## 11. Hors périmètre v1 (YAGNI)

Streaming SSE ; multi-unité ; suppression d'UNA (l'API n'a pas l'endpoint) ; mémoire
conversationnelle (`chat_id` replay) ; écriture via SQL (interdit, cf. §6/§8) ; RAG/corpus ;
gate de confirmation.

## 12. Risques d'intégration (ordre de validation)

1. **Construire + enregistrer le serveur MCP API RGP** (tools creer/modifier) et l'attacher
   à l'agent write — remplace les nœuds API abandonnés.
2. **MCP Postgres read-only** (`iaka_ro`) sur `rgp` côté IAka.
3. **Branche read renvoie un JSON parsable verbatim** — conditionne le rendu lecture propre (§6).
4. Fiabilité du routage write/read (risque d'allocation accidentelle) — atténué par défaut
   `read` + read en `Else` + isolation des tools.
5. Format du `result` d'écriture (repr Python possible) — parseur tolérant + repli texte (§6).
