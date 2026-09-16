// Mock d'identification — remplace temporairement l'appel IAka.
// À substituer par identifyObject() (route proxy /api/identify) à l'incrément suivant.

import { champsCategorie } from "./catalogue";
import type {
  CategorieCode,
  Champ,
  IdentificationResult,
  SousTypeTransport,
} from "./types";

// Valeurs "déduites" de démonstration par catégorie (le reste reste à compléter).
const DEDUITS: Partial<Record<CategorieCode, Record<string, string>>> = {
  TRANSPORT: {
    nature: "VOITURE PARTICULIERE",
    marque: "VOLKSWAGEN",
    modele: "Scirocco",
    couleur: "BLANC",
    nmr_immatriculation: "A-256-LK",
    carrosserie: "COUPE",
  },
  ARME: { nature: "ARME A FEU DE POING", marque: "ADLER", calibre: "9MM" },
  MULTIMEDIA: { nature: "TELEPHONE PORTABLE", marque: "Apple", modele: "iPhone 17 Max" },
  MONNAIE: { nature: "BILLET DE BANQUE", devise: "EURO", valeur_faciale: "10" },
};

function buildChamps(
  categorie: CategorieCode,
  sousType?: SousTypeTransport
): Champ[] {
  const deduits = DEDUITS[categorie] ?? {};
  return champsCategorie(categorie, sousType).map((def) => {
    const raw = deduits[def.cle] ?? null;
    const valeur = raw != null ? String(raw) : null;
    return {
      cle: def.cle,
      libelle: def.libelle,
      valeur,
      source: valeur != null ? "deduit" : "a_completer",
      obligatoire: def.obligatoire ?? false,
    };
  });
}

/** Simule l'identification automatique. `forced` permet de tester une catégorie. */
export function mockIdentify(forced?: CategorieCode): Promise<IdentificationResult> {
  const categorie: CategorieCode = forced ?? "TRANSPORT";
  const sousType: SousTypeTransport | undefined =
    categorie === "TRANSPORT" ? "VEHICULE_TERRESTRE" : undefined;

  const result: IdentificationResult = {
    categorie,
    sousType,
    confiance: 0.94,
    categoriesAlternatives:
      categorie === "TRANSPORT"
        ? [{ categorie: "DIVERS", confiance: 0.04 }]
        : [],
    champs: buildChamps(categorie, sousType),
  };

  if (categorie === "TRANSPORT" && sousType === "VEHICULE_TERRESTRE") {
    result.estimationPrix = {
      prixBas: 8500,
      prixMoyen: 10200,
      prixHaut: 11800,
      devise: "EUR",
      hypotheses: ["Kilométrage supposé ~120 000 km (âge estimé 8 ans) — fourchette élargie."],
      sources: [
        { site: "LaCentrale", url: "#", prix: 10490 },
        { site: "leboncoin", url: "#", prix: 9900 },
        { site: "AutoScout24", url: "#", prix: 11200 },
      ],
      confiance: 0.6,
      avertissement:
        "Estimation indicative non contractuelle. À valider par un expert automobile.",
    };
  }

  return new Promise((resolve) => setTimeout(() => resolve(result), 1100));
}
