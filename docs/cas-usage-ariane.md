# Cas d'usage IAka — Ariane : compréhension rapide d'une procédure judiciaire

## 1. Le besoin métier

Un magistrat, un chef d'enquête ou un enquêteur qui reprend un dossier reçoit une
**procédure** : de **une liasse en un seul PDF** jusqu'à **plusieurs centaines de PDF**, un
par acte (PV de transport et constatations, plaintes, auditions, perquisitions,
réquisitions, garde à vue, soit-transmis, bordereau d'envoi judiciaire…).

La première question est toujours la même, et elle coûte des heures de lecture :
**qui, quoi, quand, dans quel ordre ?**

Cinq livrables couvrent ce besoin :

1. **Synthèse** de l'enquête (narratif court).
2. **Parties prenantes** — entendus, témoins, mis en cause, enquêteurs, requis, magistrats,
   avec leur rôle.
3. **Ligne de temps des faits** — la chronologie de ce qui s'est réellement passé.
4. **Ligne de temps des actes** — la chronologie procédurale (qui a fait quoi, quand).
5. **Réseau relationnel** — le graphe des liens entre protagonistes.

Exigence non négociable : **chaque item cite sa cote d'origine**. Une synthèse de procédure
non sourcée est inutilisable — c'est le point de rupture entre une démo et un outil.

## 2. Le verrou technique

Une procédure réelle représente **des milliers de pages**. Aucun contexte de LLM ne les
avale, et la qualité s'effondre bien avant la limite technique. Le **passage unique est
impossible**.

Deuxième verrou, plus insidieux : la **coréférence**. « Le suspect » en cote D3, « M.
FERREIRA » en D18 et « l'intéressé » en D47 sont la même personne. Résoudre cela pièce par
pièce donne autant de personnes que de pièces ; le résoudre N fois donne N vérités
divergentes.

La réponse est la même philosophie que RENS — **deux étages** :

- **MAP** (une exécution par pièce) : chaque pièce est réduite à une **extraction compacte**
  (personnes avec leurs attributs d'identité, faits, métadonnées de l'acte) — jamais du
  texte brut.
- **REDUCE** (une seule exécution) : travaille sur l'**agrégat compact** de toutes les
  pièces, résout la coréférence **globalement, une seule fois**, et produit les parties
  canoniques, les relations et la synthèse.

L'agrégat compact tient dans un seul contexte même pour des centaines de pièces : c'est ce
qui fait tenir l'échelle.

## 3. La solution mise en place

### 3.1 Les entrées : du PDF, et parfois mieux que du PDF

Les pièces de la procédure pénale numérique (LRPGN / PPN) sont des **PDF/A-3 qui embarquent
un XML** décrivant la pièce : entête (unité, UNA, type d'enquête, titre de pièce), faits
(NATINF, libellé, période, lieu, coordonnées GPS), personnes (état civil complet,
implication), rédaction du PV.

Deux chemins alimentent donc **le même schéma d'extraction** :

| Chemin | Source | Coût | Fiabilité |
|---|---|---|---|
| **Texte** | rendu visuel de la pièce, lu par le LLM (MAP) | 1 exécution / pièce | dépend du modèle |
| **XML embarqué** | `data.xml` extrait du PDF, sans LLM | quasi nul | **déterministe** |

Le XML court-circuite le LLM pour tout ce qui est **certain** — identités, dates,
qualifications, géolocalisation. Le LLM ne garde que ce qu'il sait faire : lire le récit,
relier, résumer. Même mécanique que dans la page Analyse
(`src/features/synthese/pdfXml.ts` : recherche du flux `/Type/EmbeddedFile`, inflate,
parsing LRPGN), transposée à la procédure entière.

### 3.2 L'IA générative (IAka) : deux apps, découpage par étage

Le détail (nœuds, prompts, câblage) est dans `docs/iaka-ariane-workflow.md`.

| Workflow | app | Entrée | Sortie |
|---|---|---|---|
| **MAP — extraction** | `ariane-extraction` | 1 PDF (une pièce) | acte, personnes (avec attributs d'identité), faits, relations lues |
| **REDUCE — consolidation** | `ariane-consolidation` | l'agrégat de toutes les extractions | clustering des personnes, parties canoniques, relations, synthèse |

Le découpage est **temporel** (extraire puis consolider), pas « une app par vue » : ce
dernier ferait résoudre les entités autant de fois qu'il y a de vues, donc diverger.

Le fan-out MAP est orchestré par le **BFF** (`server/ariane.mjs`), à concurrence bornée —
comme RENS lance ses workflows côté BFF.

### 3.3 LLM = jugement, code = comptabilité

Décision structurante : le REDUCE **n'émet pas** les identifiants croisés du contrat final.
Demander à un LLM de référencer correctement, sur des centaines de pièces, les `parties[]`
qu'il vient de construire produit des **ids orphelins** — mode d'échec garanti.

| Fait par | Quoi |
|---|---|
| **LLM** | clustering des mentions vers une partie canonique, relations lues (famille, complice, victime de…), synthèse, nature de l'affaire |
| **Code (BFF)** | assemblage du contrat : `faits → evenements`, `méta-acte → actes`, dérivation de `entendu_par` / `requis_par`, remplacement des références par les identifiants de parties, calcul de la période et du nombre de cotes |

Zéro identifiant orphelin **par construction**, et un contrat final reconstruit
mécaniquement — donc vérifiable.

### 3.4 L'application (front)

Page `/ariane` du démonstrateur (React) : dépôt des pièces, puis cinq vues alimentées par
un unique contrat JSON — synthèse, parties prenantes, deux lignes de temps (faits / actes),
réseau relationnel. Chaque élément affiché porte sa **cote** ; un clic renvoie à la pièce.

## 4. Ce que le cas d'usage démontre pour IAka

- **Passage à l'échelle par l'architecture**, pas par la taille du contexte : map-reduce sur
  des centaines de pièces, la consolidation ne voyant que des extractions compactes.
- **Chaîne agentique mixte** : extraction déterministe (XML LRPGN) là où la donnée est
  certaine, agents LLM là où il faut du jugement (coréférence, récit, relations).
- **Traçabilité** : sortie sourcée à la cote, contrat assemblé par le code — l'IA propose,
  le code garantit la cohérence référentielle.
- **Valeur ajoutée** : quelques minutes pour situer un dossier que la lecture séquentielle
  demanderait une journée à embrasser.

## 5. Démonstrateur — jeu de données

Deux corpus **fictifs**, tous deux en **PDF/A-3 avec XML LRPGN embarqué** (pièce jointe
`data.xml`, flux `FlateDecode`, référencée par `/Names/EmbeddedFiles` et `/AF`) :

**Corpus A — procédure de cambriolage, UNA 15127/00324/2026** (6 pièces, entièrement
inventée) : PV de transport et constatations, plainte de la victime, deux auditions de
témoins, notification / exercice des droits / déroulement de garde à vue, bordereau d'envoi
judiciaire. Enquête de flagrance, NATINF 7154 (vol par effraction dans un local
d'habitation). La chaîne d'imputation est volontairement **reconstituable** : plaque
partielle relevée par un témoin, éraflure identifiée par un second, recoupement par la
vidéoprotection puis le SIV, interpellation. C'est exactement ce que les deux lignes de
temps et le réseau doivent faire ressortir.

**Corpus B — procédure longue pseudonymisée** (16 pièces) : synthèse, investigations,
perquisitions, réquisitions, prélèvement biologique, garde à vue et audition longue
(15 pages), bordereau. Noms, prénoms, adresses, téléphones et dates de naissance remplacés
par une table de correspondance unique appliquée à toutes les pièces ; faits, communes,
dates d'actes et NATINF conservés. Il sert à éprouver l'échelle et la coréférence sur des
pièces réellement volumineuses.
