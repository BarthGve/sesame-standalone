// Requêtes de lecture des référentiels de rédaction (GGD, unités, communes, mots-clés).
// Fonctions pures — testables sans base. La validation d'une FRS consomme le même jeu.

function buildRefGgdQuery() {
  return {
    text: `
      SELECT code, code_dept, nom_departement
        FROM ref_ggd
       ORDER BY code_dept`,
    values: [],
  };
}

function buildRefUnitesQuery() {
  return {
    text: `
      SELECT code_ggd, nom
        FROM ref_unite
       ORDER BY code_ggd, nom`,
    values: [],
  };
}

function buildRefMotsClesQuery() {
  return {
    text: `
      SELECT mot
        FROM ref_mot_cle
       ORDER BY mot`,
    values: [],
  };
}

// Communes pour l'autocomplete (formulaire + filtres RENS).
// - Avec code_dept : communes du département ; `q` affine (sous-chaîne).
// - Sans code_dept : recherche nationale, `q` obligatoire (≥ 2 car.) — on ne charge
//   jamais les 35k d'un coup. Limite stricte (défaut 30, max 50).
function buildRefCommunesQuery(codeDept, q, limit) {
  const dept = String(codeDept || '').trim();
  const query = q && String(q).trim() ? String(q).trim() : '';

  if (!dept) {
    if (query.length < 2) return null;
    const borne = Math.min(Math.max(Number(limit) || 30, 1), 50);
    return {
      text: `
        SELECT c.code_insee, c.nom, c.code_dept
          FROM ref_commune c
         WHERE c.nom ILIKE $1
         ORDER BY c.nom
         LIMIT $2`,
      values: [`%${query}%`, borne],
    };
  }

  const values = [dept];
  let filtre = '';
  if (query) {
    values.push(`%${query}%`);
    filtre = ` AND c.nom ILIKE $${values.length}`;
  }
  // Avec département : sans q on peut renvoyer le dept entier (centaines), plafonné.
  const borne = Math.min(Math.max(Number(limit) || (query ? 30 : 500), 1), 2000);
  values.push(borne);
  return {
    text: `
      SELECT c.code_insee, c.nom, c.code_dept
        FROM ref_commune c
       WHERE c.code_dept = $1${filtre}
       ORDER BY c.nom
       LIMIT $${values.length}`,
    values,
  };
}

// Charge le jeu complet utile à la validation d'une FRS (sans les 35k communes d'un coup :
// on ne charge que le département demandé).
function buildRefsPourValidationQuery(codeGgd) {
  const code = String(codeGgd || '').trim();
  const codeDept = code.replace(/^GGD\s*/i, '');
  return {
    ggd: buildRefGgdQuery(),
    unites: {
      text: `SELECT code_ggd, nom FROM ref_unite WHERE code_ggd = $1`,
      values: [code],
    },
    communes: {
      text: `SELECT nom FROM ref_commune WHERE code_dept = $1`,
      values: [codeDept],
    },
    mots: buildRefMotsClesQuery(),
  };
}

module.exports = {
  buildRefGgdQuery,
  buildRefUnitesQuery,
  buildRefMotsClesQuery,
  buildRefCommunesQuery,
  buildRefsPourValidationQuery,
};
