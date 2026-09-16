// Critère déterministe de la grille GIPASP. Il n'en reste qu'UN : l'ancienneté de la fiche.
//
// Les deux autres contrôles SQL (motif non renseigné, date d'événement absente) portaient sur
// des colonnes qui n'existent pas dans une FRS — le motif se rattache à la fiche entité, la
// date d'événement n'est pas saisie. Ils ont été retirés : tout le reste de la grille se lit
// désormais dans le TEXTE, donc par les agents. Fonction PURE (testable sans base).

// C10 applique le seuil du décret : R. 236-24 fixe DIX ans après le dernier événement
// (trois ans pour les mineurs, R. 236-25). Faute de date d'événement saisie, le délai se
// compte sur la date de rédaction — c'est le repli que décrit le référent national (§ III.3.2),
// et il le juge fragile : le front annonce cette limite plutôt que de la masquer.
function buildStructurelQuery(jour) {
  const text = `
    SELECT id AS frs_id, 'C10' AS critere FROM frs
     WHERE date_redaction = $1::date AND date_redaction < $1::date - INTERVAL '10 years'
     ORDER BY frs_id`;
  return { text, values: [jour] };
}

// Variante « à la demande » : le lot est une SÉLECTION d'identifiants, pas une journée. Le
// périmètre n'étant plus borné au jour, C10 devient un contrôle vivant — une fiche ancienne
// peut faire partie de la sélection. Renvoie null sur une liste vide.
function buildStructurelIdsQuery(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const text = `
    SELECT id AS frs_id, 'C10' AS critere FROM frs
     WHERE id = ANY($1::int[]) AND date_redaction < CURRENT_DATE - INTERVAL '10 years'
     ORDER BY frs_id`;
  return { text, values: [ids] };
}

module.exports = { buildStructurelQuery, buildStructurelIdsQuery };
