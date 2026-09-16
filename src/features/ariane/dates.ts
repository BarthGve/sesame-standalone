// Les dates circulent en ISO (AAAA-MM-JJ) dans tout le pipeline : c'est le format
// que produit le MAP, celui vers lequel le XML LRPGN est converti, et celui qui rend
// le tri chronologique équivalent au tri alphabétique (server/ariane.mjs pour la
// période de l'affaire, graph.ts pour les lignes de temps).
//
// Le format français est donc une affaire d'AFFICHAGE seulement. Ne jamais convertir
// avant une comparaison ou un tri.

const ISO_JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MOIS = /^(\d{4})-(\d{2})$/;
// Une année seule (« 2012 ») s'écrit pareil dans les deux formats : elle traverse la
// fonction sans transformation, par le passe-plat final.

const moisValide = (m: string) => +m >= 1 && +m <= 12;
const jourValide = (j: string) => +j >= 1 && +j <= 31;

// Une date que le MAP a produite dans une forme inattendue est rendue telle quelle :
// mieux vaut afficher « vers 2012 » qu'un « undefined/undefined/2012 » trompeur.
//
// Les bornes sont vérifiées, pas seulement la forme : réordonner « 2012-13-45 » en
// « 45/13/2012 » donnerait à une date impossible l'apparence d'une date française.
export function formatDateFr(date: string): string {
  const jour = ISO_JOUR.exec(date);
  if (jour && moisValide(jour[2]) && jourValide(jour[3])) return `${jour[3]}/${jour[2]}/${jour[1]}`;
  const mois = ISO_MOIS.exec(date);
  if (mois && moisValide(mois[2])) return `${mois[2]}/${mois[1]}`;
  return date;
}
