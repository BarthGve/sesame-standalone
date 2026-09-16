# Design — Saisie par lot : batch photos → identify → grille éditable → valider tout

Date : 2026-07-15
Statut : validé (brainstorming), prêt pour plan d'implémentation

## Objectif

Remplacer le wizard objet-par-objet par une saisie **par lot** : une fois la perquisition
créée/ouverte, l'utilisateur ajoute une ou plusieurs photos ; l'API IAKA est appelée pour
chaque photo ; quand tous les résultats sont revenus, une grille affiche pour chaque photo
les données proposées (gauche) et la photo (droite) ; l'utilisateur complète/modifie, puis
**valide tout** (enregistrement en base d'un seul geste).

Suite des incréments `2026-07-10-perquisitions-una` et `2026-07-15-perquisition-una-selector`.

## Décisions actées (brainstorming)

| Sujet | Décision |
|---|---|
| « Valider tout » | **Enregistre directement en base** : création → `POST /perquisition` (perquisition + objets) ; consultation → `addObjets`. Remplace l'ancien bouton « Enregistrer ». |
| Photos | **Affichage seul** (identification + aperçu grille). Non persistées, `photo_url` reste vide. MinIO = incrément ultérieur. |
| Panneau gauche de carte | **Fiche complète** : catégorie + champs dynamiques IAKA + n° scellé + situation + lieu. |
| Catégorie | **Modifiable** (menu déroulant catalogue) ; les champs dynamiques se recalculent (`champsCategorie`), valeurs conservées par `cle` commune. |
| Complétude | **Bloqué tant qu'incomplet** : « Valider tout » désactivé si un objet identifié a un champ obligatoire / scellé / lieu manquant (`objetComplet`). |

## Contexte existant (rappel)

- Flux actuel dans `SaisiesApp.tsx` : `Wizard` 3 étapes (`StepPhoto` → `StepFiche` → `StepValidation`),
  un objet à la fois. `identifyObject(file): Promise<IdentificationResult>` (route proxy `/api/identify`).
  `buildDraft(res): ObjetSaisi`. `objetComplet(o): boolean` (types.ts) = scellé + lieu + champs obligatoires remplis.
- `catalogue.ts` : `CATEGORIES` (libellé+icône par `CategorieCode`), `SOUS_TYPES_TRANSPORT`,
  `champsCategorie(categorie, sousType): ChampDef[]`.
- `FieldRow` (SaisiesApp) : rend un champ éditable (`Champ`).
- `mockIdentify()` : simulateur d'identification (démo sans IAKA).
- Persistance : `savePerquisition(payload)` (création) / `addObjets(perquisitionId, objets)` (consultation),
  `buildPerquisitionPayload(perq, una, objets)`, `getPerquisition(id)`.
- Modes d'écran (`SaisiesApp`) : `screen` (home/una/perq) + `perqMode` (create/consult) + `opened` (détail consulté).

## Architecture

### 1. Zone de travail : `BatchIdentify` (remplace `Wizard`)

État interne :
```ts
type BatchStatus = "pending" | "done" | "error";
interface BatchItem {
  id: string;
  file: File;
  previewUrl: string;      // URL.createObjectURL(file), révoquée au démontage
  status: BatchStatus;
  draft?: ObjetSaisi;      // rempli quand status === "done"
  error?: string;          // message si status === "error"
}
```

Comportement :
- **Ajout de photos** : input `type=file accept="image/*" multiple` (import) + input capture (`capture`) ;
  chaque fichier ajouté crée un `BatchItem` (status `pending`) et déclenche `identifyObject(file)`.
  On peut ajouter d'autres photos à tout moment (append).
- **Identify parallèle** : chaque appel met à jour son item indépendamment (done → `draft = buildDraft(res)` ;
  error → `error = message`). Un compteur de progression (n terminés / total) est affiché tant qu'il reste des `pending`.
- **Grille** : rendue quand **plus aucun item n'est `pending`** (tous done ou error). Une `ObjetCard` par item.
  Un item `pending` isolé (photo ajoutée après) réaffiche l'état de progression jusqu'à résolution.
- **Bouton « Valider tout »** : activé si (a) aucun item `pending`, (b) ≥ 1 item `done`, (c) tous les items `done`
  sont complets (`objetComplet(item.draft)`). Les items `error` sont exclus de l'enregistrement (badge d'erreur,
  n'empêchent pas la validation des autres, mais un compteur signale qu'ils seront ignorés).
  Au clic : collecte des `draft` des items `done` → callback `onValiderTout(drafts)`.
- **Démo** : bouton ajoutant un item simulé via `mockIdentify()` (utile sans IAKA réelle).
- Gestion d'erreur par item : boutons « Réessayer » (relance `identifyObject`) et « Retirer » (supprime l'item).

### 2. `ObjetCard` (une par photo)

Layout deux colonnes (gauche fiche, droite photo). Reçoit `draft: ObjetSaisi` + `onChange(next: ObjetSaisi)`.

Panneau gauche (édite `draft`) :
- **Catégorie** : `<select>` des `CategorieCode` (libellés `CATEGORIES`). Au changement :
  reconstruire `champs` depuis `champsCategorie(nouvelleCat, sousType)`, en **conservant les valeurs**
  des champs dont la `cle` existe déjà (report par `cle`), source `deduit` si valeur conservée sinon `a_completer`.
  Réinitialiser `sousType` si la catégorie n'est plus TRANSPORT.
- **Sous-type** (si catégorie === TRANSPORT) : `<select>` `SOUS_TYPES_TRANSPORT` ; au changement, recalcul des champs idem.
- **Champs dynamiques** : `FieldRow` par `champ` (édition inline, comme aujourd'hui).
- **N° scellé** : input (`numeroScelle`).
- **Situation** : `<select>` `SAISI_SOUS_SCELLE` / `SAISI_NON_SCELLE`.
- **Lieu** : input (`lieu`) — suggestions depuis `perquisition.pieces` (datalist, comme l'existant).
- Indicateur de complétude (`objetComplet`) : pastille verte/orange.

Panneau droite : `<img src={previewUrl} />` (aperçu, `max-width:100%`, `object-fit`).

### 3. `SaisiesApp` — intégration

- Le rendu `perq` remplace `Inventory + Wizard` par **Sidebar contexte + `BatchIdentify`** :
  - Sidebar (allégée) : récap perquisition (adresse/commune), retour UNA, et — en consultation —
    la liste des objets déjà enregistrés en lecture seule.
  - Zone principale : `BatchIdentify perquisition={perquisitionCourante} onValiderTout={...} saveState={...}`.
- **Callback `onValiderTout(drafts)`** :
  - création (`perqMode === "create"`) : `savePerquisition(buildPerquisitionPayload(perquisition, perquisition.una, drafts))` ;
    au succès, recharger via `getPerquisition(id)`, passer en `perqMode="consult"`, `opened = détail`, vider le batch.
  - consultation (`perqMode === "consult"`) : `addObjets(opened.id, drafts)` → `opened = résultat` (renvoyé par addObjets), vider le batch.
- États `saveState` (idle/saving/ok/err) affichés dans `BatchIdentify` près du bouton.
- Suppression de `Wizard`, `Stepper`, `StepPhoto`, `StepFiche`, `StepValidation`, `Inventory` (ou réduction
  d'`Inventory` à la sidebar contexte). `FieldRow` et les constantes de style restent.
- Les états `draft`/`step`/`objets` (mono-objet) disparaissent au profit de l'état interne de `BatchIdentify`.

## Périmètre / hors périmètre

- **Dans le périmètre** : upload multi-photos, identify parallèle avec attente globale, grille éditable
  (fiche complète + catégorie modifiable), blocage sur incomplétude, valider-tout enregistrant en base
  (création et consultation), suppression du wizard.
- **Hors périmètre** : persistance des photos (MinIO), géocodage, édition des objets déjà enregistrés,
  déploiement prod du front.

## Points de vérification

- Attente **globale** avant affichage de la grille (tous les `identifyObject` settled).
- Recalcul des champs à chaque changement de catégorie/sous-type, sans perdre les valeurs communes par `cle`.
- « Valider tout » : bloqué si un objet `done` est incomplet ; items `error` exclus ; ≥ 1 objet requis.
- Révocation des `URL.createObjectURL` (pas de fuite mémoire).
- Aucun emoji dans l'UI (icônes `Icon`/Material) — contrainte projet.
