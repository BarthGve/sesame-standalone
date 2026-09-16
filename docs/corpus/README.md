# Corpus RAG du workflow IAka « QUALITÉ »

Trois corpus, un par sous-agent. **Un corpus par agent, et un seul** : c'est ce qui empêche
l'agent LÉGALITÉ de citer R. 236-23, qui n'est pas de son ressort, et fait diverger les trois
regards. Montage du workflow : `docs/iaka-qualite-workflow.md`.

| Corpus IAka | Fichier à déposer | Agent | Critères |
|---|---|---|---|
| `gipasp-legalite` | `gipasp-legalite.pdf` | LÉGALITÉ | A1, A4 |
| `gipasp-donnees` | `gipasp-donnees.pdf` | DONNÉES | B5, B6, B7 |
| `gipasp-redaction` | `gipasp-redaction.pdf` + `source-rapport-referent-national-gipasp.pdf` | RÉDACTION | C9, D11, D12 |

Les `.md` sont la source ; les `.pdf` sont les fichiers à téléverser. Pour régénérer après
modification d'un `.md` :

```bash
f=gipasp-legalite   # ou gipasp-donnees, gipasp-redaction
pandoc docs/corpus/$f.md -f gfm -t html5 -s --metadata title=" " \
  -c docs/corpus/corpus.css --embed-resources -o /tmp/$f.html
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --no-pdf-header-footer --print-to-pdf="$PWD/docs/corpus/$f.pdf" file:///tmp/$f.html
```

La feuille de style vit ici (`corpus.css`), pas dans `/tmp`.

## Ce que contient chaque corpus

Chacun suit la même structure : le **texte officiel** des articles dont l'agent a la charge,
les **observations de la CNIL** qui en fixent la lecture, les **cas d'espèce** du référent
national qui donnent le seuil d'appréciation, puis la **grille** de l'agent — avec, à chaque
fois, ce qui n'est **pas** de son ressort. Cette dernière section compte autant que le reste :
elle évite qu'un agent signale un écart appartenant à un autre, ou déjà contrôlé en SQL.

Chaque corpus se termine par la même règle : **sans article citable, pas de signalement**.
C'est la contrepartie de `parse.mjs`, qui rejette côté serveur tout écart sans `fondement`.

## Sources

- Code de la sécurité intérieure, articles R. 236-21 à R. 236-30 (section GIPASP) —
  <https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000025503132/LEGISCTA000028285268/>
  (version en vigueur au 29 juin 2024 pour R. 236-22, modifié par le décret n° 2024-616).
- Délibération CNIL n° 2010-456 du 9 décembre 2010 (avis sur le décret créant GIPASP) —
  <https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000023782209> — reproduite intégralement en
  annexe 2 du rapport du référent national.
- Délibération CNIL n° 2020-065 du 25 juin 2020 —
  <https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000042608217>
- Rapport public du référent national GIPASP —
  <https://www.interieur.gouv.fr/content/download/113082/904432/file/2017_rapport%20re%CC%81fe%CC%81rent%20national%20Gipasp%20VFcm.pdf>
  (copie locale : `source-rapport-referent-national-gipasp.pdf`).

Les citations d'articles et de délibérations sont reprises du texte officiel. Les tableaux de
grilles de critères sont **propres au démonstrateur** : elles traduisent
la grille de contrôle du projet (`server/rens-api/audit/criteres.js`), pas une doctrine
d'emploi de la gendarmerie.

## Les exemples ne doivent jamais être les défauts plantés

Les illustrations de chaque grille sont écrites en **catégories**, pas en formules
recopiables. C'est une contrainte de mesure, pas de style : les fiches piégées de
l'alimentation nocturne (`server/rens-api/seed/corpus.mjs`, `MUTATIONS`) portent des phrases
greffées ; si l'une d'elles figurait dans un corpus, l'agent la retrouverait par simple
recherche plein texte et l'encart « taux de détection mesuré » afficherait un score de
récupération de chaîne présenté comme une performance d'analyse.

Un test le vérifie à chaque exécution de la suite rens-api : aucune séquence de cinq mots
d'une phrase plantée ne doit apparaître dans `docs/corpus/*.md`
(`server/rens-api/seed/mutations.test.mjs`). En modifiant un corpus **ou** une mutation,
relancer `npm test --prefix server/rens-api`.

## La grille ne contrôle que ce que la FRS contient

Une FRS porte un texte et des métadonnées : unité, groupement, commune, date de rédaction.
Elle ne porte ni motif d'enregistrement, ni date d'événement, ni champ d'origine de
l'information. Deux critères ont donc été **retirés** — C2 (motif non renseigné) et A3 (motif
incohérent) : contrôler un champ qui n'est pas saisi produit un écart imputable à personne.
Un troisième, C8 (faits non datés), a été retiré à son tour : la durée de conservation se
calcule sur la **date de création de la fiche**, toujours connue, jamais sur la date des faits
narrés. La datation du récit n'entre donc dans aucun calcul.

La grille compte **neuf critères**. Un seul est déterministe — C10, l'ancienneté, calculée
sur cette même date de création. Les huit autres se lisent dans le texte, donc par les agents.

## Alignements effectués sur le décret

**C10 — seuil de conservation.** `criteres.js` retenait « au-delà d'un an » en citant
R. 236-24, qui fixe **dix ans** après le dernier événement (trois ans pour les mineurs,
R. 236-25). Le critère est aligné sur le décret : libellé, requête SQL
(`INTERVAL '10 years'`) et encart méthode du front. Le critère reste silencieux en pratique —
le lot audité est borné au jour de rédaction et la purge de la base est à 90 jours — et le
front annonce ce silence plutôt que de le faire passer pour une conformité vérifiée.

**C9 — fondement.** `criteres.js` portait `CSI R. 236-25, al. 2` ; la règle des treize ans est
à la première phrase de l'article, l'alinéa 2 ne porte que la durée de trois ans. Le fondement
est aligné sur `CSI R. 236-25`, identique à ce que demande le corpus RÉDACTION. Les deux côtés
peuvent donc être comparés si l'on ferme la boucle « fondement rendu == `fondementDe(code)` »
(point différé au review final).

**C8 — fondement.** `criteres.js` cite `CSI R. 236-25`. L'exigence tient en réalité à
R. 236-24 **et** R. 236-25 : les deux durées se comptent « à compter du dernier événement ».
Le corpus RÉDACTION cite les deux articles ; le fondement du critère reste R. 236-25, l'article
que le référent national vise lui-même dans son constat sur la date d'événement (§ III.3.2).
