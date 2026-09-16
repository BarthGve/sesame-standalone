# Cas d'usage IAka — Analyse d'audition & valorisation du XML de procédure

## 1. Le besoin métier

Une procédure judiciaire, c'est une pile de procès-verbaux. Un enquêteur qui reprend un dossier —
parce qu'il en hérite, parce qu'il le rouvre, parce qu'un magistrat l'interroge — doit **relire des
auditions de plusieurs pages** pour retrouver ce qui a été dit, par qui, et ce qui reste à
éclaircir. Ce travail de relecture est chronophage, répétitif, et il se fait souvent dans
l'urgence.

Le besoin n'est pas de « résumer » : c'est de **relire plus vite sans rien perdre**. Ce qui compte
à l'écran :

- qui a été entendu, en quelle qualité, dans quelle procédure ;
- ce qui a été déclaré, dans l'ordre, sans que le rédacteur du résumé prenne parti ;
- ce qui charge et ce qui décharge, avec la même rigueur ;
- les incohérences internes au PV, qui deviennent des questions à reposer ;
- les passages sensibles (aveu, rétractation) cités mot pour mot.

Ce livrable est une **synthèse de travail interne**. Il ne constitue pas un acte de procédure et
ne se substitue jamais au PV signé.

## 2. Le verrou

Un LLM à qui l'on donne un PV scanné produit une synthèse plausible — et se trompe précisément là
où l'erreur coûte cher :

- **il confond les rôles.** Sur un PV OCRisé, rien ne distingue toujours nettement une victime
  d'un mis en cause. Une synthèse qui inverse les deux est pire qu'une absence de synthèse.
- **il abîme l'état civil.** Un nom mal lu (« BIDULLE » pour « BIDULE »), une date de naissance
  approximative, et la synthèse devient inutilisable pour un rapprochement.
- **il confond les niveaux d'énonciation.** Un PV mêle les déclarations de la personne entendue,
  les questions de l'enquêteur — qui contiennent souvent des affirmations — et les mentions du
  rédacteur. Une affirmation contenue dans une question n'est pas une déclaration.
- **il glisse vers le jugement.** « Le récit paraît peu cohérent » n'a rien à faire dans une pièce
  de travail soumise à la présomption d'innocence.

Les trois premiers points ont un point commun : ce sont des **données factuelles**, et elles
existent déjà ailleurs, sous forme certaine.

## 3. La ressource inexploitée : le XML embarqué

Les PV produits par **LRPGN** sont des PDF/A-3 : ils embarquent une pièce jointe `data.xml`
(flux PDF compressé) contenant les **données structurées de la procédure**, telles qu'elles ont
été saisies par l'unité.

Extrait réel (procédure de test, données fictives) :

```xml
<Procedure Titre_Piece="04340_00059_2025__ENQUÊTE PRÉLIMINAIRE_PROCÈS-VERBAL D'AUDITION__Marc_BIDULE">
  <Entete>
    <Procedure_Numero>00059</Procedure_Numero>
    <Procedure_Annee>2025</Procedure_Annee>
    <Enquete_Type>ENQUÊTE PRÉLIMINAIRE</Enquete_Type>
    <Unite_L4>COB LE-LION-D-ANGERS</Unite_L4>
  </Entete>
  <Faits>
    <Fait>
      <Libelle_Fait>VOL EN BANDE ORGANISEE</Libelle_Fait>
      <Natinf>10832</Natinf>
      <Periode_Affaire_Debut>20/02/2025 à 14:47</Periode_Affaire_Debut>
      <Commune_Fait>ATHIS MONS</Commune_Fait>
    </Fait>
  </Faits>
  <Personnes>
    <Personnes_Physiques>
      <Personne>
        <Personne_Nom>BIDULE</Personne_Nom>
        <Personne_Prenom>Marc</Personne_Prenom>
        <Personne_Implication>VICTIME</Personne_Implication>
        <Personne_Naissance_Date>21/02/1985</Personne_Naissance_Date>
      </Personne>
    </Personnes_Physiques>
  </Personnes>
</Procedure>
```

`Personne_Implication = VICTIME` règle définitivement la question du rôle. `Natinf 10832` donne la
qualification exacte. Ces valeurs ne sont **pas hallucinables** : elles ne sont pas lues par un
modèle, elles sont extraites d'un fichier.

Le XML porte aussi des données que l'outil **n'exploite volontairement pas** : téléphone, adresse
personnelle, profession, situation familiale, consentement, coordonnées GPS. Elles n'aident pas la
relecture et n'ont pas à s'afficher — le type `ContexteProcedure` les exclut, et un test de
non-régression vérifie qu'aucune ne ressort du parsing.

## 4. La solution mise en place

### 4.1 Deux usages d'une même extraction

L'extraction se fait **dans le navigateur**, dès le choix du fichier, sans dépendance ajoutée
(`DecompressionStream` est natif). Elle alimente deux choses :

1. **Un cartouche à l'écran** — affiché avant même le lancement de l'analyse, séparé du texte
   généré. Personne entendue et son rôle, faits et natinf, période, lieu, unité, enquêteur. Ce
   sont les données certaines : rien n'y est rédigé par un modèle.
2. **Le contexte du workflow** — le XML brut part au BFF, qui le joint à l'exécution IAka encadré
   par `<contexte_procedure>`, pour que l'analyse s'appuie sur des identités et une qualification
   exactes. Voir `docs/iaka-analyse-audition-workflow.md`.

### 4.2 La chaîne

| Étape | Où | Quoi |
|---|---|---|
| Extraction | `src/features/synthese/pdfXml.ts` | repère le flux `/Type/EmbeddedFile`, décompresse, rend le XML ou `null` |
| Parsing | `src/features/synthese/lrpgn.ts` | XML → `ContexteProcedure` typé (ou `null`) |
| Affichage | `ContexteFiche.tsx` + `SyntheseApp.tsx` | badge « Données LRPGN détectées » + cartouche |
| État | `syntheseStore.ts` | extraction asynchrone, XML persisté en `sessionStorage` (survit au F5) |
| Envoi | `syntheseApi.ts` → `server/proxy.mjs` | corps `{ files, contexte? }`, job asynchrone |
| Workflow | `server/synthese.mjs` | multipart + champ `prompt` encadré, **repli 4xx** |

### 4.3 Best-effort de bout en bout

Aucune erreur du chemin XML ne peut faire échouer l'analyse ni afficher un message :

- pièce sans XML (image, DOCX, ODT, PDF non LRPGN) → **écran strictement identique** à ce qu'il
  était avant la fonctionnalité, aucun champ envoyé au workflow ;
- PDF chiffré, flux illisible, XML malformé → `null`, silencieux ;
- XML présent mais vide de contenu exploitable → ni badge, ni cartouche (pas de carte vide sous un
  badge mensonger) ;
- workflow qui refuse le champ `prompt` en 4xx → rejeu automatique sans lui.

L'absence de XML est le **cas majoritaire**, pas une anomalie : elle ne produit donc aucun message.

## 5. Ce que l'enquêteur voit

1. Il dépose la pièce. Si elle porte un XML, le cartouche apparaît **immédiatement**, sans attendre
   l'analyse.
2. Il clique sur « Analyser ». Une barre d'attente et un compteur de secondes indiquent que le
   workflow travaille — l'avancement est simulé et plafonne volontairement sous 100 %, la durée
   réelle étant inconnue.
3. L'analyse s'affiche dans un éditeur, sous les sept rubriques. Il peut la retoucher.
4. Il copie dans le presse-papier ou exporte en PDF : le cartouche accompagne la proposition dans
   les deux cas.

Un rechargement de page ne perd ni l'analyse ni le cartouche.

## 6. Garde-fous

**Le XML est une donnée, jamais une consigne.** Il porte des champs de saisie libre, remplis par
un tiers. Il est encadré par une balise explicite et déclaré non-instruction dans le prompt, au
même titre que le texte de l'audition.

**Le contexte ne parle pas du contenu.** Il fait autorité sur l'identité, la qualité, la
qualification et le cadre — pas sur ce qui a été déclaré. Aucun élément à charge ni à décharge
n'en est tiré.

**La divergence n'est pas harmonisée.** Si le fichier de procédure et le PV ne concordent pas, le
workflow le signale comme point à clarifier sans trancher. C'est un livrable en soi : une erreur
de saisie repérée avant qu'elle ne se propage au reste du dossier.

**Données à diffusion restreinte.** Le contenu des pièces n'est jamais journalisé côté BFF (seuls
les codes d'erreur le sont). Le `sessionStorage` conserve l'analyse et le XML le temps de
l'onglet.

## 7. État et limites

**Vérifié.** Extraction et parsing confrontés à **deux PV réels de procédures distinctes** (une
victime, un témoin ; unités, infractions et types d'enquête différents). C'est cette confrontation
au réel qui a révélé un défaut que 144 tests synthétiques ne voyaient pas : le dictionnaire PDF
réel contient `/Subtype/application#2foctet-stream`, dont la sous-chaîne « stream » égarait la
recherche du début de flux. L'extraction échouait **totalement** sur les vrais fichiers.

*Leçon à retenir pour la suite : une fixture fabriquée par le même raisonnement que le code testé
ne prouve rien.*

**Non couvert à ce jour :**

- pièces autres que des auditions (plainte, garde à vue, transport, bordereau) — non passées ;
- XML comportant **plusieurs personnes ou plusieurs faits** : le code les gère (listes), mais aucun
  échantillon réel n'en contient ;
- variantes de PDF/A-3 : objets compressés (`/ObjStm`), `/Length` en référence indirecte, `/Type
  /EmbeddedFile` avec espace. Dans ces cas, l'extraction ne se déclencherait pas — en silence, et
  sans conséquence autre que l'absence de cartouche ;
- **le workflow IAka ne lit pas encore le contexte** : tant que le prompt de
  `docs/iaka-analyse-audition-workflow.md` n'est pas déployé, l'analyse tourne sans enrichissement
  (le repli assure qu'elle tourne quand même).

**Pistes.** Le XML porte les coordonnées GPS des faits et l'ensemble des personnes : de quoi
alimenter la page carte et le graphe de relations (Ariane) sans ressaisie. L'extracteur
`extraireXmlPdf` est d'ailleurs déjà réutilisé comme brique par le cas d'usage Ariane.
