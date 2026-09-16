# Carte composable en langage naturel — multi-agents IAka

**Date** : 2026-07-25
**Statut** : design validé, prêt pour plan d'implémentation
**Feature** : évolution de `src/features/carte`

## 1. But

Construire une carte **en langage naturel** en **associant plusieurs jeux de
données** hétérogènes via une seule phrase. Chaque source = un **agent IAka
spécialisé** ; un **agent Planner** en entrée dispatche le travail ; le BFF
exécute les agents en parallèle et fusionne leurs sorties en carte multi-couches.

Démonstrateur de la capacité **agentique** d'IAka : planification (dispatch),
outils (Postgres RO + RAG), composition spatiale (proximité, cadrage
administratif).

### Exemple cible v1

> « les éoliennes et les interventions où le compte-rendu parle de pendaison,
> à moins de 10 km d'une éolienne, en mai-juin »

Résultat : 2 couches — éoliennes (points) + interventions liées au concept
« pendaison » à ≤ 10 km d'une éolienne, sur la fenêtre couverte (mai-juin 2026).

## 2. Périmètre v1

**Dans** : agents `construction` + `interventions`, agent Planner (dispatcher),
**relation de proximité** inter-couches, **cadrage par département** (optionnel),
expansion de concept assistée RAG, écran carte enrichi.

**Hors v1** : châteaux d'eau (absents des données), recherche vectorielle top-k
comme filtre principal (le RAG sert à l'expansion de vocabulaire, pas au filtrage).

## 3. Faits établis (données réelles, inspection OVH 2026-07-25)

Base = conteneur **`brunogauville-postgis-bdsp-1`** (`postgis/postgis:16-3.5`),
base **`bdsp`**, owner `n8n`. Outil Postgres des agents IAka =
**`database-toolbox`** (déjà en place pour RENS : `brunogauville-rens-toolbox-1`).

Tables et SRID (`geometry_columns`) :

| Table | Géom | SRID | Rôle |
|---|---|---|---|
| `donneesMaiJuin26_suicideFrance` | Point | **4326** | **interventions** (12 224 lignes) |
| `DEPARTEMENTS` | MultiPolygon | **2154** | cadrage (`NOM`, `INSEE_DEP`) |
| `COMMUNES` | MultiPolygon | 2154 | cadrage fin |
| `REGIONS` | MultiPolygon | 2154 | — |
| `gn_limites_cgd`, `gn_limites_cob_bta` | MultiPolygon | 3857 | limites gendarmerie (hors v1) |
| `constructions` *(à créer)* | Point/Line/Poly | **2154** | BD TOPO `data_geoint` |

Colonnes clés de `donneesMaiJuin26_suicideFrance` (noms à **quoter** —
espaces/accents) :
- `geom` (Point 4326)
- Texte libre CRI : **`"Premières informations (BDSP Synthèse)"`** et
  **`"CRI (BDSP Synthèse)"`** (la donnée dit « CRI », pas « CRO » — c'est là
  qu'on cherche « pendaison »).
- Date intervention : **`"Date/Heure Appel (BDSP Synthèse)"`**.

Faits qui cadrent la feature :
- **Couverture temporelle = 2026-05-02 → 2026-06-30 uniquement.** Toute date hors
  mai-juin 2026 renvoie vide. L'exemple utilise donc **mai-juin** (pas « 1er mars »).
  Un seul millésime ⇒ filtre par plage de dates simple (pas de saisonnier récurrent).
- **734** interventions matchent `pendaison`/`pendu` en simple `ILIKE`. Donc la
  recherche texte Postgres donne déjà une **base exhaustive** ; le RAG sert à
  **élargir le vocabulaire**, pas à filtrer.
- Données = **suicides** → **PII sensible** : rôle RO, `LIMIT`, **aucun texte CRI
  ni PII dans les logs**, extraits tronqués côté sortie.
- **Constructions `data_geoint` = Grand Est uniquement**, **UTF-8**, EPSG:2154.
  Natures utiles (valeurs exactes en base) : **`Eolienne` (46, SANS accent)**,
  `Antenne` (2974), `Pont` (16902), `Transformateur`… **pas de château d'eau**.
  ⇒ l'agent doit matcher en **insensible aux accents** (`unaccent(nature) ILIKE
  unaccent(:nature)`, extension `unaccent`) pour éviter le piège Eolienne/Éolienne.
  46 éoliennes ⇒ rayon de proximité à calibrer (10 km peut être maigre ;
  l'exemple pourra viser Antenne/Pont si besoin de densité).
- **`shp2pgsql` absent** de l'image postgis (et `ogr2ogr` aussi) → ingestion des
  constructions par voie alternative (§7).
- **MapView** gère déjà points (cercles+clusters) et polygones (fill/line).
- Corpus RAG IAka **alimentable par API** (pattern *ariane* `/api/ariane/corpus/*`).

## 4. Architecture

**Topologie retenue (2026-07-27) : UN seul workflow IAka multi-agents** (Option B).
L'orchestration + le merge vivent **dans IAka**, pas dans le BFF. Détail
opérationnel des agents : `docs/iaka/bloc3-agents-carte.md`.

```
                       phrase NL
                          │
        BFF  POST /api/carte/compose   (job async — 1 seul execWorkflow)
                          │
        ┌─────────────────▼──────────────────┐  WORKFLOW IAka unique
        │  SUPERVISEUR : planifie, dispatche, │
        │  ASSEMBLE la sortie finale          │
        │     ├─► sous-agent CONSTRUCTION  (execute_sql)          │
        │     └─► sous-agent INTERVENTIONS (RAG + execute_sql)    │
        └─────────────────┬──────────────────┘
                          │  FeatureCollection taggée `_layer` + meta
                          ▼
                    carte multi-couches (BFF renvoie tel quel)
```

- Chaque sous-agent s'auto-cadre contre le PostGIS partagé et **tagge ses features
  `_layer`**. L'agent interventions résout la proximité lui-même (`ST_DWithin` sur
  `constructions`). Le superviseur concatène les features + construit `meta`
  (idéalement via une étape non-LLM si IAka en propose une).
- **BFF trivial** : un seul appel workflow, il valide et renvoie la
  FeatureCollection. Plus de fan-out/merge côté BFF (cf. §9).
- **Extensibilité** : ajouter une source = nouveau sous-agent + un `type` de couche
  connu du superviseur. Pas de réécriture du cœur.
- **Normalisation CRS** : jointures spatiales en **2154** (métrique) — interv
  `ST_Transform(geom,2154)` ; sortie GeoJSON en **4326** (`ST_Transform(…,4326)`).

## 5. Contrat de plan (sortie du Planner)

```json
{
  "scope": { "type": "departement", "valeur": "Marne" },   // optionnel
  "layers": [
    { "id": "eoliennes", "type": "construction",
      "params": { "nature": "Éolienne" } },

    { "id": "interv", "type": "interventions",
      "params": {
        "concept": "pendaison",
        "date_debut": "2026-05-01", "date_fin": "2026-06-30",
        "near": { "layer_type": "construction", "nature": "Éolienne", "km": 10 }
      } }
  ]
}
```

- `scope` optionnel : cadrage administratif (`departement` via `DEPARTEMENTS."NOM"`
  ou `INSEE_DEP` ; `commune` possible v2). Appliqué par chaque agent concerné.
- `near` optionnel : relation de proximité, résolue dans l'agent interventions
  (`ST_DWithin`). Absente ⇒ couches indépendantes.
- `type` ∈ registre { `construction`, `interventions` } (extensible).
- Le BFF **valide le plan** (schéma) avant dispatch ; `type` inconnu ⇒
  `PLAN_INVALIDE`, aucun agent lancé.

## 6. Agents de couche

### 6.1 Agent construction (IAka + outil Postgres RO)
- Entrée : `params.nature`, `scope?`.
- SQL paramétré :
  ```sql
  SELECT ST_AsGeoJSON(ST_Transform(c.geom, 4326)) AS g,
         c.nature, c.nat_detail, c.toponyme, c.hauteur, c.forme
  FROM constructions c
  [ JOIN "DEPARTEMENTS" d
      ON d."NOM" ILIKE :dept AND ST_Within(c.geom, d.geom) ]   -- si scope
  WHERE unaccent(c.nature) ILIKE unaccent(:nature)   -- Eolienne sans accent
  LIMIT :max_rows;
  ```
- Sortie : FeatureCollection (géométrie selon `forme`).

### 6.2 Agent interventions (IAka + outil RAG + outil Postgres RO) — **app BDSP réutilisée**
1. **Expansion de concept** : le RAG interroge le corpus CRI pour découvrir les
   formulations réelles du `concept` (« pendaison » → pendu, suspension,
   « retrouvé pendu », « corps pendu à »…) → **liste de termes**.
2. **Recherche exhaustive Postgres** sur ces termes + filtres :
   ```sql
   SELECT ST_AsGeoJSON(i.geom) AS g,                       -- déjà 4326
          i.id, i."Date/Heure Appel (BDSP Synthèse)" AS date,
          left(i."Premières informations (BDSP Synthèse)", 200) AS extrait
   FROM "donneesMaiJuin26_suicideFrance" i
   [ JOIN constructions c                                   -- si near
       ON c.nature ILIKE :near_nature
      AND ST_DWithin(ST_Transform(i.geom,2154), c.geom, :km*1000) ]
   [ JOIN "DEPARTEMENTS" d                                  -- si scope
       ON d."NOM" ILIKE :dept
      AND ST_Within(ST_Transform(i.geom,2154), d.geom) ]
   WHERE ( i."Premières informations (BDSP Synthèse)" ILIKE ANY(:termes)
        OR i."CRI (BDSP Synthèse)"                    ILIKE ANY(:termes) )
     AND i."Date/Heure Appel (BDSP Synthèse)" BETWEEN :d1 AND :d2
   LIMIT :max_rows;
   ```
- Sortie : FeatureCollection ; extraits CRI **tronqués** (PII).
- Couche **exhaustive** sur les termes retenus (labellisée « recherche élargie »).

## 7. Données & ingestion

- **`constructions`** : charger les 3 shapefiles `data_geoint` dans **une table
  mixte** (`id, nature, nat_detail, toponyme, hauteur, forme, geom(2154)`),
  index **GiST** sur `geom`, `forme ∈ {ponctuel, lineaire, surfacique}`.
  `shp2pgsql` absent ⇒ **voie retenue : `ogr2ogr` depuis un conteneur GDAL
  jetable** (`osgeo/gdal`) branché sur le réseau docker `brunogauville_default` :
  ```
  ogr2ogr -f PostgreSQL PG:"host=postgis-bdsp dbname=bdsp user=…" \
    CONSTRUCTION_PONCTUELLE.shp -nln constructions -overwrite -nlt GEOMETRY \
    -s_srs EPSG:2154 -t_srs EPSG:2154 \
    -lco GEOMETRY_NAME=geom -lco LAUNDER=YES -lco SPATIAL_INDEX=GIST \
    -sql "SELECT *, 'ponctuel' AS forme FROM CONSTRUCTION_PONCTUELLE"
  ```
  (1er fichier `-overwrite`, les 2 autres `-append` avec `forme`=lineaire/
  surfacique). `-nlt GEOMETRY` = géom mixte Point/Line/Polygon en une colonne.
  PK auto = `ogc_fid` (serial) ; l'`ID` BD TOPO d'origine reste en colonne `id`
  (varchar). Rien à installer dans postgis. **Modif prod** ⇒ script
  **`scripts/ingest-constructions.sh`** (documenté, idempotent, confirmation +
  `--dry-run`). **Testé end-to-end en local** (postgis+GDAL jetables) : 42389
  objets (9060/31094/2235), SRID 2154, index GiST, sortie 4326 OK.
- **`DEPARTEMENTS`/`COMMUNES`** : déjà présentes, réutilisées telles quelles.
- **Corpus RAG CRI** : alimenté **par API IAka**. Document = texte
  (`Premières informations` + `CRI`) + métadonnée `id`. Sert **uniquement** à
  l'expansion de vocabulaire ; géo/dates/complétude restent **autoritatifs en
  Postgres**. Script de synchro rejouable ; **pas de PII en logs**.

## 8. Contrat de sortie (produit par le workflow IAka, renvoyé tel quel par le BFF)

```json
{
  "type": "FeatureCollection",
  "features": [
    { "geometry": {…}, "properties": { "_layer": "eoliennes", "nature": "Éolienne", … } },
    { "geometry": {…}, "properties": { "_layer": "interv", "date": "…", "extrait": "…" } }
  ],
  "meta": {
    "layers": [
      { "id": "eoliennes", "label": "Éoliennes (BD TOPO — Grand Est)", "geom": "point", "count": 46 },
      { "id": "interv",    "label": "Interventions « pendaison » (≤10 km, mai-juin) — recherche élargie",
        "geom": "point", "count": 41 }
    ],
    "scope": { "type": "departement", "valeur": "Marne" },
    "relation": { "type": "proximite", "km": 10 },
    "coverage_note": "Constructions BD TOPO : couverture Grand Est ; interventions : mai-juin 2026.",
    "degraded": false
  }
}
```

## 9. Front

- **Route** : `POST /api/carte/compose` (job async, pattern `createGenericJob` /
  `/api/job/status`). **Un seul `execWorkflow`** vers le workflow multi-agents
  IAka (Option B) ; le BFF valide que la réponse est une FeatureCollection et la
  renvoie. Plus d'orchestration/merge côté BFF. Remplace l'usage mono-source de
  `/api/query` dans l'écran carte.
- **MapView** : généralisé de 2 buckets → **N couches** clé `properties._layer`
  (1 source+layer(s) MapLibre par couche ; style par géom/couche). `fitBounds`
  sur l'union.
- **Legend** : depuis `meta.layers`, **toggle par couche** ; affiche
  `coverage_note` et le label « recherche élargie ». **Aucun emoji** (règle
  projet) — icônes vectorielles / Material Icons.
- **carteStore** : `data` = FeatureCollection + `meta` ; `show` = `{ [layerId]:
  bool }`. Persistance F5 conservée.

## 10. Sécurité & robustesse

- **Rôle Postgres RO unique `bdsp_ro`** (SELECT only, `unaccent`,
  `statement_timeout=30s`, `LIMIT` plafonné) — via le **MCP Toolbox PostgreSQL
  intégré à IAka** (connexion directe, pas de toolbox auto-hébergé ; cf.
  `infra/bdsp-toolbox/README.md`). Accès réseau = **allowlist firewall OVH**
  (port 5433).
- **PII** (suicides) : jamais de texte CRI/PII en logs ; extraits tronqués en
  sortie ; corpus RAG traité comme sensible.
- **Sortie validée** par le BFF : doit être une FeatureCollection (retry sur
  réponse IAka non conforme, comme `/api/query`).
- **Échec** : le workflow gère l'assemblage ; une couche vide ⇒ carte partielle
  (le superviseur peut poser `meta.degraded`).

## 11. Variables d'environnement

```
IAKA_CARTE_COMPOSE_APP_ID        # LE workflow multi-agents (superviseur + sous-agents)
IAKA_CRI_CORPUS_ID               # corpus RAG CRI (interrogé par le sous-agent interventions)
```
(`RGP_API_*` / `RENS_API_*` inchangés. Connexion Postgres = connecteur IAka
`bdsp` : `91.134.75.161:5433`, db `bdsp`, user `bdsp_ro`.)

## 12. Tests

- **BFF** (`node --test`) : route `/api/carte/compose` (job async), validation que
  la réponse IAka est une FeatureCollection, retry sur non conforme, gestion
  erreurs/timeout.
- **Front** (Vitest) : rendu MapView multi-couches (clé `_layer`), toggle par
  couche, legend depuis `meta.layers`, `carteStore`.
- Workflow IAka : testé via la plateforme (hors CI front/BFF) — cf. checklist
  `docs/iaka/bloc3-agents-carte.md`.

## 13. Hypothèses à confirmer (non bloquantes)

1. **API RAG IAka** : endpoints d'alimentation + interrogation du corpus, format
   des métadonnées, comment l'agent récupère la liste de termes. Aligner sur
   *ariane*.
2. **Support IAka des sous-agents** : parallélisme (latence) et existence d'une
   **étape non-LLM** pour l'assemblage/merge des FeatureCollections.
3. **Calibrage démo** : rayon de proximité et nature (46 éoliennes ⇒ peut-être
   élargir le rayon ou viser une nature plus dense pour un rendu parlant).

_(Faits : ingestion `constructions` OK en prod §7 ; rôle `bdsp_ro` + connecteur
IAka + firewall 5433 OK §10.)_
