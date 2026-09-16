// Grille de contrôle GIPASP. Source unique des codes, libellés et gravités.
//
// PÉRIMÈTRE : la grille ne contrôle QUE ce qu'une FRS contient réellement — son texte et
// ses métadonnées (unité, GGD, commune, date de rédaction). Le « motif d'enregistrement »
// de R. 236-22, I, 4° n'est pas un champ de la FRS : il se rattache à la fiche entité, et
// le référent national recommande précisément d'en faire une saisie obligatoire dans une
// version ultérieure de l'application. Les deux critères qui en dépendaient (C2 motif non
// renseigné, A3 motif incohérent) ont donc été retirés : contrôler un champ inexistant
// produit un écart imputable à personne.
//
// C8 (faits non datés) a été retiré pour une raison voisine. La durée de conservation se
// calcule, dans l'application, à partir de la DATE DE CRÉATION de la fiche — la date du
// recueil du renseignement —, pas à partir de la date des faits narrés. Le référent national
// le constate (§ III.3.2) et le juge fragile au regard de R. 236-24, qui vise « le dernier
// événement » ; mais cet écart tient à l'outil, pas au rédacteur, et la date de création est
// toujours connue. Il ne reste donc rien à contrôler sur la datation : C10 suffit, et il se
// calcule précisément sur cette date de création.
// La gravité est TOUJOURS dérivée du code côté serveur : la sortie d'un agent
// n'est jamais autorisée à la fixer (un modèle ne doit pas pouvoir inflater une gravité).

// `fondement` est l'article que CE critère met en cause. Il sert de valeur par défaut
// aux écarts détectés en SQL — un écart structurel doit citer son article comme les autres,
// c'est tout l'argument de l'outil : un verdict sourcé est opposable, un verdict de style non.
const CRITERES = {
  A1:  { libelle: "Atteinte à la sécurité publique non caractérisée", gravite: 'bloquant', famille: 'legalite',   fondement: 'CSI R. 236-21' },
  A4:  { libelle: "Personne citée hors des catégories admises",       gravite: 'majeur',   famille: 'legalite',   fondement: 'CSI R. 236-22, II à IV' },
  B5:  { libelle: "Donnée sensible interdite",                        gravite: 'bloquant', famille: 'donnees',    fondement: 'CSI R. 236-23' },
  B6:  { libelle: "Donnée hors nomenclature R. 236-22",               gravite: 'majeur',   famille: 'donnees',    fondement: 'CSI R. 236-22, I' },
  B7:  { libelle: "Données excessives au regard des faits rapportés", gravite: 'mineur',   famille: 'donnees',    fondement: 'CSI R. 236-30' },
  C9:  { libelle: "Minorité non traitée (âge < 13 ans ou non repérable)", gravite: 'bloquant', famille: 'redaction', fondement: 'CSI R. 236-25' },
  C10: { libelle: "Fiche au-delà de dix ans de conservation",         gravite: 'mineur',   famille: 'structurel', fondement: 'CSI R. 236-24' },
  D11: { libelle: "Origine de l'information non identifiable",        gravite: 'mineur',   famille: 'redaction',  fondement: 'CSI R. 236-30' },
  D12: { libelle: "Défaut de factualité (jugement de valeur)",        gravite: 'mineur',   famille: 'redaction',  fondement: 'CSI R. 236-30' },
};

function estCodeValide(code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(CRITERES, code);
}

function graviteDe(code) {
  if (!estCodeValide(code)) throw new Error(`Code de critère inconnu : ${code}`);
  return CRITERES[code].gravite;
}

function fondementDe(code) {
  if (!estCodeValide(code)) throw new Error(`Code de critère inconnu : ${code}`);
  return CRITERES[code].fondement;
}

module.exports = { CRITERES, estCodeValide, graviteDe, fondementDe };
