# Contrôle qualité des FRS (GIPASP) — design

*Cas d'usage IAka : contrôler **systématiquement** la conformité au décret GIPASP de toutes les
fiches de renseignement simplifiées (FRS) produites chaque jour, et présenter au contrôleur la
liste des fiches à corriger, chaque signalement rendu avec son fondement juridique.*

Statut : design validé (brainstorming). Étape suivante : plan d'implémentation.
Date : 2026-08-05.

---

## 1. Objectif et périmètre

### But

Un groupement produit ~1 000 FRS par jour. Le contrôle réel se fait par sondage : le rapport du
référent national décrit une SSOR qui « réalise des audits […] soit aléatoirement par sondage, soit
en ciblant un thème particulier ». Personne ne relit tout.

L'objet du cas d'usage est de **supprimer le sondage** : contrôler les 1 000 fiches, toutes, chaque
nuit, sur les douze critères — et livrer au contrôleur, le matin, une liste de travail hiérarchisée.

### Persona

Le **contrôleur** : commandant de compagnie, officier adjoint renseignement, analyste de groupement.
Celui qui, dans le circuit réel, « exerce un contrôle a posteriori des FRS et peut en demander la
suppression aux analystes renseignement du groupement ».

### Nature du traitement

**Un batch de nuit, pas une requête interactive.** Le contrôle de 1 000 fiches ne se déclenche pas
depuis un écran en attendant devant. Il s'enchaîne derrière le cron d'alimentation existant
(`nightly.mjs`, 2 h UTC), et le contrôleur ouvre un rapport déjà calculé.

Conséquence : la latence cesse d'être une contrainte de conception, et le front devient un
**lecteur de rapport**, pas un déclencheur.

### Périmètre — itération 1

- **Batch nocturne** auditant la production de la veille, exhaustivement.
- **1 écran** : rapport d'un jour + liste des fiches à traiter.
- **Diagnostic seul.** Le workflow dit ce qui cloche, où, et sur quel fondement.
- **Read-only sur `frs`.** Aucune suppression ni modification de fiche depuis l'application.

### Hors périmètre

- **Réécriture / proposition de fiche corrigée.** Écartée volontairement : la réécriture d'une fiche
  de renseignement est précisément ce que le référent national critique chez les humains
  (« déperdition d'informations » conduisant à une appréciation différente du cas). Se rajoutera en
  branchant un agent de plus sur la jointure.
- **Aide à la rédaction** pour le gendarme de brigade (contrôle unitaire *a priori*).
- **Action sur la base** : suppression ou correction des fiches depuis l'écran.
- **Contrôle des FRE / FREC / FIE.** Seules les FRS sont en base.

---

## 2. Cadre juridique — ce qui fonde chaque critère

Le fichier **GIPASP** (« Gestion de l'information et prévention des atteintes à la sécurité
publique ») est régi par le décret n° 2020-1512 du 2 décembre 2020, codifié aux **articles
R. 236-21 à R. 236-30 du Code de la sécurité intérieure**.

| Article | Règle |
|---|---|
| R. 236-21 | Finalité : atteinte à la **sécurité publique ou à la sûreté de l'État**. Catégories de personnes limitativement énumérées. |
| R. 236-22 | Données enregistrables « dans la stricte mesure où elles sont nécessaires », en 8 rubriques, dont le **motif de l'enregistrement** (4°). Entourage limité aux **« relations directes et non fortuites »**. Mots de passe explicitement exclus. |
| R. 236-23 | Données sensibles **interdites**, sauf trois dérogations : signes physiques de signalement ; activités politiques, philosophiques, religieuses ou syndicales ; données de santé **révélant une dangerosité particulière**. Interdiction de sélectionner une catégorie de personnes sur ce seul fondement. |
| R. 236-24 / 25 | Conservation : 10 ans après le **dernier événement** (et non la date de rédaction). Mineurs : **âge ≥ 13 ans**, conservation 3 ans. |
| R. 236-27 | Journalisation de chaque opération, conservée 3 ans. |
| R. 236-30 | Le DGGN décrit chaque année « les procédures garantissant des données **exactes, pertinentes et non excessives** au regard des finalités ». |

**Spécifique aux FRS** (rapport du référent national) : conservées **un an**, visibles de
~84 000 agents, et surtout — « Ces fiches […] **ne peuvent contenir de données à caractère personnel
qu'en cas d'atteinte, potentielle ou avérée, à la sécurité publique.** »

### Défauts réellement constatés par le référent

Le rapport ne théorise pas : il cite des cas. Ils servent de trames de défaut et de cas de test.

- **Motif d'enregistrement non renseigné** — la CNIL s'en inquiétait dès sa délibération de 2010, les
  référents le confirment sur le terrain. Or le motif est *la* garantie centrale : il oblige le
  rédacteur à s'interroger sur la pertinence de la présence de la personne dans le fichier.
- **Motif fourre-tout** — « radicalisme » retenu pour un mineur portant un tatouage militant sans
  provocation ni violence ; pour un autre ayant troublé la tranquillité d'un camping une nuit d'été.
  Verdict : ce motif « ne lui permet pas de jouer le rôle de filtre attendu ».
- **Seuil d'atteinte non caractérisé** — faits de police du quotidien enregistrés comme atteinte à la
  sécurité publique.
- **Date d'événement absente** — délais calculés sur la date de création, « problématique notamment en
  termes de sécurité juridique ». Une fiche ne contenant que des éléments de suivi ne doit pas
  proroger le délai de conservation.
- **Absence d'élément nouveau** — suivi maintenu plus d'un an sans le moindre élément actualisé.

---

## 3. Grille de contrôle — 12 critères

Chaque critère porte un code stable, réutilisé de bout en bout (agent → jointure → base → front →
tests). **La lettre désigne la famille, le chiffre est l'index du critère dans la grille** — les
codes d'une même famille ne se suivent donc pas (`A1`, `A3`, `A4`), et c'est voulu : le chiffre
reste stable même si un critère change de famille.

### Famille A — Légalité de l'enregistrement · *jugement LLM*

| Code | Critère | Non conforme si |
|---|---|---|
| `A1` | Caractérisation de l'atteinte | La fiche porte des données personnelles sans que les faits établissent une atteinte, potentielle ou avérée, à la sécurité publique. |
| `A3` | Cohérence du motif | Le motif déclaré ne correspond pas aux faits narrés, ou le seuil d'atteinte n'est pas atteint. |
| `A4` | Qualité des personnes citées | Une personne est citée sans être la personne à risque, une relation directe et non fortuite, ou une victime. |

### Famille B — Données · *jugement LLM*

| Code | Critère | Non conforme si |
|---|---|---|
| `B5` | Données sensibles | Mention d'origine, de santé hors dangerosité particulière, ou de vie sexuelle. Religion et politique tolérées **rattachées à une activité**, jamais à la seule appartenance. |
| `B6` | Hors nomenclature | Donnée ne se rattachant à aucune des 8 rubriques de R. 236-22 (mot de passe, notamment). |
| `B7` | Non-excessivité | Détails sans lien avec le motif (situation familiale complète pour un fait mineur). |

### Famille C — Temporalité et conservation

| Code | Critère | Évaluation | Non conforme si |
|---|---|---|---|
| `C2` | Motif renseigné | SQL | `motif IS NULL` ou hors référentiel. |
| `C8` | Date d'événement | SQL | `date_evenement IS NULL`, ou postérieure à la date de rédaction. |
| `C9` | Minorité | **LLM** | La fiche vise un mineur sans que la minorité soit repérable, ou un mineur de moins de 13 ans. |
| `C10` | Péremption | SQL | `date_redaction` antérieure à un an. |

> `C9` est le seul critère de cette famille confié au LLM : l'âge n'est pas une colonne, il ne se lit
> que dans le texte. Le structurer à l'avance reviendrait à donner la réponse. Il est porté par le
> sous-agent RÉDACTION, déjà celui qui lit finement le texte.

### Famille D — Qualité de l'information (R. 236-30) · *jugement LLM*

| Code | Critère | Non conforme si |
|---|---|---|
| `D11` | Sourçage | L'origine de l'information n'est pas identifiable, ou repose sur une rumeur non étayée. |
| `D12` | Factualité | Jugement de valeur, qualificatif subjectif ou imputation non étayée en lieu et place de faits datés, situés, circonstanciés. |

### Gravité et suite attendue

Trois niveaux, calqués sur les suites réelles décrites par le référent. **La gravité détermine la
file de travail dans laquelle la fiche apparaît** (§7).

| Niveau | Suite attendue | Critères |
|---|---|---|
| **Bloquant** | Demande de suppression | `A1`, `B5`, `C9` (mineur < 13 ans) |
| **Majeur** | Correction exigée | `A3`, `A4`, `B6`, `C2`, `C8` |
| **Mineur** | Amélioration souhaitable | `B7`, `C10`, `D11`, `D12` |

---

## 4. Architecture

### Le principe

Trois séparations, chacune motivée :

1. **Le déterministe avant le LLM.** `C2`, `C8`, `C10` s'écrivent en `WHERE`. Les faire trancher par
   un modèle serait payer cher pour moins fiable. Ils sont évalués en SQL, sur 100 % du flux, à coût
   nul et sans batch.
2. **La boucle dans le BFF, pas dans le workflow.** IAka ne dispose pas de primitive d'itération,
   mais sait exécuter des agents en parallèle depuis une entrée. Le workflow reste donc **petit et
   fixe** — un fragment, trois agents, une jointure — et c'est un job Node qui l'appelle N fois. La
   complexité de volume vit là où elle se teste (`node --test`), pas dans le builder GUI où elle ne
   se teste pas.
3. **Le calcul de nuit, la lecture de jour.** Le front lit des résultats persistés. Aucun timeout,
   aucune attente, aucun job store.

### Le montage

```
CRON 3 h (après nightly.mjs)
   │
   ▼
job audit-nightly (Node)
   │  1. contrôle structurel SQL sur les ~1 000 fiches de la veille   → C2, C8, C10
   │  2. découpe en fragments de ~40 fiches
   │  3. déclenche ~25 exécutions du workflow, concurrence bornée à 6
   │  4. persiste les non-conformités
   │
   ▼  pour chaque fragment :
        [ WORKFLOW IAka « QUALITÉ » ]   entrée = 40 fiches (JSON)
             ├──► sous-agent LÉGALITÉ    corpus RAG : R.236-21/22 + référentiel des motifs  → A1, A3, A4
             ├──► sous-agent DONNÉES     corpus RAG : R.236-23 + avis CNIL                  → B5, B6, B7
             └──► sous-agent RÉDACTION   corpus RAG : rapport du référent national          → C9, D11, D12
                          ▼   (en parallèle depuis l'entrée)
                    [ NŒUD DE JOINTURE ]  fusionne les trois sorties
                          ▼
                    non-conformités du fragment (JSON)
   │
   ▼
   frs_audit_run · frs_audit_fragment · frs_audit
   │
   ▼
Front  src/features/qualite/  ──► GET /api/rens/audit/rapport?jour=… ──► rens-api (lecture directe)
```

### Pourquoi pas de superviseur

La carte composable a un agent superviseur parce qu'une **phrase libre** doit être interprétée et
planifiée. Ici l'entrée est un tableau de fiches produit par un job. Il n'y a rien à planifier. On
reprend l'éventail parallèle depuis l'entrée, capacité confirmée sur la plateforme.

### Pourquoi trois sous-agents et pas un

Trois expertises distinctes, **trois corpus distincts**. C'est ce qui fait la valeur du cas d'usage :
chaque agent est adossé à *son* texte de référence, donc il ne rend pas un avis de style (« cela
semble excessif ») mais un avis **sourcé** — « R. 236-23 : donnée de santé ne révélant pas de
dangerosité particulière ». Un verdict sourcé est opposable ; un verdict de style ne l'est pas.

**Arbitrage assumé** : chaque fiche est donc lue trois fois. Un agent unique portant les 12 critères
diviserait le coût par trois, au prix d'une consigne diluée sur un outil de conformité. Le coût est
chiffré ci-dessous ; si la facture devient le sujet, c'est le premier levier — mais on ne commence
pas par sacrifier la qualité du verdict.

### Volumétrie et coût

Régime réel de la base, vérifié dans `nightly.mjs` : **900 à 1 200 fiches par nuit**, rétention
glissante de **90 jours** — soit ~90 000 fiches en régime établi. Fiches de **687 caractères en
moyenne** (~180 tokens).

| Grandeur | Valeur |
|---|---|
| Fiches auditées par nuit | ~1 000 |
| Fragments (40 fiches) | ~25 |
| Exécutions de workflow | ~25, concurrence 6 |
| Appels d'agents | ~75 |
| Tokens d'entrée (fiches) | ~180 k × 3 familles ≈ **550 k** |
| Durée estimée du batch | ~4 min |

Chaque fiche n'est auditée **qu'une fois, à son arrivée**. On traite 1 000 fiches par nuit, jamais
les 90 000 du stock.

### La taille de fragment est un réglage mesuré

40 est un point de départ, pas une vérité. Le budget de tokens n'est pas la contrainte — c'est
l'**attention par fiche** : un agent à qui l'on tend une longue liste homogène ne note pas chaque
élément, il parcourt et rend une poignée de cas plausibles. Le rappel s'effondre bien avant le
contexte.

Les défauts plantés (§5) donnent un taux de détection **mesuré**. On fait varier le fragment de 20 à
60 et on retient la valeur où le taux décroche. `taille_fragment` est stockée sur chaque run, pour
que deux runs restent comparables.

---

## 5. Modèle de données

### Migration `006_audit.sql`

**Trois colonnes ajoutées à `frs`**, toutes `NULL`ables volontairement — un `NOT NULL` rendrait le
défaut « motif absent » impossible à démontrer :

```sql
ALTER TABLE frs ADD COLUMN motif          text;   -- motif d'enregistrement (R. 236-22, 4°)
ALTER TABLE frs ADD COLUMN date_evenement date;   -- date des faits (R. 236-25)
ALTER TABLE frs ADD COLUMN origine_info   text;   -- constatation directe | RT | tiers | source ouverte
CREATE INDEX idx_frs_date_evt ON frs(date_evenement);
```

Ce sont exactement les trois manques que le référent national reproche à la version 1 de
l'application réelle. Les ajouter, c'est jouer la version 2.

**Trois tables d'audit :**

```sql
CREATE TABLE frs_audit_run (
  id              serial PRIMARY KEY,
  jour            date NOT NULL UNIQUE,       -- jour audité (la veille du run)
  lance_a         timestamptz NOT NULL DEFAULT now(),
  termine_a       timestamptz,
  statut          text NOT NULL DEFAULT 'en_cours', -- en_cours | complet | partiel | echec
  total_fiches    integer NOT NULL DEFAULT 0,
  fragments_total integer NOT NULL DEFAULT 0,
  fragments_ok    integer NOT NULL DEFAULT 0,
  taille_fragment integer NOT NULL
);

CREATE TABLE frs_audit_fragment (
  id      serial PRIMARY KEY,
  run_id  integer NOT NULL REFERENCES frs_audit_run(id) ON DELETE CASCADE,
  rang    integer NOT NULL,
  frs_ids integer[] NOT NULL,
  statut  text NOT NULL DEFAULT 'en_attente',  -- en_attente | ok | echec
  erreur  text,
  UNIQUE (run_id, rang)
);

CREATE TABLE frs_audit (
  id          serial PRIMARY KEY,
  run_id      integer NOT NULL REFERENCES frs_audit_run(id) ON DELETE CASCADE,
  frs_id      integer NOT NULL REFERENCES frs(id) ON DELETE CASCADE,
  critere     text NOT NULL,     -- A1 … D12
  gravite     text NOT NULL,     -- bloquant | majeur | mineur
  source      text NOT NULL,     -- sql | llm
  fondement   text,              -- ex. « CSI R. 236-22, 4° »
  extrait     text,
  explication text,
  confiance   text,              -- haute | moyenne  (NULL si source = sql)
  UNIQUE (run_id, frs_id, critere)
);
CREATE INDEX idx_audit_run ON frs_audit(run_id);
CREATE INDEX idx_audit_frs ON frs_audit(frs_id);
```

`UNIQUE (run_id, frs_id, critere)` fait la déduplication **au niveau de la base** : deux agents
peuvent signaler la même fiche sous le même code, l'insertion se fait en `ON CONFLICT DO UPDATE` en
gardant la confiance la plus haute. Pas de code de dédoublonnage à écrire ni à tester.

### Pourquoi une table `frs_audit_fragment`

Sans elle, une fiche sans ligne dans `frs_audit` est ambiguë : conforme, ou jamais traitée ? Dans un
outil de conformité, cette ambiguïté est la pire des défaillances — un audit incomplet se déguiserait
en audit vierge. La table rend le fait explicite, permet de **rejouer un seul fragment en échec**, et
alimente le statut affiché en tête de rapport.

### Idempotence

Rejouer une journée supprime son run (cascade) et le recrée. Indispensable quand on ajuste un prompt
et qu'on veut recomparer à taille de fragment égale.

### Référentiel des motifs

Le référent recommande « l'élaboration d'un référentiel de motifs d'enregistrement » définissant,
pour chacun, le seuil d'atteinte justifiant l'inscription. Liste fermée, portée par le corpus RAG du
sous-agent LÉGALITÉ et par la contrainte SQL de `C2` :

`violences urbaines`, `violences en marge d'événements sportifs`, `atteinte aux institutions`,
`radicalisation`, `mouvance contestataire`, `atteintes aux biens en série`, `trafic de stupéfiants`,
`détention d'armes`, `dangerosité psychiatrique`, `sûreté de l'État`.

### Vérité terrain — défauts plantés

Sans défauts, l'audit affichera 100 % de conformité et ne prouvera rien : le corpus a été **généré
conforme par construction** (en-tête de `server/rens-api/seed/corpus.mjs`).

On plante donc, **dans la production nocturne**, ~40 fiches défectueuses par nuit couvrant les codes,
marquées par un mot-clé technique `defaut:<code>` dans `frs_mot_cle` — **le mécanisme exact déjà
employé pour `signal-faible:<code>`** à l'itération 1. Les trames s'inspirent directement des cas du
rapport (le tatouage qualifié de radicalisme, le tapage nocturne en camping).

Deux règles de méthode :

- **Muter des trames existantes, jamais écrire de nouveaux gabarits.** Une fiche défectueuse rédigée
  « à part » se reconnaît à son style : l'agent apprendrait une forme au lieu de raisonner sur le
  fond, et le taux de détection mesurerait autre chose que ce qu'on croit.
- **Le mot-clé `defaut:` n'est jamais transmis aux agents.** Le job le filtre avant de composer le
  fragment. Sinon l'audit lit la réponse au lieu de la trouver. Testé.

**`C10` est structurellement intestable ici** : la purge à 90 jours fait qu'aucune fiche n'atteint un
an. Le critère reste — il est juste et gratuit — mais il rapportera toujours 0, et le rapport doit
l'indiquer plutôt que de laisser croire à une conformité vérifiée. Il est exclu du jeu de défauts
plantés.

---

## 6. Contrats

### Entrée du workflow — un fragment

```json
{ "fragment": 7,
  "fiches": [
    { "id": 1204, "date_redaction": "2026-08-04", "date_evenement": null,
      "titre": "…", "motif": null, "origine_info": "tiers",
      "unite": "COB Segré-en-Anjou Bleu", "code_ggd": "GGD 49",
      "commune": "Segré", "texte": "…", "porte_pii": true } ]
}
```

`porte_pii` : drapeau SQL par expression régulière (patronyme en capitales, plaque, pseudonyme, date
de naissance). Une **indication** pour les agents, pas un filtre — `A1` s'apprécie sur toutes les
fiches. La plaque d'immatriculation est une donnée personnelle au sens de R. 236-22, 3° : sur le
corpus, 28 % des fiches citent une identité et 52 % une plaque, donc la part réellement porteuse de
données personnelles dépasse 52 %.

### Sortie d'un sous-agent

Un tableau JSON, une entrée par non-conformité. **Tableau vide si le fragment est sain** — et un
tableau vide est un résultat, pas une absence de résultat.

```json
[ { "frs_id": 1234,
    "critere": "A3",
    "gravite": "majeur",
    "extrait": "…passage exact de la fiche…",
    "fondement": "CSI R. 236-22, 4°",
    "explication": "Motif « radicalisation » retenu pour un tapage nocturne, sans provocation ni violence.",
    "confiance": "haute" } ]
```

`confiance` (`haute` / `moyenne`) permet au front de séparer ce qui appelle une décision de ce qui
appelle une relecture. Un contrôle qualité incapable de dire « je ne suis pas sûr » n'est pas
utilisable.

**Règle de prompt, non négociable** : pas de `fondement` citable, pas de signalement. C'est ce qui
empêche la dérive vers la police du style.

### `GET /audit/rapport?jour=YYYY-MM-DD&ggd=` — rens-api, lecture

```json
{ "data": {
  "run": { "jour": "2026-08-04", "statut": "complet", "termine_a": "2026-08-05T03:12:44Z",
           "total_fiches": 1043, "fragments_total": 26, "fragments_ok": 26,
           "taille_fragment": 40 },
  "synthese": {
    "fiches_non_conformes": 168,
    "taux_conformite": 0.839,
    "par_gravite": { "bloquant": 11, "majeur": 74, "mineur": 83 },
    "par_critere": [ { "critere": "C2", "libelle": "Motif non renseigné", "n": 87 } ],
    "par_unite":   [ { "unite": "COB Segré-en-Anjou Bleu", "n": 9, "bloquant": 1 } ]
  },
  "fiches": [
    { "frs_id": 1204, "titre": "…", "unite": "…", "code_ggd": "GGD 49", "commune": "…",
      "date_redaction": "2026-08-04", "gravite_max": "bloquant", "n_ecarts": 3,
      "criteres": ["A1", "B5", "C2"] } ]
} }
```

### `GET /audit/fiche/{frs_id}?jour=` — détail

Renvoie la fiche **entière** (texte intégral, métadonnées) et ses non-conformités avec extrait,
fondement, explication et confiance. Le texte intégral est indispensable : un contrôleur juge en
contexte, pas sur un fragment de phrase.

### Routes BFF

`GET /api/rens/audit/rapport` et `GET /api/rens/audit/fiche` — simples forwards vers rens-api, sur le
modèle de `/api/rens/fiches` existant. **Aucun appel de workflow depuis le front** : tout est déjà
calculé.

Enveloppe `{ data }` / `{ error: { code, message } }`, identique au reste de rens-api.

---

## 7. Front — `src/features/qualite/`

Une page, conformément au principe du projet : une page = un cas d'usage = un workflow. Elle répond à
une seule question — **qu'est-ce que je dois traiter aujourd'hui ?**

### Bandeau de couverture (en tête, toujours visible)

> **Audit du 4 août 2026** — 1 043 fiches contrôlées, 26/26 fragments · terminé à 03 h 12
> **83,9 % conformes** · 11 bloquants · 74 majeurs · 83 mineurs

La couverture passe avant le résultat. Un audit partiel (`statut: partiel`) affiche un bandeau
d'avertissement explicite — « 24/26 fragments : 78 fiches non contrôlées ». Un rapport qui laisse
croire à une couverture totale qu'il n'a pas est pire que pas de rapport.

Sélecteur de jour (défaut : dernier run) et filtre GGD.

### Trois files de travail

Le tri principal n'est pas la gravité pour elle-même, mais **l'action attendue** — c'est ce que le
contrôleur a à faire :

| Onglet | Contenu | Suite |
|---|---|---|
| **À supprimer** | fiches portant un écart bloquant | demande de suppression à l'analyste |
| **À corriger** | écart majeur, sans bloquant | retour à l'unité rédactrice |
| **À surveiller** | écarts mineurs seulement | amélioration, pas d'urgence |

### Liste des fiches

Une ligne par fiche : titre, unité, GGD, commune, date, gravité maximale, nombre d'écarts, et les
codes de critères en pastilles. Triée par gravité puis par unité. Filtrable par critère.

Chaque ligne se déplie sur le détail — une entrée par non-conformité :

- le **critère** et son libellé ;
- le **fondement** (« CSI R. 236-22, 4° ») — mis en avant, c'est ce qui rend le signalement opposable ;
- l'**extrait incriminé surligné dans le texte intégral de la fiche**, pas isolé ;
- l'**explication** ;
- la **confiance**, quand elle est « moyenne », signalée comme appelant une relecture humaine.

### Vue par unité

Second onglet de lecture : quelles brigades concentrent les non-conformités. C'est l'information qui
intéresse un commandant de compagnie — elle désigne une action de formation ciblée, là où la liste
de fiches ne désigne qu'un travail de correction.

### Encart méthode

Repliable, en pied de page : taille de fragment du run, défauts plantés retrouvés sur total planté
(taux de détection mesuré), mention que `C10` ne peut pas se déclencher du fait de la rétention à
90 jours.

### Notice

Permanente : le diagnostic est une aide au contrôle et ne vaut pas décision. Données et identités
entièrement fictives.

### États à traiter explicitement

Aucun run pour ce jour (cron non passé, jour futur) · run en cours · run partiel · run en échec ·
jour sans aucune non-conformité. Chacun a son message ; aucun ne doit ressembler à « tout va bien ».

**Icônes Material Icons ou SVG. Aucun emoji** — règle projet.

---

## 8. Le job `audit-nightly`

`server/rens-api/audit/nightly.mjs` — voisin de l'alimentation `seed/nightly.mjs`, mais dans son
propre répertoire : l'un écrit des fiches, l'autre les juge.

Déroulé :

1. Créer (ou remplacer) le `frs_audit_run` du jour.
2. **Contrôle structurel SQL** sur toutes les fiches du jour → insertion directe des écarts `C2`,
   `C8`, `C10` avec `source = 'sql'`.
3. Sélectionner les fiches du jour, **filtrer les mots-clés `defaut:`**, découper en fragments de
   `taille_fragment`, créer les `frs_audit_fragment`.
4. Exécuter les fragments avec une **concurrence bornée** (défaut 6) : appel du workflow via
   `execWorkflow`, parsing de la sortie, insertion en `ON CONFLICT DO UPDATE`, passage du fragment à
   `ok` ou `echec` avec le message d'erreur.
5. Clore le run : `complet` si tous les fragments sont `ok`, `partiel` sinon.

Variables : `AUDIT_TAILLE_FRAGMENT` (défaut 40), `AUDIT_CONCURRENCE` (défaut 6), `AUDIT_JOUR`
(rejeu d'un jour donné), `AUDIT_DRY=1` (transaction puis `ROLLBACK`, sur le modèle de
`NIGHTLY_DRY`).

Un fragment en échec **n'interrompt pas le run** : il est marqué, le run finit `partiel`, et le
rejeu ne reprend que les fragments `echec`.

---

## 9. Tests

| Niveau | Objet |
|---|---|
| `node --test` (audit) | Découpage en fragments (bornes, reste), concurrence bornée, `ON CONFLICT` conservant la confiance la plus haute, un fragment en échec laisse le run `partiel`, rejeu idempotent, `AUDIT_DRY` ne persiste rien. |
| `node --test` (audit) | **Le mot-clé `defaut:` est absent du fragment transmis au workflow.** |
| `node --test` (structurel) | `C2` / `C8` / `C10` : cas limites, motif hors référentiel, date d'événement postérieure à la rédaction. |
| `node --test` (rens-api) | `/audit/rapport` et `/audit/fiche` : jour sans run, run partiel, filtre GGD, enveloppe d'erreur. |
| `node --test` (proxy) | Forwards `/api/rens/audit/*`. |
| Vitest (front) | Les trois files, dépliage du détail, filtres, et **chacun des états** du §7 — en particulier « run partiel » et « aucun run », qui ne doivent jamais ressembler à « conforme ». |
| Recette | **Taux de détection ≥ 70 %** sur les défauts plantés ; **aucun faux positif « bloquant »** sur un lot réputé sain ; calibration de `taille_fragment` entre 20 et 60. |

Le seuil de 70 % est un critère d'acceptation mesuré et publié, pas une garantie.

---

## 10. Risques

| Risque | Traitement |
|---|---|
| **Rappel qui s'effondre sur un fragment trop grand** | `taille_fragment` calibrée empiriquement sur les défauts plantés, stockée par run. |
| **Audit partiel présenté comme complet** | `frs_audit_fragment` + statut du run + bandeau d'avertissement + test front dédié. |
| **Faux positifs sur jugement subjectif** (`D12`) | `confiance` obligatoire ; `D12` plafonné à « mineur » ; le rapport est une aide, jamais une décision. |
| **Dérive vers la police du style** | Corpus RAG restreint aux textes normatifs ; sans `fondement` citable, pas de signalement. |
| **Fuite de la vérité terrain dans le prompt** | Filtrage des mots-clés `defaut:` dans le job, testé explicitement. |
| **Défauts plantés reconnaissables au style** | Mutation de trames existantes, jamais de gabarits neufs. |
| **Coût du triple passage** | Chiffré (~550 k tokens/nuit). Premier levier si la facture devient le sujet : fusionner les familles — au prix de la spécialisation. |
| **Confusion démo / réel** | Notice permanente ; identités et faits entièrement fictifs. |

---

## 11. Arbitrages tranchés

| Question | Décision |
|---|---|
| Moment du contrôle | *A posteriori* sur la production, pas d'aide à la rédaction. |
| Diagnostic ou réparation | **Diagnostic seul.** |
| Couverture | **Systématique — toutes les fiches.** Le sondage ciblé a été écarté : honnête, mais peu convaincant pour un outil de contrôle. |
| Où vit la boucle | Dans le job Node. IAka n'itère pas, mais parallélise depuis une entrée. |
| Interactif ou batch | **Batch nocturne**, front en lecture seule de résultats persistés. |
| Découpage des agents | Par famille de critères, un corpus normatif chacun. |

Aucune décision ouverte.

---

## Sources

- [Décret n° 2020-1512 du 2 décembre 2020 — Légifrance](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000042607387)
- [Articles R. 236-21 à R. 236-30 du Code de la sécurité intérieure — Légifrance](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000025503132/LEGISCTA000028285268/)
- [Rapport public du référent national sur le traitement GIPASP — ministère de l'Intérieur](https://www.interieur.gouv.fr/content/download/113082/904432/file/2017_rapport%20re%CC%81fe%CC%81rent%20national%20Gipasp%20VFcm.pdf)

*Synthèse documentaire, établie à partir des textes publiés. Ne constitue pas un avis juridique.*
