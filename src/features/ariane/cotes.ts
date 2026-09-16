// Affichage des cotes. Une cote LRPGN est un nom de fichier — long, en majuscules,
// et porteur de l'etat civil : « 20260210_1645_PVGardeAVue_MEC_FERREIRA_ANTHONY ».
// Affichee brute sur la fiche d'une personne, elle repete son nom et son role, et
// noie ce que le lecteur cherche vraiment : quand, et quel acte.
//
// On n'en garde donc que la date et la nature de l'acte. La cote complete reste
// disponible en infobulle, pour retrouver la piece dans le dossier papier.

export type CoteAffichable = { date: string | null; libelle: string };

// Vocabulaire releve sur des exports reels, comme cote serveur. Un type absent
// d'ici s'affiche tel quel : on ne traduit jamais un code qu'on n'a pas observe.
const LIBELLES: Record<string, string> = {
  PVAudition: "Audition",
  PVAuditionGAV: "Audition (garde à vue)",
  PVPlainte: "Plainte",
  PVGardeAVue: "Garde à vue",
};

const AVEC_DATE = /^(\d{4})(\d{2})(\d{2})_(\d{4})_([^_]+)/;

export function formatCote(cote: string): CoteAffichable {
  const m = AVEC_DATE.exec(cote ?? "");
  if (!m) return { date: null, libelle: cote ?? "" };
  const [, annee, mois, jour, , type] = m;
  return { date: `${jour}/${mois}/${annee}`, libelle: LIBELLES[type] ?? type };
}
