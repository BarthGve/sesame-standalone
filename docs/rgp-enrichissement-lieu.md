# Enrichissement du lieu des faits — table compagnon `una_lieu`

But : classer le **type de lieu** d'un fait (cambriolage / vol par effraction) à partir
du texte libre `una.synthese`, et — en option — **géocoder** l'adresse, dans une table
compagnon. L'agent de consultation SQL filtre ensuite sur `type_lieu` (JOIN) au lieu de
faire du keyword-matching fragile sur `synthese`.

## Pourquoi une table compagnon (et pas une colonne dans `una`)

`ALTER TABLE una` n'est pas autorisé. Solution : une **nouvelle table** `una_lieu`
avec FK vers `una.id`, remplie par un job LLM offline, lue par l'agent via `LEFT JOIN`.
Précédent dans le repo : `perquisition` (migrations `rgp-api`) référence déjà `una(id)`
dans la même base, avec `adresse/code_postal/commune/latitude/longitude/type_lieu` et un
`GRANT SELECT ... TO iaka_ro`. Même patron, appliqué au lieu du *fait*.

## Schéma

```sql
CREATE TABLE una_lieu (
  id           serial PRIMARY KEY,
  una_id       integer NOT NULL REFERENCES una(id) ON DELETE CASCADE,
  -- Phase 1 : classification (toujours renseignée)
  type_lieu    text CHECK (type_lieu IN
                 ('LOCAL_PRO','HABITATION','LIEU_PUBLIC','VEHICULE','INDETERMINE')),
  confiance    numeric,                    -- confiance classif 0.0-1.0
  extrait      text,                       -- citation de synthese justifiant
  -- Phase 2 : géolocalisation (optionnelle, NULL tant que non géocodé)
  adresse_norm text,                       -- adresse normalisée (BAN)
  code_postal  varchar(5),
  commune      varchar(5) REFERENCES communes(code_insee),
  latitude     numeric(9,6),
  longitude    numeric(9,6),
  ban_score    numeric,                    -- qualité géocodage BAN 0.0-1.0
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_una_lieu_una  ON una_lieu(una_id);
CREATE INDEX idx_una_lieu_type ON una_lieu(type_lieu);
GRANT SELECT ON una_lieu TO iaka_ro;       -- l'agent lit
-- le job d'enrichissement écrit avec le rôle rgp_api (INSERT/UPDATE)
```

`serial PK` + `una_id` non unique → gère **1 procédure : N scènes**.

## Garde-fous

1. **Découpler `type_lieu` et adresse.** Beaucoup de synthèses n'ont aucune adresse
   (« cambriolage de la boulangerie »). `type_lieu` reste déductible sans adresse.
   Les colonnes phase 1 et phase 2 sont indépendamment NULLables : ne jamais faire
   dépendre le type de la présence d'une adresse.
2. **BAN ≠ type d'activité.** BAN normalise une adresse, il ne dit pas « c'est un
   commerce ». `type_lieu` reste produit par le LLM. (Activité fiable = SIRENE,
   évolution ultérieure — cf. bas de doc.)
3. **PII / sensibilité.** Les adresses de victimes sont sensibles (`una.sensible`
   existe déjà). Stocker des adresses normalisées = sujet protection des données,
   à valider avant la phase 2.

## Séquençage

- **Phase 1 (le vrai besoin)** : remplir `type_lieu / confiance / extrait`. Léger.
  Résout la classification « locaux pro » tout de suite.
- **Phase 2 (bonus carto)** : remplir `adresse_norm + géo` via BAN quand la carte
  est voulue. Mêmes lignes, colonnes géo passées de NULL à valeurs.

---

## Périmètre d'exécution du job

Ne classer QUE les procédures pertinentes, et rester idempotent :

```sql
SELECT u.id, u.synthese, u.commune
FROM una u
LEFT JOIN una_lieu l ON l.una_id = u.id
WHERE u.synthese ~* 'cambriol|effraction|introduction|vol par effraction'
  AND l.una_id IS NULL;          -- pas encore enrichi
```

Relancer sur INSERT/UPDATE de `synthese` (trigger → file, ou cron balayant les manquants).

## Pipeline d'enrichissement (2 sous-étapes)

```
synthese
  ├─ 1. LLM  → { type_lieu, confiance, extrait, adresse_texte }     (extraction)
  └─ 2. BAN  → géocode adresse_texte → adresse_norm, CP, commune INSEE, lat/lon, score
             (Phase 2 seulement ; ignorer si adresse_texte vide ou phase 1)
```

BAN = `https://api-adresse.data.gouv.fr/search/?q=<adresse>&citycode=<insee>` — géocodeur
officiel FR, gratuit. Rend `citycode` (INSEE), `postcode`, coordonnées, `score`. Passer
`una.commune` en `citycode` pour cadrer la recherche.

### Prompt système du classifieur (étape 1)

```
Tu es un classifieur de procédures judiciaires de la gendarmerie. On te donne un
LOT de synthèses (texte libre décrivant l'objet d'une procédure). Pour CHAQUE
synthèse, tu détermines le TYPE DE LIEU du fait (cambriolage / vol par effraction),
tu extrais l'adresse si elle est présente, et tu renvoies un objet JSON.

## Taxonomie FERMÉE — n'invente jamais d'autre valeur

- LOCAL_PRO    : lieu à usage professionnel/commercial/industriel/agricole.
                 Commerce, magasin, boutique, tout nom en -erie (boulangerie,
                 boucherie, épicerie…), pharmacie, restaurant, bar, hôtel, tabac,
                 banque, station-service, entrepôt, usine, atelier, chantier,
                 garage, bureau, cabinet, étude, société/entreprise (SARL, SAS,
                 SA, EURL, SCI), exploitation agricole, hangar.
- HABITATION   : domicile, maison, appartement, résidence, pavillon, logement,
                 villa, studio, « au domicile de ».
- LIEU_PUBLIC  : voie publique, parking public, école, mairie, gymnase, lieu de
                 culte, cimetière.
- VEHICULE     : voiture, camion, fourgon, scooter ; vol dans/du véhicule.
- INDETERMINE  : la synthèse ne permet pas de trancher (trop courte, générique,
                 lieu non mentionné). Valeur LÉGITIME — ne devine JAMAIS.

## Règles

1. Fonde-toi UNIQUEMENT sur le texte de la synthèse. Aucune connaissance externe.
2. Ambiguïté ou absence d'indice de lieu → INDETERMINE. Ne devine pas.
3. Plusieurs lieux cités → celui du fait principal.
4. `confiance` = certitude sur type_lieu (0.0-1.0). INDETERMINE peut être très
   confiant (« aucun lieu mentionné » = certain que c'est indéterminé).
5. `extrait` = citation EXACTE et COURTE justifiant type_lieu (vide si INDETERMINE).
6. `adresse_texte` = l'adresse littérale si présente dans la synthèse (numéro, rue,
   voie), sinon chaîne vide. NE PAS inventer d'adresse.
7. Sortie : UNIQUEMENT un tableau JSON valide, un objet par entrée, MÊME ORDRE,
   même `una_id`. Aucun texte hors JSON.

## Format de sortie

[
  { "una_id": 123, "type_lieu": "LOCAL_PRO", "confiance": 0.95,
    "extrait": "cambriolage de la boulangerie", "adresse_texte": "12 rue des Lilas" }
]

## Exemples

Entrée :
[
  {"una_id": 1, "synthese": "Cambriolage de la boulangerie, 12 rue des Lilas, vitrine fracturée"},
  {"una_id": 2, "synthese": "Vol par effraction au préjudice de la SARL Dubois, entrepôt visité"},
  {"una_id": 3, "synthese": "Introduction dans un local agricole, matériel dérobé"},
  {"una_id": 4, "synthese": "Cambriolage d'un pavillon, porte-fenêtre forcée"},
  {"una_id": 5, "synthese": "Vol par effraction au domicile de M. X, 4 impasse du Puits"},
  {"una_id": 6, "synthese": "Vol à la roulotte, véhicule fracturé sur le parking"},
  {"una_id": 7, "synthese": "Dégradations et vol dans l'école communale"},
  {"una_id": 8, "synthese": "Effraction d'un local, plusieurs objets dérobés, enquête en cours"},
  {"una_id": 9, "synthese": "Cambriolage, plainte déposée"}
]

Sortie :
[
  {"una_id": 1, "type_lieu": "LOCAL_PRO",   "confiance": 0.97, "extrait": "boulangerie, vitrine fracturée", "adresse_texte": "12 rue des Lilas"},
  {"una_id": 2, "type_lieu": "LOCAL_PRO",   "confiance": 0.96, "extrait": "SARL Dubois, entrepôt visité", "adresse_texte": ""},
  {"una_id": 3, "type_lieu": "LOCAL_PRO",   "confiance": 0.9,  "extrait": "local agricole", "adresse_texte": ""},
  {"una_id": 4, "type_lieu": "HABITATION",  "confiance": 0.95, "extrait": "pavillon, porte-fenêtre forcée", "adresse_texte": ""},
  {"una_id": 5, "type_lieu": "HABITATION",  "confiance": 0.97, "extrait": "au domicile de M. X", "adresse_texte": "4 impasse du Puits"},
  {"una_id": 6, "type_lieu": "VEHICULE",    "confiance": 0.94, "extrait": "véhicule fracturé sur le parking", "adresse_texte": ""},
  {"una_id": 7, "type_lieu": "LIEU_PUBLIC", "confiance": 0.9,  "extrait": "école communale", "adresse_texte": ""},
  {"una_id": 8, "type_lieu": "INDETERMINE", "confiance": 0.85, "extrait": "", "adresse_texte": ""},
  {"una_id": 9, "type_lieu": "INDETERMINE", "confiance": 0.9,  "extrait": "", "adresse_texte": ""}
]
```

Note : le LLM connaît déjà « boulangerie = commerce ». Aucun lexique de métiers à
maintenir — c'est tout l'intérêt vs le regex 2a.

### Géocodage BAN (étape 2, phase 2 seulement)

Pour chaque `adresse_texte` non vide :

```
GET https://api-adresse.data.gouv.fr/search/?q=<adresse_texte>&citycode=<una.commune>&limit=1
→ features[0].properties : { citycode, postcode, score }, geometry.coordinates : [lon, lat]
```

Ne conserver que `score >= 0.5` (sinon adresse trop incertaine → laisser géo à NULL).

## Écriture en base (rôle avec droit d'écriture — PAS `iaka_ro`)

```sql
INSERT INTO una_lieu (una_id, type_lieu, confiance, extrait,
                      adresse_norm, code_postal, commune, latitude, longitude, ban_score)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
ON CONFLICT (una_id) DO UPDATE SET
  type_lieu=EXCLUDED.type_lieu, confiance=EXCLUDED.confiance, extrait=EXCLUDED.extrait,
  adresse_norm=EXCLUDED.adresse_norm, code_postal=EXCLUDED.code_postal,
  commune=EXCLUDED.commune, latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude,
  ban_score=EXCLUDED.ban_score, updated_at=now();
```

(Passer `una_id` en UNIQUE si tu veux 1 seule ligne/procédure ; retirer la contrainte
pour autoriser N scènes — alors gérer l'upsert autrement qu'en ON CONFLICT(una_id).)

---

## Patch du prompt de l'agent de consultation SQL

Ajouter au **### Schéma** :

    Table compagnon `una_lieu` (LEFT JOIN una_lieu l ON l.una_id = una.id) :
    - l.type_lieu : LOCAL_PRO | HABITATION | LIEU_PUBLIC | VEHICULE | INDETERMINE
    - l.confiance (0-1), l.extrait (citation), l.adresse_norm, l.latitude, l.longitude

Ajouter au **### Règles** :

    - Type de lieu (locaux pro, commerce, habitation, véhicule…) : JOINDRE una_lieu
      et filtrer/grouper sur l.type_lieu. JAMAIS de mot-clé sur synthese.
    - INDETERMINE de confiance < 0.6 = « à relire manuellement » (pas « Autre »).

Exemples à ajouter :

    « les cambriolages dans des locaux professionnels »
      SELECT u.unite||'/'||u.numero||'/'||u.annee AS una, u.synthese, l.extrait
      FROM una u LEFT JOIN una_lieu l ON l.una_id = u.id
      WHERE u.unite=15127 AND u.synthese ~* 'cambriol|effraction'
        AND l.type_lieu='LOCAL_PRO'
      ORDER BY u.numero DESC

    « répartition des cambriolages par type de lieu »
      SELECT COALESCE(l.type_lieu,'INDETERMINE') AS type_lieu, count(*) AS nombre
      FROM una u LEFT JOIN una_lieu l ON l.una_id = u.id
      WHERE u.unite=15127 AND u.synthese ~* 'cambriol|effraction'
      GROUP BY 1 ORDER BY 2 DESC

---

## Évolution : activité via SIRENE

Pour les cas où le type dépend d'un nom propre (« chez Établissements Durand »), le LLM
seul ne peut trancher personne vs société. Ajouter alors un **lookup SIRENE** (base INSEE
open data) : `nom + commune → raison sociale + code APE/NAF`. Le code APE donne l'activité
réelle. À traiter comme un **outil structuré** (pas un RAG sémantique). Optionnel, après
que la classif LLM de base soit en place.
```