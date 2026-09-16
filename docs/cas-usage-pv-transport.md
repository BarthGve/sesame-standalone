# Cas d'usage IAka — Aide à la rédaction du PV de transport et de constatations

## 1. Le besoin métier

Le **procès-verbal de transport et de constatations** est la première pièce de presque
toute procédure d'atteinte aux biens. Il est rédigé après coup, au retour à l'unité, à
partir de notes prises sur les lieux — souvent quelques lignes sur un carnet, des
photographies et de la mémoire.

Ce PV décide de la qualité de tout le dossier : c'est lui qui fixe le **mode opératoire**,
les **traces relevées**, la **liste des scellés**, l'**heure d'arrivée**, l'**avis au
parquet**. Un détail non consigné le jour même est perdu.

Trois difficultés, constantes :

1. **Le temps** — une heure de rédaction pour trente minutes de constatations, sur une
   unité qui enchaîne les interventions.
2. **La complétude** — la trame est stable (transport, constatations, mesures prises, biens
   dérobés, avis à l'autorité judiciaire), mais l'oubli d'une rubrique ne se voit qu'à la
   relecture du magistrat.
3. **La rigueur formelle** — le PV doit reprendre, sans écart, l'unité, l'UNA, le cadre
   d'enquête, le NATINF, l'état civil de la victime, la géolocalisation. Ces données
   existent déjà ailleurs : elles ne doivent surtout pas être ressaisies, ni « devinées ».

## 2. Le verrou technique

Le réflexe naturel — « je donne mes notes à un LLM, il me rend le PV » — échoue sur le
point qui compte : un procès-verbal est un **acte authentique**. Une identité approximative,
une heure inventée, un NATINF plausible mais faux ne sont pas des imperfections
rédactionnelles, ce sont des **nullités potentielles**.

D'où la règle de conception :

> Le LLM **ne produit jamais** une donnée d'état civil, une date, une heure, un NATINF, une
> adresse ou une coordonnée. Il **rédige la narration** autour de données qui lui sont
> fournies.

La séparation est la même que dans la page Analyse : d'un côté les **données certaines**
(issues du XML LRPGN de la procédure ou du formulaire d'intervention), affichées telles
quelles et **non hallucinables** ; de l'autre, le **texte proposé**, relu et validé par
l'enquêteur avant signature.

Second verrou : la sortie attendue n'est pas du markdown, c'est un **document
bureautique** structuré en chapitres, prêt à être versé dans la procédure.

## 3. La solution mise en place

### 3.1 Les entrées

| Entrée | Nature | Origine |
|---|---|---|
| **Notes de terrain** | texte libre, télégraphique, dicté ou tapé | l'enquêteur |
| **Contexte certain** | unité, UNA, cadre d'enquête, NATINF, faits, état civil, lieu, GPS | XML LRPGN de la procédure, ou formulaire |
| **Trame** | rubriques attendues du PV de transport | fixée par le workflow |

Le contexte certain est extrait du PDF/A-3 de la procédure quand il existe
(`/Type/EmbeddedFile` → inflate → parsing LRPGN), exactement comme pour la page Analyse. À
défaut, il est saisi une fois dans le formulaire et réutilisé pour toutes les pièces.

### 3.2 Le workflow IAka

Un seul workflow, entrée **multipart** (notes + contexte), sortie **document Word** :

```
DÉBUT (notes de terrain + contexte certain)
  ▼
[Agent rédacteur]  → structure les notes selon la trame, rédige au style PV
  ▼
[Outil create_document_docx]  → chapitres → .docx
  ▼
FIN (<tool-input> chapitres · <tool-output> métadonnées · <tool-output-doc> docx base64)
```

Le BFF (`server/pvtcmp.mjs`, `extractPv`) sépare les trois blocs de la réponse : le
**.docx** en base64 pour le téléchargement, les **chapitres** pour l'aperçu dans
l'application, les métadonnées pour le nom de fichier. L'absence de chapitres n'invalide
rien — le document reste téléchargeable.

### 3.3 La trame produite

| Rubrique | Contenu attendu | Source |
|---|---|---|
| En-tête | unité, UNA, cadre d'enquête, articles visés, rédacteur, date et heure | contexte certain |
| **Transport** | avis reçu (heure, origine), départ, arrivée sur les lieux, constatation de la flagrance | notes + contexte |
| **Constatations** | abords, point de pénétration, traces d'outil, désordre intérieur, ce qui est absent | notes |
| **Mesures prises** | gel des lieux, photographies, scellés numérotés, réquisitions adressées | notes |
| **Biens dérobés** | nature, marque, modèle, numéro de série, valeur déclarée | notes + déclarations |
| **Avis à l'autorité judiciaire** | heure, magistrat avisé, instructions reçues | notes |
| Clôture | lieu, date et heure de clôture, signatures | contexte |

L'agent a l'interdiction d'inventer une rubrique manquante : il **signale** ce qui n'est
pas couvert par les notes plutôt que de le combler. C'est le principal apport métier — le
PV revient avec ses trous explicités, avant que le magistrat ne les découvre.

### 3.4 L'application (front)

Page `/pvtransport` du démonstrateur (React, `src/features/pvtransport/`) :

- **Colonne gauche** — la saisie des notes, et la fiche de contexte certain (badge
  « Données LRPGN détectées » quand elles proviennent du XML).
- **Colonne droite** — l'aperçu chapitre par chapitre du PV proposé, la liste des points
  non renseignés, et le téléchargement du `.docx`.

Le texte généré est une **proposition** : il est relu et modifié dans l'application avant
export. Rien n'est signé par la machine.

## 4. Ce que le cas d'usage démontre pour IAka

- **Frontière donnée certaine / texte généré** : le LLM rédige, il ne certifie pas. C'est le
  motif réutilisable pour tout acte à valeur juridique.
- **Sortie bureautique** : un workflow agentique peut rendre un livrable directement
  exploitable (document Word versé en procédure), pas seulement du texte.
- **Réemploi de l'existant** : le même XML LRPGN embarqué qui alimente l'Analyse et Ariane
  sert ici de socle de vérité — une donnée saisie une fois, exploitée trois fois.
- **Valeur ajoutée mesurable** : le temps de rédaction, et surtout la **complétude** — les
  rubriques oubliées sont signalées au moment où l'on peut encore y remédier.

## 5. Démonstrateur — jeu de données

Le corpus **fictif** de la procédure de cambriolage **UNA 15127/00324/2026** sert de
référence : le PV de transport et de constatations du 10 février 2026 (avis du CORG à
06 h 52, arrivée sur les lieux à 07 h 15, porte-fenêtre forcée au levier, empreinte de
semelle, scellés n° 01 à 04, réquisition vidéoprotection, avis au parquet de Versailles à
08 h 20, huit biens dérobés pour 4 350 euros) constitue la **cible** attendue.

Les **notes de terrain** correspondantes — une vingtaine de lignes télégraphiques — servent
d'entrée de démonstration. La comparaison entre le PV généré et la pièce de référence
donne une mesure directe de la qualité : rubriques couvertes, données certaines reprises
sans écart, éléments signalés comme manquants.
