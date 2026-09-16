# Rédaction d'une FRS avec contrôle *a priori* — design

*Cas d'usage IAka : rédiger une FRS dans l'application, la soumettre à la même grille GIPASP que
l'audit avant de l'enregistrer, et laisser le rédacteur trancher — corriger, ou passer outre.*

Statut : design validé (brainstorming). Étape suivante : plan d'implémentation.
Date : 2026-08-07.

---

## 1. Objectif et périmètre

### But

L'audit existant est *a posteriori* : il constate la nuit ce qui a été écrit le jour, et rend au
contrôleur une liste de fiches à corriger. Cette feature prend le problème par l'autre bout —
elle met la même grille sous les yeux du **rédacteur**, au moment où il écrit, avant que la fiche
n'existe.

Le geste à montrer tient en trois temps : **écrire → voir ce qui cloche → décider**. Décider veut
dire les deux branches, sans préférence de l'outil : corriger le texte et réanalyser, ou
enregistrer malgré les remarques. Le contrôle **conseille, il ne barre jamais la route**.

### Ce que la feature n'est pas

- **Pas une réécriture automatique.** Le diagnostic seul, comme l'audit. Une IA qui reformule une
  FRS à la place du militaire déplace la responsabilité de rédaction ; c'est précisément ce que le
  référent national reproche aux pratiques actuelles.
- **Pas un blocage.** Aucun verdict n'empêche l'enregistrement. Un outil qui refuse d'enregistrer
  se contourne — le rédacteur écrit ailleurs, et le contrôle ne voit plus rien.
- **Pas une seconde grille.** Mêmes neuf critères, même workflow, mêmes trois agents. Une aide à
  la rédaction qui dirait vert là où l'audit dit rouge reproduirait, dans l'outil, l'incohérence
  que le référent reproche aux contrôles humains.

### Décidé pendant le brainstorming

| Question | Réponse retenue |
|---|---|
| Grille du contrôle *a priori* | La même : 9 critères, 3 agents, workflow existant |
| Où vit le brouillon | Côté front ; une seule écriture en base, à l'enregistrement |
| Trace du passage outre | Aucune — la fiche entre en base comme les autres |
| Champs saisis | Formulaire complet, fidèle à une FRS |
| Disposition | Deux colonnes : saisie à gauche, verdict à droite |
| Cas conforme | Confirmation explicite quand même |
| Droits d'écriture | Rôle Postgres dédié + bornes de validation serveur |

**Conséquence du « aucune trace »** : le passage outre ne laisse rien de particulier en base. La
fiche enregistrée avec ses écarts sera reprise par l'audit nocturne et signalée comme n'importe
quelle autre. C'est cohérent — l'audit reste la seule mesure qui fait foi — mais la démonstration
ne peut pas montrer « untel a été averti et a maintenu ». Si ce geste devient souhaité, il
demandera une migration (colonnes ou table `frs_controle_redaction`), pas un correctif.

---

## 2. Parcours

L'écran vit dans `QualiteApp`, qui porte déjà trois vues par onglets (`fiches`, `unites`,
`analyse`). On ajoute un **quatrième onglet « Rédiger »** : même page, même feature, aucun routage
nouveau. Rédacteur et contrôleur regardent la même grille ; les séparer en deux écrans donnerait
deux produits, et c'est par là que les deux vérités reviennent.

```
┌─ Rédiger une FRS ────────────────────────────────────────────┐
│ Titre  [_______________]  Unité [COB Segré ▾]  GGD [49 ▾]    │
│ Commune[_______________]  Date  [2026-08-07]                 │
├──────────────────────────────┬───────────────────────────────┤
│ Texte                        │ Verdict — Non conforme        │
│ ┌──────────────────────────┐ │ ┌───────────────────────────┐ │
│ │Rassemblement constaté le │ │ │ B6  Donnée hors nomencl.  │ │
│ │3 août... M. Karim BENNANI│ │ │ R. 236-22  ·  majeur      │ │
│ │de confession musulmane...│ │ │ « de confession... »      │ │
│ │                          │ │ ├───────────────────────────┤ │
│ └──────────────────────────┘ │ │ B5  Donnée sensible       │ │
│                              │ │ R. 236-23  ·  bloquant    │ │
│ [Réanalyser] [Enregistrer]   │ └───────────────────────────┘ │
└──────────────────────────────┴───────────────────────────────┘
```

(État « verdict rendu ». Avant la première analyse, la colonne droite est vide et le seul bouton
est `Analyser`.)

Les deux colonnes s'empilent sous 900 px. Le texte reste **éditable pendant que le verdict est
affiché** : c'est tout l'intérêt de la disposition — corriger sans perdre les remarques de vue.
Modifier le texte ne fait pas disparaître le verdict, mais le marque **périmé** (« ce verdict
porte sur une version antérieure du texte »), sans quoi le rédacteur enregistrerait en croyant
avoir la bénédiction d'une analyse qui ne portait pas sur ce qu'il vient d'écrire.

Les états de l'écran :

1. **Saisie** — formulaire vide ou en cours. `Analyser` s'active dès que les champs obligatoires
   sont remplis ; **`Enregistrer` n'existe pas encore à cet état**. On n'enregistre pas une fiche
   qui n'a pas été soumise au contrôle — sauf si le contrôle lui-même a échoué (§6). Deux boutons
   indépendants dès la saisie rendraient l'analyse facultative, et le geste que la démonstration
   veut montrer disparaîtrait au premier clic pressé.
2. **Analyse en cours** — ~45 s. Attente annoncée avec sa durée attendue, pas un spinner muet.
3. **Verdict** — la colonne droite affiche le rapport. `Enregistrer` demande une confirmation
   explicite **même quand la fiche est conforme** : le rédacteur voit dans tous les cas ce qui a
   été contrôlé, y compris ce qui passe.
4. **Enregistrée** — numéro de fiche affiché, formulaire remis à zéro, lien vers la fiche.

### Le cas conforme

Choix retenu : confirmer quand même. La grille complète des neuf critères passe sous les yeux du
rédacteur, ce qui donne au « conforme » un contenu vérifiable au lieu d'une absence de nouvelle.
Coût assumé : un clic de plus sur chaque fiche propre.

---

## 3. Analyser un texte qui n'existe pas encore

### Le problème

L'analyse à la demande part d'identifiants : `POST /api/rens/audit/analyse` reçoit des `frs_ids`,
appelle `/audit/lot?frs_ids=…`, et charge les fiches en base. Ici, le texte n'a pas de ligne — et
ne doit pas en avoir tant que le rédacteur n'a pas tranché.

### Le montage

Nouvelle route BFF **`POST /api/rens/audit/analyse-texte`**, asynchrone comme sa voisine (`jobId`
+ polling `/api/job/status`) : 45 s ne tiennent pas derrière le proxy d'accès.

```
front ── POST /api/rens/audit/analyse-texte { titre, unite, code_ggd,
   │        departement, commune, texte }
   │
   └─ BFF : validation → composerFragment([fiche volante]) → workflow IAka
            (3 agents, app qualité) → parseSortieAgents → construireRapportAnalyse
   │
   └─ 202 { jobId } ; le front poll jusqu'au rapport
```

rens-api n'est pas sollicité : il n'y a rien à charger. Le workflow, `parse.mjs` et
`construireRapportAnalyse` sont utilisés **sans modification** — c'est ce qui garantit qu'aide à la
rédaction et audit disent la même chose.

### L'identifiant sentinelle

`parseSortieAgents(brut, idsAutorises)` rejette tout écart dont le `frs_id` n'est pas dans la liste
autorisée — c'est la frontière anti-hallucination. La fiche volante reçoit donc un identifiant
sentinelle, passé en `idsAutorises`. **À vérifier à l'implémentation** : que la valeur choisie ne
tombe dans aucun test de véracité (`if (!frs_id)`) le long du chemin. Si `0` en heurte un, prendre
une autre valeur plutôt que d'assouplir le test.

### C10 est sans objet, et l'écran doit le dire

`structurels` est vide : le seul contrôle SQL (C10, ancienneté au-delà de dix ans) n'est pas
évalué. `construireRapportAnalyse` affichera donc C10 en `ok`, ce qui est **exact** — une fiche du
jour n'a pas dix ans — mais « 9 contrôles passés » se lirait comme une garantie qui n'a pas été
rendue. L'écran marque C10 « sans objet à la rédaction ».

### Ce que le rédacteur voit du verdict

Réemploi direct : `FicheRapport` et `TexteAvecExtraits` (dans `AnalyseDemande.tsx` et `ui.tsx`)
rendent déjà un rapport de fiche avec surlignage des extraits. La colonne droite les réutilise. Si
`FicheRapport` doit être partagé, il est extrait dans son propre fichier — pas dupliqué.

---

## 4. L'écriture en base

### La doctrine du dépôt

`007_audit_grants.sql` l'écrit noir sur blanc : *« rens_api et rens_ro restent en LECTURE SEULE,
toute écriture passe par rens_seed, table par table. »* Les neuf routes de rens-api sont des `GET`.
On respecte cette règle plutôt que de la contourner pour économiser dix lignes de SQL.

### Migration `009_redaction.sql`

```sql
CREATE ROLE rens_redaction LOGIN;          -- mot de passe posé au déploiement, jamais commité
GRANT CONNECT ON DATABASE rens TO rens_redaction;
GRANT USAGE  ON SCHEMA public  TO rens_redaction;
GRANT INSERT ON frs, frs_mot_cle TO rens_redaction;
GRANT USAGE, SELECT ON SEQUENCE frs_id_seq, frs_mot_cle_id_seq TO rens_redaction;
```

Pas d'`UPDATE`, pas de `DELETE`, pas de `SELECT`. Ce rôle ne peut qu'ajouter — il ne peut ni
réécrire une fiche existante, ni en lire une. Un test de migration vérifie ces absences, comme
`007_audit_grants.test.mjs` vérifie les présences.

### Route `POST /frs` (rens-api)

rens-api ouvre un **second pool** (`PGUSER_REDACTION` / `PGPASSWORD_REDACTION`, `max: 2`), utilisé
par cette seule route. Le pool de lecture ne gagne aucun droit.

Validation, avant toute écriture — un refus est un `400` nommé, jamais un `500` :

| Champ | Règle |
|---|---|
| `titre` | obligatoire, 1–200 caractères |
| `texte` | obligatoire, 1–8000 caractères |
| `unite`, `code_ggd`, `departement`, `commune` | obligatoires, validés **contre les valeurs déjà présentes en base** |
| `date_redaction` | **imposée par le serveur** (`CURRENT_DATE`) ; la valeur du client est ignorée |
| `mots_cles` | 0 à 10, chacun ≤ 40 caractères |
| `mots_cles` commençant par `defaut:` | **rejeté** |

Deux de ces règles ne sont pas cosmétiques :

- **La date imposée.** Un client qui choisit sa date écrit dans le passé, donc dans une fenêtre
  d'audit déjà close ou dans un agrégat déjà calculé. Le serveur tranche.
- **Le marqueur `defaut:` rejeté.** C'est la vérité terrain : les fiches mutées la nuit le portent,
  et le taux de détection de l'audit se mesure dessus. Laissé libre, il permettrait de fabriquer
  des faux positifs et de fausser la seule mesure de qualité de l'outil.

Retour : `201 { data: { id } }`.

Le BFF proxifie via `POST /api/rens/frs`, comme il le fait déjà pour les lectures — le front ne
parle jamais à rens-api directement.

---

## 5. Simplification incidente — `porte_pii` sort du SQL

`filtrerEcarts` a besoin de `f.porte_pii` pour décider si une fiche sort du champ du décret. Ce
booléen est aujourd'hui calculé **en SQL**, dans `PORTE_PII_SQL` (`audit/rapport.js`), par les
deux requêtes de chargement. Un texte volant n'a pas de ligne : ni requête, ni booléen.

Trois issues, dont deux mauvaises :

1. Réimplémenter la détection en JS pour ce chemin → **deux définitions** de « porte une donnée
   personnelle ». C'est exactement la faute corrigée deux fois cette semaine (règles du décret
   contournées par le batch, verdicts DCP repliés dans un `Map`).
2. Interroger la base pour un texte qu'on ne veut justement pas y écrire → un aller-retour réseau
   pour évaluer une expression régulière.
3. **Porter la détection en JS et l'appeler depuis les trois chemins.** Les deux requêtes ramènent
   **déjà `f.texte`** : le calcul SQL est superflu. Une fonction `portePii(texte)` dans
   `regles.mjs`, appliquée après chargement pour le batch et l'analyse par identifiants, et
   directement sur le texte saisi pour la rédaction.

On retient la troisième. Le SQL rétrécit, la définition devient unique, et le texte volant passe
par la même porte que les fiches en base. Les cas de test existants
(`rapport.test.js`, détection PII) migrent tels quels et perdent leur traduction POSIX → JS, qui
n'était qu'un contournement du fait que la règle vivait en SQL.

---

## 6. Erreurs

| Situation | Comportement |
|---|---|
| `SORTIE_ILLISIBLE`, `IAKA_TIMEOUT`, `IAKA_UPSTREAM` | Message nommé ; **`Enregistrer` reste actif**. Un contrôle en panne ne bloque pas un rédacteur. |
| Validation refusée à l'enregistrement | `400` nommé, champ fautif désigné, **texte conservé à l'écran** |
| Écriture en échec (base, réseau) | Message d'échec, texte conservé, réessai possible. Rien n'est jamais perdu par l'écran. |
| Texte modifié après un verdict | Verdict marqué périmé, `Analyser` remis en avant |

Le fil directeur : **le texte saisi ne disparaît sous aucun scénario d'erreur.** Perdre une demi-heure
de rédaction est le seul défaut qu'un rédacteur ne pardonne pas à un outil.

---

## 7. Tests

**Serveur** (`node --test`) : validation de `POST /frs`, champ par champ ; rejet d'un mot-clé
`defaut:` ; date imposée malgré une date cliente ; composition du fragment volant (liste blanche
des champs respectée) ; `portePii` sur les cas aujourd'hui couverts en SQL, plus le texte volant ;
migration `009` — le rôle peut insérer, ne peut ni lire, ni modifier, ni supprimer.

**Front** (Vitest) : le cycle complet analyser → verdict → corriger → verdict périmé → réanalyser →
enregistrer ; l'enregistrement reste possible quand l'analyse est en erreur ; le texte survit à un
échec d'enregistrement.

---

## 8. Hors périmètre

- Trace du passage outre en base (voir §1 — demande une migration).
- Modification d'une fiche existante : la route n'a que l'`INSERT`, et c'est délibéré.
- Analyse au fil de la frappe (chaque analyse coûte 45 s et un appel workflow).
- Pièces jointes, photos, brouillons persistés entre deux sessions.
