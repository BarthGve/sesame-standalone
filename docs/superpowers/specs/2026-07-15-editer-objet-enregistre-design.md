# Design — Éditer un objet déjà enregistré

Date : 2026-07-15
Statut : validé (brainstorming), prêt pour plan d'implémentation

## Objectif

Depuis la sidebar d'une perquisition (mode consultation), cliquer sur un objet déjà enregistré
ouvre le formulaire d'édition (données à gauche, photo à droite) pour le **modifier** et
réenregistrer. Incrément 1 de 2 (l'incrément 2 = persistance photos MinIO ; ici la droite
affiche « Sans photo »).

Suite de `2026-07-15-saisie-batch-photos`.

## Décisions actées (brainstorming)

| Sujet | Décision |
|---|---|
| Séquence | **Édition d'abord** ; MinIO (photos persistées) = incrément 2 séparé. |
| Photo à droite (objet existant) | **« Sans photo »** (non persistée tant que MinIO n'est pas fait). |
| Changement de catégorie en édition | Recalcule les champs (`recomputeChamps`, valeurs conservées par `cle`), comme le batch. |

## Contexte existant (rappel)

- `PerqSidebar` (SaisiesApp.tsx) liste les objets existants (`ApiObjet[]`) en **lecture seule** (non cliquables).
- `ObjetCard` : carte éditable (catégorie modifiable, scellé/situation/lieu, `FieldRow`, photo droite) — réutilisable.
- Backend `perquisition.js` : `insertObjets(client, perqId, objets)` insère objet + champs + identifiants + estimation + alternatives. `extractIdentifiants(categorie, champs)`. `getPerquisition(pool|client, id)` renvoie le détail (objets avec `champs`, `identifiants`, etc.). `addObjets` = modèle d'endpoint (validation → 404 → transaction → relecture via client).
- `ApiObjet` (perquisitionApi.ts) = `{ id, categorie, sous_type?, numero_scelle?, situation?, lieu?, champs: {cle,libelle,valeur,source,obligatoire}[], identifiants: {type,valeur}[] }`.
- Clients : `addObjets`, `getPerquisition`, `mapObjet(o: ObjetSaisi): ObjetPayload`, `unwrap<T>`.
- rgp-api : enveloppe `{data}`/`{error}`, `err()` renvoie toujours HTTP 200. Route déployée par `scp` + `docker compose up -d --build rgp-api`.

## 1. Backend — endpoint de mise à jour d'un objet

Refactor DRY : extraire de `insertObjets` la partie « champs + identifiants » (et estimation/alternatives)
d'un objet dans un helper `insertObjetChampsIdentifiants(client, objId, objet)`, réutilisé par
`insertObjets` (inchangé fonctionnellement) et par `updateObjet`.

Nouvelle fonction `updateObjet(pool, body)` :
- valide `body.objet_id` (entier) → 400 ; `body.categorie` requis → 400.
- vérifie l'existence de l'objet (`SELECT perquisition_id FROM objet_saisi WHERE id=$1`) → 404 sinon ;
  mémorise `perquisition_id` pour la relecture.
- transaction :
  - `UPDATE objet_saisi SET categorie=$, sous_type=$, numero_scelle=$, situation=$, lieu=$ WHERE id=$`
    (photo_url et estimation inchangés).
  - `DELETE FROM objet_champ WHERE objet_id=$` puis réinsertion des `body.champs`.
  - `DELETE FROM objet_identifiant WHERE objet_id=$` puis réinsertion via `extractIdentifiants(categorie, champs)`.
- COMMIT ; renvoie `getPerquisition(client, perquisition_id)`.
- Erreurs : ROLLBACK + 500.

Route `server.js` : `POST /perquisition/objet/update` (après le bloc auth, style existant) :
`json(res, 200, {data})` / `err(res, out.code, out.error.code, out.error.message)`.

Proxy `proxy.mjs` : `RGP_ROUTES` += `"POST /api/perquisition/objet/update": "/perquisition/objet/update"`.

OpenAPI : ajouter le chemin.

## 2. Front — clients

`perquisitionApi.ts` :
- `updateObjet(objetId: number, objet: ObjetSaisi, fetchImpl?): Promise<PerquisitionDetail>` →
  `POST /api/perquisition/objet/update` avec `{ objet_id, ...mapObjet(objet) }` (réutilise `mapObjet` ;
  le backend ignore `photo_url`/estimation). Renvoie la perquisition à jour (via `unwrap`).
- `apiObjetToDraft(o: ApiObjet): ObjetSaisi` — reverse mapping pour l'édition :
  `{ id: String(o.id), categorie, sousType: o.sous_type ?? undefined, confiance: 1, numeroScelle: o.numero_scelle ?? "", situation: (o.situation as SituationScelle) ?? "SAISI_SOUS_SCELLE", lieu: o.lieu ?? "", champs: o.champs.map(normaliser source) }`.
  (`source` DB peut être `null` → mapper vers `"a_completer"`.)

## 3. Front — UX d'édition

- `PerqSidebar` : rendre chaque objet existant **cliquable** ; nouvelle prop `onEditObjet?: (o: ApiObjet) => void`,
  chaque `<li>` devient un `<button>` appelant `onEditObjet(o)`.
- `SaisiesApp` : state `editingObjet: { objetId: number; draft: ObjetSaisi } | null`.
  - Clic sidebar → `setEditingObjet({ objetId: o.id, draft: apiObjetToDraft(o) })`.
  - Rendu `perq` : si `editingObjet` non nul, la zone principale affiche une vue d'édition
    (composant `ObjetEditor` : `ObjetCard` avec `previewUrl=""` + barre « Enregistrer les modifications » / « Annuler »)
    au lieu de `BatchIdentify`. La sidebar reste affichée.
  - `ObjetCard` `onChange` met à jour `editingObjet.draft` ; `onRemove` masqué/no-op en mode édition
    (l'`ObjetCard` a un bouton « retirer » — en édition on le remplace par « Annuler » au niveau de la barre,
    et on passe un `onRemove` qui annule l'édition, ou on rend le bouton retirer inerte ; choix d'implémentation :
    `onRemove` = annuler l'édition).
  - « Enregistrer les modifications » : `updateObjet(objetId, draft)` → `setOpened(refreshed)`,
    `setEditingObjet(null)`, `saveState` ok. « Annuler » → `setEditingObjet(null)`.
  - Bloqué si l'objet est incomplet (`objetComplet(draft)` faux) — cohérent avec le batch.

## Périmètre / hors périmètre

- **Dans le périmètre** : endpoint update objet (champs + identifiants remplacés, recalcul identifiants),
  sidebar cliquable, vue d'édition réutilisant `ObjetCard`, catégorie modifiable, blocage si incomplet.
- **Hors périmètre** : photos MinIO (incrément 2 — droite « Sans photo »), suppression d'objet, édition du lieu de la perquisition.

## Points de vérification

- `updateObjet` : transaction atomique ; champs ET identifiants remplacés (pas d'accumulation) ; relecture via le client.
- Recalcul identifiants après changement de catégorie/champs (ex. changer l'immatriculation met à jour `objet_identifiant`).
- `apiObjetToDraft` : `source` null → `"a_completer"` ; `sousType` absent → undefined.
- Blocage sur incomplétude (`objetComplet`).
- Aucun emoji (icônes `Icon`).
