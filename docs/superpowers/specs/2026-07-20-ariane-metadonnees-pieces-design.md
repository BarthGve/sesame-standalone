# Ariane — métadonnées déterministes des pièces (nom de fichier + XML LRPGN)

Date : 2026-07-20
Statut : design validé, non implémenté. Phase 2 bloquée par une dépendance externe (§10).
Prérequis : `docs/superpowers/specs/2026-07-19-ariane-design.md`, `docs/iaka-ariane-workflow.md`
Voisin : `docs/superpowers/specs/2026-07-20-analyse-xml-lrpgn-design.md` (page `/analyse`,
autre équipe)

## 1. Problème

Le pipeline map-reduce d'Ariane demande au LLM de produire des champs qui sont, en
réalité, déjà connus de façon déterministe : type d'acte, date, rédacteur, identité et
rôle des personnes, cote. Deux conséquences mesurées en production sur une procédure de
13 pièces :

- **Fiabilité.** Ces champs sont devinés à partir du texte. Rien ne garantit qu'ils
  correspondent à l'état civil réel ni au rôle procédural exact.
- **Échelle.** L'extraction a produit **79 mentions de personnes pour 13 pièces**. Le
  REDUCE doit les démêler par ressemblance de chaînes ; l'agrégat atteint 29 000
  caractères, la sortie dépasse par intermittence le plafond de tokens, `extractJson`
  échoue et le job se termine en `ARIANE_INVALIDE`. Le phénomène est aléatoire : deux
  exécutions sur la même entrée donnent des résultats différents. À 50 pièces il devient
  systématique.

Or les pièces issues de LRPGN portent leurs métadonnées deux fois :

- **Nom de fichier normalisé** — `20250221_1445_PVAudition_VIC_BIDULE_MARC.pdf`
- **XML embarqué dans le PDF** — un `data.xml` dans un flux `/Type/EmbeddedFile` compressé
  deflate. Schéma `1.50.xsd`, racine `Procedure` : `Entete`, `Redaction_Proces_Verbal`,
  `Personnes_Physiques/Personne`, `Faits/Fait/Natinf`, `Enqueteurs`, `Objets`.

Ni l'un ni l'autre n'est garanti : il faut servir les deux cas, avec et sans.

## 2. Objectifs

1. **Fiabilité** — aucun champ vérifiable ne provient plus du LLM lorsqu'une source
   déterministe existe.
2. **Échelle** — la coréférence des personnes passe du LLM au code, ce qui réduit l'entrée
   et la sortie du REDUCE et supprime la cause des troncatures.

### Non-objectifs

- Exploiter `Objets`, `Moyens_Transport`, `Signalement`, NATINF, coordonnées GPS pour de
  nouvelles vues. Chantier distinct, postérieur.
- Se passer du LLM sur les pièces dotées d'un XML. Le XML porte l'état civil, pas le récit
  des faits ; supprimer l'extraction ferait perdre `faits` et la matière de la synthèse.
- Parser le gabarit du PDF (en-tête, table d'identité, pied NATINF). Écarté : le gabarit
  varie selon les unités, les versions de LRPGN et les pièces scannées, et un parser
  d'en-tête qui se trompe en silence sur une procédure judiciaire est pire que pas de
  parser.
- Écrire un parser XML côté BFF. `DOMParser` n'existe pas sous Node et ajouter une
  dépendance XML est exclu (contrainte du plan `/analyse`). Le parsing reste au navigateur.

## 3. Architecture

### 3.1 Répartition

| Où | Quoi | Statut |
|---|---|---|
| Front | `extraireXmlPdf(file)` — sort le `data.xml` du PDF | **livré** (`b0fc469`) |
| Front | `parseLrpgn(xml) → ContexteProcedure` | **à livrer par l'équipe `/analyse`** (§10) |
| Front | Conversion `ContexteProcedure` → `meta` Ariane, envoi au BFF | à écrire |
| BFF | `server/pieceMeta.mjs` — grammaire du nom de fichier, clé d'identité, fusion | à écrire |

`server/pieceMeta.mjs` est pur : aucun réseau, aucun disque, aucune horloge. Il ne parse
pas de XML — il reçoit des métadonnées déjà structurées.

### 3.2 Ordre d'autorité

**XML > nom de fichier > LLM.** Jamais l'inverse. Une valeur produite par le LLM ne
remplace jamais une valeur déterministe ; le LLM ne peut qu'ajouter ce qu'aucune source
structurée ne fournit.

### 3.3 Double usage des métadonnées

1. **En entrée du MAP** — transmises dans le champ `prompt` du multipart pour que le LLM
   cesse de produire ces champs et se concentre sur `faits` et `relations_lues`. Gain
   fiabilité ; la sortie rétrécit. Repli sur 422 : voir §5.
2. **En code, après le MAP** — chaque mention de personne reçoit une clé d'identité ; la
   fusion se fait par appariement exact avant `buildAggregate`. Gain échelle : le REDUCE
   reçoit des parties déjà constituées au lieu de mentions à démêler.

**Le second usage ne dépend ni du premier, ni du XML.** C'est ce qui permet le découpage
en phases du §9.

## 4. Flux de données

### 4.1 Contrat d'entrée

Le XML étant embarqué dans le PDF, il n'y a **pas** de second fichier à déposer ni à
apparier. Le front extrait, parse, et transmet le résultat :

```jsonc
{ "files": [{ "base64": "…", "mime": "application/pdf",
              "filename": "20250221_1445_PVAudition_VIC_BIDULE_MARC.pdf",
              "meta": {                          // optionnel — absent si pas de XML exploitable
                "personnes": [{ "nom": "BIDULE", "prenom": "Marc",
                                "naissanceDate": "21/02/1985", "naissanceLieu": "LORIGNE",
                                "implication": "VICTIME" }],
                "procedure": { "numero": "00059", "annee": "2025",
                               "unite": "COB LE-LION-D-ANGERS",
                               "dateActe": "vendredi 21 février 2025" },
                "enqueteurs": [{ "nom": "Adjudant Julie MALLIETTE",
                                 "qualite": "Officier de Police Judiciaire" }]
              },
              "xmlBrut": "<Procedure …>…</Procedure>"   // optionnel — pour le prompt MAP
            }] }
```

`meta` sert la fusion en code ; `xmlBrut` sert le prompt du MAP. Les deux sont optionnels
et indépendants.

### 4.2 Grammaire du nom de fichier

```
YYYYMMDD _ HHMM _ <TypePiece> _ <ROLE> _ <NOM> _ <PRENOM> .pdf
20250221 _ 1445 _ PVAudition  _ VIC    _ BIDULE _ MARC
```

Regex stricte, sans tolérance : correspondance exacte, ou `null`. Les noms libres
(`01_Synthese`, `Audition Elisabeth LE SUEUR`) retombent sur le chemin LLM actuel.

Un code `TypePiece` ou `ROLE` inconnu donne `autre` **et** un avertissement nommant le
code. Aucune valeur n'est devinée : le vocabulaire réel se découvre à l'usage.

### 4.3 Clé d'identité

La clé est **à deux étages**, jamais à deux formats. Un format qui varierait selon la
source empêcherait de fusionner une personne vue en D3 avec XML et en D9 sans XML.

```
noyau         →  NOM | PRENOM                        (toujours calculé, normalisé)
discriminants →  naissanceDate, naissanceLieu        (présents seulement avec XML)
```

Les discriminants viennent de `ContexteProcedure`, qui porte déjà `naissanceDate` et
`naissanceLieu`. Aucun code INSEE n'est nécessaire, donc aucune extension du type produit
par l'équipe `/analyse`.

**Règle de fusion** : deux mentions désignent la même personne si leurs **noyaux sont
égaux** ET que l'une des conditions suivantes tient :

- l'une des deux au moins ne porte pas de discriminants ;
- les deux en portent, et ils concordent.

Deux mentions dont les noyaux concordent mais dont les discriminants **divergent** sont
deux personnes distinctes — deux homonymes correctement séparés.

| D3 | D9 | Résultat |
|---|---|---|
| XML | XML | Homonymes distingués par date et lieu de naissance. |
| XML | nom seul | Fusion sur le noyau. Les discriminants de D3 sont conservés sur la partie. |
| nom seul | nom seul | Fusion sur le noyau ; homonymes exacts confondus. |

Normalisation du noyau : casse repliée, accents retirés, espaces multiples réduits.

**Le rôle n'entre ni dans le noyau ni dans les discriminants**, sous peine de scinder la
personne qui change de statut au fil de la procédure — précisément ce que §4.4 préserve.

Conséquence assumée sur la dernière ligne : deux homonymes exacts, sans XML ni l'un ni
l'autre, fusionnent à tort. Cas rare, détectable, et la parade — fournir un PDF LRPGN avec
son XML — est disponible.

### 4.4 Rôles multiples

Une personne peut porter des rôles différents selon les pièces (témoin en D3, mis en cause
en D9). C'est une réalité procédurale, pas une erreur. Le contrat §4.4 gagne un champ,
sans en perdre :

```jsonc
{
  "id": "p1", "nom": "Marc BIDULE",
  "role": "mis_en_cause",                       // principal — couleur, groupement, tri
  "roles": [                                    // historique complet, nouveau, optionnel
    { "role": "victime", "cote": "D3" },
    { "role": "mis_en_cause", "cote": "D9" }
  ],
  "aliases": [], "qualite": "", "premiere_cote": "D3"
}
```

`role` = le plus engageant de `roles`, dans l'ordre
`mis_en_cause > victime > requis > temoin > magistrat > enqueteur > autre`.

Justification : `graph.ts:43` colore les nœuds du réseau par `p.role` et `graph.ts:38`
groupe les parties par rôle ; une liste seule casserait les deux. `roles` est additif et
optionnel — `validateContract`, `PartiesView` et `Reseau` continuent de fonctionner
inchangés, et affichent l'historique en complément.

## 5. Gestion d'erreur

Principe : sur un dossier judiciaire, **une dégradation ne doit jamais être silencieuse,
et ne doit jamais faire échouer l'ensemble.**

| Situation | Comportement |
|---|---|
| Nom non conforme | `meta = null`, chemin LLM actuel. Pas d'avertissement — cas normal. |
| PDF sans XML embarqué | Repli sur le nom de fichier. Pas d'avertissement — cas normal. |
| XML présent mais illisible ou non conforme | Repli sur le nom de fichier, avertissement avec la cote. |
| Code `TypePiece` / `ROLE` inconnu | `autre` + avertissement nommant le code. |
| XML et nom de fichier divergents | XML gagne, avertissement listant les champs. Une contradiction signale souvent un fichier mal nommé, donc potentiellement mal attribué. |
| 422 sur l'envoi du prompt au MAP | Rejoué sans métadonnées en entrée ; la fusion en code s'applique quand même. Même motif que `runSynthese` (plan `/analyse`, Task 7). |

Ces avertissements réutilisent le canal ouvert le 2026-07-20 pour les pièces écartées : le
job porte déjà `pieces_ignorees[]`, on ajoute `avertissements[]`, affichés par le même
bandeau. Un seul endroit dans l'UI pour « ce dossier n'est pas ce qu'il paraît ».

## 6. Tests

`pieceMeta.mjs` étant pur, tout le raisonnement délicat se teste en table, sans mock.

| Niveau | Outil | Couverture |
|---|---|---|
| `pieceMeta.mjs` | `node --test` | Nom conforme → champs exacts. Nom libre → `null`. Codes inconnus → `autre` + avertissement. Accents et casse dans le noyau. |
| Fusion | `node --test` | Deux pièces, même personne → une partie. Discriminants divergents → deux parties. Rôles divergents → `roles[]` complet, `role` principal correct. Mentions sans clé laissées au REDUCE. |
| `ariane.mjs` | `node --test`, deps injectées | Pièce avec / sans méta. Contradiction XML vs nom. 422 → repli, pipeline nu. |
| Front | Vitest | Conversion `ContexteProcedure` → `meta`. PDF sans XML → pas de `meta`. Bandeau d'avertissements. |

Aucun test ne tape IAka. Aucun test ne duplique la fixture XML de l'équipe `/analyse`.

## 7. Journalisation

Les pièces d'une procédure sont à diffusion restreinte. Les logs ne portent que des
métadonnées — jamais de nom de personne, de nom de fichier, ni de contenu de pièce. Le nom
de fichier est lui-même sensible ici, puisqu'il contient l'état civil. Même règle que
`proxy.mjs` pour les FRS ; contenu réservé à `ARIANE_DEBUG=1`.

## 8. Inconnues à lever

### 8.1 IAka accepte-t-il fichier + prompt dans le même multipart ?

Le MAP est en `require_prompt=false` et aucun workflow du dépôt n'envoie les deux
ensemble. Le plan `/analyse` (Task 7) adopte le motif « prompt dans le multipart, rejeu
sans prompt sur 422 » pour `runSynthese`, mais il n'est pas encore confronté au vrai IAka.
À vérifier avant la phase 2 ; sans conséquence sur la phase 1.

### 8.2 Vocabulaire de `TypePiece`

Un seul échantillon : `PVAudition`. La table `TypePiece` → énum acte est à compléter. Le
mécanisme « inconnu → `autre` + avertissement » permet de démarrer sans la connaître.

Le vocabulaire de `ROLE` dans le nom de fichier (`VIC`) reste également à confirmer, mais
`Personne_Implication` du XML (`VICTIME`) fournit déjà la voie fiable.

### 8.3 Découpage des noms composés

La grammaire §4.2 suppose `NOM` et `PRENOM` en un seul segment, déduit d'un unique exemple
(`BIDULE_MARC`). Les noms réels ne s'y plient pas toujours : `LE SUEUR`, `DE LA CROIX`, un
prénom composé. Deux issues, d'inégale gravité :

- le nom ne correspond pas à la regex → `null` → chemin LLM. Sans danger.
- le nom correspond mais se découpe mal → noyau erroné → **fusion erronée**. Grave, et
  silencieux.

Le second cas conditionne la fiabilité de tout le §4.3. À trancher sur un échantillon réel
de noms de fichiers avant la phase 1 ; en attendant, la regex reste stricte et préfère
`null` au doute.

## 9. Phases

**Phase 1 — serveur seul, aucune dépendance externe.** Grammaire du nom de fichier, clé
d'identité, fusion en code, `roles[]`, avertissements. Livre l'essentiel des deux
objectifs et ne dépend ni du XML, ni de l'équipe `/analyse`, ni d'IAka. Implémentable
immédiatement.

**Phase 2 — branchement du XML.** Conversion `ContexteProcedure` → `meta`, envoi au BFF,
discriminants actifs. Bloquée par §10.

**Phase 3 — métadonnées en entrée du MAP.** Modification du prompt et du schéma de l'app
`ariane-extraction` côté IAka. Bloquée par §8.1.

## 10. Dépendance externe

`parseLrpgn` est produit par l'équipe qui travaille sur `/analyse`
(`docs/superpowers/plans/2026-07-20-analyse-xml-lrpgn.md`, Task 2). Ariane le consomme
sans le modifier.

Deux points de coordination, à traiter **avant** que cette équipe termine, faute de quoi
ils deviennent un refactor à deux équipes :

1. **Emplacement.** `pdfXml.ts` et `lrpgn.ts` sont sous `src/features/synthese/`. Deux
   features les consommant désormais, ils ont leur place dans un module partagé
   (`src/lib/lrpgn/`). Ariane n'a pas à importer depuis `features/synthese/`.
2. **Stabilité de `ContexteProcedure`.** Ariane s'appuie sur `nom`, `prenom`,
   `naissanceDate`, `naissanceLieu`, `implication`. Aucun ajout demandé ; simplement, ces
   cinq champs ne doivent pas disparaître.

Aucune modification de leur code n'est nécessaire au-delà du déplacement.

## 11. Ce que ce design ne corrige pas

Les défauts de robustesse constatés le 2026-07-20 restent entiers et relèvent de chantiers
distincts :

- IAka renvoie par intermittence 502 et 504 sous concurrence 4 ; aucun retry.
- Le budget de polling du front est un compteur fixe (`maxPolls 400 × 1500 ms` ≈ 10 min),
  non proportionné au nombre de pièces.
- L'upload envoie tous les PDF encodés en base64 dans un unique POST JSON — mur mémoire
  bien avant 50 pièces.

Ce design réduit fortement la pression sur le REDUCE, ce qui atténue le troisième mode de
défaillance, mais ne traite ni les deux premiers ni le mur d'upload.
