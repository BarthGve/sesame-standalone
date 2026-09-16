# Base RENS / FRS + synthèse IAka — design

*Cas d'usage exploratoire IAka : une base de **fiches de renseignement simplifiées (FRS)**
rédigées par les unités de terrain, interrogeable en **langage naturel** pour produire une
synthèse d'un jour donné, dégager des tendances et faire émerger des signaux faibles.*

Statut : design validé (brainstorming). Prochaine étape : plan d'implémentation (writing-plans).

## 1. Objectif et périmètre

### But
Montrer qu'IAka peut, à partir d'une base de FRS et d'une demande en langage naturel :
- produire la **synthèse des fiches d'un jour donné** ;
- dégager des **tendances** (par thématique, département, période) ;
- faire émerger des **signaux faibles** (phénomène mineur récurrent, dispersé, invisible
  fiche par fiche).

### Périmètre itération 1 (scope A) — validé
- **1 écran** : consultation (liste + filtres des fiches) + zone langage naturel → synthèse.
- Base **remplie par seed SQL** (pas de saisie terrain — itération 2).
- Requêtes **read-only**.

### Découverte de signaux faibles — itération 1, via agrégation
La détection de signaux faibles **est** dans le périmètre, mais **par agrégation**, pas par
récupération brute : un signal faible = ~5-15 fiches dispersées dans des centaines, jamais
présentes dans un `LIMIT 60`. L'agent lance d'abord UNE requête `GROUP BY mot ... HAVING
count BETWEEN 5 AND 20 AND count(DISTINCT code_ggd) >= 3` (les thèmes de fond, très fréquents,
sont exclus par la borne haute ; restent les phénomènes rares-mais-dispersés), puis fait un
**drill-in** sur le candidat (~8 fiches) pour narrer. Une requête agrégée renvoie ~10 lignes →
tient dans le budget de prompt. Le seed plante 3 trames avec des **mots-clés naturels signatures**
rares et non partagés (`faux agent`, `équipement technique`, `exploitation agricole`).

### Hors périmètre (itérations ultérieures)
- Saisie/rédaction de fiche par les unités (formulaire d'écriture).
- **Narration cross-corpus brute** : rédiger une synthèse en lisant les textes intégraux de
  centaines de fiches en un seul prompt. L'itération 1 narre soit sur un ensemble filtré
  tractable (jour / dept+période / mots-clés, ≤60 fiches), soit sur le drill-in d'un signal
  découvert par agrégation.
- Recherche sémantique (la base live est `postgres:16` **sans pgvector**).

### Deux limites structurelles assumées
1. **Pas de vecteur** : la récupération se fait par SQL `date / dept / thématique / mots-clés`
   uniquement. IAka ne raisonne que sur ce que le filtre remonte.
2. **Budget de prompt** : « synthèse d'un jour » = poignée de fiches → récupération directe OK
   (`LIMIT 60`). Les questions année entière passent par l'**agrégation** (§5-B, ~10 lignes
   renvoyées) puis drill-in, jamais par la lecture brute de centaines de textes.

## 2. Contexte GIPASP (conformité des données)

Le seed doit rester cohérent avec les catégories de données que le fichier **GIPASP**
(décret n° 2020-1512 du 2 déc. 2020, CSI) autorise à collecter : identité, coordonnées,
situation personnelle, **moyens de déplacement (immatriculation, permis)**, activités
susceptibles de porter atteinte à la sécurité publique, facteurs de dangerosité/fragilité,
et les catégories de personnes concernées (personnes menaçantes, relations directes,
victimes, entourage de groupements).

**Choix de conception** : les personnes n'apparaissent **que dans le texte libre** de la fiche,
avec des **identités entièrement fictives** couvrant ces catégories. **Aucune colonne PII
structurée** — le schéma ne porte que des métadonnées (date, unité, dept, thématique,
mots-clés). Plus simple, plus sûr, et suffisant pour la démo.

## 3. Architecture

Calquée sur RGP, en **read-only**. Deux accès à **la même base `rens`** :

```
Front  src/features/rens ─┬─ GET  /api/rens/fiches   → proxy.mjs → rens-api (HTTP + pg) → base rens   [liste/filtre]
                          └─ POST /api/rens/synthese → proxy.mjs → workflow IAka « RENS »
                                                                      └ Agent synthèse + MCP Postgres RO (rôle rens_ro)
                                                                        → execute_sql → textes des fiches
                                                                        → narration markdown (synthèse/tendances/signaux)
```

- `rens-api` HTTP sert **l'application** (liste consultable sans invoquer le LLM).
- **MCP Postgres read-only** sert **IAka** (l'agent lit les textes et rédige).

C'est exactement le double accès RGP (`rgp-api` HTTP pour l'app + MCP SQL pour IAka), en
supprimant la branche d'écriture.

## 4. Modèle de données

Base `rens` sur le conteneur `brunogauville-postgres-1` (`postgres:16`, hôte `91.134.75.161:5432`).

```sql
CREATE TABLE frs (
  id             serial PRIMARY KEY,
  date_redaction date NOT NULL,
  titre          text NOT NULL,
  unite          text NOT NULL,          -- ex. "COB Segré-en-Anjou Bleu"
  code_ggd       text NOT NULL,          -- ex. "GGD 49"
  departement    text NOT NULL,          -- ex. "Maine-et-Loire"
  thematique     text NOT NULL,          -- ex. "violences urbaines", "dérive sectaire"
  texte          text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_frs_date  ON frs(date_redaction);
CREATE INDEX idx_frs_ggd   ON frs(code_ggd);
CREATE INDEX idx_frs_theme ON frs(thematique);

CREATE TABLE frs_mot_cle (
  id     serial PRIMARY KEY,
  frs_id integer NOT NULL REFERENCES frs(id) ON DELETE CASCADE,
  mot    text NOT NULL,
  ordre  integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_motcle_frs ON frs_mot_cle(frs_id);
CREATE INDEX idx_motcle_mot ON frs_mot_cle(mot);
```

Décisions actées : **pas de cotation** ; mots-clés dans une **table séparée** (pattern RGP,
pas de colonne `text[]`).

### Rôles PostgreSQL
Deux rôles dédiés, tous deux **SELECT-only** en itération 1 (le seed passe par la migration,
en tant que propriétaire) :
- `rens_api` — utilisé par le conteneur `rens-api` (HTTP app).
- `rens_ro` — utilisé par le MCP Postgres d'IAka.

```sql
GRANT SELECT ON frs, frs_mot_cle TO rens_api, rens_ro;
```

## 5. Workflow IAka « RENS »

Workflow **mono-branche** (pas de routage write/read — tout est lecture) :

```
DÉBUT (prompt langage naturel, préfixé de la date du jour par le proxy)
  → Agent synthèse + MCP Postgres read-only (base rens, rôle rens_ro)
  → FIN (markdown)
```

**Agent synthèse — comportement attendu :**
1. Le **proxy** préfixe la date du jour au prompt (comme RGP : sans ça l'agent devine mal
   « aujourd'hui »/« cette année »).
2. L'agent choisit la **stratégie de requête** selon la demande :
   - **(A) synthèse d'un jour / période courte / thème précis** → UNE requête `SELECT` filtrée
     (`date_redaction`, `code_ggd`, `thematique`, jointure `frs_mot_cle`) remontant
     `titre + texte + date + unité + dept + mots-clés`, `LIMIT 60` de garde.
   - **(B) signaux faibles / tendances longues** → d'abord UNE requête d'**agrégation**
     (`GROUP BY mot ... HAVING count BETWEEN 5 AND 20 AND depts >= 3`, en excluant les
     marqueurs techniques `signal-faible:%`), puis un **drill-in** par mot-clé naturel sur le
     candidat pour narrer.
3. Il **appelle réellement** `execute_sql` (vrai tool call, jamais décrit en texte).
4. Il **raisonne** et rédige la réponse en **markdown** : phrase de synthèse, tableau de
   tendances si demandé, ou mise en évidence du signal faible (fenêtre temporelle, nb de
   départements, dates/unités du drill-in, pourquoi c'est invisible fiche par fiche).

Différence clé avec RGP : la branche read RGP renvoie des **données** (JSON) ; ici l'agent
**narre** à partir des textes (c'est le cœur du cas d'usage). Faisable en un seul agent :
il reçoit le résultat de l'outil en contexte puis rédige.

**MCP Postgres RO — câblage (à faire côté builder IAka, comme RGP) :**
- MCP Toolbox PostgreSQL pointé sur la base `rens`, rôle `rens_ro`.
- Réseau : firewall `DOCKER-USER` déjà ouvert sur 5432 pour l'IP de sortie IAka
  `91.134.33.159` (règle `IAKA_FW`). Ajouter l'entrée `pg_hba.conf` du conteneur :
  `host rens rens_ro 91.134.33.159/32 scram-sha-256` (+ `SELECT pg_reload_conf()`).

## 6. rens-api (conteneur OVH)

Node `http` + `pg`, calqué sur `server/rgp-api`. **Read-only**, auth Bearer.

Endpoints :
- `GET /fiches?date=&ggd=&theme=&q=&limit=` → liste filtrée (JSON `{ data: [...] }`).
- `GET /fiches/:id` → détail d'une fiche (avec ses mots-clés).
- `GET /health`.

Enveloppe de réponse uniforme comme RGP : succès `{ "data": ... }`, erreur
`{ "error": { "code", "message" } }`. Dockerfile identique (node:20-alpine). Ajouté au
`docker-compose.yml` OVH (`/home/brunogauville/docker-compose.yml`), routé nginx sous
`/rens-api`. Une `openapi.json` décrit l'API (utile si on veut plus tard un MCP-API dérivé
pour la saisie en itération 2).

## 7. Proxy applicatif (`server/proxy.mjs`)

Deux routes ajoutées, sur les patterns existants :
- `GET /api/rens/fiches` → relaie vers `rens-api` (token serveur, jamais côté client).
- `POST /api/rens/synthese` → pattern `iaka.mjs` : `execWorkflow` (app RENS) avec **préfixe
  date du jour**, poll jusqu'au `SUCCESS`, extraction du markdown (retire les blocs
  `<tool>…</tool>` / `<tool-output>`, comme `synthese.mjs`/`iaka.mjs`).

Erreurs : `RENS_UPSTREAM`, `IAKA_UPSTREAM`, `IAKA_TIMEOUT` (réutilise les conventions).
`pollTimeoutMs` configuré ; un filtre trop large peut approcher le timeout → d'où le `LIMIT`
côté agent (§5).

## 8. Front `src/features/rens/`

Un écran, aligné sur `src/features/rgp` :
- `RensApp.tsx` — layout 2 zones : (gauche) liste + filtres (date, GGD, thématique,
  recherche mots-clés) ; (droite) zone langage naturel → rendu **markdown**
  (`react-markdown` + `remark-gfm`, déjà en place).
- `rensStore.ts` — store persisté via `createPersistedStore` (pattern existant).
- `rensApi.ts` — appels `/api/rens/fiches` et `/api/rens/synthese`.
- Tests : `RensApp.test.tsx`, `rensStore.test.ts`, `rensApi.test.ts`.

**Contrainte projet** : **aucun emoji** dans l'UI (icônes Material Icons / SVG inline, texte).

## 9. Seed de données

Objectif : ~**400-800 fiches**, du **1 janv. → 18 juil. 2026** (~199 jours), **2-4 fiches/jour**,
réparties sur **plusieurs GGD** (49 Maine-et-Loire, 44 Loire-Atlantique, 53 Mayenne,
72 Sarthe, 85 Vendée…), **thématiques variées** (radicalisation, rodéos/violences urbaines,
trafics de stupéfiants, dérives sectaires, atteintes aux élus, écologie radicale, escroqueries
aux personnes âgées, économie souterraine…).

**Conformité** : identités **fictives**, catégories GIPASP (§2), personnes uniquement dans le
texte.

**Signaux faibles — 2-3 trames scénarisées plantées** : un phénomène mineur récurrent,
dispersé sur plusieurs départements et étalé dans le temps, anodin fiche par fiche mais
formant une tendance à l'échelle (ex. montée graduelle d'un même mode opératoire / d'une même
cible sur 4 dept, janv.→juin). C'est ce qu'IAka doit relier.

**Reproductibilité** : le seed est **généré par LLM hors-repo** puis **le `.sql` d'INSERT
résultant est commité** (migration/seed reproductible, pas un one-shot manuel). Un test vérifie
la validité et la présence des trames.

## 10. Déploiement OVH (ordre)

1. Créer la base `rens` sur `brunogauville-postgres-1` + migration (tables, index).
2. Créer rôles `rens_api`, `rens_ro` (SELECT-only) + grants.
3. Charger le seed SQL.
4. Ajouter `pg_hba.conf` pour `rens_ro` (IP IAka) + `pg_reload_conf()`.
5. Build/run du conteneur `rens-api` (docker-compose.yml OVH) + route nginx `/rens-api`.
6. Côté builder IAka : app/workflow « RENS » + MCP Postgres RO sur `rens`.

## 11. Tests

- `rens-api` : `node --test` (endpoints, filtres, enveloppe d'erreur) — pattern
  `server/rgp-api/*.test.js`.
- `proxy` : `server/proxy.test.mjs` (routes `/api/rens/*`, extraction markdown, erreurs).
- Front : `vitest` sur `rensStore` / `rensApi` / `RensApp` (mock réaliste du markdown IAka,
  comme `RgpApp.test.tsx`).
- Seed : validité SQL + comptage + présence des trames de signaux faibles.

## 12. Dette / points à surveiller

- Rôles `rens_api`/`rens_ro` SELECT-only tant qu'il n'y a pas de saisie (itération 2 rouvrira
  l'écriture, via API HTTP à allocation contrôlée — jamais SQL direct, cf. leçon RGP).
- Token `rens-api` géré côté serveur (proxy + MCP), jamais dans le prompt (cf.
  `rgp-api-security-debt`).
- Synthèse cross-corpus année : nécessitera une étape d'agrégation (map-reduce sur fiches)
  hors budget de prompt — itération dédiée.
