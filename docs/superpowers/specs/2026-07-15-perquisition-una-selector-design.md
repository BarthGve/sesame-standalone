# Design — Sélection UNA existant + rouvrir une perquisition

Date : 2026-07-15
Statut : validé (brainstorming), prêt pour plan d'implémentation

## Objectif

Donner un front simple pour :
1. **Créer** une perquisition rattachée à un **UNA existant** choisi dans la base (plus de saisie
   libre du numéro), en recyclant le formulaire de perquisition existant.
2. **Rouvrir** une perquisition existante en **consultation**, avec possibilité d'**ajouter**
   de nouveaux objets saisis (le lieu et les objets existants restent en lecture seule).

Suite de la feature `2026-07-10-perquisitions-una` (schéma + API + front d'enregistrement déjà livrés).

## Décisions actées (brainstorming)

| Sujet | Décision |
|---|---|
| Rouvrir une perquisition | **Consultation + ajout d'objets** (lieu et objets existants en lecture seule ; ajout de nouveaux objets possible) |
| Choix de l'UNA | **Liste déroulante filtrable** via `GET /api/procedures` (filtres année/unité ; affiche una + type + commune + synthèse) |
| Navigation | **UNA d'abord** : accueil = choisir un UNA → ses perquisitions + « Nouvelle perquisition » |
| Sauvegarde des ajouts | **Batch** : les nouveaux objets s'accumulent, un seul « Enregistrer les ajouts » |

## Contexte existant (rappel)

- Front `src/features/saisies/SaisiesApp.tsx` (831 l.) : `SetupScreen` (formulaire perquisition,
  avec un champ UNA texte libre ajouté au précédent incrément), `Inventory` (liste des objets),
  `Wizard` (`StepPhoto`/`StepFiche`/`StepValidation`), producteurs de `Perquisition` + `ObjetSaisi[]`
  en mémoire. Monté via `App.tsx` (onglet `saisies`).
- Client `src/features/saisies/perquisitionApi.ts` : `buildPerquisitionPayload`, `savePerquisition`.
- Proxy `server/proxy.mjs` : forwarde déjà `GET /api/procedures`, `GET /api/perquisitions`,
  `GET /api/perquisition`, `POST /api/perquisition`, `GET /api/objets/recherche` vers rgp-api.
- rgp-api `server/rgp-api/` : `perquisition.js` (`createPerquisition`, `getPerquisition`,
  `listPerquisitions`, `searchObjets`, `extractIdentifiants`, `normalizeIdent`). `err()` renvoie
  toujours HTTP 200 avec `{ error:{ code, message } }` ; succès = `{ data }`.
- `GET /procedures` (rgp-api `listUna`) renvoie des lignes riches : `una`, `unite`, `numero`,
  `annee`, `type_libelle`, `groupe_libelle`, `synthese`, `commune_libelle`, `urgent`, `sensible`,
  filtrables par `type`, `unite`, `annee`, `groupe`, `urgent`, `sensible`, `limit` (défaut 200).

## 1. Navigation — machine à états dans SaisiesApp

Nouvel état `screen: "home" | "una" | "perq"` (remplace le pilotage actuel basé seulement sur
`perquisition`/`editingPerq`). État additionnel :
- `selectedUna: { una: string; ... } | null` — la procédure choisie (ligne `/procedures`).
- `perqMode: "create" | "consult"` — mode de l'écran `perq`.
- `openedPerquisition: PerquisitionDetail | null` — perquisition chargée en consultation.

Transitions :
- `home` → (clic UNA) → `una` : charge `listPerquisitions(una)`.
- `una` → « Nouvelle perquisition » → `perq` mode `create` (UNA = `selectedUna.una`).
- `una` → (clic perquisition existante) → charge `getPerquisition(id)` → `perq` mode `consult`.
- `perq` → retour → `una` ; `una` → retour → `home`.

## 2. Backend — endpoint d'ajout d'objets

Refactor DRY : extraire de `createPerquisition` la boucle d'insertion d'un objet (objet_saisi +
objet_champ + objet_identifiant + objet_estimation_source/hypothese + objet_categorie_alternative)
dans un helper `insertObjets(client, perqId, objets)`. `createPerquisition` l'appelle ; le nouvel
endpoint aussi.

Nouvelle fonction `addObjets(pool, body)` dans `perquisition.js` :
- valide `body.perquisition_id` (entier) et `body.objets` (array non vide) ;
- vérifie que la perquisition existe (`SELECT id FROM perquisition WHERE id=$1`) → 404 sinon ;
- transaction : `insertObjets(client, perquisition_id, body.objets)` ; COMMIT ;
- renvoie `getPerquisition(client, perquisition_id)` (relecture via le client de transaction,
  comme le fix anti-deadlock existant).

Route `server.js` : `POST /perquisition/objets` (après le bloc auth, style des routes existantes) :
`json(res, 200, { data })` sur succès, `err(res, out.code, out.error.code, out.error.message)` sinon.

Proxy `server/proxy.mjs` : ajouter à `RGP_ROUTES` l'entrée `"POST /api/perquisition/objets": "/perquisition/objets"`.

OpenAPI : ajouter le chemin.

## 3. Front — clients + mapping

`perquisitionApi.ts` étendu (tous avec `fetchImpl: typeof fetch = fetch` injectable, gestion de
l'enveloppe HTTP-200-`{error}` comme `savePerquisition`) :

- `listProcedures(params?: { annee?: string; unite?: string; limit?: number }): Promise<Procedure[]>`
  → `GET /api/procedures` (+ query). `Procedure` = `{ una: string; type?: string; commune_libelle?: string; synthese?: string; urgent?: boolean; sensible?: boolean }` (champs utiles pour l'affichage).
- `listPerquisitions(una: string): Promise<PerquisitionSummary[]>` → `GET /api/perquisitions?una=`.
  `PerquisitionSummary` = `{ id: number; adresse: string; commune_libelle?: string; type_lieu?: string; date_debut?: string; created_at: string; nb_objets: number }`.
- `getPerquisition(id: number): Promise<PerquisitionDetail>` → `GET /api/perquisition?id=`.
  `PerquisitionDetail` = forme brute API (snake_case) : `{ id, una, adresse, code_postal, commune_libelle, type_lieu, perquisitionne, opj, date_debut, intervenants: string[], pieces: string[], objets: ApiObjet[] }`.
  `ApiObjet` = `{ id, categorie, sous_type, numero_scelle, situation, lieu, champs: {cle,libelle,valeur,source,obligatoire}[], identifiants: {type,valeur}[], estimation_sources, estimation_hypotheses, categories_alternatives }`.
- `addObjets(perquisitionId: number, objets: ObjetSaisi[]): Promise<{ id: number }>` →
  `POST /api/perquisition/objets` avec `{ perquisition_id, objets: objets.map(mapObjet) }` (réutilise
  le mapping objet de `buildPerquisitionPayload`, extrait en helper `mapObjet(o)`).

Pas de reverse-mapping complet vers `ObjetSaisi` : l'affichage lecture seule des objets existants
consomme directement `ApiObjet` (catégorie, scellé, champs remplis). Les nouveaux objets ajoutés
sont produits par le `Wizard` existant (type `ObjetSaisi`) et envoyés via `addObjets`.

## 4. Écrans & recyclage

- **`UnaPicker`** (nouveau) : liste `/procedures` filtrable (2 selects année/unité + rendu liste),
  ligne cliquable montrant `una` (gras) + type + commune + synthèse tronquée. Icônes Material
  (`Icon`), jamais d'emoji.
- **`UnaScreen`** (nouveau) : en-tête récap UNA (una, type, commune, synthèse) ; liste des
  perquisitions existantes (`PerquisitionSummary` : adresse, commune, nb objets, date) cliquables ;
  bouton « Nouvelle perquisition ». État vide si aucune.
- **`SetupScreen`** (adapté) : reçoit `una: string` en **prop** ; le champ UNA texte libre ajouté au
  précédent incrément est **retiré** ; l'UNA est affiché en lecture (récap) et injecté dans l'objet
  `Perquisition` produit. Le gate `valid` retire `una.trim()` (l'UNA est garanti par la prop).
- **`Inventory`** (adapté) : accepte des `objetsExistants?: ApiObjet[]` (lecture seule, badge
  « enregistré ») affichés au-dessus des objets en cours ; en mode `consult`, le bouton devient
  « Enregistrer les ajouts » et appelle `addObjets(openedPerquisition.id, nouveauxObjets)` (n'envoie
  que les objets ajoutés) ; en mode `create`, comportement actuel (`savePerquisition` du tout).
- `Wizard`/`StepPhoto`/`StepFiche`/`StepValidation` : inchangés.

## Périmètre / hors périmètre

- **Dans le périmètre** : navigation UNA-first, picker UNA, liste des perquisitions par UNA,
  création via formulaire recyclé, consultation + ajout d'objets, endpoint `POST /perquisition/objets`.
- **Hors périmètre** (inchangé depuis l'incrément précédent) : édition du lieu ou des objets
  existants ; suppression ; photos MinIO ; géocodage ; déploiement prod du front.

## Points de vérification

- Le refactor `insertObjets` doit préserver le comportement de `createPerquisition` (tests
  d'intégration existants + E2E) — extraction pure, aucun changement de sémantique.
- `addObjets` : transaction atomique ; relecture via le client de transaction (pas le pool).
- Recyclage `SetupScreen` : ne pas casser le flux de création existant.
