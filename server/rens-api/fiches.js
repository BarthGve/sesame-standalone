// Construction des requêtes SQL de lecture des FRS. Fonctions PURES (testables sans DB) :
// renvoient { text, values } passés tels quels à pool.query. Read-only.

// Marqueurs techniques de test : jamais affichés au front, jamais agrégés. Un marqueur
// planté ~4 fois par nuit et par code entre en quelques jours dans la fenêtre des signaux
// faibles (5-20 occurrences, >= 3 départements) — il serait annoncé comme un phénomène
// émergent. L'exclusion appartient donc à la requête, pas à la recette.
const EXCLUT_MARQUEURS = "m.mot NOT LIKE 'signal-faible:%' AND m.mot NOT LIKE 'defaut:%'";

const SELECT_LIST = `
  SELECT f.id, to_char(f.date_redaction, 'YYYY-MM-DD') AS date_redaction, f.titre, f.unite, f.code_ggd, f.departement,
         f.commune, f.texte,
         COALESCE(array_agg(m.mot ORDER BY m.ordre) FILTER (WHERE m.mot IS NOT NULL AND m.mot NOT LIKE 'defaut:%' AND m.mot NOT LIKE 'signal-faible:%'), '{}') AS mots_cles
  FROM frs f
  LEFT JOIN frs_mot_cle m ON m.frs_id = f.id`;

// Construit la clause WHERE partagée (liste + count). Filtres optionnels : date (jour exact),
// from/to (période), ggd, commune, mot (référentiel, répétable), q (recherche libre).
// SANS filtre de date/période/recherche → défaut « dernier jour » en base.
// `mot` et `q` lèvent ce défaut (recherche thématique / libre sur l'historique).
// ggd et commune NE le lèvent PAS : ils affinent dans le jour courant.
function buildFilters(params) {
  const where = [], values = [];
  const push = (frag, v) => { values.push(v); where.push(frag.replace('$?', '$' + values.length)); };

  const date = (params.get('date') || '').trim();
  if (date) push('f.date_redaction = $?', date);
  const from = (params.get('from') || '').trim();
  if (from) push('f.date_redaction >= $?', from);
  const to = (params.get('to') || '').trim();
  if (to) push('f.date_redaction <= $?', to);
  const ggd = (params.get('ggd') || '').trim();
  if (ggd) push('f.code_ggd = $?', ggd);
  // Commune : sous-chaîne (saisie partielle « Saincaize » trouve « Saincaize-Meauce »).
  const commune = (params.get('commune') || '').trim();
  if (commune) push('f.commune ILIKE $?', '%' + commune + '%');

  // Mots-clés du référentiel (ref_mot_cle) : un ou plusieurs, match EXACT sur frs_mot_cle.
  // Répéter `mot=…` ou `mots=a,b`. OR : la fiche porte au moins l'un des termes.
  const mots = [
    ...params.getAll('mot').map((m) => m.trim()),
    ...((params.get('mots') || '').split(',').map((m) => m.trim())),
  ].filter((m) => m && m.length <= 40 && !/^(defaut|signal-faible):/i.test(m));
  // Déduplique en conservant l'ordre.
  const motsUniques = [...new Set(mots)].slice(0, 10);
  if (motsUniques.length) {
    values.push(motsUniques);
    const i = '$' + values.length;
    where.push(
      `EXISTS (SELECT 1 FROM frs_mot_cle mk WHERE mk.frs_id = f.id AND mk.mot = ANY(${i}::text[]) AND mk.mot NOT LIKE 'signal-faible:%' AND mk.mot NOT LIKE 'defaut:%')`,
    );
  }

  const q = (params.get('q') || '').trim();
  if (q) {
    values.push('%' + q + '%');
    const i = '$' + values.length;
    // Recherche large : titre, texte, mots-clés, ET rattachements (unité / commune / GGD /
    // département) — sinon « PSIG Nevers » ou « Saint-Dizier » ne trouvent rien.
    where.push(`(f.titre ILIKE ${i} OR f.texte ILIKE ${i} OR f.unite ILIKE ${i} OR f.commune ILIKE ${i} OR f.code_ggd ILIKE ${i} OR f.departement ILIKE ${i} OR EXISTS (SELECT 1 FROM frs_mot_cle mk WHERE mk.frs_id = f.id AND mk.mot ILIKE ${i} AND mk.mot NOT LIKE 'signal-faible:%' AND mk.mot NOT LIKE 'defaut:%'))`);
  }

  // Portée temporelle par défaut = DERNIER jour, SAUF date/période/recherche (q ou mots-clés).
  if (!date && !from && !to && !q && !motsUniques.length) {
    where.push("f.date_redaction = (SELECT max(date_redaction) FROM frs)");
  }
  return { where, values };
}

// Liste filtrée + paginée. Filtres via buildFilters ; limit (défaut 100, max 500) + offset (défaut 0).
function buildListQuery(params) {
  const { where, values } = buildFilters(params);
  let limit = parseInt(params.get('limit'), 10);
  if (!Number.isInteger(limit) || limit <= 0) limit = 100;
  if (limit > 500) limit = 500;
  let offset = parseInt(params.get('offset'), 10);
  if (!Number.isInteger(offset) || offset < 0) offset = 0;

  let text = SELECT_LIST + '\n  WHERE ' + where.join(' AND ');
  text += '\n  GROUP BY f.id\n  ORDER BY f.date_redaction DESC, f.id DESC\n  LIMIT ' + limit + ' OFFSET ' + offset;
  return { text, values };
}

// Nombre total de fiches pour les MÊMES filtres (pour la pagination). Pas de JOIN nécessaire
// (le filtre q utilise une sous-requête EXISTS sur f.id).
function buildCountQuery(params) {
  const { where, values } = buildFilters(params);
  return { text: 'SELECT count(*)::int AS total FROM frs f WHERE ' + where.join(' AND '), values };
}

function buildDetailQuery(id) {
  return { text: SELECT_LIST + '\n  WHERE f.id = $1\n  GROUP BY f.id', values: [id] };
}

// Découverte de signaux faibles par AGRÉGATION : regroupe les fiches par mot-clé et ne garde
// que les phénomènes RARES-MAIS-DISPERSÉS (count entre min et max, sur >= depts départements).
// Les thèmes de fond, très fréquents, sont exclus par la borne haute ; les marqueurs techniques
// 'signal-faible:%' sont exclus (hooks de test). Paramètres optionnels : min (défaut 5),
// max (défaut 20), depts (défaut 3). Read-only.
function buildSignauxFaiblesQuery(params) {
  let minN = parseInt(params.get('min'), 10);
  if (!Number.isInteger(minN) || minN < 2) minN = 5;
  let maxN = parseInt(params.get('max'), 10);
  if (!Number.isInteger(maxN) || maxN < minN) maxN = 20;
  let minDepts = parseInt(params.get('depts'), 10);
  if (!Number.isInteger(minDepts) || minDepts < 1) minDepts = 3;
  const text = `
    SELECT m.mot,
           count(*) AS n,
           count(DISTINCT f.code_ggd) AS depts,
           to_char(min(f.date_redaction), 'YYYY-MM-DD') AS debut,
           to_char(max(f.date_redaction), 'YYYY-MM-DD') AS fin,
           array_agg(DISTINCT f.code_ggd ORDER BY f.code_ggd) AS ggds
    FROM frs f
    JOIN frs_mot_cle m ON m.frs_id = f.id
    WHERE ${EXCLUT_MARQUEURS}
    GROUP BY m.mot
    HAVING count(*) BETWEEN $1 AND $2 AND count(DISTINCT f.code_ggd) >= $3
    ORDER BY depts DESC, n DESC`;
  return { text, values: [minN, maxN, minDepts] };
}

// PANORAMA D'UN JOUR : toute l'agrégation est faite par la base (scalable à 1000+ fiches/jour) ;
// renvoie UN objet JSON compact (total, delta veille, répartitions) que l'agent narre sans jamais
// lire les fiches brutes. `date` = 'YYYY-MM-DD' optionnelle ; si absente, on prend le DERNIER jour
// présent dans la base (utile pour une synthèse « du jour » automatisée sans calcul de date côté
// appelant). Read-only.
function buildAgregatsQuery(date) {
  // Sans date : LA VEILLE (= dernier jour − 1). La liste de gauche montre « le jour » (dernier
  // jour) ; la synthèse porte sur le dernier jour COMPLET = la veille.
  const d = date ? '$1::date' : '(CURRENT_DATE - 1)';
  const values = date ? [date] : [];
  const text = `
    SELECT json_build_object(
      'date', to_char((${d}), 'YYYY-MM-DD'),
      'total', (SELECT count(*) FROM frs WHERE date_redaction = (${d})),
      'total_veille', (SELECT count(*) FROM frs WHERE date_redaction = (${d}) - 1),
      'top_mots', (SELECT COALESCE(json_agg(json_build_object('mot', mot, 'n', n) ORDER BY n DESC), '[]'::json)
                   FROM (SELECT m.mot, count(*) AS n FROM frs f JOIN frs_mot_cle m ON m.frs_id = f.id
                         WHERE f.date_redaction = (${d}) AND ${EXCLUT_MARQUEURS}
                         GROUP BY m.mot ORDER BY count(*) DESC LIMIT 12) t),
      'par_ggd', (SELECT COALESCE(json_agg(json_build_object('code_ggd', code_ggd, 'n', n) ORDER BY n DESC), '[]'::json)
                  FROM (SELECT code_ggd, count(*) AS n FROM frs WHERE date_redaction = (${d}) GROUP BY code_ggd) g),
      'top_communes', (SELECT COALESCE(json_agg(json_build_object('commune', commune, 'n', n) ORDER BY n DESC), '[]'::json)
                       FROM (SELECT commune, count(*) AS n FROM frs WHERE date_redaction = (${d}) AND commune IS NOT NULL
                             GROUP BY commune ORDER BY count(*) DESC LIMIT 10) c)
    ) AS agregats`;
  return { text, values };
}

// SIGNAUX FAIBLES sur une FENÊTRE GLISSANTE : agrégation par mot-clé sur [fin-window, fin], avec
// dispersion (depts, communes, jours) et flag `emergent` (majorité des occurrences dans les
// `recent` derniers jours → phénomène en hausse). Seuils min/max/depts = knobs d'échelle (à monter
// pour 1000 fiches/jour). Entiers validés inlinés (sûr) ; `date` de fin paramétrée ($1), défaut =
// max(date_redaction). Exclut le marqueur technique. Read-only, renvoie ~10–30 lignes.
function buildSignauxQuery(params) {
  const date = (params.get('date') || '').trim();
  let window = parseInt(params.get('window'), 10); if (!Number.isInteger(window) || window < 1) window = 30;
  let recent = parseInt(params.get('recent'), 10); if (!Number.isInteger(recent) || recent < 1) recent = 7;
  let minN = parseInt(params.get('min'), 10); if (!Number.isInteger(minN) || minN < 2) minN = 5;
  let maxN = parseInt(params.get('max'), 10); if (!Number.isInteger(maxN) || maxN < minN) maxN = 20;
  let minDepts = parseInt(params.get('depts'), 10); if (!Number.isInteger(minDepts) || minDepts < 1) minDepts = 3;
  // Sans date : fenêtre finissant à LA VEILLE de la DATE COURANTE (CURRENT_DATE − 1).
  // Une date explicite (?date=YYYY-MM-DD) borne la fin de fenêtre sur ce jour.
  const end = date ? '$1::date' : '(CURRENT_DATE - 1)';
  const values = date ? [date] : [];
  const text = `
    WITH agg AS (
      SELECT m.mot,
             count(*) AS n,
             count(DISTINCT f.code_ggd) AS depts,
             count(DISTINCT f.commune) AS communes,
             count(DISTINCT f.date_redaction) AS jours,
             to_char(min(f.date_redaction), 'YYYY-MM-DD') AS debut,
             to_char(max(f.date_redaction), 'YYYY-MM-DD') AS fin,
             count(*) FILTER (WHERE f.date_redaction > (${end}) - ${recent}) AS recent_n
      FROM frs f
      JOIN frs_mot_cle m ON m.frs_id = f.id
      WHERE f.date_redaction BETWEEN (${end}) - ${window} AND (${end})
        AND ${EXCLUT_MARQUEURS}
      GROUP BY m.mot
    )
    SELECT mot, n, depts, communes, jours, debut, fin,
           (recent_n::float / NULLIF(n, 0) >= 0.6) AS emergent
    FROM agg
    WHERE n BETWEEN ${minN} AND ${maxN} AND depts >= ${minDepts}
    ORDER BY depts DESC, jours DESC, n DESC`;
  return { text, values };
}

module.exports = { buildListQuery, buildCountQuery, buildDetailQuery, buildSignauxFaiblesQuery, buildAgregatsQuery, buildSignauxQuery };
