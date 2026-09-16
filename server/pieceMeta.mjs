// Métadonnées déterministes d'une pièce de procédure. Module pur : aucun réseau,
// aucun disque, aucune horloge. Voir docs/superpowers/specs/2026-07-20-ariane-metadonnees-pieces-design.md
//
// Principe directeur : aucune valeur n'est devinée. Un code inconnu donne "autre"
// et un avertissement qui le nomme, pour que le vocabulaire reel se decouvre a
// l'usage au lieu d'etre silencieusement ecrase.

// Vocabulaire releve sur des exports LRPGN reels, jamais suppose. Un code absent
// d'ici donne "autre" et un avertissement qui le nomme, de sorte que le vocabulaire
// se complete a l'usage plutot que par conjecture.
//
// PVPlainte est classe en "audition" : un proces-verbal de plainte est une audition
// de victime dans sa forme, et se range avec elles sur la ligne de temps.
const TYPES_PIECE = {
  PVAudition: "audition",
  PVAuditionGAV: "audition",          // audition menee pendant la garde a vue
  PVPlainte: "audition",
  PVGardeAVue: "gav",
  PVTransportConstatations: "transport",
};
const ROLES_FICHIER = {
  VIC: "victime",
  TEM: "temoin",
  MEC: "mis_en_cause",
};

// Segments strictement alphabetiques : un chiffre, un espace ou un tiret signale
// un gabarit qu'on ne sait pas decouper. Dans le doute → null → chemin LLM actuel.
const GRAMMAIRE = /^(\d{8})_(\d{4})_([A-Za-z]+)_([A-Za-z]+)_([A-Za-z]+)_([A-Za-z]+)$/;

const sansExtension = (nom) => nom.replace(/\.[^.]+$/, "");

export function parseNomFichier(filename) {
  if (typeof filename !== "string") return null;
  const m = GRAMMAIRE.exec(sansExtension(filename));
  if (!m) return null;
  const [, aaaammjj, hhmm, typePiece, codeRole, nom, prenom] = m;

  const annee = aaaammjj.slice(0, 4), mois = aaaammjj.slice(4, 6), jour = aaaammjj.slice(6, 8);
  const heures = hhmm.slice(0, 2), minutes = hhmm.slice(2, 4);
  if (+mois < 1 || +mois > 12 || +jour < 1 || +jour > 31) return null;
  if (+heures > 23 || +minutes > 59) return null;

  const avertissements = [];
  const typeActe = TYPES_PIECE[typePiece];
  if (!typeActe) avertissements.push(`Type de piece inconnu : ${typePiece}`);
  const role = ROLES_FICHIER[codeRole];
  if (!role) avertissements.push(`Role inconnu : ${codeRole}`);

  return {
    date: `${annee}-${mois}-${jour}`,
    heure: `${heures}:${minutes}`,
    typeActe: typeActe ?? "autre",
    role: role ?? "autre",
    nom, prenom, avertissements,
  };
}

// Cle de coreference. Accents retires, casse repliee, apostrophes (droite ou
// typographique) supprimees plutot que traitees en separateur — "d'Artagnan"
// est un patronyme lie, pas deux jetons ; le confondre avec "Artagnan" seul
// serait une sur-fusion (deux patronymes distincts). Le reste est decoupe sur
// tout ce qui n'est pas une lettre, et TOUS les jetons sont retenus, y compris
// ceux d'une seule lettre : une initiale discrimine — "Jean M. DUPONT" et
// "Jean P. DUPONT" sont deux personnes, les ecarter les fusionnerait a tort.
// En revanche un nom reduit uniquement a des initiales (aucun jeton de 2
// lettres ou plus) n'identifie personne : la cle serait trop faible pour
// fonder une fusion, donc on renvoie null plutot qu'une cle inexploitable.
export function cleNoyau(nomComplet) {
  if (typeof nomComplet !== "string") return null;
  const jetons = nomComplet
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/['’]/g, "")
    .split(/[^A-Z]+/)
    .filter((j) => j.length > 0);
  if (!jetons.some((j) => j.length >= 2)) return null;
  return [...new Set(jetons)].sort().join("|");
}

// Du plus engageant au moins engageant. Sert a choisir le role principal d'une
// partie vue sous plusieurs statuts au fil de la procedure (spec §4.4). Exportee
// pour rester l'unique source de cet ordre : ariane.mjs la reutilise plutot que
// de dupliquer la table (deux tables qui divergeraient seraient un piege).
const ORDRE_ROLES = ["mis_en_cause", "victime", "requis", "temoin", "magistrat", "enqueteur", "autre"];
export const rangRole = (role) => {
  const i = ORDRE_ROLES.indexOf(role);
  return i === -1 ? ORDRE_ROLES.length : i;
};

// Le vocabulaire des roles est ferme (meme liste que l'ordre d'engagement ci-dessus).
// Un role_apparent invente par le MAP ("plaignant", "greffier") est ramene a "autre"
// des son enregistrement : il ne peut donc ressortir ni dans le role principal d'une
// partie ni dans son historique roles[]. Sans cette borne, un seul mot hors
// vocabulaire fait echouer validateContract et emporte l'analyse de tout le dossier.
// Exportee pour la meme raison que rangRole : ariane.mjs doit borner le role des
// parties que le REDUCE invente, et deux tables de vocabulaire qui divergeraient
// seraient un piege.
export const normaliserRole = (role) => (ORDRE_ROLES.includes(role) ? role : "autre");

// Une naissance vide (null, undefined, "") n'informe pas : elle est compatible avec
// n'importe quelle autre. Deux naissances renseignees et differentes, en revanche,
// designent deux personnes distinctes.
// Exportee pour la meme raison que rangRole et normaliserRole : appliquerMetaXml
// alimente le discriminant utilise ici, il doit donc apparier selon exactement la
// meme regle. Deux regles qui divergeraient seraient un piege.
const naissanceVide = (n) => n === null || n === undefined || n === "";
export const naissancesCompatibles = (a, b) => naissanceVide(a) || naissanceVide(b) || a === b;

// Destine a l'ecran : les pieces sont a diffusion restreinte, le libelle ne nomme
// donc ni la personne, ni la piece, ni la date concernee.
export const AVERTISSEMENT_HOMONYMES =
  "Homonymes distingués par la date de naissance : une mention sans date n'a pas pu être rattachée";

// Meme regle de diffusion : ni nom, ni cote, ni valeur d'attribut. Le regroupement se
// fait sur le seul noyau du nom quand aucune naissance ne discrimine ; la spec (§4.3)
// assume cette sur-fusion en la disant « detectable ». Or l'agregat ne retient qu'une
// qualite et qu'une adresse par groupe : il efface justement l'indice qui la rendrait
// detectable. Cet avertissement le restitue.
export const AVERTISSEMENT_ATTRIBUTS_DIVERGENTS =
  "Mentions d'un même nom aux qualités ou adresses divergentes : vérifiez qu'il ne s'agit pas d'homonymes";

const attributVide = (v) => v === null || v === undefined || v === "";

// Regroupe les mentions de personnes par cle de coreference. Une mention sans cle
// exploitable n'est jamais fusionnee : elle repart telle quelle vers le REDUCE.
//
// Le noyau du nom ne suffit pas a identifier une personne : deux homonymes de dates
// de naissance differentes sont deux personnes, et les fusionner attribuerait les
// actes de l'une a l'autre — la faute la plus grave du domaine. La naissance est
// donc un discriminant : a noyau egal, deux mentions ne se rejoignent que si leurs
// naissances sont compatibles. Plusieurs groupes peuvent des lors partager le meme
// noyau ; `cle` reste le noyau, a titre informatif, et n'identifie plus un groupe
// a lui seul.
//
// Une mention sans naissance ne tranche rien : si le noyau porte deux homonymes que
// la naissance separe, elle n'est rattachee a aucun des deux — dans le doute, on ne
// fusionne pas. La rattacher au premier groupe compatible ferait dependre le dossier
// du seul ordre des pieces, et lui transmettrait les faits et actes de l'autre. Elle
// part alors dans `sansCle`, ou le REDUCE la traitera avec son contexte plus riche,
// et un avertissement remonte a l'utilisateur.
export function fusionnerMentions(mentions) {
  // Comptage prealable des naissances connues par noyau. Fait avant la boucle pour
  // que la decision ne depende pas de la position de la mention sans date dans la
  // liste : compter au fil de l'eau reproduirait le defaut qu'on corrige.
  const naissancesParCle = new Map();
  for (const m of mentions) {
    const cle = cleNoyau(m.nom);
    if (!cle || naissanceVide(m.naissance)) continue;
    let connues = naissancesParCle.get(cle);
    if (!connues) { connues = new Set(); naissancesParCle.set(cle, connues); }
    connues.add(m.naissance);
  }

  const parCle = new Map(); // noyau → groupes de ce noyau, dans l'ordre de creation
  // Valeurs distinctes non vides de qualite et d'adresse rencontrees dans chaque
  // groupe. Tenues a part de l'objet groupe : c'est un signal d'interface, pas une
  // donnee metier, et les groupes alimentent le prompt du REDUCE.
  const attributsParGroupe = new Map();
  const groupes = [];
  const sansCle = [];
  const avertissements = [];
  for (const m of mentions) {
    const cle = cleNoyau(m.nom);
    if (!cle) { sansCle.push(m); continue; }
    if (naissanceVide(m.naissance) && (naissancesParCle.get(cle)?.size ?? 0) > 1) {
      sansCle.push(m);
      if (!avertissements.includes(AVERTISSEMENT_HOMONYMES)) avertissements.push(AVERTISSEMENT_HOMONYMES);
      continue;
    }
    let candidats = parCle.get(cle);
    if (!candidats) { candidats = []; parCle.set(cle, candidats); }
    // Premier groupe compatible : la naissance du groupe est la premiere non vide
    // de ses membres, donc un groupe encore sans naissance accueille la mention et
    // adopte la sienne.
    let g = candidats.find((c) => naissancesCompatibles(c.naissance, m.naissance));
    if (!g) {
      g = { cle, nom: m.nom, naissance: naissanceVide(m.naissance) ? null : m.naissance, membres: [], roles: [] };
      candidats.push(g);
      groupes.push(g);
    } else if (naissanceVide(g.naissance) && !naissanceVide(m.naissance)) {
      g.naissance = m.naissance;
    }
    g.membres.push(m.gref);
    let attributs = attributsParGroupe.get(g);
    if (!attributs) { attributs = { qualites: new Set(), adresses: new Set() }; attributsParGroupe.set(g, attributs); }
    // Comparaison sur la valeur telle que le MAP l'a lue : mieux vaut un signal de
    // trop, que l'utilisateur ecarte d'un coup d'oeil, qu'une normalisation qui
    // masquerait la divergence que cet avertissement existe pour montrer.
    if (!attributVide(m.qualite)) attributs.qualites.add(m.qualite);
    if (!attributVide(m.adresse)) attributs.adresses.add(m.adresse);
    const role = normaliserRole(m.role_apparent);
    if (!g.roles.some((r) => r.role === role && r.cote === m.cote)) {
      g.roles.push({ role, cote: m.cote });
    }
  }
  // Un seul avertissement pour tout le dossier : il alerte sur un risque de
  // sur-fusion, il n'a pas a se repeter groupe par groupe.
  for (const g of groupes) {
    const a = attributsParGroupe.get(g);
    if (a && (a.qualites.size > 1 || a.adresses.size > 1)) {
      avertissements.push(AVERTISSEMENT_ATTRIBUTS_DIVERGENTS);
      break;
    }
  }
  return {
    groupes: groupes.map((g) => ({
      ...g,
      role: [...g.roles].sort((a, b) => rangRole(a.role) - rangRole(b.role))[0]?.role ?? "autre",
    })),
    sansCle,
    avertissements,
  };
}
