# Corpus `gipasp-legalite`

Corpus normatif de l'agent **LÉGALITÉ** du workflow IAka « QUALITÉ ».
Critères couverts : **A1**, **A4**. Aucun autre.

> **Périmètre.** Une FRS porte un texte et des métadonnées (unité, groupement, commune, date
> de rédaction). Elle ne porte **pas** de champ « motif d'enregistrement » : cette donnée de
> R. 236-22, I, 4° se rattache à la fiche entité, et le référent national recommande d'en
> faire une saisie obligatoire dans une version ultérieure de l'application. Le critère qui
> contrôlait la cohérence du motif avec les faits a donc été retiré : on ne relève pas
> l'écart d'un champ qui n'est pas saisi.

Sources : code de la sécurité intérieure, articles R. 236-21 et R. 236-22 (Légifrance,
version en vigueur au 29 juin 2024) ; délibération CNIL n° 2010-456 du 9 décembre 2010 ;
rapport public du référent national GIPASP.

---

## 0. Préalable — y a-t-il une donnée à caractère personnel ?

**Le GIPASP est un traitement de données à caractère personnel.** Tout ce que le décret
encadre — les catégories admises, les données sensibles interdites, les durées de
conservation, les droits des personnes — protège des personnes physiques. Une fiche qui n'en
met aucune en cause ne tombe sous aucune de ces limites.

**Définition** (RGPD, art. 4, 1° ; loi n° 78-17 du 6 janvier 1978) :

> toute information se rapportant à une personne physique **identifiée ou identifiable**.

La CNIL précise qu'une personne peut être identifiée :

- **directement** — nom et prénom ;
- **indirectement** — numéro de téléphone, **plaque d'immatriculation**, numéro de sécurité
  sociale, adresse postale ou électronique, voix, image, identifiant en ligne ;
- **par croisement** : l'identification peut résulter « d'une seule donnée (exemple : nom) »
  ou « du croisement d'un ensemble de données (exemple : une femme vivant à telle adresse,
  née tel jour et membre dans telle association) ».

**Conséquence pour le contrôle.** Avant tout autre examen, la question est : *cette fiche
permet-elle d'identifier une personne physique, directement ou par recoupement ?*

- **Non** → la fiche est **valide**. Aucun critère ne s'applique, aucun écart n'est à relever.
  Un phénomène décrit sans personne — des dégradations sur du mobilier urbain, une série de
  vols sans auteur identifié, un survol de drone sans télépilote localisé — ne met en jeu les
  droits de personne. R. 236-21 vise d'ailleurs aussi les personnes morales et les
  groupements : une fiche peut porter sur eux sans concerner aucune personne physique.
- **Oui** → la grille s'applique, et c'est seulement là que se posent les questions de
  caractérisation de l'atteinte, de catégories admises, de données sensibles et de
  conservation.

**Exemples d'éléments qui rendent une personne identifiable dans une FRS** : une identité
même partielle ; une date de naissance associée à un lieu ; une plaque d'immatriculation ; un
pseudonyme ou l'adresse d'un compte ; « le gérant du bar X de la commune Y » ; « un élève de
sixième âgé de 11 ans du collège Z » — le recoupement suffit, le nom n'est pas nécessaire.

**Ne rend PAS une personne identifiable** : « une vingtaine de personnes », « des individus
non identifiés », « un véhicule de couleur claire » sans immatriculation, une personne morale
ou un groupement désigné seul.

---

## 1. Finalité du traitement — CSI, article R. 236-21

Le ministre de l'intérieur (direction générale de la gendarmerie nationale) est autorisé à
mettre en œuvre un traitement de données à caractère personnel dénommé « Gestion de
l'information et prévention des atteintes à la sécurité publique », ayant pour finalité de
recueillir, de conserver et d'analyser les informations qui concernent des personnes physiques
ou morales ainsi que des groupements dont l'activité individuelle ou collective indique qu'elles
peuvent porter atteinte à la sécurité publique ou à la sûreté de l'État.

Le traitement a notamment pour finalité de recueillir, de conserver et d'analyser les
informations qui concernent les personnes susceptibles de prendre part à des activités
terroristes, de porter atteinte à l'intégrité du territoire ou des institutions de la
République ou d'être impliquées dans des actions de violence collectives, en particulier en
milieu urbain ou à l'occasion de manifestations sportives.

Les données intéressant la sûreté de l'État sont celles qui révèlent des activités susceptibles
de porter atteinte aux intérêts fondamentaux de la Nation ou de constituer une menace
terroriste portant atteinte à ces mêmes intérêts. Ces données, de façon isolée ou groupée, font
l'objet d'une identification dans le traitement.

**Définition de la sécurité publique.** La CNIL rappelle que la « sécurité publique » doit
s'entendre comme l'élément de l'ordre public caractérisé par l'absence de périls pour la vie,
la liberté ou le droit de propriété des individus (délibération n° 2010-456).

---

## 2. Catégories de données admises — CSI, article R. 236-22

Peuvent être enregistrées dans le traitement mentionné à l'article R. 236-21, dans le respect
des dispositions de l'article 4 de la loi n° 78-17 du 6 janvier 1978 relative à l'informatique,
aux fichiers et aux libertés et **dans la stricte mesure où elles sont nécessaires à la
poursuite des finalités mentionnées à l'article R. 236-21**, les catégories de données à
caractère personnel suivantes.

### I. Données concernant la personne physique pouvant porter atteinte à la sécurité publique ou à la sûreté de l'État

1. **Éléments d'identification** : nom ; prénoms ; alias ; date et lieu de naissance ;
   nationalité ; signes physiques particuliers et objectifs ; photographies ; documents
   d'identité (type, numéro, validité, autorité et lieu de délivrance) ; origine géographique
   (lieux de résidence et zones d'activité).
2. **Coordonnées** : numéros de téléphone ; adresses postales et électroniques ; identifiants
   utilisés (pseudonymes, sites ou réseaux concernés, autres identifiants techniques), **à
   l'exclusion des mots de passe** ; adresses et lieux fréquentés.
3. **Situation** : situation familiale ; formation et compétences ; profession et emplois
   occupés ; moyens de déplacement (moyens utilisés, immatriculation des véhicules, permis de
   conduire) ; situation au regard de la réglementation de l'entrée et du séjour en France ;
   éléments patrimoniaux.
4. **Motifs de l'enregistrement.**
5. **Activités susceptibles de porter atteinte à la sécurité publique ou à la sûreté de
   l'État** : activités publiques ou au sein de groupements ou de personnes morales ;
   comportement et habitudes de vie ; déplacements ; activités sur les réseaux sociaux ;
   pratiques sportives ; pratique et comportement religieux.
6. **Facteurs de dangerosité** : lien avec des groupes extrémistes ; éléments ou signes de
   radicalisation, suivi pour radicalisation ; données relatives aux troubles psychologiques ou
   psychiatriques obtenues conformément aux dispositions législatives et réglementaires en
   vigueur ; armes et titres afférents ; détention d'animaux dangereux ; agissements
   susceptibles de recevoir une qualification pénale ; antécédents judiciaires (nature des
   faits et date) ; fiches de recherche ; suites judiciaires ; mesures d'incarcération (lieu,
   durée et modalités) ; accès à des zones ou des informations sensibles.
7. **Facteurs de fragilité** : facteurs familiaux, sociaux et économiques ; régime de
   protection ; faits dont la personne a été victime ; comportement auto-agressif ;
   addictions ; mesures administratives ou judiciaires restrictives de droits, décidées ou
   proposées.
8. **Indication de l'enregistrement ou non de la personne** dans les traitements suivants :
   traitement d'antécédents judiciaires (art. R. 40-23 et s. du code de procédure pénale) ;
   système informatique national N-SIS ; traitement PASP ; fichier des personnes recherchées ;
   FSPRT ; traitement des objets et véhicules volés ou signalés.

### II. Personnes en relation directe avec la personne visée

Données concernant les personnes physiques entretenant ou ayant entretenu des relations
**directes et non fortuites** avec la personne pouvant porter atteinte à la sécurité publique
ou à la sûreté de l'État, notamment ses parents et ses enfants, **dans la stricte mesure où ces
données sont nécessaires pour son suivi** et dans la limite des catégories mentionnées aux 1°,
2°, 3° et 5° à l'exception du c du I.

### III. Victimes

Données concernant les victimes des agissements de la personne physique pouvant porter atteinte
à la sécurité publique ou à la sûreté de l'État, **dans la stricte mesure où ces données sont
nécessaires à la protection des intérêts de la victime et à la prévention de la réitération**,
et dans la limite des catégories mentionnées aux 1°, 2°, 3°, 5° à l'exception du c du I et au c
du 7° du I.

### IV. Personnes liées à une personne morale ou à un groupement

Données concernant les personnes physiques entretenant ou ayant entretenu des relations
directes et non fortuites avec la personne morale ou le groupement pouvant porter atteinte à la
sécurité publique ou à la sûreté de l'État, ou victimes des agissements de ces personnes
morales et groupements, dans la stricte mesure où ces données sont nécessaires à leur suivi et
dans la limite des catégories mentionnées aux 1°, 2°, 3°, 5° à l'exception du c du I, et,
concernant les victimes, au c du 7° du I.

**Conséquence directe pour A4** : une personne citée dans une fiche doit être **soit** la
personne à risque (I), **soit** une relation directe et non fortuite de celle-ci (II), **soit**
une victime (III), **soit** une personne liée à la personne morale ou au groupement (IV). Un
tiers purement fortuit — témoin de passage, commerçant qui a vu la scène, voisin sans lien —
n'entre dans aucune de ces catégories.

---

## 3. Pourquoi le motif n'est pas contrôlé ici

La donnée « motifs de l'enregistrement » figure bien à R. 236-22, I, 4°, et la CNIL y voit une
garantie (délibération n° 2010-456) :

> La commission rappelle que cette donnée constitue une garantie dès lors qu'elle permet de
> vérifier que l'inscription est liée à la finalité du traitement et de préciser en quoi la
> personne peut porter atteinte à la sécurité publique. Or, il apparaît que cette donnée pourra
> ne pas être systématiquement renseignée selon la nature de la fiche. La commission souhaite
> que le « motif de l'enregistrement » soit une donnée obligatoire.

Le référent national fait le même constat (§ III.3.1) et en tire une recommandation : créer
« de nouveaux motifs d'enregistrement (dont le renseignement serait obligatoire) » dans la
version suivante de l'application.

**Mais ce n'est pas un champ de la FRS.** Le motif se rattache à la fiche entité ; le
rédacteur d'une fiche de renseignement simplifiée ne le saisit pas. Un agent qui reprocherait
son absence ou son inadéquation relèverait un écart qui n'est imputable à personne. Le
contrôle porte donc sur la question que la FRS permet réellement de trancher : **les faits
narrés caractérisent-ils une atteinte à la sécurité publique ?** (A1)

---

## 4. Seuils de caractérisation de l'atteinte

Le référent national recommande de « définir, plus finement, pour chacun d'eux, le seuil
d'atteinte à la sécurité publique justifiant l'inscription dans le fichier ». Ces seuils ne
sont pas dans le décret : ils traduisent, pour le contrôle, la ligne entre le fait de police
du quotidien et l'atteinte que R. 236-21 vise. Ils servent à trancher **A1**.

| Nature des faits | Seuil atteint | En deçà (pas d'atteinte caractérisée) |
|---|---|---|
| Violences urbaines | faits collectifs mettant en péril la vie ou les biens : jets de projectiles, dégradations en réunion, guet-apens, **rodéos motorisés répétés** compromettant la sécurité des usagers — délit depuis la loi du 3 août 2018 (C. route, L. 236-1 ; deux ans en réunion) | tapage isolé, incivilité unique |
| Événements sportifs | affrontements ou provocations organisés, groupe à risque, convoi coordonné | présence dans un stade |
| Atteinte aux institutions | menaces, dégradations, intimidations visant un élu ou un agent public en lien avec sa fonction | critique publique, même virulente |
| Radicalisation | adoption d'une forme **violente** d'action liée à une idéologie extrémiste ; apologie du terrorisme ; projet de départ en zone de conflit | pratique religieuse seule, changement d'habitudes, fréquentation d'une personne radicalisée |
| Mouvance contestataire | préparation d'actions de blocage, repérage de sites, mobilisation organisée | opinion, manifestation déclarée |
| Atteintes aux biens | faits répétés de même mode opératoire, équipe itinérante, repérages constatés | vol isolé |
| Stupéfiants | organisation de vente : guetteurs, point de deal, transactions répétées | usage personnel |
| Armes | détention, exhibition ou transaction hors cadre légal | détention régulière d'une arme de chasse |
| Dangerosité psychiatrique | risque avéré pour autrui, établi par un élément objectif | diagnostic ou suivi, seuls — donnée sensible interdite |
| Sûreté de l'État | atteinte aux intérêts fondamentaux de la Nation, menace terroriste | — |

---

## 4. Cas d'espèce relevés par le référent national

Ces cas sont des **écarts constatés dans le fichier réel**. Ils donnent le seuil d'appréciation.

**Fait anodin traité comme une menace — aucune provocation ni violence rapportée.** Le
référent raisonne ici sur le motif porté par la fiche entité ; pour l'agent LÉGALITÉ, qui ne
voit que la FRS, la question devient : les faits narrés caractérisent-ils une atteinte à la
sécurité publique ? (A1)

> Une telle démarche aurait, par exemple, conduit à s'interroger sur la pertinence de la
> présence dans le traitement d'un mineur inscrit pour s'être présenté à son collège avec
> d'autres camarades en arborant des tatouages représentant le drapeau palestinien et le slogan
> « Pray for Palestine, 100.000 morts », sans qu'aucune forme de provocation ou de violence ne
> soit rapportée. Il en va de même du cas d'un jeune inscrit pour avoir troublé, avec deux
> camarades, la tranquillité publique dans un camping au cours d'une nuit d'été, jusqu'à
> l'intervention des gendarmes devant lesquels il a obtempéré sans le moindre incident. Dans
> ces deux cas, le motif de « radicalisme » retenu n'a pas paru pertinent aux référents.

**Atteinte non caractérisée — pratique religieuse seule, ou simple relation.**

> Les référents ont estimé que la seule pratique de l'Islam, même dans le cadre d'une
> conversion, y compris lorsqu'elle s'accompagne d'un changement dans les habitudes
> vestimentaires et alimentaires, ne suffit pas à caractériser un risque d'atteinte à la
> sécurité publique, pas plus que le fait d'être une simple connaissance d'une personne dont la
> radicalisation est avérée.

**Signalement non corroboré.**

> Les référents ont également considéré que la présence de certains mineurs dans le traitement
> n'était pas justifiée dans des cas où les signes de radicalisation décrits n'étaient pas
> suffisamment précis ou caractérisés ou reposaient uniquement sur des éléments déclaratifs non
> corroborés à la suite des premières investigations menées.

**Nuance à respecter — l'absence de radicalisation n'efface pas tout risque.**

> On comprend néanmoins que l'absence de radicalisation n'exclut pas nécessairement tout risque
> d'atteinte à la sécurité publique, notamment dans le cas de jeunes connus par ailleurs pour
> leur comportement violent ou instable ou leur fragilité psychologique ou affective.

---

## 5. Grille de l'agent LÉGALITÉ

| Code | Écart | Fondement à citer |
|---|---|---|
| **A1** | Atteinte à la sécurité publique non caractérisée : la fiche porte des données personnelles alors que les faits n'établissent aucune atteinte, potentielle ou avérée, à la sécurité publique ou à la sûreté de l'État. | CSI R. 236-21 |
| **A4** | Personne citée hors des catégories admises : un tiers est nommé sans être la personne à risque, une relation directe et non fortuite, ou une victime. | CSI R. 236-22, II à IV |

### Ce qui n'est PAS un écart de cet agent

- Le **motif d'enregistrement** : il n'est pas saisi dans la FRS. Ne jamais reprocher son
  absence ni son inadéquation — il n'y a rien à contrôler.
- Une donnée sensible ou hors nomenclature : ressort de l'agent DONNÉES (B5, B6, B7).
- Un jugement de valeur, une origine d'information floue, la présence d'un mineur : ressort de
  l'agent RÉDACTION (C9, D11, D12).
- Le style, la longueur, l'orthographe : hors périmètre. On applique le décret, pas une
  préférence rédactionnelle.

### Règle absolue

Un écart n'est signalé que si l'article du code de la sécurité intérieure qui le fonde peut être
cité dans le champ `fondement`. **Sans article citable, pas de signalement.**
