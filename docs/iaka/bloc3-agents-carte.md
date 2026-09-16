# Bloc 3 — Workflow IAka multi-agents de la carte composable

**Topologie retenue : UN seul workflow IAka** contenant un **agent superviseur**
qui planifie, dispatche vers des **sous-agents** outillés, puis **assemble** la
carte finale. Le BFF (bloc 4) ne fait qu'**un appel** et reçoit la
FeatureCollection déjà composée.

```
phrase ──► [ WORKFLOW IAka ]
             ┌──────────────────────────────────────────────┐
             │  SUPERVISEUR : comprend la phrase, planifie,   │
             │  dispatche, puis ASSEMBLE la sortie finale     │
             │        ├──► sous-agent CONSTRUCTION  (outil: execute_sql)      │
             │        └──► sous-agent INTERVENTIONS (outils: RAG + execute_sql)│
             └──────────────────────────────────────────────┘
                          │  FeatureCollection taggée + meta
                          ▼
                        BFF (1 appel)
```

Prérequis (faits) : connecteur **MCP Toolbox PostgreSQL** `bdsp` OK (DATABASE
`bdsp`, HOST `91.134.75.161`, PORT `5433`, USER `bdsp_ro`, outil `execute_sql`
read-only) + corpus RAG CRI (§5).

---

## 0. Principe de sortie (fiabilité)

Un sous-agent ne construit PAS le GeoJSON à la main : il fait **une seule requête**
qui renvoie déjà une FeatureCollection, via PostGIS, et retourne le résultat tel
quel. Chaque feature porte une propriété **`_layer`** (identifiant de couche) pour
que le superviseur puisse tout fusionner et que le front distingue les couches.

Patron SQL commun :
```sql
SELECT json_build_object(
  'type','FeatureCollection',
  'features', COALESCE(json_agg(ST_AsGeoJSON(f.*)::json), '[]'::json)
) AS fc
FROM (
  SELECT '<layer_id>' AS _layer, <colonnes...>, ST_Transform(<geom>,4326) AS geom
  FROM <table> WHERE <filtres> LIMIT 5000
) f;
```
`ST_AsGeoJSON(f.*)` : `geom` → géométrie, les autres colonnes (dont `_layer`) →
`properties`. Sortie toujours en **EPSG:4326**. Toujours un `LIMIT` (≤ 5000).

---

## 1. Agent SUPERVISEUR (entrée du workflow)

**Rôle** : (a) comprendre la phrase et décider les couches + paramètres, (b)
appeler les sous-agents concernés avec leurs paramètres, (c) **assembler** leurs
FeatureCollections en une seule + construire `meta`.

**Entrée** : la phrase utilisateur.
**Sortie** : UN objet JSON (voir §4), rien d'autre.

### Plan interne (ce que le superviseur décide avant de dispatcher)
```json
{
  "scope": { "type":"departement", "valeur":"Marne" } | null,
  "layers": [
    { "id":"eoliennes", "type":"construction",
      "params": { "nature":"Eolienne" } },
    { "id":"interv", "type":"interventions",
      "params": { "concept":"pendaison", "date_debut":"2026-05-01",
                  "date_fin":"2026-06-30",
                  "near": { "type":"construction","nature":"Eolienne","km":10 } } }
  ]
}
```

### Prompt système (superviseur)
```
Tu es l'orchestrateur d'une carte composable. À partir de la phrase de
l'utilisateur :

1) Décide les couches à produire. Types disponibles :
   - "construction" (objets BD TOPO : éoliennes, antennes, ponts...). param: nature
     (valeur BD TOPO, ex. "Eolienne" SANS accent).
   - "interventions" (interventions gendarmerie liées aux suicides). params:
     concept (thème du compte-rendu, ex. "pendaison"), date_debut/date_fin
     (YYYY-MM-DD), near optionnel ({type,nature,km}) pour la proximité.
   - scope optionnel : {"type":"departement","valeur":"<Nom>"} si un département
     est cité.
   Les interventions ne couvrent que 2026-05-02 → 2026-06-30 : borne toute plage
   à cet intervalle. Ajoute "near" si la phrase dit "près de / à moins de N km".

2) Appelle TOUS les sous-agents des couches retenues, puis ATTENDS que CHACUN ait
   répondu. Chaque sous-agent renvoie un objet FeatureCollection
   {"type":"FeatureCollection","features":[...]} dont les features portent _layer.
   N'assemble RIEN tant que tu n'as pas reçu la réponse de TOUS les sous-agents.
   Ne produis AUCUNE FeatureCollection ni aucun texte intermédiaire entre les
   appels.

3) SEULEMENT une fois toutes les réponses reçues, ASSEMBLE ta réponse finale
   UNIQUE : fusionne les tableaux `features` de tous les sous-agents dans UNE
   seule FeatureCollection, et ajoute "meta" (layers avec id/label/count comptés
   sur les features réellement reçues, scope, relation, coverage_note).

RÈGLES DE SORTIE — IMPÉRATIF :
- Tu ne produis qu'UN seul message final, APRÈS tous les sous-agents. Aucune sortie
  intermédiaire, aucune FeatureCollection partielle.
- Ta réponse finale est EXCLUSIVEMENT un objet JSON valide, commençant par « { »
  et finissant par « } ».
- N'inclus JAMAIS : le texte des appels d'outils, les balises <tool>/<tool-input>/
  <tool-output>, ton raisonnement, des explications, des balises markdown (```),
  ni de phrase d'introduction ou de conclusion.
- Ne recopie pas la sortie brute des outils : transforme-la en la FeatureCollection
  finale décrite ci-dessus.
- Si une couche ne renvoie aucune feature, garde-la dans meta.layers avec count 0.
Exemple de forme attendue (valeurs indicatives) :
{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{...},
"properties":{"_layer":"eoliennes",...}}],"meta":{"layers":[{"id":"eoliennes",
"label":"Éoliennes","count":46}],"scope":null,"relation":{"type":"proximite",
"km":10},"coverage_note":"..."}}
```

> **Fusion fiable** : si IAka propose une **étape non-LLM** (code/fonction) pour
> concaténer les features et compter, utilise-la plutôt que de faire ré-écrire
> tous les points par le LLM (moins de risque de perte/altération sur de gros
> volumes). Sinon, le superviseur concatène les tableaux `features` tels quels.
> Dans tous les cas, la SORTIE du workflow ne doit contenir que le JSON final.

---

## 1bis. Nœud de JOINTURE (assembleur final) — VALIDÉ

Le workflow a un **nœud de jointure** en aval qui reçoit les sorties des 2
sous-agents et produit la FeatureCollection finale. Comme il s'exécute **après**
les sous-agents, il évite l'assemblage prématuré. **Câblage : construction ET
interventions → nœud jointure.**

Prompt du nœud de jointure :
```
Tu es le nœud de jointure d'une carte. Tu reçois en entrée les sorties de deux
sous-agents, chacune étant un objet JSON FeatureCollection : la couche CONSTRUCTION
et la couche INTERVENTIONS. Chaque feature porte déjà une propriété "_layer".

Ta tâche : fusionner ces deux FeatureCollections en UNE seule.
1. Récupère le tableau "features" de chaque entrée. Entrée vide/absente/sans
   features → tableau vide (ne bloque pas).
2. Concatène tous les "features" des deux couches dans un seul tableau, sans les
   modifier (garde geometry et properties telles quelles, dont "_layer").
3. Construis "meta.layers" : un objet par couche présente {id=_layer, label, count
   = nombre réel de features de cette couche}.
4. Ajoute meta.scope, meta.relation (proximite+km si applicable), meta.coverage_note.

RÈGLES DE SORTIE — IMPÉRATIF :
- Réponse = EXCLUSIVEMENT l'objet JSON final ({ ... }).
- Aucune balise <tool>, aucun ```, aucun texte ni raisonnement.
- Ne recopie pas les entrées brutes : produis la FeatureCollection fusionnée.
```
Résultat validé (2026-07-27) : 53 features (46 eoliennes + 7 interv), meta correct,
zéro trace d'outil.

## 2. Sous-agent CONSTRUCTION

**Outil** : `execute_sql`. **Entrée** : `{ nature, scope|null }`.
**Sortie** : FeatureCollection, chaque feature `properties._layer` = l'id fourni.

```sql
SELECT json_build_object('type','FeatureCollection',
  'features', COALESCE(json_agg(ST_AsGeoJSON(f.*)::json),'[]'::json)) AS fc
FROM (
  SELECT 'eoliennes' AS _layer,
         c.nature, c.nat_detail, c.toponyme, c.hauteur, c.forme,
         ST_Transform(c.geom,4326) AS geom
  FROM constructions c
  WHERE unaccent(c.nature) ILIKE unaccent('Eolienne')
  -- scope dept optionnel :
  -- AND EXISTS (SELECT 1 FROM "DEPARTEMENTS" d
  --             WHERE unaccent(d."NOM") ILIKE unaccent('Marne')
  --               AND ST_Within(c.geom, d.geom))   -- c.geom & d.geom en 2154
  LIMIT 5000
) f;
```

Prompt système : « Tu produis la couche des constructions d'une nature donnée via
execute_sql (lecture seule). Table `constructions`(nature, nat_detail, toponyme,
hauteur, forme, geom[2154]), couverture Grand Est. IMPÉRATIF SQL : écris les tables
SANS préfixe de base (`constructions`, JAMAIS `bdsp.constructions`). Filtre TOUJOURS
avec unaccent(nature) ILIKE unaccent(:nature) (natures parfois sans accent, ex.
Eolienne). Cadrage département éventuel via "DEPARTEMENTS"("NOM", geom[2154]) et
ST_Within. Produis UNE seule requête renvoyant une FeatureCollection GeoJSON avec le
wrapper json_build_object('type','FeatureCollection','features',
COALESCE(json_agg(ST_AsGeoJSON(f.*)::json),'[]'::json)) sur une sous-requête f
(colonnes + _layer=:id + ST_Transform(geom,4326) AS geom), LIMIT 5000. N'utilise PAS
un simple SELECT de la colonne geom (renverrait du WKB hex). Réponds uniquement par
le JSON renvoyé par la requête. »

---

## 3. Sous-agent INTERVENTIONS

**Outils** : corpus **RAG CRI** + `execute_sql`.
**Entrée** : `{ concept, date_debut, date_fin, near|null, scope|null, id }`.

Déroulé : (1) interroger le RAG avec `concept` pour découvrir les formulations
réelles → liste de termes ; (2) requête exhaustive Postgres.

Utilise la **vue `v_interventions`** (noms de colonnes propres, pas d'accents/
espaces) : `id, date_appel, premieres_infos, cri, commune, geom(4326)`.

```sql
SELECT json_build_object('type','FeatureCollection',
  'features', COALESCE(json_agg(ST_AsGeoJSON(f.*)::json),'[]'::json)) AS fc
FROM (
  SELECT 'interv' AS _layer,
         i.id,
         i.date_appel AS date,
         i.commune,
         left(i.premieres_infos, 200) AS extrait,
         ST_Transform(i.geom,4326) AS geom
  FROM v_interventions i
  WHERE ( i.premieres_infos ILIKE ANY(ARRAY['%pendaison%','%pendu%','%suspension%'])
       OR i.cri             ILIKE ANY(ARRAY['%pendaison%','%pendu%','%suspension%']) )   -- % OBLIGATOIRES
    AND i.date_appel BETWEEN '2026-05-02' AND '2026-06-30'
    AND EXISTS (                               -- near (optionnel) : ≤10 km d'une éolienne
        SELECT 1 FROM constructions c
        WHERE unaccent(c.nature) ILIKE unaccent('Eolienne')
          AND ST_DWithin(ST_Transform(i.geom,2154), c.geom, 10000) )
  LIMIT 5000
) f;
```
- Scope dept : `AND EXISTS (SELECT 1 FROM v_departements d WHERE unaccent(d.nom) ILIKE unaccent('Marne') AND ST_Within(ST_Transform(i.geom,2154), d.geom))`.
- Sans `near` : retirer le bloc EXISTS proximité. Proximité en mètres (`km*1000`), géométries en **2154**.

**PII (suicides)** : ne jamais renvoyer le texte brut — extrait tronqué
(`left(...,200)`), rien dans les logs.

Prompt système : « Tu produis la couche des interventions liées à un concept.
IMPÉRATIF SQL : utilise la VUE `v_interventions`(id, date_appel, premieres_infos,
cri, commune, geom[4326]) — noms simples, PAS la table brute. Tables/vues SANS
préfixe de base (JAMAIS `bdsp.xxx`). Recherche texte en ILIKE avec des `%` autour
des termes : ILIKE ANY(ARRAY['%pendaison%','%pendu%',...]) (les `%` sont
OBLIGATOIRES). Proximité via `constructions`, cadrage via `v_departements`(nom,
geom[2154]). Sortie via le wrapper json_build_object + json_agg(ST_AsGeoJSON(f.*))
(pas de SELECT geom brut = WKB hex). Tu as 2 outils : le corpus RAG des
comptes-rendus, et execute_sql (RO). D'abord
interroge le RAG avec le concept pour établir la liste des termes réellement
employés (le RAG enrichit le vocabulaire, ne filtre pas). Puis UNE requête sur
"donneesMaiJuin26_suicideFrance" : ILIKE ANY(ARRAY[...termes]) sur "Premières
informations (BDSP Synthèse)" et "CRI (BDSP Synthèse)", filtre de dates BETWEEN,
proximité si near (EXISTS + ST_DWithin en 2154, km*1000), scope dept si fourni.
Renvoie une FeatureCollection (_layer=:id, extrait tronqué 200 car., géométrie en
4326), LIMIT 5000. Réponds uniquement par le JSON renvoyé. »

---

## 4. Format de sortie FINAL du workflow (ce que reçoit le BFF)

```json
{
  "type": "FeatureCollection",
  "features": [ /* features de toutes les couches, chacune avec properties._layer */ ],
  "meta": {
    "layers": [
      { "id":"eoliennes", "label":"Éoliennes (BD TOPO — Grand Est)", "count": 46 },
      { "id":"interv",    "label":"Interventions « pendaison » (≤10 km, mai-juin) — recherche élargie", "count": 41 }
    ],
    "scope": { "type":"departement","valeur":"Marne" } | null,
    "relation": { "type":"proximite","km":10 } | null,
    "coverage_note": "Constructions BD TOPO : Grand Est ; interventions : mai-juin 2026."
  }
}
```

Le BFF valide juste que c'est une FeatureCollection, la renvoie au front (qui lit
`_layer` + `meta.layers` pour les couches/légende).

---

## 5. Corpus RAG CRI (ingestion via API IAka)

Un document par intervention. Requête d'extraction (`bdsp_ro`) à pousser dans le
corpus (comme ariane) :
```sql
SELECT id,
       concat_ws(' — ', "Premières informations (BDSP Synthèse)",
                        "CRI (BDSP Synthèse)") AS texte
FROM "donneesMaiJuin26_suicideFrance"
WHERE coalesce("Premières informations (BDSP Synthèse)",'') <> ''
   OR coalesce("CRI (BDSP Synthèse)",'') <> '';
```
~12 000 documents, **PII sensible** (accès restreint).

---

## 6. Aide-mémoire base `bdsp`

**Préférer les VUES aux noms propres** (créées pour fiabiliser le SQL des agents) :

| Objet | Géom | SRID | Colonnes |
|---|---|---|---|
| `constructions` (table) | Point/Line/Poly | 2154 | `nature` (`Eolienne` sans accent), `nat_detail`, `toponyme`, `hauteur`, `forme` |
| **`v_interventions`** (vue) | Point | 4326 | `id`, `date_appel`, `premieres_infos`, `cri`, `commune` |
| **`v_departements`** (vue) | MultiPolygon | 2154 | `nom`, `insee_dep` |

Tables brutes sous-jacentes (à éviter, noms à espaces/accents) :
`donneesMaiJuin26_suicideFrance`, `DEPARTEMENTS`/`COMMUNES`/`REGIONS`.

Règles :
- **Noms de tables SANS préfixe de base** : écris `constructions`, PAS
  `bdsp.constructions` (`bdsp` est la BASE, pas un schéma → `bdsp.constructions`
  = « relation does not exist »). Le schéma est `public`, implicite.
- Géométrie de sortie via le **wrapper** `json_agg(ST_AsGeoJSON(f.*))` (§0) — un
  simple `SELECT ... geom` renvoie du WKB hex illisible.
- Jointures spatiales en **2154** (interventions 4326 → `ST_Transform(i.geom,2154)`) ;
  sortie GeoJSON **4326** ; `unaccent(...)` des deux côtés ; colonnes à
  espaces/accents entre guillemets doubles.

## 7. Checklist de test

- [ ] Superviseur : phrase exemple → dispatch correct + sortie JSON conforme (§4).
- [ ] Construction : `nature=Eolienne` → ~46 features, `_layer=eoliennes`, géom 4326.
- [ ] Interventions sans near : concept `pendaison`, mai-juin → features (base ILIKE ≈ 734).
- [ ] Interventions avec near 10 km : sous-ensemble non vide, cohérent Grand Est.
- [ ] Sortie finale = 1 FeatureCollection + `meta.layers`, aucun texte/balise, extraits ≤ 200 car.
- [ ] Latence acceptable (vérifier si les sous-agents tournent en parallèle ou en séquence côté IAka).
```
