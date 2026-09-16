# Pages de l’application

Routes **réelles** (`src/App.tsx`). Toute autre URL sous `/app/*` redirige
vers `/app/accueil`. L’auth UI n’existe pas : qui atteint le port 80 voit
toutes les pages.

Un `app_id` vide → flag `workflows.*` à `false`, **pas d’appel IAKA**, page
« non configuré ». IAKA down ou mal câblée → `IAKA_UNAVAILABLE` /
`IAKA_UPSTREAM` (messages déjà prévus dans l’UI).

## `/` — landing

Page d’entrée DSFR (« Expérimentation IAKA DGGN »). Bouton **Entrer** →
`/app` (index redirigé vers `/app/accueil`). Lien logo depuis l’app → retour
ici. Pas de widget externe.

## `/app/accueil` — Accueil

Présentation de l’expérimentation (enjeu, objectifs, périmètre). Aucun appel
IAKA. Point d’atterrissage du menu.

## `/app/carte` — Carte BDSP

Question en langage naturel → workflow IAKA (`IAKA_CARTE_APP_ID`) → GeoJSON
affiché sur MapLibre. Fond : tuiles same-origin `/api/tiles/{z}/{x}/{y}` si
`MAP_TILES_URL` est posé, sinon fond neutre.

- Job asynchrone BFF (jusqu’à ~8 min de poll carte).
- Dump `bdsp` absent : exécution possible, couches vides (« Aucun point »).
- Clic objet : identify (`IAKA_IDENTIFY_APP_ID`) si configuré.

## `/app/saisies` — Perquisitions

Saisie des objets d’une perquisition (UNA, lieu, scellés, photos, PV).
Données : **rgp-api** (seed UNA `12345/1/2026` dès le premier `up`).

- Autocomplétion d’adresse : `GET /api/adresses?q=` (BAN off → `[]`, saisie libre).
- Photos : MinIO via rgp-api ; clé absente → 404.
- Identification photo : `IAKA_IDENTIFY_APP_ID`.

## `/app/rgp` — Assistant personnel RGP

Chat enquêteur ↔ workflow `IAKA_RGP_APP_ID`. Réponses riches (objets,
perquisitions) via rgp-api. Seed minimal suffisant pour une démo sans dump
photos.

## `/app/frs` — Fiches de renseignement

Page unifiée, onglets (query `?onglet=`) :

| Onglet | URL | Rôle | IAKA |
|---|---|---|---|
| Flux | `/app/frs?onglet=flux` | Liste / détail des FRS (rens-api) | — |
| Synthèse | `/app/frs?onglet=synthese` | Synthèse quotidienne + zoom | `IAKA_RENS_SYNTHESE_APP_ID`, `IAKA_RENS_ZOOM_APP_ID` |
| Contrôle | `/app/frs?onglet=controle` | Qualité GIPASP (rapport d’audit) | `IAKA_QUALITE_APP_ID` (batch) |
| À la demande | `/app/frs?onglet=analyse` | Audit interactif 1–20 fiches | `IAKA_QUALITE_APP_ID` |
| Rédiger | `/app/frs?onglet=rediger` | Rédaction a priori | — (rens-api écriture) |

Deep-link : `/app/frs?onglet=controle`. Contexte jour + GGD partagé Flux /
Contrôle.

Anciennes routes, **redirigées** :

- `/app/rens` → `/app/frs?onglet=flux`
- `/app/qualite` → `/app/frs?onglet=controle`

Le seed FRS (`server/rens-api/seed/frs_seed.sql`) peuple le flux. Sans seed :
listes vides, pas de crash. L’audit nocturne est **off** (`AUDIT_NIGHTLY=0`)
tant qu’on ne le lance pas à la main.

## `/app/qualite`

Alias historique. Redirige vers `/app/frs?onglet=controle`. Ne pas documenter
d’autre chemin « qualité ».

## `/app/analyse` — Analyse (synthèse d’audition)

Dépôt d’**une** pièce (PV / audition) → workflow `IAKA_SYNTHESE_APP_ID` →
proposition HTML éditable, copie, export. Menu : **Analyse**.

Il n’existe **pas** de route `/app/synthese` : c’est `/app/analyse`.

## `/app/pv-transport` — PV transport

Dépôt d’**un** fichier de notes → workflow `IAKA_PVTCMP_APP_ID` → projet de PV.
Route réelle : `/app/pv-transport` (tiret), pas `/app/pvtransport`.

## `/app/evaluation` — Évaluation des avoirs

Choix d’une UNA (seed `12345/1/2026` ou procédures saisies), sélection
d’objets (véhicules), lancement `IAKA_EVALUATION_APP_ID`. L’agent IAKA
s’appuie sur le MCP **cote-api** (`http://cote-api:8082`) et rgp-api.

## `/app/ariane` — Ariane

Dépôt de pièces PDF → extraction (`IAKA_ARIANE_EXTRACTION_APP_ID`) +
consolidation (`IAKA_ARIANE_CONSOLIDATION_APP_ID`) → dossier (synthèse,
parties, faits, actes, réseau). Onglet Questions : RAG si
`IAKA_RAG_CORPUS_ID` est renseigné, sinon message « corpus non configuré »
(`ARIANE_RAG_INDISPONIBLE`).

## Menu

Groupes dans le bandeau :

- **Rédaction procédure** : Analyse, Ariane, PV transport, Perquisitions,
  Évaluation des avoirs, Assistant personnel - RGP
- **Sécurité publique** : Carte BDSP, Fiches de renseignement

Pastille de statut (en cours / ok / erreur) sur les pages à job long.

## Jobs

Les traitements longs (carte, analyse, PV, évaluation, FRS synthèse, Ariane)
passent par le store **mémoire** du BFF (`jobs.mjs`). Un redémarrage BFF
annule les jobs en vol — l’UI affichera `JOB_INCONNU`.
