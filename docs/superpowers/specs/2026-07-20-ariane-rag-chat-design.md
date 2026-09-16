# Ariane — RAG documentaire et chat sur la procédure

Spec de conception. Ajoute au cas d'usage Ariane (cf.
`docs/superpowers/specs/2026-07-19-ariane-design.md`) une ingestion des pièces dans un
corpus RAG IAka, en parallèle du MAP, et un onglet de questions-réponses sur la
procédure.

> **AVERTISSEMENT — opération destructive.** La purge décrite ici supprime **tous** les
> documents du corpus visé par `IAKA_RAG_CORPUS_ID`, sans distinction d'origine, et de
> façon irréversible côté IAka. Ce corpus doit être **dédié à la démo Ariane**. Ne jamais
> pointer `IAKA_RAG_CORPUS_ID` sur un corpus partagé avec un autre usage.

## 1. Objectif

Le pipeline map-reduce produit une vue macro (parties, actes, événements, réseau,
synthèse). Il perd par construction le détail du texte des pièces. Le chat RAG répond sur
le texte intégral et **démontre une seconde capacité de la plateforme IAka** : le RAG
documentaire, à côté de l'agentique.

C'est un **argument de démonstration**, pas un outil d'enquête. Le périmètre est calibré
en conséquence : le minimum crédible, rien de plus.

## 2. Principe directeur

**Le RAG ne peut jamais casser l'analyse.** Le map-reduce est le cœur de la démo, le chat
est un bonus. Toute défaillance RAG dégrade l'onglet Questions et laisse le dossier
intact.

Corollaire : les erreurs RAG ne remontent jamais dans le champ `error` du job, seulement
dans son champ `rag`.

## 3. API IAka utilisée

Deux surfaces distinctes.

**REST RAG** (mêmes en-têtes `Authorization: Bearer` que les workflows) :

| Appel | Usage |
|---|---|
| `GET /rag/documents?corpus_id=…` | lister avant purge |
| `DELETE /rag/document?corpus_id=…&file_hash=…` | purger, un appel par document |
| `POST /rag/ingest` | multipart : `file`, `corpus_id`, `url_source`, `metadata` (JSON) |
| `POST /rag/retriever` | **non utilisé** — voir §4 |

**Endpoint OpenAI-compatible**, pour le chat :
`{IAKA_RAG_BASE_URL}/corpus/{IAKA_RAG_CORPUS_ID}/iak/{IAKA_RAG_IAK_ID}/v1/chat/completions`,
avec `stream: true`. IAka fait la recherche, le prompt système et la génération ; le BFF
ne gère que l'historique et le relais du flux.

Variables d'environnement à ajouter au `.env` du proxy :

```
IAKA_RAG_BASE_URL=<base de l'API OpenAI-compatible>
IAKA_RAG_CORPUS_ID=<corpus DEDIE a la demo Ariane>
IAKA_RAG_IAK_ID=<IAK oriente procedure judiciaire>
```

`IAKA_RAG_BASE_URL` est distincte de `IAKA_BASE_URL` : l'endpoint OpenAI-compatible est
exposé sur un autre hôte (`iaka-api.apps.ocp4…`). À confirmer au câblage.

## 4. Décisions de conception

**Corpus unique, purgé avant chaque analyse.** Ni `/rag/retriever` ni l'endpoint OpenAI
n'exposent de filtre par métadonnées. Sans purge, le chat répondrait en mélangeant toutes
les procédures ingérées depuis le début — inacceptable en démonstration. Le corpus ne
contient donc, à tout instant, que la procédure affichée à l'écran.

**Endpoint OpenAI plutôt que `/rag/retriever`.** Le retriever imposerait de construire
nous-mêmes le prompt et d'appeler un modèle : plus de code, plus de tests, pour un gain de
contrôle dont la démo n'a pas besoin.

**Le contrat Ariane n'est pas injecté dans le prompt du chat.** Le RAG répond sur le texte
des pièces, le graphe répond sur les entités extraites : deux surfaces, deux
démonstrations. Les mélanger brouillerait l'argument « voilà ce que le RAG apporte en
plus ».

**Streaming SSE.** Une réponse complète ferait attendre l'utilisateur devant un indicateur
de chargement. Le relais coûte une trentaine de lignes dans le BFF natif, sans dépendance.

## 5. Architecture

Module isolé `server/ariane-rag.mjs`, trois fonctions publiques, aucune dépendance à
`ariane.mjs` :

```
purgeCorpus(cfg, fetchImpl)          → liste puis supprime chaque file_hash
ingestPiece(file, cote, cfg, fetch)  → POST /rag/ingest, metadata { cote }
chatStream(messages, res, cfg, fetch)→ relais SSE du flux OpenAI vers le front
```

`ariane.mjs` porte déjà le map-reduce sur ~250 lignes ; le RAG est un second sujet et
reste dehors. Le seul point de couture est dans `startJob` :

```
purgeCorpus()                      ← sequentiel, doit finir avant toute ingestion
  ▼
fan-out par piece (concurrence bornee existante) :
   runExtraction(piece)   ∥   ingestPiece(piece)
  ▼
buildAggregate → runConsolidation → assembleContract
```

L'ingestion réutilise le buffer PDF déjà en mémoire pour le MAP : coût quasi nul. Elle se
termine largement avant le REDUCE (~170 s mesurées sur 3 pièces), donc le chat est
utilisable dès que le dossier s'affiche.

Routes BFF nouvelles, dans `server/proxy.mjs` :

| Route | Rôle |
|---|---|
| `POST /api/ariane/chat` | body `{ messages }`, réponse SSE |
| `POST /api/ariane/corpus/purge` | appelée par le bouton Vider |

Le statut de job expose un champ supplémentaire :

```jsonc
{ "status": "done", "progress": { "done": 3, "total": 3 },
  "rag": { "indexees": 3, "total": 3, "erreur": null } }
```

## 6. Front

Sixième onglet dans `TABS` (`src/features/ariane/ArianeApp.tsx:11`) :
`{ key: "questions", label: "Questions", icon: "forum" }`. Icône Material, pas d'emoji
(cf. CLAUDE.md).

Fichiers nouveaux :

- `ChatView.tsx` — liste de messages, champ de saisie, bouton d'envoi. Mince.
- `arianeChatApi.ts` — ouvre le POST SSE, émet chaque delta vers le store. Séparé de
  `arianeApi.ts` : l'API du dossier et celle du chat ne se mélangent pas, comme côté
  serveur.

État ajouté à `arianeStore.ts` : `messages`, `streaming`, `rag`.

Règles d'affichage :

1. Onglet grisé tant que `rag.indexees === 0`. Actif dès `indexees > 0`, avec le ratio
   affiché s'il est incomplet (« 2/3 pièces indexées »).
2. **Vider** appelle `POST /api/ariane/corpus/purge` **avant** `reset()`, et vide
   l'historique de conversation. Si la purge échoue, on prévient l'utilisateur au lieu de
   nettoyer l'écran en laissant les PDF côté IAka — sinon la démo suivante répondrait sur
   l'affaire précédente.
3. Historique envoyé tel quel au format `messages` OpenAI. Pas de troncature en phase 1 :
   procédure modeste, quelques échanges. Si le contexte déborde, c'est `max_tokens` à
   ajuster.

## 7. Gestion d'erreur

| Situation | Comportement |
|---|---|
| Purge échoue | **Aucune ingestion** (risque de mélange avec la procédure précédente). Le map-reduce continue. Onglet grisé, raison affichée. |
| Ingestion d'une pièce échoue | Best-effort, comme le MAP. Pièce comptée manquante, chat opérationnel sur les autres, ratio affiché. |
| Toutes les ingestions échouent | Onglet grisé, dossier affiché normalement. |
| Flux SSE coupé en cours | Le front conserve le texte déjà reçu et affiche l'erreur dessous, sans tout jeter. |
| `IAKA_RAG_CORPUS_ID` absent | RAG entièrement désactivé (`rag.total` reste à 0), purge impossible — c'est le garde-fou contre une purge sur un corpus non voulu. Onglet grisé, comme dans les autres cas : un seul comportement d'onglet à implémenter et à tester, au lieu d'un masquage particulier. |

Codes d'erreur, dans la continuité de l'existant : `ARIANE_RAG_PURGE`,
`ARIANE_RAG_INDISPONIBLE`. Ils alimentent `rag.erreur`, jamais `job.error`.

## 8. Tests

`server/ariane-rag.test.mjs`, `node --test`, `fetchImpl` bouchonné, dans le style de
`server/ariane.test.mjs` :

- `purgeCorpus` liste puis supprime chaque `file_hash` ; corpus vide → aucun DELETE
- `purgeCorpus` sans `corpus_id` configuré → lève, **aucun appel réseau** (le garde-fou
  est testé, pas seulement écrit)
- `ingestPiece` envoie `file` + `corpus_id` + `metadata` en multipart
- purge en échec → `ingestPiece` jamais appelée
- une ingestion en échec sur trois → `rag: { indexees: 2, total: 3 }`
- `chatStream` relaie les deltas et ferme proprement ; coupure amont → événement d'erreur
  SSE

Front, Vitest :

- le store accumule les deltas dans le dernier message
- l'onglet est grisé si `rag.indexees === 0`
- Vider appelle la purge avant `reset()`

## 8bis. Métadonnées d'ingestion depuis l'XML embarqué

Les pièces au format procédure pénale numérique sont des **PDF/A-3** portant une pièce
jointe `data.xml` conforme au schéma LRPGN 1.50. Quand elle est présente, elle qualifie la
pièce bien mieux que son nom de fichier, et alimente le champ `metadata` de
`/rag/ingest` :

| Champ metadata | Source |
|---|---|
| `type_piece` | libellé lisible du type d'acte, via `formatCote` (nom de fichier) |
| `date_acte` | `Acte_Enquete_Date` (texte, déjà lisible : « vendredi 21 février 2025 ») |
| `redacteur` | `Enqueteur_Nom` |
| `unite` | `Unite_L4` |
| `procedure` | `Procedure_Numero` + `Procedure_Annee` |
| `nature_fait` | `Libelle_Fait` |
| `natinf` | `Natinf` |
| `personne_concernee` | `Personne_Prenom` + `Personne_Nom`, dans l'ordre du XML |

Tous ces champs sont facultatifs. Une source vide donne un champ **absent**, jamais un
champ vide : une chaîne vide se retrouverait telle quelle dans la réponse du modèle. La
`cote` reste jointe en toutes circonstances et prévaut : c'est elle qui relie la réponse
du chat à la pièce du dossier, aucun champ venant du client ne peut l'écraser.

Trois décisions :

**L'état civil est assumé en métadonnée** *(révisé le 2026-07-21 — remplace la règle
initiale « pas d'état civil en métadonnée »)*. La version initiale de cette spec excluait
l'identité des personnes. Cette règle est abandonnée, pour une raison factuelle : la
`cote` envoyée est le nom de fichier LRPGN, qui contient déjà le nom et le rôle de la
personne (`20260210_1105_PVAudition_TEM_DUVAL_PATRICK`). Le principe était donc déjà
contourné en pratique, sans être assumé nulle part — et une règle écrite que le code
contredit finit par tromper le lecteur.

Le choix retenu est d'assumer : `personne_concernee` est ajoutée explicitement. Trois
raisons. Le corpus est **dédié à la démonstration et purgé à chaque analyse** (§8). Le
texte intégral du PDF est déjà indexé et **contient de toute façon cette identité** : la
métadonnée ne révèle rien de neuf. Et c'est elle qui rend une réponse utilisable —
« l'audition de Patrick DUVAL » est plus parlant que « le PV du 10 février à 11 h 05 »
quand deux témoins sont entendus le même jour.

Contrepartie explicite : ces métadonnées portant de l'état civil, **elles ne sont jamais
journalisées**, ni côté front ni côté serveur.

**Extraction réutilisée, pas réécrite** *(révisé le 2026-07-21)*. La version initiale de
cette spec prévoyait de balayer les flux du PDF côté serveur et de les décompresser avec
`zlib.inflateSync`. Ce n'est plus le bon choix : `extraireXmlPdf` et `parseLrpgn` existent
désormais dans `src/lib/lrpgn/`, testés et partagés entre la page Analyse et Ariane, et le
front transmet déjà le XML parsé au BFF dans le champ `meta` de chaque pièce (voir
`docs/superpowers/plans/2026-07-21-ariane-metadonnees-phase2.md`).

Écrire un second extracteur côté serveur donnerait **deux implémentations du même parsing**
sur un chemin sensible, qui divergeraient tôt ou tard. Les métadonnées d'ingestion sont
donc dérivées de ce que le front envoie déjà. Sept des huit champs du tableau sortent tels
quels de `ContexteProcedure` ; le huitième, `type_piece`, vient de `formatCote`, qui
traduit déjà le nom de fichier en libellé lisible pour l'affichage des cotes. Aucun ajout
à `parseLrpgn` n'a été nécessaire.

La construction (`contexteVersMetaDocument`, `src/features/ariane/metaXml.ts`) est **pure** :
le parsing XML a déjà eu lieu, il n'y a ni DOM ni réseau. Les métadonnées voyagent dans
`file.meta.document` jusqu'au BFF, où `ingestPiece` les joint au champ `metadata` de
`/rag/ingest`.

**Pas de conversion de fuseau : on prend le texte, pas l'attribut.** `Acte_Enquete_Date`
porte `utc="2025-02-20T23:00Z[UTC]"` pour un acte du **21 février** — tronquer cette chaîne
décalerait d'un jour toutes les pièces rédigées en soirée. L'élément porte en revanche,
dans son contenu textuel, la date déjà écrite en heure locale et en toutes lettres
(« vendredi 21 février 2025 »). C'est elle qui est reprise : elle évite la conversion,
et c'est aussi la forme la plus directement citable dans une réponse du chat.

Le PDF sans XML (cas courant hors procédure numérique) retombe sur la seule `cote` : le
comportement décrit au reste de la spec est inchangé. Cette règle prime sur le tableau —
`type_piece` se déduirait du seul nom de fichier, mais n'est **pas** émis en l'absence
d'XML.

## 9. Hors périmètre

- Filtrage par métadonnées et corpus multiples — dépend de capacités API non vérifiées.
- Injection du contrat Ariane dans le prompt du chat (cf. §4).
- Troncature ou résumé d'historique long.
- Citation cliquable renvoyant à la cote dans les autres onglets — dépend du format des
  sources renvoyées par l'endpoint OpenAI, à observer au câblage.
- **Chemin hybride XML du MAP (spec Ariane §8.1).** Le parseur de §8bis lit assez de
  structuré (personnes avec état civil et `Personne_Implication`, faits datés, rédacteur,
  entête d'affaire) pour remplacer l'extraction LLM quand l'XML est présent — sans coût
  LLM ni hallucination possible. L'échantillon qui bloquait ce chantier existe désormais.
  C'est un projet distinct, avec sa propre spec : il touche le contrat final, pas
  l'ingestion RAG.
- Cotes et entête d'affaire alimentées par l'XML (`Titre_Piece` au lieu du nom de
  fichier, `affaire.reference`/`service`/`nature` depuis l'`Entete`) — corrigerait trois
  défauts constatés en recette, mais modifie le contrat : relève du même projet distinct.
