# Design — Générer le PV de perquisition (vue HTML imprimable)

Date : 2026-07-15
Statut : validé (brainstorming), prêt pour plan d'implémentation

## Objectif

Depuis une perquisition enregistrée (mode consultation), générer le **procès-verbal de
perquisition** sous forme de vue HTML imprimable (impression navigateur → PDF), reproduisant
la structure du modèle `Perquisition Pierre Roger.odt` : mentions obligatoires (bleu) templatées
depuis les données, objets saisis (noir) groupés par lieu.

## Décisions actées (brainstorming)

| Sujet | Décision |
|---|---|
| Sortie | **Vue HTML imprimable** dans le front (composant `PvPerquisition`) + `window.print` (CSS `@media print` A4). Pas d'export .odt/.docx. |
| Rendu des objets | **Générique** : nos `champs` portent `libelle`+`valeur` (même catalogue que le `.odt`) → « Catégorie : X (situation) » + `libellé : valeur`. Pas de formateur codé par catégorie. |
| Données manquantes | **Placeholders `_____________`** (comme le modèle), complétés à la main par l'OPJ. |

## Étude du modèle `.odt` (relevé)

- Bleu `#5983b0` = **mentions obligatoires** (squelette légal). Noir `#000000` = **objets saisis**.
- Métadonnées : Code unité / Nmr P.V. / Année / Nmr dossier justice / Nmr pièce / N° feuillet.
- Objets rendus : « Catégorie : [libellé] (Saisi scellé) [libellé champ : valeur …] ----- », groupés par
  « - Lieu : [lieu] » puis « - Pièce à conviction : ». Les libellés de champs correspondent au catalogue
  (`Nature`, `Marque`, `Numéro`, `Calibre`…), d'où le rendu générique.

## Données (depuis `PerquisitionDetail` = `opened`)

Disponibles : `una` (unite/numero/annee), `adresse`, `commune_libelle`, `perquisitionne`, `opj`,
`date_debut`, `pieces: string[]`, `intervenants: string[]`, `objets` (`categorie`, `sous_type`,
`numero_scelle`, `situation`, `lieu`, `champs: {libelle,valeur}[]`).
Absentes → placeholder `_____________` : résidence OPJ, bureau unité, Insee, heure de fin,
n° dossier justice, feuillets, nom compagnie.

## 1. Helpers purs (`src/features/saisies/pv.ts`)

- `PLACEHOLDER = "_____________"`.
- `formatPvDate(iso?: string): { longue: string; courte: string; heure: string }` — depuis `date_debut`
  ISO : `longue` = « le jeudi 12 février 2026 » (jour + date FR), `heure` = « 15 heures 45 minutes »,
  `courte` = « 12 février 2026 ». Si absent → placeholders.
- `situationLabel(s?: string): string` — `SAISI_SOUS_SCELLE`→« Saisi sous scellé », `SAISI_NON_SCELLE`→« Saisi non scellé », sinon « Saisi ».
- `objetLine(o: ApiObjet): string` — « Catégorie : {CATEGORIES[cat].libelle} ({situationLabel}) »
  + (si `sous_type`) « Type de moyen : {SOUS_TYPES_TRANSPORT[sous_type]} » + les `champs` à valeur non
  vide en « {libelle} : {valeur} » séparés par espace.
- `groupByLieu(objets: ApiObjet[]): { lieu: string; objets: ApiObjet[] }[]` — regroupe par `lieu`
  (vide → « Lieu non précisé »), ordre d'apparition.

## 2. Composant `PvPerquisition` (`src/features/saisies/PvPerquisition.tsx`)

Props : `{ perquisition: PerquisitionDetail; onClose: () => void }`.

- **Barre d'outils** (classe `pv-toolbar`, masquée à l'impression) : « ← Retour » (`onClose`) + « Imprimer » (`window.print()`).
- **Document PV** (classe `pv-page`, A4) :
  1. En-tête : GENDARMERIE NATIONALE ; unité (libellé) ; ENQUÊTE PRÉLIMINAIRE ; PROCÈS-VERBAL DE PERQUISITION.
  2. Tableau métadonnées : Code unité / Nmr P.V. / Année (dérivés de `una`) ; dossier justice, feuillets = placeholder.
  3. **Mentions bleues** (classe `pv-legal`, couleur `#5983b0`), templatées (verbatim ci-dessous).
  4. **Objets** (noir) par lieu via `groupByLieu` + `objetLine`.
  5. Mentions de clôture (bleu).

### Mentions obligatoires (verbatim, `{…}` = données, `___` = placeholder)

- « Le {date.longue} à {date.heure}. »
- « Nous soussigné {opj}, Officier de Police Judiciaire en résidence à {___}. »
- « Vu les articles 16 à 19 et 75 à 78 du Code de Procédure Pénale. »
- « Nous trouvant au bureau de notre unité à {___}, rapportons les opérations suivantes : »
- « Le {date.longue} à {date.heure}, nous nous présentons pour y effectuer une perquisition au domicile de {perquisitionne}, {adresse} à {commune_libelle} (Insee : {___}), qui nous paraît détenir des pièces ou objets relatifs aux faits incriminés. »
- « Nous sommes assistés par : {intervenants joints par ', '}, de notre unité. »
- « Nous sommes accompagnés par {perquisitionne}. »
- « L'assentiment exprès autorisant la perquisition et les saisies a été préalablement sollicité, rédigé et joint à la présente pièce. »
- « En la présence constante de {perquisitionne}, nous procédons à la perquisition des pièces suivantes : {pieces joints par ', '} »
- « Dans les lieux ci-après, nous découvrons la pièce à conviction suivante : »
- [OBJETS par lieu]
- « Nous déclarons à {perquisitionne} saisie de cette pièce à conviction. »
- « Nous en portons mention sur l'inventaire des pièces à conviction et la plaçons sous scellé que paraphe avec nous {perquisitionne}. »
- « L'objet saisi sera mis à la disposition du magistrat compétent en même temps que les pièces de la procédure. »
- « Nos recherches au domicile de {perquisitionne} n'amènent la découverte d'aucun autre objet susceptible de servir à la manifestation de la vérité. »
- « Nous informons la personne présente, qu'elle pourra, conformément à l'article 77-2 du code de procédure pénale, à l'expiration d'un délai d'un an à compter de la présente perquisition effectuée à son domicile, demander au procureur de la République, par lettre recommandée avec accusé de réception ou par déclaration au greffe contre récépissé, de consulter le dossier de la procédure. »
- « La perquisition se termine le {date.courte} à {___}. »

### CSS impression

Feuille inline / `@media print` : masquer la chrome de l'app et `.pv-toolbar` ; `.pv-page` en A4
(marges, `font-size` ~12px, `color-adjust: exact` pour conserver le bleu). En écran, `.pv-page`
centrée sur fond gris (aperçu type feuille).

## 3. Intégration

- `PerqSidebar` (mode consultation) : bouton « Générer le PV » → `onGenererPv?()`.
- `SaisiesApp` : state `showPv: boolean`. Quand `showPv && opened`, le rendu `perq` affiche
  `PvPerquisition` (plein écran) au lieu du layout sidebar+batch. `onClose` → `showPv=false`.

## Périmètre / hors périmètre

- **Dans le périmètre** : vue PV imprimable, mentions bleues templatées, objets génériques par lieu,
  placeholders pour données absentes, bouton depuis la consultation.
- **Hors périmètre** : export .odt/.docx/PDF serveur, édition/saisie des placeholders (résidence,
  heure fin, dossier justice…) persistée, pagination fine en feuillets numérotés, signatures.

## Points de vérification

- Mentions bleues templatées avec les bonnes données ; placeholders visibles pour l'absent.
- Objets groupés par lieu, rendu générique fidèle (« Catégorie : … (situation) libellé : valeur … »).
- `window.print` n'imprime que le PV (toolbar + chrome masqués) ; bleu conservé à l'impression.
- Date FR correcte depuis `date_debut` ISO.
- Aucun emoji (icônes `Icon`).
