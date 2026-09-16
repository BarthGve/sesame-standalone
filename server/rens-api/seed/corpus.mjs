// Corpus FRS — SOURCE UNIQUE des données (départements, thèmes, trames, listes fictives).
// Partagé par generate.mjs (seed déterministe) et nightly.mjs (alimentation nocturne).
// Contient UNIQUEMENT des données pures : aucun PRNG, aucun effet de bord. Chaque
// consommateur branche son propre générateur d'aléa (mulberry32 déterministe côté seed,
// Math.random côté nightly) sur les helpers pick/fill.
//
// GIPASP : plaques mentionnées si atteinte SUPPOSÉE à l'ordre public / la sûreté ; identités
// uniquement si susceptibles de porter atteinte à la sécurité publique/de l'État ET contrôlées.
// Tout est FICTIF (plaques et identités générées par fiche).

export const esc = (s) => s.replace(/'/g, "''");

// Plaque française fictive : LL-DDD-LL (lettres sans I/O/U pour rester plausible).
export const PL = 'ABCDEFGHJKLMNPQRSTVWXYZ';

// Identités fictives.
export const PRENOMS = ['Karim', 'Yanis', 'Léa', 'Nadia', 'Thomas', 'Sofiane', 'Émilie', 'Mehdi', 'Julie', 'Antoine', 'Rachid', 'Camille', 'Lucas', 'Fatima', 'Hugo', 'Sarah', 'Bilal', 'Manon', 'Kevin', 'Inès'];
export const NOMS = ['BENNANI', 'FERHAT', 'MERCIER', 'DUBOIS', 'NGUYEN', 'MARTIN', 'ROUSSEAU', 'HADDAD', 'LEROY', 'GARCIA', 'MOREAU', 'BOULANGER', 'DA SILVA', 'PETIT', 'CHEVALIER', 'MASSON', 'BERNARD', 'FONTAINE', 'RIVIERE', 'MARCHAND'];

// Pseudonyme et URL de source ouverte (fictifs) — pour le renseignement en ligne (GIPASP :
// identifiants/pseudonymes et sites/réseaux concernés autorisés, hors mots de passe).
export const HANDLES = ['libre_2026', 'nuit_du_sud', 'kareem_off', 'resistance84', 'anon1789', 'veritas_fr', 'ombre_noire', 'faucon_du_nord', 'silence_radio', 'colere_rurale', 'zone_libre_', 'oeil_ouvert'];
export const PLATS = ['t.me/', 'x.com/', 'facebook.com/', 'instagram.com/', 'tiktok.com/@', 'discord.gg/'];

// Départements (métropole + Outre-mer) → GGD + communes (préfecture + villes connues).
export const DEPTS = [
  ['01', 'Ain', ['Bourg-en-Bresse', 'Oyonnax', 'Gex']], ['02', 'Aisne', ['Laon', 'Saint-Quentin', 'Soissons']],
  ['03', 'Allier', ['Moulins', 'Montluçon', 'Vichy']], ['04', 'Alpes-de-Haute-Provence', ['Digne-les-Bains', 'Manosque', 'Sisteron']],
  ['05', 'Hautes-Alpes', ['Gap', 'Briançon', 'Embrun']], ['06', 'Alpes-Maritimes', ['Nice', 'Cannes', 'Grasse']],
  ['07', 'Ardèche', ['Privas', 'Annonay', 'Aubenas']], ['08', 'Ardennes', ['Charleville-Mézières', 'Sedan', 'Rethel']],
  ['09', 'Ariège', ['Foix', 'Pamiers', 'Saint-Girons']], ['10', 'Aube', ['Troyes', 'Romilly-sur-Seine', 'Bar-sur-Aube']],
  ['11', 'Aude', ['Carcassonne', 'Narbonne', 'Limoux']], ['12', 'Aveyron', ['Rodez', 'Millau', 'Villefranche-de-Rouergue']],
  ['13', 'Bouches-du-Rhône', ['Aix-en-Provence', 'Arles', 'Istres']], ['14', 'Calvados', ['Caen', 'Lisieux', 'Bayeux']],
  ['15', 'Cantal', ['Aurillac', 'Saint-Flour', 'Mauriac']], ['16', 'Charente', ['Angoulême', 'Cognac', 'Confolens']],
  ['17', 'Charente-Maritime', ['La Rochelle', 'Saintes', 'Rochefort']], ['18', 'Cher', ['Bourges', 'Vierzon', 'Saint-Amand-Montrond']],
  ['19', 'Corrèze', ['Tulle', 'Brive-la-Gaillarde', 'Ussel']], ['2A', 'Corse-du-Sud', ['Ajaccio', 'Porto-Vecchio', 'Sartène']],
  ['2B', 'Haute-Corse', ['Bastia', 'Corte', 'Calvi']], ['21', "Côte-d'Or", ['Dijon', 'Beaune', 'Montbard']],
  ['22', "Côtes-d'Armor", ['Saint-Brieuc', 'Lannion', 'Dinan']], ['23', 'Creuse', ['Guéret', 'Aubusson', 'La Souterraine']],
  ['24', 'Dordogne', ['Périgueux', 'Bergerac', 'Sarlat-la-Canéda']], ['25', 'Doubs', ['Besançon', 'Montbéliard', 'Pontarlier']],
  ['26', 'Drôme', ['Valence', 'Montélimar', 'Die']], ['27', 'Eure', ['Évreux', 'Vernon', 'Les Andelys']],
  ['28', 'Eure-et-Loir', ['Chartres', 'Dreux', 'Châteaudun']], ['29', 'Finistère', ['Quimper', 'Brest', 'Morlaix']],
  ['30', 'Gard', ['Nîmes', 'Alès', 'Le Grau-du-Roi']], ['31', 'Haute-Garonne', ['Toulouse', 'Muret', 'Saint-Gaudens']],
  ['32', 'Gers', ['Auch', 'Condom', 'Mirande']], ['33', 'Gironde', ['Libourne', 'Arcachon', 'Blaye']],
  ['34', 'Hérault', ['Montpellier', 'Béziers', 'Sète']], ['35', 'Ille-et-Vilaine', ['Rennes', 'Saint-Malo', 'Fougères']],
  ['36', 'Indre', ['Châteauroux', 'Issoudun', 'Le Blanc']], ['37', 'Indre-et-Loire', ['Tours', 'Amboise', 'Chinon']],
  ['38', 'Isère', ['Grenoble', 'Vienne', 'Bourgoin-Jallieu']], ['39', 'Jura', ['Lons-le-Saunier', 'Dole', 'Saint-Claude']],
  ['40', 'Landes', ['Mont-de-Marsan', 'Dax', 'Biscarrosse']], ['41', 'Loir-et-Cher', ['Blois', 'Vendôme', 'Romorantin-Lanthenay']],
  ['42', 'Loire', ['Saint-Étienne', 'Roanne', 'Montbrison']], ['43', 'Haute-Loire', ['Le Puy-en-Velay', 'Brioude', 'Yssingeaux']],
  ['44', 'Loire-Atlantique', ['Saint-Nazaire', 'Châteaubriant', 'Ancenis']], ['45', 'Loiret', ['Orléans', 'Montargis', 'Pithiviers']],
  ['46', 'Lot', ['Cahors', 'Figeac', 'Gourdon']], ['47', 'Lot-et-Garonne', ['Agen', 'Villeneuve-sur-Lot', 'Marmande']],
  ['48', 'Lozère', ['Mende', 'Florac', 'Marvejols']], ['49', 'Maine-et-Loire', ['Angers', 'Cholet', 'Saumur']],
  ['50', 'Manche', ['Saint-Lô', 'Cherbourg-en-Cotentin', 'Coutances']], ['51', 'Marne', ['Châlons-en-Champagne', 'Reims', 'Épernay']],
  ['52', 'Haute-Marne', ['Chaumont', 'Saint-Dizier', 'Langres']], ['53', 'Mayenne', ['Laval', 'Mayenne', 'Château-Gontier']],
  ['54', 'Meurthe-et-Moselle', ['Nancy', 'Lunéville', 'Toul']], ['55', 'Meuse', ['Bar-le-Duc', 'Verdun', 'Commercy']],
  ['56', 'Morbihan', ['Vannes', 'Lorient', 'Pontivy']], ['57', 'Moselle', ['Metz', 'Thionville', 'Sarreguemines']],
  ['58', 'Nièvre', ['Nevers', 'Cosne-Cours-sur-Loire', 'Château-Chinon']], ['59', 'Nord', ['Douai', 'Valenciennes', 'Cambrai']],
  ['60', 'Oise', ['Beauvais', 'Compiègne', 'Senlis']], ['61', 'Orne', ['Alençon', 'Argentan', 'Flers']],
  ['62', 'Pas-de-Calais', ['Arras', 'Boulogne-sur-Mer', 'Calais']], ['63', 'Puy-de-Dôme', ['Clermont-Ferrand', 'Riom', 'Issoire']],
  ['64', 'Pyrénées-Atlantiques', ['Pau', 'Bayonne', 'Oloron-Sainte-Marie']], ['65', 'Hautes-Pyrénées', ['Tarbes', 'Lourdes', 'Bagnères-de-Bigorre']],
  ['66', 'Pyrénées-Orientales', ['Perpignan', 'Céret', 'Prades']], ['67', 'Bas-Rhin', ['Haguenau', 'Sélestat', 'Saverne']],
  ['68', 'Haut-Rhin', ['Colmar', 'Mulhouse', 'Thann']], ['69', 'Rhône', ['Villefranche-sur-Saône', 'Givors', 'Tarare']],
  ['70', 'Haute-Saône', ['Vesoul', 'Lure', 'Gray']], ['71', 'Saône-et-Loire', ['Mâcon', 'Chalon-sur-Saône', 'Autun']],
  ['72', 'Sarthe', ['Le Mans', 'La Flèche', 'Mamers']], ['73', 'Savoie', ['Chambéry', 'Albertville', 'Saint-Jean-de-Maurienne']],
  ['74', 'Haute-Savoie', ['Annecy', 'Thonon-les-Bains', 'Bonneville']], ['76', 'Seine-Maritime', ['Rouen', 'Le Havre', 'Dieppe']],
  ['77', 'Seine-et-Marne', ['Melun', 'Meaux', 'Fontainebleau']], ['78', 'Yvelines', ['Versailles', 'Mantes-la-Jolie', 'Rambouillet']],
  ['79', 'Deux-Sèvres', ['Niort', 'Bressuire', 'Parthenay']], ['80', 'Somme', ['Amiens', 'Abbeville', 'Péronne']],
  ['81', 'Tarn', ['Albi', 'Castres', 'Gaillac']], ['82', 'Tarn-et-Garonne', ['Montauban', 'Castelsarrasin', 'Moissac']],
  ['83', 'Var', ['Draguignan', 'Fréjus', 'Brignoles']], ['84', 'Vaucluse', ['Avignon', 'Carpentras', 'Orange']],
  ['85', 'Vendée', ['La Roche-sur-Yon', 'Les Sables-d\'Olonne', 'Fontenay-le-Comte']], ['86', 'Vienne', ['Poitiers', 'Châtellerault', 'Montmorillon']],
  ['87', 'Haute-Vienne', ['Limoges', 'Saint-Junien', 'Bellac']], ['88', 'Vosges', ['Épinal', 'Saint-Dié-des-Vosges', 'Remiremont']],
  ['89', 'Yonne', ['Auxerre', 'Sens', 'Avallon']], ['90', 'Territoire de Belfort', ['Belfort', 'Delle', 'Giromagny']],
  ['91', 'Essonne', ['Étampes', 'Palaiseau', 'Dourdan']], ['95', "Val-d'Oise", ['Pontoise', 'Sarcelles', 'Gonesse']],
  ['971', 'Guadeloupe', ['Basse-Terre', 'Pointe-à-Pitre', 'Le Moule']], ['972', 'Martinique', ['Fort-de-France', 'Le Lamentin', 'Le Marin']],
  ['973', 'Guyane', ['Cayenne', 'Saint-Laurent-du-Maroni', 'Kourou']], ['974', 'La Réunion', ['Saint-Denis', 'Saint-Pierre', 'Saint-Paul']],
  ['976', 'Mayotte', ['Mamoudzou', 'Dzaoudzi', 'Koungou']],
];
export const GGDS = DEPTS.map(([code, dep, communes]) => ({ ggd: 'GGD ' + code, dep, communes }));

// Thématiques (bruit de fond) — variées. Gabarits GIPASP-safe, jetons {PLAQUE}/{IDENTITE}.
export const THEMES = [
  { theme: 'violences urbaines', titres: ['Rodéos motorisés récurrents', 'Attroupement et jets de projectiles'],
    mots: ['rodéo', 'deux-roues', 'nuisances', 'quartier'],
    textes: ["Depuis une dizaine de jours, signalements répétés de rodéos motorisés en soirée, principalement entre 21h00 et minuit, sur les axes desservant le quartier et ses abords immédiats. Un deux-roues non homologué (50cc débridé) apparaît impliqué à plusieurs reprises ; immatriculation partielle relevée par un riverain : {PLAQUE}. Les individus, décrits comme de jeunes majeurs résidant vraisemblablement sur place, adoptent une conduite dangereuse (roues arrière prolongées, remontées de file, franchissements de feux) et se dispersent à l'approche des patrouilles. Aucun n'a pu être formellement identifié à ce stade. Nuisances sonores nocturnes et sentiment d'insécurité croissants rapportés par plusieurs familles ; phénomène à surveiller et à recouper avec les mains courantes des unités voisines.",
             "Attroupement d'une dizaine d'individus en début de nuit ayant occasionné des jets de projectiles (bouteilles en verre, pierres) sur la voie publique et en direction d'un abribus. Aucun blessé ni dégât matériel majeur constaté, la dispersion étant intervenue spontanément à l'arrivée des premiers moyens. Un véhicule utilitaire de couleur claire (immatriculation {PLAQUE}) a été aperçu stationnant à proximité immédiate, puis quittant les lieux au même moment ; lien à confirmer. Le mode opératoire et le créneau horaire recoupent d'autres épisodes signalés dans le secteur les jours précédents. Aucune revendication. Élément à rapprocher des remontées locales et à intégrer au suivi du quartier."] },
  { theme: 'trafic de stupéfiants', titres: ['Point de deal présumé', 'Va-et-vient suspects nocturnes'],
    mots: ['stupéfiants', 'deal', 'guet'],
    textes: ["Va-et-vient nocturnes réguliers observés autour d'un hall d'immeuble, principalement en fin de soirée et en début de nuit, avec présence de guetteurs postés en entrée de rue et en pied d'immeuble donnant l'alerte à l'approche de tout véhicule. Une berline sombre (immatriculation {PLAQUE}) effectue des passages courts et répétés, marquant de brefs arrêts avant de repartir. Les échanges, rapides et discrets, sont cohérents avec une activité de vente au détail. Plusieurs habitants font état d'un climat d'intimidation et évitent désormais les parties communes en soirée. Aucun mis en cause identifié à ce jour ; renseignement à recouper avec les doléances déjà enregistrées sur le secteur.",
             "Transactions rapides signalées de manière récurrente sur un parking de zone commerciale en périphérie, en journée comme en soirée. Deux individus reviennent régulièrement, dont l'un circulant à scooter (immatriculation {PLAQUE}) et l'autre à pied, effectuant des contacts brefs avec des occupants de véhicules qui repartent aussitôt. Le fonctionnement (rendez-vous minutés, points de rencontre changeants) évoque une logistique de livraison. Aucun produit ni somme n'a été constaté directement. Éléments d'ambiance à confirmer par surveillance et à rapprocher des renseignements des unités limitrophes."] },
  { theme: 'atteintes aux élus', titres: ['Menaces envers un élu local', 'Dégradation de permanence'],
    mots: ['élu', 'menaces', 'permanence'],
    textes: ["Un élu local fait état de la réception, à sa permanence et à son domicile, de plusieurs courriers anonymes au ton menaçant sur une période courte. Les écrits, au vocabulaire revendicatif, sont explicitement liés à un projet d'aménagement contesté sur la commune. Aucune menace de passage à l'acte datée n'y figure, mais la répétition et la montée en intensité inquiètent l'intéressé, qui a modifié ses habitudes. Aucun auteur n'est identifié à ce stade ; un rapprochement est à effectuer avec les prises de position publiques récentes sur le dossier. Les originaux ont été conservés. Renseignement à suivre et à recouper avec d'éventuels faits similaires visant d'autres élus du secteur.",
             "Inscriptions hostiles et injurieuses taguées durant la nuit sur la façade et la vitrine d'une permanence d'élu, visant nommément l'intéressé et un projet local. Dégradations découvertes à l'ouverture ; aucun témoin direct. Un véhicule de tourisme (immatriculation {PLAQUE}) a été aperçu par un riverain quittant les lieux à vive allure peu avant, sans que le lien soit établi. Le mode opératoire (intervention nocturne, message ciblé) s'inscrit dans un climat de tension autour du dossier concerné. Faits à rapprocher d'autres dégradations à caractère revendicatif signalées récemment ; suivi à assurer."] },
  { theme: 'escroqueries aux personnes âgées', titres: ['Démarchage frauduleux de séniors', 'Faux agents à domicile'],
    mots: ['escroquerie', 'personnes âgées', 'démarchage'],
    textes: ["Plusieurs personnes âgées d'un même secteur ont été démarchées à domicile, sur une courte période, par un individu se présentant comme agent d'un service public et exhibant un badge non vérifiable. Sous prétexte d'un contrôle technique ou administratif urgent, l'homme tente d'obtenir l'accès au logement et de détourner l'attention des occupants. Un véhicule utilitaire blanc (immatriculation {PLAQUE}) est associé à ces passages. Aucune remise de fonds n'est confirmée à ce stade, mais le mode opératoire est caractéristique des équipes itinérantes de faux agents. Les victimes, isolées, n'ont pas toutes conservé de description précise. Renseignement à diffuser en prévention et à recouper avec les faits des communes voisines.",
             "Vague d'appels téléphoniques ciblant des séniors isolés, l'interlocuteur usurpant la qualité d'agent administratif ou bancaire pour instaurer un climat d'urgence. Sous couvert d'une prétendue anomalie sur un compte ou d'un remboursement à régulariser, il cherche à obtenir des coordonnées bancaires, des codes ou un rendez-vous à domicile. Plusieurs personnes rapportent des appels répétés depuis des numéros masqués ou usurpés. Le discours, rodé et insistant, vise à contourner la méfiance des victimes. Aucun préjudice financier n'est confirmé pour l'instant. Phénomène à signaler en prévention et à rapprocher des campagnes d'escroquerie recensées au plan départemental."] },
  { theme: 'dérive sectaire', titres: ['Groupe de développement personnel signalé', 'Emprise sur personne vulnérable'],
    mots: ['emprise', 'communauté', 'vulnérabilité'],
    textes: ["Une famille s'inquiète de l'isolement croissant d'un proche depuis son adhésion à un groupe se présentant comme dédié au 'développement personnel'. Les réunions, fréquentes et tenues en zone rurale au domicile de l'un des membres, s'accompagneraient d'un discours de rupture avec l'entourage et d'une pression financière (contributions, stages payants). Le proche aurait progressivement cessé ses activités habituelles et espacé les contacts familiaux. Aucun élément pénal n'est caractérisé à ce stade, mais les indices d'emprise et de vulnérabilité sont réunis. Situation à évaluer avec prudence et à porter à la connaissance des services compétents ; à recouper avec d'éventuels signalements analogues.",
             "Rassemblement récurrent constaté dans une propriété isolée accueillant, plusieurs fois par semaine, un groupe restreint autour d'un animateur au discours communautaire marqué. Le voisinage rapporte des allées et venues discrètes et la présence de personnes paraissant en situation de vulnérabilité. L'animateur, contrôlé lors d'un déplacement routier, a été identifié comme M./Mme {IDENTITE} ; aucune infraction n'a été relevée à cette occasion. Le fonctionnement (mise à l'écart de l'entourage, ascendant d'une figure centrale) appelle une vigilance particulière. Renseignement à recouper et à suivre dans la durée, sans caractérisation pénale à ce stade."] },
  { theme: 'écologie radicale', titres: ['Repérage sur site industriel', 'Tract appelant au blocage'],
    mots: ['militants', 'blocage', 'site'],
    textes: ["Deux personnes ont été observées photographiant et filmant les accès, clôtures et postes de contrôle d'un site industriel classé, avant de se replier à bord d'un véhicule de tourisme (immatriculation {PLAQUE}) stationné à l'écart. Leur comportement (repérage méthodique des points d'entrée, attention portée aux caméras et aux horaires de rondes) évoque une phase de préparation. En parallèle, une mobilisation visant ce type d'installations est relayée en ligne sur {URL}. Aucune action n'a été engagée sur place à ce jour. Éléments à rapprocher des appels militants en cours et à porter à la connaissance de l'exploitant pour renforcement de la vigilance ; suivi à assurer.",
             "Distribution de tracts sur la voie publique appelant au blocage d'un chantier local présenté comme écologiquement contesté, l'appel étant également relayé par le compte {PSEUDO} ({URL}) annonçant une action à venir. Un participant, contrôlé sur place lors de la distribution, a été identifié : {IDENTITE}, déjà connu(e) pour sa participation à des actions de blocage. Le discours diffusé prône une mobilisation déterminée mais ne comporte pas d'appel explicite à la violence. La date et le lieu précis de l'action annoncée restent à confirmer. Renseignement à recouper avec les mouvements militants régionaux et à intégrer à l'anticipation des troubles à l'ordre public."] },
  { theme: 'radicalisation', titres: ['Changement de comportement signalé', 'Propos préoccupants en ligne'],
    mots: ['signalement', 'comportement', 'réseaux'],
    textes: ["Signalement émanant d'un proche faisant état d'un changement rapide et marqué de comportement chez un individu : rupture avec l'entourage habituel, adoption d'un discours rigoriste et rejet des institutions sur une période courte. L'intéressé, contrôlé lors d'un déplacement routier, a été identifié : {IDENTITE} ; aucune infraction relevée à cette occasion. Le proche décrit un repli progressif et de nouvelles fréquentations mal identifiées. Aucun élément ne permet à ce stade de caractériser un projet ou une menace. Renseignement à évaluer avec mesure, à recouper avec les autres remontées et à porter, le cas échéant, à la connaissance des services spécialisés.",
             "Propos préoccupants relevés sur un réseau social et signalés par un tiers. Le compte {PSEUDO} ({URL}) diffuse un discours de rupture et des contenus valorisant l'affrontement avec les institutions ; le titulaire présumé serait {IDENTITE} (identité à confirmer). La montée en tonalité des publications sur une courte période et l'écho recherché auprès d'un public jeune sont notés. Aucun appel direct et daté à commettre des faits n'est identifié à ce stade. Les contenus sont à évaluer, à horodater et à recouper avant toute qualification. Renseignement à transmettre aux services compétents pour appréciation."] },
  { theme: 'atteintes aux biens agricoles', titres: ['Vols de matériel agricole', 'Intrusions sur exploitation'],
    mots: ['agricole', 'vol', 'exploitation'],
    textes: ["Série de vols de GPS de guidage, de batteries et d'outillage spécialisé commis sur plusieurs exploitations agricoles isolées d'un même secteur, sur une période resserrée. Les faits, commis de nuit, visent des matériels de valeur revendables et dénotent une bonne connaissance des lieux et des équipements ciblés. Une camionnette (immatriculation {PLAQUE}) a été signalée circulant de nuit sur les chemins ruraux desservant les parcelles concernées. Les exploitants déplorent un préjudice cumulé important et un sentiment d'exposition croissant. Aucun auteur interpellé à ce jour. Faits à rapprocher d'une possible équipe itinérante et à recouper avec les vols similaires des départements limitrophes.",
             "Intrusions nocturnes répétées dans des hangars et bâtiments d'exploitation, avec ouverture forcée de portails et fouille des espaces de stockage. Si aucun vol majeur n'est systématiquement constaté, des traces de repérage préalable (marquages, ouvertures testées, passages réitérés) sont relevées, suggérant une préparation en vue de faits ultérieurs. Les propriétaires signalent des chiens agités et des déclenchements d'éclairage plusieurs nuits d'affilée. Aucun auteur n'a été interpellé. Le mode opératoire évoque un secteur en cours de 'reconnaissance'. Renseignement à intégrer à la surveillance des zones agricoles isolées et à recouper avec les faits voisins."] },
  { theme: 'hooliganisme', titres: ['Tensions autour d\'une rencontre sportive', 'Groupe de supporters à risque'],
    mots: ['supporters', 'rencontre', 'ordre public'],
    textes: ["En marge d'une rencontre sportive, un groupe de supporters a été signalé pour un comportement agressif aux abords de l'enceinte : usage de fumigènes, provocations et échauffourées évitées de justesse grâce au dispositif en place. Un individu, contrôlé à cette occasion, a été identifié : {IDENTITE}, déjà connu pour des faits similaires. Des tensions préexistantes avec un groupe rival sont rapportées et pourraient ressurgir lors des prochaines échéances. Aucune interpellation pour violences à ce stade. Renseignement à intégrer à la préparation des futurs matchs et à recouper avec les fiches des groupes à risque connus au plan régional.",
             "Déplacement annoncé d'un groupe de supporters classé à risque à l'occasion d'une rencontre à l'extérieur, avec constitution d'un convoi routier repéré sur l'axe principal (dont un véhicule immatriculé {PLAQUE}). Les échanges en amont, relayés dans des espaces de discussion fermés, laissent entrevoir une volonté de confrontation avec les supporters adverses. Les horaires et points de convergence évoquent un rendez-vous coordonné. Aucun incident constaté au moment de la remontée. Éléments à porter à la connaissance des unités concernées le long de l'itinéraire et à recouper avec les renseignements d'ordre public existants."] },
  { theme: 'trafic d\'armes', titres: ['Détention d\'arme signalée', 'Transaction d\'arme présumée'],
    mots: ['arme', 'détention', 'trafic'],
    textes: ["Signalement faisant état de la détention possible d'une arme de poing par un individu au comportement menaçant, qui l'aurait exhibée ou évoquée à l'occasion d'un différend de voisinage. La source, indirecte, rapporte des propos alarmants tenus par l'intéressé. Un véhicule (immatriculation {PLAQUE}) lui est associé. Aucune arme n'a été constatée directement par les enquêteurs à ce stade, et l'origine comme la nature exacte de l'objet restent à établir. La montée de tension locale justifie une évaluation attentive. Renseignement à recouper avec les antécédents éventuels et à sécuriser en vue d'une possible judiciarisation.",
             "Renseignement faisant état d'une transaction d'arme présumée devant intervenir sur un parking isolé, à l'écart des zones fréquentées et sur un créneau discret. Un participant, contrôlé à proximité, a été identifié : {IDENTITE}. Les modalités décrites (rendez-vous bref, remise d'un objet volumineux dissimulé, méfiance marquée des protagonistes) sont cohérentes avec un échange clandestin, sans que la nature de l'objet soit établie. Aucune saisie n'a été opérée. La fiabilité de la source reste à confirmer. Élément à recouper d'urgence avec les renseignements relatifs au trafic d'armes dans le secteur."] },
];

// Jours couverts par le seed déterministe (le nightly, lui, date au jour du run).
export const JOURS = ['2026-07-17', '2026-07-18', '2026-07-19', '2026-07-20', '2026-07-21', '2026-07-22'];

// 3 TRAMES de signaux faibles NATIONALES : phénomène mineur mais récurrent et dispersé sur
// plusieurs départements. Signature = mot-clé rare non partagé avec le bruit. Marqueur technique
// 'signal-faible:<code>' = hook de test (exclu de la découverte agrégée).
export const TRAMES = [
  { code: 'demarchage-faux-agent', theme: 'escroqueries aux personnes âgées',
    titre: 'Démarchage par faux agent — mode opératoire identique',
    codes: ['24', '33', '47', '17', '16', '87', '19', '46', '82', '31', '64', '40'],
    texte: "Personne âgée démarchée à son domicile par un homme se présentant comme agent d'un organisme officiel, muni d'un gilet et d'un badge non vérifiables. Même mode opératoire que d'autres faits récents : prétexte d'un contrôle urgent (compteur, canalisation, mise aux normes), insistance pour entrer, tentative de détourner l'attention pendant qu'un second individu resterait à l'extérieur. Un véhicule utilitaire blanc (immatriculation {PLAQUE}) est associé au passage, et une fausse carte professionnelle a été présentée. La victime, isolée, n'a pas toujours conservé de description précise ni relevé l'immatriculation complète. Fait isolé en apparence, mais dont la signature recoupe des signalements dispersés sur d'autres communes ; à recouper au plan départemental.",
    mots: ['faux agent', 'utilitaire blanc', 'personnes âgées'] },
  { code: 'survol-drone-sensible', theme: 'écologie radicale',
    titre: 'Survol de drone au-dessus d\'un site sensible',
    codes: ['13', '83', '06', '30', '34', '11', '84', '2A', '2B', '66'],
    texte: "Survol répété d'un drone au-dessus d'un site sensible (dépôt d'hydrocarbures, emprise clôturée, infrastructure) en soirée et à la tombée de la nuit, sur plusieurs occurrences rapprochées. Les trajectoires, lentes et stationnaires au-dessus des points d'intérêt, évoquent une manœuvre de reconnaissance plutôt qu'un usage de loisir. Aucun télépilote n'a pu être localisé, l'appareil disparaissant dès l'arrivée des moyens. Un véhicule de tourisme (immatriculation {PLAQUE}) a été observé stationnant à proximité au moment des faits, occupant à bord, puis quittant les lieux. Aucune atteinte matérielle constatée. Fait en apparence localisé, mais dont la signature recoupe des survols signalés sur d'autres emprises sensibles du secteur ; à recouper d'urgence au plan zonal.",
    mots: ['drone', 'survol', 'site sensible'] },
  { code: 'reperage-exploitation', theme: 'atteintes aux biens agricoles',
    titre: 'Repérage suspect en zone d\'exploitation',
    codes: ['53', '49', '85', '72', '35', '56', '22', '29', '44', '50'],
    texte: "Véhicule de tourisme (immatriculation {PLAQUE}) observé à plusieurs reprises stationnant à proximité d'exploitations agricoles isolées, ses occupants paraissant observer les hangars, les accès et les matériels entreposés. Le véhicule redémarre systématiquement à l'arrivée d'un tiers ou de l'exploitant, ce qui écarte l'hypothèse d'un simple arrêt fortuit. Aucun vol ni dégradation n'est constaté ce jour : le comportement relève de l'observation et du repérage préalable. Les exploitants concernés font état d'un sentiment de surveillance inhabituel. Fait apparemment isolé, mais dont la signature recoupe des repérages signalés autour d'autres exploitations du secteur ; à recouper et à intégrer à la surveillance des zones agricoles.",
    mots: ['exploitation agricole', 'repérage', 'hangar'] },
];

// --- Vérité terrain : défauts plantés -------------------------------------------------------
// Le corpus est CONFORME PAR CONSTRUCTION (cf. en-tête) : sans défauts, l'audit afficherait
// 100 % et ne prouverait rien. Chaque mutation part d'une trame EXISTANTE — jamais d'un
// gabarit neuf : une fiche défectueuse écrite « à part » se reconnaîtrait au style, et
// l'agent apprendrait une forme au lieu de raisonner sur le fond.
// C10 (péremption à un an) est absent : la purge glissante à 90 jours le rend inatteignable.

export const MUTATIONS = [
  { code: 'D11', applique: (f) => ({ ...f,
      texte: f.texte + " Il se dit dans le voisinage que l'intéressé prépare d'autres actions." }) },
  { code: 'D12', applique: (f) => ({ ...f,
      texte: f.texte + " Individu manifestement nuisible et sans le moindre scrupule, au comportement inquiétant." }) },
  // A1 : on désamorce les faits de la trame — il ne reste plus d'atteinte à caractériser,
  // alors que la fiche continue de nommer des personnes.
  { code: 'A1',  applique: (f) => ({ ...f,
      texte: f.texte.replace(/\.\s*$/, '') + ". Vérification faite, il s'agit d'un différend de voisinage relatif à une haie mitoyenne : aucune violence, aucune menace, médiation acceptée par les deux parties." }) },
  { code: 'A4',  applique: (f) => ({ ...f,
      texte: f.texte + " Était également présente sur les lieux Mme Julie LEROY, commerçante du quartier, qui n'a fait que constater la scène depuis sa vitrine." }) },
  { code: 'B5',  applique: (f) => ({ ...f,
      texte: f.texte + " L'intéressé, d'origine maghrébine, suit un traitement pour dépression depuis deux ans selon son entourage." }) },
  { code: 'B6',  applique: (f) => ({ ...f,
      texte: f.texte + " Son compte est accessible avec le mot de passe communiqué par un tiers : « soleil2026 »." }) },
  { code: 'B7',  applique: (f) => ({ ...f,
      texte: f.texte + " Son épouse est aide-soignante à l'hôpital, ses deux enfants sont scolarisés en primaire, sa belle-mère réside au domicile et perçoit une pension de réversion." }) },
  // C9 : on rattache la trame à un mineur de moins de 13 ans, sans réécrire les faits.
  { code: 'C9',  applique: (f) => ({ ...f,
      texte: f.texte + " Parmi les personnes concernées figure un collégien de 12 ans, scolarisé dans l'établissement voisin, dont les parents ont été reçus." }) },
];

// Applique `combien` mutations sur des fiches tirées dans le lot, et marque chaque fiche
// mutée d'un mot-clé technique `defaut:<code>` — même mécanisme que `signal-faible:<code>`.
// Ce mot-clé ne doit JAMAIS atteindre un prompt (cf. audit/fragments.mjs, liste blanche).
export function appliquerDefauts(fiches, rand, combien) {
  const n = Math.min(combien, fiches.length);
  const pris = new Set();
  for (let i = 0; i < n; i++) {
    let idx = Math.floor(rand() * fiches.length);
    while (pris.has(idx)) idx = (idx + 1) % fiches.length;
    pris.add(idx);
    const mut = MUTATIONS[i % MUTATIONS.length];
    fiches[idx] = mut.applique(fiches[idx]);
    fiches[idx].mots = [...fiches[idx].mots, `defaut:${mut.code}`];
  }
  return fiches;
}
