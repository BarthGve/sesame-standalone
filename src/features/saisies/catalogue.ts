// Catalogue des catégories et de leurs champs.
// Source de vérité partagée : rendu de fiche + mock d'identification.
// Aligné sur champs_par_categorie_perquisition.md et le schéma CTI.

import type { CategorieCode, SousTypeTransport } from "./types";

export interface ChampDef {
  cle: string;
  libelle: string;
  obligatoire?: boolean;
}

// `icon` = nom de ligature Material Icons (jamais d'emoji dans le front, cf. CLAUDE.md).
export const CATEGORIES: Record<CategorieCode, { libelle: string; icon: string }> = {
  ARME: { libelle: "Arme", icon: "security" },
  HORLOGERIE: { libelle: "Art / horlogerie", icon: "schedule" },
  MULTIMEDIA: { libelle: "Multimédia", icon: "smartphone" },
  BIJOU: { libelle: "Bijou", icon: "diamond" },
  DOCUMENT: { libelle: "Document", icon: "description" },
  DROGUE: { libelle: "Drogue", icon: "science" },
  EXPLOSIF: { libelle: "Explosif", icon: "warning" },
  MUNITION: { libelle: "Munition", icon: "adjust" },
  METAUX: { libelle: "Métaux", icon: "hardware" },
  MONNAIE: { libelle: "Monnaie", icon: "payments" },
  MOYEN_PAIEMENT: { libelle: "Moyen de paiement", icon: "credit_card" },
  TRANSPORT: { libelle: "Moyen de transport", icon: "directions_car" },
  DIVERS: { libelle: "Objet divers", icon: "inventory_2" },
};

export const SOUS_TYPES_TRANSPORT: Record<SousTypeTransport, string> = {
  VEHICULE_TERRESTRE: "Véhicule terrestre",
  AERONEF: "Aéronef",
  BATEAU: "Bateau",
  MOTEUR_BATEAU: "Moteur de bateau",
  CONTAINER: "Container / équipement industriel",
  EQUIP_NON_ROULANT: "Équipement industriel non roulant",
};

const COMMUNS_BASE: ChampDef[] = [
  { cle: "nature", libelle: "Nature", obligatoire: true },
  { cle: "marque", libelle: "Marque" },
  { cle: "modele", libelle: "Modèle" },
  { cle: "numero", libelle: "Numéro" },
  { cle: "quantite", libelle: "Quantité" },
  { cle: "inscriptions", libelle: "Inscription(s)" },
  { cle: "description", libelle: "Description" },
];

const SPECIFIQUES: Record<CategorieCode, ChampDef[]> = {
  ARME: [
    { cle: "type_arme", libelle: "Type d'arme", obligatoire: true },
    { cle: "calibre", libelle: "Calibre", obligatoire: true },
    { cle: "mode_tir", libelle: "Mode de tir" },
    { cle: "categorie_legale", libelle: "Catégorie légale", obligatoire: true },
  ],
  HORLOGERIE: [
    { cle: "titre", libelle: "Titre" },
    { cle: "matiere", libelle: "Matière" },
    { cle: "artiste", libelle: "Artiste" },
  ],
  MULTIMEDIA: [
    { cle: "imei", libelle: "Numéro IMEI" },
    { cle: "numero_sim", libelle: "Numéro carte SIM" },
    { cle: "code_pin", libelle: "Code PIN" },
    { cle: "code_puk", libelle: "Code PUK" },
    { cle: "numero_appel", libelle: "Numéro d'appel" },
  ],
  BIJOU: [{ cle: "matiere", libelle: "Matière" }],
  DOCUMENT: [
    { cle: "type_document", libelle: "Type de document", obligatoire: true },
    { cle: "pays_delivrance", libelle: "Pays de délivrance" },
    { cle: "date_delivrance", libelle: "Date de délivrance" },
    { cle: "titulaire_nom", libelle: "Nom titulaire" },
    { cle: "titulaire_prenom", libelle: "Prénom titulaire" },
    { cle: "titulaire_date_naissance", libelle: "Date de naissance" },
    { cle: "titulaire_lieu_naissance", libelle: "Lieu de naissance" },
  ],
  DROGUE: [
    { cle: "conditionnement", libelle: "Conditionnement" },
    { cle: "poids", libelle: "Poids", obligatoire: true },
    { cle: "unite_mesure", libelle: "Unité de mesure", obligatoire: true },
    { cle: "remise_douaniere", libelle: "Remise douanière" },
  ],
  EXPLOSIF: [
    { cle: "origine", libelle: "Origine" },
    { cle: "nom_explosif", libelle: "Nom de l'explosif" },
    { cle: "nom_societe", libelle: "Nom de la société" },
    { cle: "couleur", libelle: "Couleur" },
    { cle: "mise_a_feu", libelle: "Mise à feu" },
  ],
  MUNITION: [
    { cle: "origine", libelle: "Origine" },
    { cle: "calibre", libelle: "Calibre", obligatoire: true },
    { cle: "categorie_legale", libelle: "Catégorie légale" },
    { cle: "nombre", libelle: "Nombre de munitions" },
  ],
  METAUX: [
    { cle: "codification_nom", libelle: "Codification / Nom" },
    { cle: "fonction", libelle: "Fonction" },
    { cle: "section_mm2", libelle: "Section (mm²)" },
    { cle: "matiere", libelle: "Matière" },
    { cle: "conditionnement", libelle: "Conditionnement" },
    { cle: "poids_kg", libelle: "Poids matière (kg)" },
  ],
  MONNAIE: [
    { cle: "devise", libelle: "Devise", obligatoire: true },
    { cle: "valeur_faciale", libelle: "Valeur faciale", obligatoire: true },
  ],
  MOYEN_PAIEMENT: [
    { cle: "type_document", libelle: "Type de document", obligatoire: true },
    { cle: "montant", libelle: "Montant" },
    { cle: "devise", libelle: "Devise" },
    { cle: "numero_compte", libelle: "Numéro de compte" },
    { cle: "banque", libelle: "Banque" },
    { cle: "agence", libelle: "Agence" },
    { cle: "titulaire_nom", libelle: "Nom titulaire" },
    { cle: "titulaire_prenom", libelle: "Prénom titulaire" },
  ],
  TRANSPORT: [], // dépend du sous-type — voir champsTransport()
  DIVERS: [{ cle: "autres_numeros", libelle: "Autre(s) numéro(s)" }],
};

const TRANSPORT_COMMUN: ChampDef[] = [
  { cle: "nature", libelle: "Nature", obligatoire: true },
  { cle: "marque", libelle: "Marque" },
  { cle: "modele", libelle: "Modèle" },
  { cle: "nmr_immatriculation", libelle: "N° d'immatriculation" },
  { cle: "pays_immatriculation", libelle: "Pays d'immatriculation" },
  { cle: "numero_serie", libelle: "Numéro de série (VIN)" },
  { cle: "numero_moteur", libelle: "Numéro moteur" },
  { cle: "couleur", libelle: "Couleur" },
  { cle: "description", libelle: "Description" },
];

const TRANSPORT_SPECIFIQUE: Record<SousTypeTransport, ChampDef[]> = {
  VEHICULE_TERRESTRE: [
    { cle: "carrosserie", libelle: "Carrosserie" },
    { cle: "date_mec", libelle: "Date 1ʳᵉ mise en circulation", obligatoire: true },
    { cle: "kilometrage", libelle: "Kilométrage", obligatoire: true },
  ],
  AERONEF: [
    { cle: "nombre_moteurs", libelle: "Nombre de moteurs" },
    { cle: "longueur_m", libelle: "Longueur (m)" },
    { cle: "envergure_m", libelle: "Envergure (m)" },
  ],
  BATEAU: [
    { cle: "nom_bateau", libelle: "Nom du bateau" },
    { cle: "type_propulsion", libelle: "Type de propulsion" },
    { cle: "nombre_moteurs", libelle: "Nombre de moteurs" },
    { cle: "matiere_coque", libelle: "Matière coque" },
    { cle: "longueur_m", libelle: "Longueur (m)" },
  ],
  MOTEUR_BATEAU: [
    { cle: "annee_modele", libelle: "Année modèle" },
    { cle: "type_carburant", libelle: "Type de carburant" },
    { cle: "puissance_cv", libelle: "Puissance (CV)" },
  ],
  CONTAINER: [
    { cle: "numero_bic", libelle: "Numéro BIC" },
    { cle: "longueur_m", libelle: "Longueur (m)" },
    { cle: "hauteur_m", libelle: "Hauteur (m)" },
  ],
  EQUIP_NON_ROULANT: [
    { cle: "couleur", libelle: "Couleur" },
    { cle: "teinte", libelle: "Teinte" },
  ],
};

/** Liste des champs d'une catégorie (transport = communs + sous-type). */
export function champsCategorie(
  categorie: CategorieCode,
  sousType?: SousTypeTransport
): ChampDef[] {
  if (categorie === "TRANSPORT") {
    const spe = sousType ? TRANSPORT_SPECIFIQUE[sousType] : [];
    return [...TRANSPORT_COMMUN, ...spe];
  }
  return [...COMMUNS_BASE, ...SPECIFIQUES[categorie]];
}
