// Modèle de domaine — saisies en perquisition.
// Aligné sur schema_objets_perquisition_cti.sql et agents_iaka_perquisition.md.

export type CategorieCode =
  | "ARME"
  | "HORLOGERIE"
  | "MULTIMEDIA"
  | "BIJOU"
  | "DOCUMENT"
  | "DROGUE"
  | "EXPLOSIF"
  | "MUNITION"
  | "METAUX"
  | "MONNAIE"
  | "MOYEN_PAIEMENT"
  | "TRANSPORT"
  | "DIVERS";

export type SousTypeTransport =
  | "VEHICULE_TERRESTRE"
  | "AERONEF"
  | "BATEAU"
  | "MOTEUR_BATEAU"
  | "CONTAINER"
  | "EQUIP_NON_ROULANT";

export type SourceChamp = "deduit" | "a_completer";

/** Un champ de fiche : pré-rempli par l'IA (deduit) ou à saisir (a_completer). */
export interface Champ {
  cle: string;
  libelle: string;
  valeur: string | null;
  source: SourceChamp;
  obligatoire: boolean;
}

export interface EstimationPrix {
  prixBas: number | null;
  prixMoyen: number | null;
  prixHaut: number | null;
  devise: string;
  hypotheses: string[];
  sources: { site: string; url: string; prix: number | null }[];
  confiance: number;
  avertissement: string;
}

export type SituationScelle = "SAISI_SOUS_SCELLE" | "SAISI_NON_SCELLE";

export interface ObjetSaisi {
  id: string;
  categorie: CategorieCode;
  sousType?: SousTypeTransport;
  confiance: number;
  categoriesAlternatives?: { categorie: CategorieCode; confiance: number }[];
  photo?: string; // clé MinIO (via /api/photo?key=)
  numeroScelle: string;
  situation: SituationScelle;
  lieu: string; // lieu de découverte (suggéré ou libre)
  champs: Champ[];
  estimationPrix?: EstimationPrix;
}

/** Résultat renvoyé par l'agent d'identification (routeur + spécialiste). */
export interface IdentificationResult {
  categorie: CategorieCode;
  sousType?: SousTypeTransport;
  confiance: number;
  categoriesAlternatives?: { categorie: CategorieCode; confiance: number }[];
  champs: Champ[];
  estimationPrix?: EstimationPrix;
}

export interface Intervenant {
  role: "assistant" | "accompagnant" | "temoin";
  grade?: string;
  nom: string;
}

export type TypeLieu = "DOMICILE" | "LOCAL_PRO" | "VEHICULE" | "AUTRE";

export interface Perquisition {
  una?: string; // "unite/numero/annee" — UNA de rattachement
  adresse: string;
  commune: string;
  codePostal: string;
  insee?: string;
  dateDebut: string;
  dateFin?: string;
  typeLieu: TypeLieu;
  perquisitionne: string;
  opj: string;
  intervenants: string[]; // "Grade Nom", saisie libre en V1
  pieces: string[]; // emplacements déclarés → suggestions de lieu de découverte
}

/** Un objet est complet si tous ses champs obligatoires (y c. scellé + lieu) sont remplis. */
export function objetComplet(o: ObjetSaisi): boolean {
  if (!o.numeroScelle.trim() || !o.lieu.trim()) return false;
  return o.champs.every((c) => !c.obligatoire || (c.valeur ?? "").trim() !== "");
}
