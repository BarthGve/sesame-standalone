import { champsCategorie } from "./catalogue";
import type { Champ, CategorieCode, SousTypeTransport, IdentificationResult, ObjetSaisi } from "./types";

// Reconstruit la liste des champs pour une (catégorie, sous-type), en reportant
// les valeurs existantes dont la `cle` est encore présente dans le nouveau catalogue.
export function recomputeChamps(
  prev: Champ[],
  categorie: CategorieCode,
  sousType?: SousTypeTransport
): Champ[] {
  const prevByCle = new Map(prev.map((c) => [c.cle, c]));
  return champsCategorie(categorie, sousType).map((def) => {
    const existing = prevByCle.get(def.cle);
    const valeur = existing?.valeur ?? null;
    const rempli = valeur != null && String(valeur).trim() !== "";
    return {
      cle: def.cle,
      libelle: def.libelle,
      valeur,
      source: rempli ? "deduit" : "a_completer",
      obligatoire: def.obligatoire ?? false,
    };
  });
}

// Construit un ObjetSaisi éditable depuis un résultat d'identification IAKA.
export function buildDraftFrom(res: IdentificationResult, id: string): ObjetSaisi {
  return {
    id,
    categorie: res.categorie,
    sousType: res.sousType,
    confiance: res.confiance,
    categoriesAlternatives: res.categoriesAlternatives,
    numeroScelle: "",
    situation: "SAISI_SOUS_SCELLE",
    lieu: "",
    champs: res.champs,
    estimationPrix: res.estimationPrix,
  };
}
