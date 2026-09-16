// Validation d'une FRS saisie dans l'application, et requêtes de son insertion.
//
// FRONTIÈRE DE CONFIANCE : ce corps vient d'un navigateur, par une API joignable depuis
// Internet. Rien n'est écrit sans être passé par ici — et les refus sont NOMMÉS, pour que le
// rédacteur sache quel champ reprendre plutôt que de perdre son texte sur un 500 muet.
//
// Les rattachements et mots-clés sont validés contre les RÉFÉRENTIELS (ref_ggd, ref_unite,
// ref_commune, ref_mot_cle) — une seule source pour le formulaire et le serveur.

const MAX = { titre: 200, texte: 8000, motsCles: 10, motCle: 40 };

const OBLIGATOIRES = ['titre', 'unite', 'code_ggd', 'departement', 'commune', 'texte'];
const BORNES = { titre: MAX.titre, texte: MAX.texte };

const refuse = (message) => ({ ok: false, code: 'bad_request', message });

/**
 * @param {object} corps
 * @param {{
 *   ggd: { code: string, code_dept: string, nom_departement: string }[],
 *   unites: { code_ggd: string, nom: string }[],
 *   communes: { nom: string }[],
 *   mots_cles: string[],
 * }} refs
 */
function validerFrs(corps, refs) {
  if (!corps || typeof corps !== 'object') return refuse('Corps de requête absent ou illisible');
  if (!refs || typeof refs !== 'object') return refuse('Référentiel indisponible');

  const valeur = {};
  for (const champ of OBLIGATOIRES) {
    const v = typeof corps[champ] === 'string' ? corps[champ].trim() : '';
    if (!v) return refuse(`Champ « ${champ} » obligatoire`);
    if (BORNES[champ] && v.length > BORNES[champ]) {
      return refuse(`Champ « ${champ} » trop long (${BORNES[champ]} caractères au plus)`);
    }
    valeur[champ] = v;
  }

  // GGD XX : entrée du référentiel. Le nom de département est imposé par le référentiel
  // (on refuse un client qui enverrait GGD 49 + « Paris »).
  const ggd = (refs.ggd || []).find((g) => g.code === valeur.code_ggd);
  if (!ggd) return refuse(`GGD inconnu : « ${valeur.code_ggd} »`);
  if (valeur.departement !== ggd.nom_departement) {
    return refuse(`Département incohérent pour ${ggd.code} (attendu : ${ggd.nom_departement})`);
  }

  // Unité rattachée à CE GGD.
  const uniteOk = (refs.unites || []).some(
    (u) => u.code_ggd === valeur.code_ggd && u.nom === valeur.unite,
  );
  if (!uniteOk) return refuse(`Unité inconnue pour ${valeur.code_ggd} : « ${valeur.unite} »`);

  // Commune du département du GGD (comparaison insensible à la casse).
  const communeOk = (refs.communes || []).some(
    (c) => c.nom && c.nom.toLowerCase() === valeur.commune.toLowerCase(),
  );
  if (!communeOk) {
    return refuse(`Commune inconnue pour le département ${ggd.code_dept} : « ${valeur.commune} »`);
  }
  // Normalise sur la casse du référentiel.
  valeur.commune = (refs.communes || []).find(
    (c) => c.nom && c.nom.toLowerCase() === valeur.commune.toLowerCase(),
  ).nom;

  const mots = corps.mots_cles === undefined ? [] : corps.mots_cles;
  if (!Array.isArray(mots)) return refuse('Champ « mots_cles » : liste attendue');
  if (mots.length > MAX.motsCles) return refuse(`Mots-clés : ${MAX.motsCles} au plus`);

  const catalogue = new Set((refs.mots_cles || []).map((m) => (typeof m === 'string' ? m : m.mot)));
  const propres = [];
  const vus = new Set();
  for (const m of mots) {
    const v = typeof m === 'string' ? m.trim() : '';
    if (!v) continue;
    if (v.length > MAX.motCle) return refuse(`Mot-clé trop long (${MAX.motCle} caractères au plus)`);
    // `defaut:` / `signal-faible:` fausseraient l'audit et les signaux faibles.
    if (/^(defaut|signal-faible):/i.test(v)) return refuse(`Mot-clé réservé : « ${v} »`);
    if (!catalogue.has(v)) return refuse(`Mot-clé hors référentiel : « ${v} »`);
    if (vus.has(v)) continue;
    vus.add(v);
    propres.push(v);
  }
  valeur.mots_cles = propres;

  // La date n'est PAS lue du corps : le serveur impose la sienne (cf. buildInsertFrsQuery).
  return { ok: true, valeur };
}

function buildInsertFrsQuery(valeur) {
  const text = `
    INSERT INTO frs (date_redaction, titre, unite, code_ggd, departement, commune, texte)
    VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6)
    RETURNING id`;
  return {
    text,
    values: [valeur.titre, valeur.unite, valeur.code_ggd, valeur.departement, valeur.commune, valeur.texte],
  };
}

function buildInsertMotsClesQuery(frsId, mots) {
  if (!mots || !mots.length) return null;
  const text = `
    INSERT INTO frs_mot_cle (frs_id, mot, ordre)
    SELECT $1, mot, (ordinalite - 1)::int
      FROM unnest($2::text[]) WITH ORDINALITY AS t(mot, ordinalite)`;
  return { text, values: [frsId, mots] };
}

module.exports = { validerFrs, buildInsertFrsQuery, buildInsertMotsClesQuery, MAX };
