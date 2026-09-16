# Chaîne agentique IAka — assistant RGP

*Cette note décrit uniquement ce qui se passe **dans IAka** : la structure du workflow, ses
nœuds, ses agents et ses outils. Le front et le proxy applicatif sont hors sujet ici.*

Le câblage détaillé (prompts complets, identifiants d'outils, schéma de base) est dans
`docs/iaka-rgp-workflow.md`.

## Vue d'ensemble

Un unique **workflow IAka** (app « 05 - RGP ») porte toute l'intelligence. Il reçoit une
demande en langage naturel et produit une réponse en **markdown**. Il enchaîne :

```
DÉBUT (prompt requis)
   │
   ▼
[1] AGENT DE ROUTAGE  ──►  { "action": "write" | "read" }   (défaut : read)
   │
   ▼
[2] CONDITION (nœud LLM)  ──  Si write ─┐            Sinon (read) ─┐
                                        ▼                          ▼
                            [3] AGENT WRITE               [4] AGENT READ
                            + outils MCP « API RGP »       + outil MCP « Postgres (SQL) »
                            (createProcedure /             (execute_sql, lecture seule)
                             modifyProcedure)                       │
                                        │                          │
                                        └──────────┬───────────────┘
                                                   ▼
                                                 FIN
```

Le modèle utilisé par les nœuds est **Qwen 3.6** (généraliste + réflexion + code).

## [1] Agent de routage

**Rôle.** Classer l'intention de l'utilisateur en **binaire** : écriture ou lecture. Il
répond uniquement par un petit objet : `{"action": "write"}` ou `{"action": "read"}`.

- `write` = ouvrir une **nouvelle** procédure **ou** modifier une procédure existante.
- `read` = tout le reste (consulter, lister, compter, analyser, répondre à une question).
- **Règle de sécurité** : en cas de doute, `read`. On n'émet `write` que sur une intention
  d'écriture **explicite** — car écrire (allouer / modifier un UNA) est irréversible.

Ce routage binaire est volontairement simple : la distinction critique (écrire = irréversible)
est tranchée **une seule fois**, explicitement.

## [2] Nœud de condition

**Rôle.** Aiguiller vers la bonne branche à partir de la sortie du routage. Le nœud est
piloté par le modèle (formulaire `Si` / `Sinon`) :

- **Si** `action = write` → branche **écriture**.
- **Sinon** (défaut) → branche **lecture**.

La branche lecture étant le **défaut**, toute demande ambiguë retombe côté lecture (sûr).

## [3] Branche écriture — Agent + outils MCP « API RGP »

**Rôle.** Réaliser la création ou la modification en **appelant réellement un outil** MCP qui
encapsule l'API HTTP RGP. L'agent choisit l'outil et le renseigne à partir de la demande :

| Outil MCP | Action | Paramètres |
|---|---|---|
| `createProcedure` | ouvre une **nouvelle** procédure (alloue le numéro d'UNA) | unité (15127), type (PVEJ / PVEJST), synthèse, urgent, sensible, groupe |
| `modifyProcedure` | modifie une procédure **existante** | UNA (identité) + uniquement les champs à changer |

**Points clés.**

- **L'agent APPELLE l'outil** (véritable appel d'outil) — il ne se contente jamais de
  *décrire* l'appel en texte, sinon rien ne s'exécute.
- L'**allocation atomique** du numéro d'UNA reste dans l'API HTTP (jamais en SQL direct) :
  pas de risque de doublon.
- En modification, seuls les **champs réellement demandés** sont transmis (pour ne pas
  écraser les autres).
- Après l'exécution, l'agent **confirme en markdown** (numéro d'UNA en gras), en recopiant
  fidèlement les valeurs retournées par l'outil.

## [4] Branche lecture — Agent + outil MCP « Postgres » (lecture seule)

**Rôle.** Répondre à toute question de consultation en interrogeant la base RGP via un outil
MCP **PostgreSQL en lecture seule** (`execute_sql`), puis en **mettant en forme** la réponse.

**Sécurité et intégrité.**

- L'outil est connecté à la base avec un **rôle read-only dédié** : l'agent ne peut faire que
  des `SELECT` — **aucune écriture possible**, même en cas d'erreur du modèle.
- **Une seule requête** produit le résultat (agrégations comprises, via `GROUP BY`) : les
  **chiffres sont calculés par la base**, jamais par le modèle.
- L'agent **recopie exactement** les valeurs du résultat ; il ne recompte pas.

**Mise en forme (pilotée par le prompt).** L'agent choisit le format adapté à la demande :

- question fermée / synthèse → **une phrase** ;
- « par mois / par groupe / répartition / sous forme de tableau » → **tableau markdown** ;
- « liste / montre-moi tous les… » → **liste markdown**.

## Sortie du workflow

Le nœud **FIN** renvoie la réponse de la branche. En pratique :

- la réponse « métier » de l'agent est du **markdown** (phrase, tableau ou liste) ;
- le résultat de l'outil (données de la base ou de l'API) est disponible en amont pour garantir
  l'exactitude.

## Synthèse des briques IAka

| Brique | Rôle |
|---|---|
| Workflow « 05 - RGP » | orchestration complète (routage → condition → branches) |
| Agent de routage | classe write / read (défaut read) |
| Nœud de condition (Qwen 3.6) | aiguille vers écriture ou lecture |
| Agent write + MCP « API RGP » | `createProcedure` / `modifyProcedure` (via l'API HTTP) |
| Agent read + MCP « Postgres » | `execute_sql` en **lecture seule** sur la base RGP |
| Modèle | Qwen 3.6 27b |
| Format de réponse | markdown (phrase / tableau / liste) |

**Garde-fous structurels de la chaîne :**

1. routage binaire avec **lecture par défaut** ;
2. **isolation des outils par branche** — l'agent lecture n'a que l'outil SQL *read-only*
   (il ne peut pas écrire), l'agent écriture n'a que les outils API (il ne peut pas faire de
   SQL arbitraire) ;
3. **écritures via l'API HTTP** (allocation atomique) ; **lectures via un rôle read-only** ;
4. **chiffres calculés par la base**, mis en forme par l'agent.
