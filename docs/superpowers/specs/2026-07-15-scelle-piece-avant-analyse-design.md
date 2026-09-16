# Design — Saisir scellé + pièce avant l'analyse (batch)

Date : 2026-07-15
Statut : validé (brainstorming), prêt pour plan d'implémentation

## Objectif

Lors de l'ajout de photos, permettre de renseigner le **numéro de scellé** et la **pièce**
(lieu de découverte) **avant** de lancer l'analyse IA. L'analyse d'une photo démarre
automatiquement dès que son scellé est renseigné. Front seul (composant `BatchIdentify`),
aucun changement backend.

## Décisions actées (brainstorming)

| Sujet | Décision |
|---|---|
| Scellé / pièce | **Par photo** (chaque photo a son propre scellé + sa propre pièce). |
| Déclenchement de l'analyse | **Auto dès scellé renseigné** — précisément à la **perte de focus** du champ scellé (valeur non vide). |

## Contexte existant (`BatchIdentify`, `src/features/saisies/SaisiesApp.tsx`)

- Aujourd'hui : `addFiles` crée des items `status:"pending"` et lance `runIdentify` **immédiatement**.
  Bannière globale « Identification en cours… n/total ». La grille (`ObjetCard`) s'affiche quand
  `pending === 0`. `ObjetCard` porte déjà les champs scellé/situation/lieu éditables.
- `BatchItem = { id, previewUrl, status: "pending"|"done"|"error", draft?, error?, file? }`.
- `buildDraftFrom(res, id)` → `ObjetSaisi` (scellé "", situation SAISI_SOUS_SCELLE, lieu "").
- `perquisition.pieces` = pièces déclarées au setup (datalist pour le lieu).
- `objetComplet(draft)` exige scellé + lieu + champs obligatoires. `peutValider` = pas de pending + ≥1 done + tous complets.

## Changements

### `BatchItem`
- Nouveau statut **`"staging"`** (ajouté, en attente de scellé pour lancer l'analyse).
- Nouveaux champs `numeroScelle: string` et `lieu: string` (saisis en préparation).
- `BatchStatus = "staging" | "pending" | "done" | "error"`.

### Flux
1. `addFiles` : items en `status:"staging"`, `numeroScelle:""`, `lieu:""`, `file`. **Ne lance pas** l'analyse.
2. **Ligne de préparation** par item staging : vignette + input **N° scellé** + input **Pièce**
   (datalist `perquisition.pieces`) + indication « Renseignez le scellé pour lancer l'analyse ».
   Les inputs mettent à jour `numeroScelle`/`lieu` de l'item (contrôlés).
3. **Déclencheur** : `onBlur` du champ scellé → `analyze(id)`. `analyze` lit l'item courant
   (via `itemsRef.current`), vérifie `status === "staging"` + scellé non vide + `file` présent →
   `status:"pending"` → `identifyObject(file)` → au succès : `draft = { ...buildDraftFrom(res,id),
   numeroScelle: item.numeroScelle, lieu: item.lieu }`, `status:"done"` ; erreur → `status:"error"`.
4. **Grille** : rendu de tous les items par statut (plus de gate `pending === 0` global) :
   - `staging` → ligne de préparation (vignette + scellé + pièce) ;
   - `pending` → ligne « Analyse en cours… » (vignette + spinner) ;
   - `done` → `ObjetCard` (scellé/pièce pré-remplis, éditables) ;
   - `error` → ligne d'erreur + « Retirer » (comme aujourd'hui).
5. **Valider tout** : activé quand **aucun item `staging` ni `pending`**, ≥ 1 `done`, tous complets
   (`objetComplet`), et pas d'upload/save en cours. Un item sans scellé reste `staging` → bloque.
6. **Démo** (`addDemo`) : reste instantanée (item `done` directement, scellé à compléter dans la carte).
   Retirer la bannière globale « Identification en cours » au profit des lignes par item.
7. Texte d'accueil (état vide) mis à jour : « Ajoutez des photos, renseignez le n° de scellé et la
   pièce ; l'analyse démarre automatiquement. »

### Inchangé
- `ObjetCard`, `buildDraftFrom`, `mapObjet`, upload MinIO au valider-tout, persistance. Le scellé/lieu
  saisis en préparation sont portés par le `draft` → transmis au save comme aujourd'hui.
- Révocation des object URLs (déjà gérée via `itemsRef`).

## Périmètre / hors périmètre

- **Dans le périmètre** : état préparation, saisie scellé/pièce par photo avant analyse, déclenchement
  auto au blur du scellé, rendu par item, gating valider.
- **Hors périmètre** : pièce commune au lot, bouton « analyser » manuel, réanalyse d'un item done,
  changement backend.

## Points de vérification

- Ajout de photos → pas d'analyse tant que le scellé n'est pas renseigné (blur).
- Blur d'un scellé non vide → analyse de CET item ; le draft résultant porte le scellé + la pièce saisis.
- Items indépendants (un item analysé pendant qu'un autre est encore en préparation).
- Valider tout bloqué tant qu'un item est en préparation (sans scellé) ou en cours.
- `itemsRef` : `analyze` lit la valeur scellé/pièce courante (pas de closure périmée).
- Aucun emoji (icônes `Icon`).
