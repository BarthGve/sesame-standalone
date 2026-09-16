// Modèle de cote automobile SIMULÉ. Aucune donnée réelle : un catalogue de
// démonstration, une décote par âge et par kilométrage, et des annonces
// comparables engendrées à partir des mêmes paramètres.
//
// DÉTERMINISME : ce module ne doit jamais dépendre de l'horloge ni du hasard.
// L'âge se calcule depuis ANNEE_REFERENCE (et non l'année courante), et les
// annonces sont dérivées d'un hachage des paramètres. Une démonstration dont
// les chiffres bougent d'un jour à l'autre est intestable et ingérable.

const ANNEE_REFERENCE = 2026;
const DECOTE_ANNUELLE = 0.12; // 12 % par an
const KM_PAR_AN = 15000; // usage de référence
const PENALITE_PAR_KM = 0.0000045; // fraction du prix neuf par km au-delà de la référence
const VALEUR_RESIDUELLE = 0.06; // plancher : 6 % du prix neuf
const AMPLITUDE = 0.14; // ±14 % autour du prix moyen
const AGE_PAR_DEFAUT = 8; // âge supposé (en années) quand l'année est absente ou implausible
const ANNEE_MIN_PLAUSIBLE = 1950;

const CATALOGUE = [
  { marque: "VOLKSWAGEN", modele: "SCIROCCO", segment: "COMPACTE", prixNeuf: 32000 },
  { marque: "VOLKSWAGEN", modele: "GOLF", segment: "COMPACTE", prixNeuf: 30000 },
  { marque: "VOLKSWAGEN", modele: "TOUAREG", segment: "SUV", prixNeuf: 68000 },
  { marque: "RENAULT", modele: "CLIO", segment: "CITADINE", prixNeuf: 20000 },
  { marque: "RENAULT", modele: "MEGANE", segment: "COMPACTE", prixNeuf: 28000 },
  { marque: "RENAULT", modele: "KANGOO", segment: "UTILITAIRE", prixNeuf: 24000 },
  { marque: "PEUGEOT", modele: "208", segment: "CITADINE", prixNeuf: 21000 },
  { marque: "PEUGEOT", modele: "308", segment: "COMPACTE", prixNeuf: 29000 },
  { marque: "PEUGEOT", modele: "3008", segment: "SUV", prixNeuf: 38000 },
  { marque: "CITROEN", modele: "C3", segment: "CITADINE", prixNeuf: 19000 },
  { marque: "BMW", modele: "SERIE 3", segment: "BERLINE", prixNeuf: 52000 },
  { marque: "BMW", modele: "X5", segment: "SUV", prixNeuf: 82000 },
  { marque: "MERCEDES", modele: "CLASSE C", segment: "BERLINE", prixNeuf: 54000 },
  { marque: "AUDI", modele: "A3", segment: "COMPACTE", prixNeuf: 36000 },
  { marque: "AUDI", modele: "Q5", segment: "SUV", prixNeuf: 62000 },
  { marque: "FORD", modele: "FIESTA", segment: "CITADINE", prixNeuf: 19500 },
  { marque: "TOYOTA", modele: "YARIS", segment: "CITADINE", prixNeuf: 22000 },
  { marque: "DACIA", modele: "SANDERO", segment: "CITADINE", prixNeuf: 15000 },
];

const PRIX_SEGMENT = {
  CITADINE: 19000,
  COMPACTE: 29000,
  BERLINE: 48000,
  SUV: 55000,
  UTILITAIRE: 25000,
};

const VILLES = ["Angers (49)", "Nantes (44)", "Rennes (35)", "Le Mans (72)", "Tours (37)"];

// Repli de segment (aucun modèle reconnu) : la carrosserie, quand elle est
// fournie et reconnue, oriente le segment plutôt que de retomber systématiquement
// sur COMPACTE. Carrosserie absente ou non reconnue : défaut documenté COMPACTE.
const CARROSSERIE_SEGMENT_DEFAUT = "COMPACTE";
const CARROSSERIE_SEGMENT = {
  CITADINE: "CITADINE",
  BERLINE: "BERLINE",
  BREAK: "BERLINE",
  SUV: "SUV",
  "4X4": "SUV",
  MONOSPACE: "COMPACTE",
  COUPE: "COMPACTE",
  CABRIOLET: "COMPACTE",
  UTILITAIRE: "UTILITAIRE",
  FOURGON: "UTILITAIRE",
};

// Majuscules, sans accent, espaces réduits : « Scirocco » et " scirocco " sont
// le même modèle, et l'agent ne doit pas être pénalisé par une saisie photo.
function normaliser(v) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Hachage stable (FNV-1a 32 bits) : sert à engendrer des annonces variées mais
// reproductibles. `Math.random` casserait le déterminisme.
function empreinte(texte) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const MODELE_PREFIXE_MIN = 3; // en deçà, un préfixe n'identifie rien

function trouverModele(marque, modele) {
  const exact = CATALOGUE.find((c) => c.marque === marque && c.modele === modele);
  if (exact) return { entree: exact, correspondance: "exacte" };

  // Modèle voisin, dans les deux sens, mais pas symétriquement :
  // - « SCIROCCO 2.0 TSI » → SCIROCCO est une version détaillée, légitime quelle
  //   que soit sa longueur (modele.startsWith(c.modele)).
  // - « T » → TOUAREG est une troncature, pas une identification : un préfixe
  //   trop court accepte n'importe quel modèle du catalogue au hasard. On exige
  //   une longueur minimale avant d'accepter c.modele.startsWith(modele).
  const proche = CATALOGUE.find(
    (c) =>
      c.marque === marque &&
      (modele.startsWith(c.modele) ||
        (modele.length >= MODELE_PREFIXE_MIN && c.modele.startsWith(modele)))
  );
  if (proche) return { entree: proche, correspondance: "approchante" };

  return { entree: null, correspondance: "repli_segment" };
}

function arrondi(valeur) {
  return Math.round(valeur / 10) * 10;
}

// Année absente, non numérique, ou hors intervalle plausible (saisie photo mal
// lue) : on retombe sur un âge supposé plutôt que de laisser un NaN se
// propager jusqu'aux prix. `annee` reste l'année réellement utilisée pour le
// calcul, `supposee` dit si elle a été devinée.
function normaliserAnnee(valeur) {
  const annee = Number(valeur);
  const plausible = Number.isInteger(annee) && annee >= ANNEE_MIN_PLAUSIBLE && annee <= ANNEE_REFERENCE + 1;
  if (plausible) return { annee, supposee: false };
  return { annee: ANNEE_REFERENCE - AGE_PAR_DEFAUT, supposee: true };
}

/**
 * Cote simulée d'un véhicule terrestre.
 * @param {{marque?: string, modele?: string, annee?: number|string, km?: number|string, carrosserie?: string}} p
 */
function coter(p) {
  const marque = normaliser(p.marque);
  const modele = normaliser(p.modele);
  const { annee, supposee: anneeSupposee } = normaliserAnnee(p.annee);
  const { entree, correspondance } = trouverModele(marque, modele);

  const age = Math.max(0, ANNEE_REFERENCE - annee);
  // Kilométrage absent : usage moyen supposé, l'hypothèse est dite dans `methode`.
  const kmConnu = Number(p.km) > 0;
  const km = kmConnu ? Number(p.km) : age * KM_PAR_AN;

  const segment = entree
    ? entree.segment
    : CARROSSERIE_SEGMENT[normaliser(p.carrosserie)] || CARROSSERIE_SEGMENT_DEFAUT;
  const prixNeuf = entree ? entree.prixNeuf : PRIX_SEGMENT[segment];

  const apresAge = prixNeuf * Math.pow(1 - DECOTE_ANNUELLE, age);
  const kmExcedent = Math.max(0, km - age * KM_PAR_AN);
  const apresKm = apresAge - prixNeuf * PENALITE_PAR_KM * kmExcedent;
  const moyen = arrondi(Math.max(prixNeuf * VALEUR_RESIDUELLE, apresKm));

  const bas = arrondi(moyen * (1 - AMPLITUDE));
  const haut = arrondi(moyen * (1 + AMPLITUDE));

  const graine = empreinte(`${marque}|${modele}|${annee}|${km}`);
  const nombre = 3 + (graine % 3); // 3 à 5 annonces
  const annonces = Array.from({ length: nombre }, (_, i) => {
    const decalage = ((graine >>> (i * 3)) % 21) - 10; // -10 % à +10 %
    const prix = arrondi(Math.min(haut, Math.max(bas, moyen * (1 + decalage / 100))));
    const kmAnnonce = Math.max(1000, km + (((graine >>> (i * 5)) % 20000) - 10000));
    return {
      titre: `${entree ? entree.marque : marque} ${entree ? entree.modele : modele}`.trim(),
      annee,
      km: kmAnnonce,
      prix,
      lieu: VILLES[(graine + i) % VILLES.length],
      url: `https://cote.local/annonce/${(graine + i).toString(16)}`,
    };
  });

  const methode =
    "Prix catalogue de démonstration, décoté de 12 % par an, corrigé du kilométrage au-delà " +
    `de ${KM_PAR_AN} km/an, puis dispersé pour engendrer des annonces comparables. ` +
    (kmConnu
      ? `Kilométrage fourni : ${km} km.`
      : `Kilométrage non fourni : usage moyen supposé, soit ${km} km.`) +
    (anneeSupposee
      ? ` Année absente ou non plausible : âge supposé de ${AGE_PAR_DEFAUT} ans, soit ${annee}.`
      : "");

  return {
    reference: { marque, modele, annee, km, segment },
    fourchette: { bas, moyen, haut, devise: "EUR" },
    annonces,
    correspondance,
    methode,
    avertissement: "Données de démonstration — source simulée, non contractuelle.",
  };
}

module.exports = { coter, ANNEE_REFERENCE };
