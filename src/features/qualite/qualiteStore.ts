import type { FicheLigne } from "./qualiteApi";

export type File = "toutes" | "supprimer" | "corriger" | "surveiller";

// Les trois files spécialisées PARTITIONNENT le lot : une fiche apparaît dans une seule,
// celle de son écart le plus grave. Sans ça, le contrôleur traiterait deux fois la même
// fiche. « toutes » est la vue d'ensemble, pas une quatrième file : elle rend le lot entier,
// dans l'ordre du rapport (le plus grave d'abord).
export function filtrerParFile(fiches: FicheLigne[], file: File): FicheLigne[] {
  if (file === "toutes") return fiches;
  const cible = { supprimer: "bloquant", corriger: "majeur", surveiller: "mineur" } as const;
  return fiches.filter((f) => f.gravite_max === cible[file]);
}

export const LIBELLE_FILE: Record<File, string> = {
  toutes: "Toutes",
  supprimer: "À supprimer",
  corriger: "À corriger",
  surveiller: "À surveiller",
};

// Un audit produit des centaines de fiches en écart : la liste se lit par pages, sinon le
// navigateur rend un mur et le contrôleur ne sait pas où il en est.
export const PAR_PAGE = 25;

export function page<T>(lignes: T[], rang: number): T[] {
  return lignes.slice(rang * PAR_PAGE, (rang + 1) * PAR_PAGE);
}

export function nombrePages(total: number): number {
  return Math.max(1, Math.ceil(total / PAR_PAGE));
}
