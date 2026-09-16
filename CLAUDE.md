# Instructions projet — sesame-standalone / SÉSAME (air-gap)

## But

Démonstrateur des capacités de la plateforme **IAka** (IA agentique) pour
installation **hors Internet**. Chaque page du front = un cas d'usage = un
**workflow IAka**. Le front appelle une route `/api/*` du BFF, qui déclenche le
workflow (ou proxifie vers un microservice) et renvoie le résultat.

La démo OVH vit dans un autre dépôt. Ici : code + compose + wiki d'install.

## Architecture

- **Front** — React 19 + Vite + TS. UI : Cunningham / DSFR / ui-kit (La Suite gouv),
  MapLibre (carte). Pages dans `src/features/` : accueil, carte, saisies, rgp,
  synthese, pvtransport.
- **BFF** — `server/proxy.mjs` : serveur HTTP Node natif (sans framework), port 8787.
  `iaka.mjs::execWorkflow` = cœur : POST `/workflows/execute` puis poll
  `/workflows/executions/{id}` jusqu'à `SUCCESS`. Routes → workflow :
  `/api/query` (carte→GeoJSON), `/api/rgp/chat`, `/api/synthese`, `/api/pvtcmp`,
  `/api/identify`. App IDs = env `IAKA_*_APP_ID` (jamais en dur).
- **Microservices** (Docker, Postgres) — `server/rgp-api/` (perquisitions,
  objets, photos MinIO) et `server/rens-api/` (fiches RENS/FRS, read-only). Chacun
  son `package.json`, `Dockerfile`, `openapi.json`, `migrations/`.
- **Compose local** — BFF + rgp/rens/cote + Postgres/PostGIS + MinIO. IAKA reste
  hors compose, joignable via `IAKA_BASE_URL` / `IAKA_JWT` / `IAKA_*_APP_ID`.

## Commandes

- `npm run dev` — front seul (Vite). `/api` proxifié vers `localhost:8787`.
- `npm run proxy` — BFF seul (`--env-file=.env`).
- `npm run dev:all` — BFF + front.
- `npm run lint` — oxlint (front + serveur).
- `npm test` — tests **front** (Vitest, `src/**/*.test.{ts,tsx}`, jsdom).
- `npm run test:bff` — tests BFF (`server/*.test.mjs`).
- `npm run test:rens` / `test:rgp` / `test:cote` — microservices.
- `npm run test:all` — front + BFF + les 3 microservices.
- `npm run build` — `tsc -b && vite build`.

## Infra & env

- `.env` requis (voir `.env.example`) : `IAKA_BASE_URL`, `IAKA_JWT`,
  `IAKA_*_APP_ID`, `RGP_API_URL`/`RGP_API_TOKEN`, `RENS_API_URL`/`RENS_API_TOKEN`.
  Les `MINIO_*` vivent côté rgp-api (compose), pas dans le BFF.
- Secrets — ne jamais commit. Pas d'UUID métier ni d'URL cloud dans `.env.example`.

## Front-end

- **INTERDIT : émoticônes / emoji dans le front.** Ne jamais utiliser d'emoji comme
  icône, puce, marqueur ou décoration dans l'UI. Utiliser à la place des icônes
  vectorielles (Material Icons — déjà importé via `@fontsource/material-icons` —
  ou SVG inline), du texte, ou les tokens/composants Cunningham / DSFR.

## Qualité & discipline de développement

### Principes non négociables

1. **Petits diffs, un sujet par PR.** Pas de « feature + refactor massif + docs ».
2. **Pas de code spéculatif.** Pas d'abstraction « au cas où », pas de feature flag
  mort, pas de dépendance ajoutée sans usage immédiat dans le diff.
3. **La vérité vit dans le code + les tests**, pas dans les commentaires d'intention.
  Un commentaire explique un *pourquoi* non évident (sécurité, contrainte métier),
  jamais ce que le code fait déjà.
4. **Données de procédure = sensibles** (perquisitions, FRS, pièces, photos, IMEI,
  plaques, IBAN, noms). Ne jamais les logger, les renvoyer en clair dans une erreur
  générique, ni les coller dans un prompt de debug.

### Avant de coder une feature non triviale

1. Lire l'architecture existante dans la feature concernée (`src/features/<x>/`,
  route BFF, microservice).
2. Si le comportement n'est pas évident : écrire ou mettre à jour une spec courte
  dans `docs/superpowers/specs/` (ou pointer une existante).
3. Préférer **étendre** un module existant plutôt que d'en créer un parallèle
  (ex. jobs → `jobs.mjs`, stores → `createPersistedStore`, forward API → pattern
  `forwardRgp` / `forwardRens`).

### Front (React / TS)

- **TypeScript `strict: true`** (activé). Interdit d'introduire de nouveaux
  `as any` hors tests ou bindings de lib sans types (justifier en 1 ligne).
- **Composants** : un fichier > ~300 lignes = signal de découpage (sous-composants,
  hooks, modules pur). Ne pas grossir les monolithes existants (`SaisiesApp.tsx`…).
- **Styles** : préférer tokens Cunningham / DSFR / classes CSS partagées.
  Interdit de dupliquer des hex brand (`#000091`, etc.) dans chaque feature —
  extraire une constante partagée ou un token. Éviter d'ajouter des blocs
  `style={{...}}` massifs ; les nouveaux écrans doivent réutiliser le design system.
- **État** : stores feature via `createPersistedStore` (ou React Query si le cas
  est vraiment du cache serveur). Ne pas réintroduire un 3e pattern state.
- **Appels API** : toujours via le module `*Api.ts` de la feature ; pas de `fetch`
  ad hoc dans un composant UI.
- **Jobs longs** : utiliser `runJobAsync` ; gérer `TIMEOUT`, `JOB_INCONNU`,
  `ABORTED` explicitement dans le store.
- **INTERDIT : emoji dans l'UI** (déjà en vigueur).

### BFF (`server/proxy.mjs` et modules)

- Toute nouvelle route : validation d'entrée stricte, code d'erreur stable ajouté
  à `ERROR_STATUS` (`httpUtil.mjs`) si pertinent, **aucun** détail upstream/LLM
  renvoyé au client.
- Corps HTTP : toujours borné (taille max) ; rejeter 413 au-delà (`readBody`).
- Workflows IAka : passer par `iaka.mjs` / helpers existants ; ne pas re-coder
  le poll execute/status. Toutes les cibles IAka via env `IAKA_*`.
- Jobs : créer via `jobs.mjs` (ou store Ariane pour ce pipeline) ; ne pas inventer
  un store parallèle. TTL + plafond de taille obligatoires.
- Forward microservices : Bearer serveur uniquement ; ne pas faire confiance au
  client pour l'auth amont.
- **Ne pas logger** prompt, body, markdown FRS, ni résultat workflow brut
  (sauf slice d'erreur technique ≤ 300–500 car. côté serveur). Utiliser
  `logRequest` (méthode + path + présence auth uniquement).
- Health : `GET /health` sans auth (aligné microservices).
- **Auth BFF** : pas d'auth UI. Defense-in-depth optionnelle : `BFF_API_TOKEN`
  (Bearer sur `/api/*`). Ne jamais exposer le port 8787 sans reverse-proxy
  authentifié en réseau non maîtrisé.

### Microservices (rgp-api, rens-api, cote-api)

- **Fail-closed** : sans `API_TOKEN`, refus de démarrer. Interdit le pattern
  `if (TOKEN && …)` qui ouvre l'API si le secret manque.
- SQL **uniquement** paramétré (`$1…`). Interdit de construire du SQL avec
  interpolation de chaînes utilisateur.
- Séparer pure logique (query builders, validations) du handler HTTP — testable
  sans écouter un port.
- Migrations versionnées dans `migrations/` ; pas de DDL ad hoc en prod.
- OpenAPI mis à jour si le contrat HTTP change.

### Sécurité (checklist PR)

- [ ] Auth : route protégée au bon niveau (BFF / microservice)
- [ ] Validation + bornes (taille, longueur, whitelist d'enum)
- [ ] Pas de secret en dur, pas de secret dans les logs
- [ ] Photos / fichiers : path traversal impossible, MIME sûr
- [ ] Erreurs client = codes stables, pas de stack
- [ ] Données sensibles absentes des logs et des messages d'erreur

### Tests (obligatoires pour merger)

| Zone | Outil | Quand |
|------|--------|--------|
| Logique pure front | Vitest (`src/**/*.test.ts`) | toujours |
| Composants à branches | Vitest + Testing Library | si logique UI non triviale |
| BFF | `node --test server/*.test.mjs` | toute route / helper touché |
| rens-api | `npm test --prefix server/rens-api` | si code rens/audit touché |
| rgp-api | `npm test --prefix server/rgp-api` | si code rgp touché |
| cote-api | `npm test --prefix server/cote-api` | si code cote touché |

Règles :
- **Nouvelle logique pure → test d'abord** (ou dans le même commit).
- Un bug fixé → test de non-régression qui échoue sans le fix.
- Ne pas mocker au point de ne plus tester le comportement réel
  (préférer fake `fetch` / faux pool pg comme le repo le fait déjà).
- `npm test` seul ne couvre **pas** le serveur : lancer `npm run test:all` ou au
  minimum les tests de la zone modifiée avant de déclarer « OK ».

### CI attendue (ne pas régresser)

Le pipeline doit rester au moins : lint, typecheck, tests front, tests BFF,
tests microservices (rgp, rens, cote), build Docker local (sans registry distant).
Toute nouvelle règle de lint ajoutée au repo doit être branchée en CI (fail = bloquant).

### Conventions de code IA

- **Ne pas réécrire** un fichier entier pour un petit fix.
- **Ne pas** ajouter de README / doc markdown non demandés hors `docs/` métier.
- Préférer le français pour l'UI et les messages métier ; anglais OK pour
  identifiants techniques (`ERROR_STATUS`, noms de jobs).
- Noms : français métier dans le domaine gendarmerie (`perquisition`, `una`,
  `fiche`, `scelle`) — rester cohérent avec l'existant.
- Après modification : lancer les tests de la zone + `npx tsc -b` ;
  ne pas affirmer que « ça passe » sans l'avoir exécuté.

### Dette connue (ne pas aggraver)

- `SaisiesApp.tsx`, `proxy.mjs`, `ariane.mjs` sont déjà gros : tout ajout doit
  **extraire** plutôt qu'empiler.
- Styles inline historiques : les nouveaux écrans utilisent `src/lib/uiTokens.ts`
  (ou variables Cunningham), pas de nouveaux hex brand en dur.
- Aucune PR ne doit ajouter de relâchement (`any`, disable lint, fail-open auth).
