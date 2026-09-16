# Fiche descriptive — Allocation d'un UNA dans RGP via l'API

## 1. Objet

L'application SÉSAME dispose d'une API HTTP (« RGP Lookup API — carnet ») qui permet
de **consulter** et surtout d'**allouer** des numéros de procédure RGP, identifiés par
leur **UNA**. « Prendre un UNA » consiste à réserver, de façon atomique et garantie
sans doublon, le prochain numéro de procédure disponible pour une unité et une année
données.

L'API est appelée par l'agent conversationnel **IAka** (via un contrat OpenAPI) ou
directement en HTTP.

## 2. Notion d'UNA

- **UNA = `unite / numero / annee`** (ex. `15127/1/2026`).
- `unite` : code de l'unité de gendarmerie (FK `unite.code`).
- `numero` : compteur **par couple (unité, année)**, qui **repart à 1 chaque année**.
- `annee` : année de la procédure (par défaut, l'année courante).

C'est le `numero` que l'API génère automatiquement : l'appelant ne le fournit jamais.

## 3. Architecture

```
IAka (agent LLM)  ──OpenAPI──▶  RGP Lookup API  ──▶  PostgreSQL (base « rgp »)
                                 (Node.js :8080)       table « una » + tables jointes
```

- **Runtime** : serveur Node.js natif (`http`), sans framework, pool `pg` (4 connexions max).
  Fichiers : `server/rgp-api/server.js`, `perquisition.js`.
- **Conteneur** : image `node:20-alpine` (`server/rgp-api/Dockerfile`), écoute sur `:8080`.
- **Hébergement** : conteneur Docker sur serveur OVH (`brunogauville-rgp-api-1`), réseau
  privé. Exposition publique en production via `http://localhost/rgp-api`.
- **Accès développeur** : tunnel SSH `scripts/tunnel-rgp.sh` (map `localhost:8080` → conteneur).
- **Contrat** : `server/rgp-api/openapi.json` (fourni à IAka comme description des outils).

## 4. Endpoint d'allocation

| Élément | Valeur |
|---|---|
| Méthode | `POST /procedure` (alias `POST /pv`) |
| Alias GET | `GET /procedure/creer?...` (paramètres en query — contournement d'un bug IAka sur le POST) |
| Auth | En-tête `Authorization: Bearer <API_TOKEN>` si un token est configuré |
| Corps | JSON `ProcedureCreate` |
| Réponse OK | `{ "data": <Procedure> }` |
| Réponse erreur | `{ "error": { "code": "...", "message": "..." } }` |

### Paramètres du corps

| Champ | Requis | Description |
|---|---|---|
| `unite` | **oui** | Code entier de l'unité. Doit exister dans `unite`. |
| `type` | **oui** | Type de document : libellé (ex. `PVEJ`) **ou** id. Doit exister dans `type_document`. |
| `synthese` | non | Objet de la procédure (ex. « cambriolage »). |
| `urgent` | non | Booléen. Défaut `false`. |
| `sensible` | non | Booléen. Défaut `false`. |
| `groupe` | non | Libellé ou id de groupe, **scopé à l'unité**. |
| `commune` | non | Code INSEE (ex. `49331`, `2A004`) ou nom non ambigu. |
| `annee` | non | Défaut = année courante. |

### Exemple

Requête :
```json
POST /procedure
{ "unite": 15127, "type": "PVEJ", "synthese": "cambriolage", "urgent": true }
```

Réponse :
```json
{ "data": {
    "id": 42, "una": "15127/1/2026",
    "unite": 15127, "numero": 1, "annee": 2026,
    "type_libelle": "PVEJ", "synthese": "cambriolage",
    "urgent": true, "sensible": false,
    "unite_libelle": "Communauté de brigades de Segré-en-Anjou Bleu"
} }
```

## 5. Déroulé de l'allocation (côté serveur)

Fonction `createUna` (`server.js`). Étapes :

1. **Validation** des champs : `unite` entier, `type` non vide, `annee` valide, coercition
   des booléens `urgent`/`sensible`.
2. **Vérification des références** : l'unité existe (`unite`), le type existe
   (`type_document`), le groupe éventuel existe **pour cette unité**, la commune éventuelle
   est résolue en code INSEE (le code prime ; un nom n'est accepté que s'il est non ambigu).
3. **Allocation atomique du numéro** (cœur du dispositif) :
   ```
   BEGIN
   SELECT pg_advisory_xact_lock(unite, annee)          -- verrou par (unité, année)
   SELECT COALESCE(MAX(numero),0)+1  FROM una WHERE unite=? AND annee=?
   INSERT INTO una (... numero, date_submit=now())
   COMMIT
   ```
   Le **verrou consultatif transactionnel** (`pg_advisory_xact_lock`) sérialise les
   allocations concurrentes sur le même couple (unité, année) : deux demandes simultanées
   ne peuvent pas obtenir le même `numero`. Le verrou est relâché automatiquement au COMMIT.
4. **Relecture** de la ligne créée (avec libellés joints) renvoyée dans `data`.
5. En cas d'erreur, `ROLLBACK` et réponse `500 db_error`.

## 6. Codes d'erreur

| Code | Cause |
|---|---|
| `bad_request` | Champ requis manquant/invalide (`unite`, `type`, `annee`, corps JSON illisible). |
| `unite_inconnue` | Code unité absent de la table `unite`. |
| `type_inconnu` | Type de document introuvable. |
| `groupe_inconnu` | Groupe introuvable pour l'unité. |
| `commune_inconnue` / `commune_ambigue` | Commune non résolue ou nom ambigu. |
| `unauthorized` | Token Bearer manquant ou invalide. |
| `db_error` | Erreur PostgreSQL (rollback effectué). |

## 7. Endpoints connexes

- `GET /procedure?una=15127/1/2026` (ou `unite`/`numero`/`annee`) — consulter un UNA.
- `GET /procedures` (alias `/pvs`) — lister avec filtres (`type`, `unite`, `annee`,
  `groupe`, `urgent`, `sensible`, `limit`).
- `POST /procedure/modifier` (alias `/pv/modifier`) — modifier une procédure existante ;
  **l'identité `unite/numero/annee` est immuable** (elle sert uniquement à cibler la ligne).
- `GET /types` — liste autoritative des types de procédure (aide IAka à choisir).
- `GET /communes?q=...` — recherche typeahead de communes (accent-insensible).
- `GET /health` — sonde de disponibilité (non authentifiée).
- Famille `/perquisition*` — perquisitions et objets saisis rattachés à un UNA.

## 8. Points d'attention

- **Un POST = un numéro consommé** : chaque appel réussi incrémente définitivement le
  compteur. Pas d'annulation prévue par l'API (pas d'endpoint de suppression d'UNA).
- **Sécurité** : `API_TOKEN` est obligatoire — sans lui le service refuse de démarrer
  (fail-closed, `server.js`). Les requêtes sont journalisées avec IP et user-agent.
- Le contrat OpenAPI annonce `201 Created` à l'allocation ; l'implémentation renvoie
  actuellement le corps `data` avec un code HTTP `200`.
- **Codes d'erreur** : jusqu'au 20/07/2026, le helper `err()` écrasait *tous* les codes en `200`,
  l'erreur n'étant lisible que dans le corps (`{"error":{"code":…}}`). Un client qui teste le code
  HTTP — dont les nœuds et connecteurs IAka — voyait donc toujours un succès. Corrigé : `err()`
  propage le vrai code, comme `rens-api`. **Des échecs RGP jusque-là masqués peuvent apparaître au
  déploiement** ; vérifier les tokens des connecteurs MCP RGP en même temps.
