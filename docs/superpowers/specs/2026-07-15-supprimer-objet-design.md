# Design — Supprimer un objet enregistré

Date : 2026-07-15
Statut : validé (brainstorming), prêt pour plan d'implémentation

## Objectif

Permettre de supprimer un objet déjà enregistré d'une perquisition, depuis l'éditeur d'objet
(`ObjetEditor`), avec confirmation inline.

## Décisions actées (brainstorming)

| Sujet | Décision |
|---|---|
| Emplacement | Bouton « Supprimer l'objet » dans la barre d'action de `ObjetEditor` (édition d'un objet existant). |
| Confirmation | **Inline** : le bouton révèle « Confirmer la suppression ? Oui / Annuler » avant l'appel API. |

## Contexte existant

- Édition : clic sur un objet (sidebar consultation) → `editingObjet: { objetId, draft }` → `ObjetEditor`
  (barre : « Annuler » + « Enregistrer les modifications »).
- Backend `perquisition.js` : `updateObjet` (modèle d'endpoint : valider objet_id → 404 → transaction →
  relecture via client). FKs `objet_champ`/`objet_identifiant`/`objet_estimation_*`/`objet_categorie_alternative`
  = `ON DELETE CASCADE` sur `objet_saisi`.
- Clients : `updateObjet`, `getPerquisition`, `unwrap`. Enveloppe `{data}`/`{error}`, `err()` HTTP 200.

## 1. Backend — endpoint de suppression

Nouvelle fonction `deleteObjet(pool, body)` dans `perquisition.js` :
- valide `body.objet_id` (entier) → 400.
- vérifie l'existence (`SELECT perquisition_id FROM objet_saisi WHERE id=$1`) → 404 sinon ; mémorise `perquisition_id`.
- `DELETE FROM objet_saisi WHERE id=$1` (le CASCADE supprime champs/identifiants/estimation/alternatives).
- renvoie `getPerquisition(client, perquisition_id)` (relecture via le client).
- Erreurs → 500. `client.release()` en finally.

Route `server.js` : `POST /perquisition/objet/delete` (après le bloc auth) : `json(res,200,{data})` /
`err(res,out.code,out.error.code,out.error.message)`.

Proxy `proxy.mjs` : `RGP_ROUTES` += `"POST /api/perquisition/objet/delete": "/perquisition/objet/delete"`.

OpenAPI : ajouter le chemin.

## 2. Front — client

`perquisitionApi.ts` :
- `deleteObjet(objetId: number, fetchImpl?): Promise<PerquisitionDetail>` →
  `POST /api/perquisition/objet/delete` `{ objet_id: objetId }`, renvoie `unwrap<PerquisitionDetail>`.

## 3. Front — UX

- `ObjetEditor` : ajouter à la barre d'action un bouton « Supprimer l'objet » (style danger, couleur `ERR`,
  icône `Icon name="delete"`). État local `confirming: boolean` :
  - clic « Supprimer l'objet » → `confirming = true` → afficher « Confirmer la suppression ? » + « Oui, supprimer » (ERR) + « Annuler » (ghost).
  - « Oui, supprimer » → `onDelete()` ; « Annuler » → `confirming = false`.
- `SaisiesApp` : passer `onDelete` à `ObjetEditor` → `handleDeleteObjet` :
  `deleteObjet(editingObjet.objetId)` → `setOpened(refreshed)`, `setEditingObjet(null)`, `saveState` ok ;
  erreur → `saveState` err.
- La suppression ne s'applique qu'en édition d'un objet **existant** (l'éditeur n'est ouvert que pour ceux-là).

## Périmètre / hors périmètre

- **Dans le périmètre** : endpoint delete (CASCADE), client, bouton + confirmation inline dans l'éditeur.
- **Hors périmètre** : suppression multiple/bulk, suppression depuis la sidebar sans ouvrir l'éditeur,
  purge du blob MinIO associé (orphelin accepté), corbeille/undo.

## Points de vérification

- `deleteObjet` : 404 si objet inexistant ; CASCADE effectif (champs/identifiants supprimés) ; relecture via client.
- Confirmation inline avant l'appel (pas de suppression au premier clic).
- Après suppression : l'objet disparaît de la sidebar, retour à `BatchIdentify`.
- Aucun emoji (icônes `Icon`).
