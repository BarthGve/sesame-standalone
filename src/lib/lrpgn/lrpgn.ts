// Mapping du XML LRPGN (racine <Procedure>) vers les seules données utiles à la
// relecture d'une audition. Le schéma autorise N personnes et N faits.
//
// Volontairement ABSENTS du type : téléphone, adresse personnelle, profession,
// situation familiale, consentement, coordonnées GPS. Ils sont dans le XML mais
// n'aident pas la relecture et n'ont pas à s'afficher.

export type PersonneContexte = {
  nom: string;
  prenom: string;
  naissanceDate: string;
  naissanceLieu: string;
  implication: string;
  nationalite: string;
};

export type FaitContexte = {
  libelle: string;
  natinf: string;
  debut: string;
  fin: string;
  localisation: string;
  commune: string;
  codePostal: string;
};

export type ContexteProcedure = {
  personnes: PersonneContexte[];
  faits: FaitContexte[];
  procedure: {
    numero: string;
    annee: string;
    unite: string;
    typeEnquete: string;
    dateActe: string;
  };
  enqueteurs: { nom: string; qualite: string }[];
};

function txt(racine: ParentNode, balise: string): string {
  return racine.querySelector(balise)?.textContent?.trim() ?? "";
}

export function parseLrpgn(xml: string): ContexteProcedure | null {
  try {
    if (!xml.trim()) return null;
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) return null;
    if (doc.documentElement?.nodeName !== "Procedure") return null;

    return {
      personnes: Array.from(doc.querySelectorAll("Personnes_Physiques > Personne")).map((p) => ({
        nom: txt(p, "Personne_Nom"),
        prenom: txt(p, "Personne_Prenom"),
        naissanceDate: txt(p, "Personne_Naissance_Date"),
        naissanceLieu: txt(p, "Personne_Naissance_Lieu"),
        implication: txt(p, "Personne_Implication"),
        nationalite: txt(p, "Personne_Nationalite"),
      })),
      faits: Array.from(doc.querySelectorAll("Faits > Fait")).map((f) => ({
        libelle: txt(f, "Libelle_Fait"),
        natinf: txt(f, "Natinf"),
        debut: txt(f, "Periode_Affaire_Debut"),
        fin: txt(f, "Periode_Affaire_Fin"),
        localisation: txt(f, "Localisation_Fait"),
        commune: txt(f, "Commune_Fait"),
        codePostal: txt(f, "Code_Postal_Commune_Fait"),
      })),
      procedure: {
        numero: txt(doc, "Procedure_Numero"),
        annee: txt(doc, "Procedure_Annee"),
        unite: txt(doc, "Unite_L4"),
        typeEnquete: txt(doc, "Enquete_Type"),
        dateActe: txt(doc, "Acte_Enquete_Date"),
      },
      // Le second <Enqueteur> du schéma ne porte qu'un article de code : sans nom,
      // il n'a rien à afficher.
      enqueteurs: Array.from(doc.querySelectorAll("Enqueteurs > Enqueteur"))
        .map((e) => ({ nom: txt(e, "Enqueteur_Nom"), qualite: txt(e, "Enqueteur_Qualite") }))
        .filter((e) => e.nom),
    };
  } catch {
    return null;
  }
}
