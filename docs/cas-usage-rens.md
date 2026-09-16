# Cas d'usage IAka — Base RENS : synthèse quotidienne du renseignement & signaux faibles

## 1. Le besoin métier

Les unités de terrain de la gendarmerie produisent en continu des **fiches de renseignement
simplifiées (FRS)** : de petits comptes rendus (un titre, une date, une unité rédactrice, un
département de rattachement, la commune de recueil, quelques mots-clés, un texte libre). À
l'échelle nationale, la production est de l'ordre de **1000 fiches par jour**.

Deux besoins, impossibles à traiter à la main à ce volume :

1. **Synthèse quotidienne** — chaque matin, disposer d'un panorama du renseignement de la veille :
   volume produit, thèmes dominants, répartition géographique, évolution par rapport à l'avant-veille.
2. **Signaux faibles** — faire émerger les **phénomènes discrets** : peu de faits, chacun anodin
   pris isolément, mais qui **reviennent et se dispersent** sur plusieurs départements et dans le
   temps. Invisibles à la lecture fiche par fiche, ce sont eux qui portent l'anticipation.

Cadre juridique : les FRS respectent le fichier **GIPASP** (décret n° 2020-1512). Les données
personnelles ne sont mentionnées que dans les catégories autorisées — plaques d'immatriculation
en cas d'atteinte supposée à l'ordre public / la sûreté de l'État, identités de personnes
susceptibles de porter atteinte à la sécurité et ayant été contrôlées, identifiants/pseudonymes
et URL pour le renseignement en source ouverte.

## 2. Le verrou technique

À **1000 fiches/jour**, on ne peut **pas** donner les textes bruts à un LLM : une seule journée
représente ~100 000 tokens, illisible et hors budget. Toute solution « je lis toutes les fiches et
je résume » s'effondre à l'échelle.

La réponse : **l'agrégation est faite par la base de données** (comptes, regroupements,
détection), et l'IA générative ne travaille que sur des **agrégats compacts** — puis, seulement
là où c'est utile, sur un **petit sous-ensemble** de textes ciblés.

## 3. La solution mise en place

### 3.1 Une base + une API de consultation (rens-api)

- Base **PostgreSQL `rens`** (OVH) : table `frs` (date, titre, unité, code GGD, département,
  commune, texte) + table `frs_mot_cle`. Rôles en **lecture seule** (`rens_api`, `rens_ro`).
- Micro-service **`rens-api`** (Node, read-only, authentification Bearer), exposé en HTTPS.
  Toute l'intelligence lourde est en SQL, la base renvoie du JSON compact :

| Endpoint | Rôle | Sortie |
|---|---|---|
| `GET /fiches` | liste/filtre (date, période, GGD, commune, recherche) **paginée** | fiches |
| `GET /fiches/{id}` | détail d'une fiche | fiche + texte |
| `GET /agregats` | **panorama d'un jour** (défaut : la veille) | total, delta veille, top mots-clés, par GGD, top communes |
| `GET /signaux` | **découverte de signaux faibles** sur une fenêtre glissante | mots-clés rares-mais-dispersés + `emergent` |

**Découverte de signaux faibles — le cœur.** Un signal faible = un mot-clé qui apparaît **peu**
(rare) mais **dispersé** sur plusieurs départements et plusieurs jours. Une simple requête
d'agrégation l'isole : `GROUP BY mot HAVING count BETWEEN 5 ET 20 AND depts >= 3` (les thèmes de
fond, très fréquents, sont écartés par la borne haute ; il reste les phénomènes mineurs mais
récurrents). Un drapeau `emergent` signale ceux qui montent récemment. **Scalable** : la requête
renvoie ~10-30 lignes quel que soit le volume (validé sur 6000 fiches / 6 jours).

### 3.2 L'IA générative (IAka) : deux workflows

Le détail (nœuds, prompts, câblage) est dans `docs/iaka-rens-workflows.md`.

- **Workflow 1 — Synthèse quotidienne** : appelle en parallèle `GET /agregats` et `GET /signaux`
  (deux nœuds API), puis une **jointure pilotée en langage naturel** rédige la synthèse à partir
  de ces deux blocs JSON compacts. L'agent **ne voit jamais les fiches brutes**.
- **Workflow 2 — Zoom sur un signal** : appelle `GET /signaux`, puis un **agent lecteur** doté de
  l'outil `listFiches` (MCP dérivé de l'OpenAPI rens-api) choisit le signal le plus saillant,
  récupère la **quinzaine de fiches** concernées **avec leur texte** et rédige une analyse
  détaillée (mode opératoire, étendue, recommandations).

Architecture à deux étages : **découverte** (agrégats/mots-clés, tout le volume) → **analyse**
(texte, sur un sous-ensemble ciblé). C'est ce qui permet la profondeur **sans** lire les 1000
fiches.

### 3.3 L'application (front)

Page `/rens` du démonstrateur (React) :

- **Colonne gauche** — les **fiches du jour** (dernier jour), en liste paginée (20/page). La liste
  ne montre que les métadonnées ; un clic ouvre la fiche entière (texte complet). Filtres : date,
  GGD, commune, recherche.
- **Colonne droite** — un bouton **« Générer la synthèse »** déclenche les deux workflows IAka (via
  le BFF `server/proxy.mjs`, route `/api/rens/synthese`, qui les lance en parallèle et concatène) :
  **synthèse de la veille + zoom signal faible**, rendus en markdown.

Distinction métier importante : la **liste** porte sur **le jour** (production en cours) ; la
**synthèse** porte sur **la veille** (dernier jour complet).

## 4. Ce que le cas d'usage démontre pour IAka

- **Passage à l'échelle** : l'IA générative reste pertinente et rapide à 1000+ fiches/jour parce
  que le gros du travail est délégué à la base (agrégation SQL) ; le LLM ne fait que la
  **narration** sur des données réduites.
- **Chaîne agentique mixte** : nœuds API déterministes (fiables, sans SQL halluciné) pour la
  collecte + agents LLM pour la synthèse et l'analyse ciblée.
- **Valeur ajoutée** : faire **émerger** ce qui est noyé dans la masse (signaux faibles) — une
  tâche qu'aucune lecture humaine séquentielle ne permet à ce volume.

## 5. Démonstrateur — jeu de données

Jeu **fictif** national (métropole + Outre-mer, 97 GGD), ~1000 fiches/jour du **17 au 22 juillet
2026**, 10 thématiques variées (violences urbaines, stupéfiants, atteintes aux élus, escroqueries
aux séniors, dérive sectaire, écologie radicale, radicalisation, atteintes aux biens agricoles,
hooliganisme, trafic d'armes). Textes GIPASP-safe (plaques, identités, pseudos/URL fictifs générés
par fiche). **3 trames de signaux faibles** plantées (faux agent, survol de drone sur site
sensible, repérage d'exploitations) — l'outil les isole proprement du bruit.
