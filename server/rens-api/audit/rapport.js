// Lecture du rapport d'audit. Toute l'agrégation est faite par la base : le front
// affiche, il ne calcule pas. Fonctions PURES (testables sans base).

const { CRITERES } = require('./criteres');

// Table de correspondance code → libellé, injectée comme VALUES pour que les libellés
// restent une source unique côté Node.
const LIBELLES = Object.entries(CRITERES).map(([c, v]) => `('${c}','${v.libelle.replace(/'/g, "''")}')`).join(',');

const RANG_GRAVITE = `CASE gravite WHEN 'bloquant' THEN 3 WHEN 'majeur' THEN 2 ELSE 1 END`;

function buildRapportQuery(jour, ggd) {
  const values = [];
  let selRun;
  if (jour) { values.push(jour); selRun = `SELECT * FROM frs_audit_run WHERE jour = $1::date`; }
  else { selRun = `SELECT * FROM frs_audit_run ORDER BY jour DESC LIMIT 1`; }

  let filtreGgd = '';
  if (ggd) { values.push(ggd); filtreGgd = ` AND f.code_ggd = $${values.length}`; }

  const text = `
    WITH r AS (${selRun}),
    e AS (
      SELECT a.*, f.unite, f.code_ggd, f.commune, f.titre,
             to_char(f.date_redaction, 'YYYY-MM-DD') AS date_redaction
        FROM frs_audit a JOIN r ON a.run_id = r.id JOIN frs f ON f.id = a.frs_id
       WHERE true${filtreGgd}
    ),
    par_fiche AS (
      SELECT frs_id, titre, unite, code_ggd, commune, date_redaction,
             count(*)::int AS n_ecarts,
             max(${RANG_GRAVITE})::int AS rang_max,
             array_agg(critere ORDER BY critere) AS criteres
        FROM e GROUP BY frs_id, titre, unite, code_ggd, commune, date_redaction
    ),
    lib(code, libelle) AS (VALUES ${LIBELLES})
    SELECT json_build_object(
      'run', (SELECT json_build_object(
                'jour', to_char(r.jour,'YYYY-MM-DD'), 'statut', r.statut,
                'termine_a', r.termine_a, 'total_fiches', r.total_fiches,
                'fragments_total', r.fragments_total, 'fragments_ok', r.fragments_ok,
                'taille_fragment', r.taille_fragment) FROM r),
      'synthese', json_build_object(
        'fiches_non_conformes', (SELECT count(*)::int FROM par_fiche),
        'taux_conformite', (SELECT CASE WHEN COALESCE(r.total_fiches,0) = 0 THEN NULL
                              ELSE round(1 - (SELECT count(*)::numeric FROM par_fiche) / r.total_fiches, 3) END FROM r),
        'par_gravite', (SELECT COALESCE(json_object_agg(g, n), '{}'::json) FROM
                          (SELECT gravite AS g, count(DISTINCT frs_id)::int AS n FROM e GROUP BY gravite) x),
        'par_critere', (SELECT COALESCE(json_agg(json_build_object('critere', c, 'libelle', l, 'n', n) ORDER BY n DESC), '[]'::json)
                          FROM (SELECT e.critere AS c, lib.libelle AS l, count(*)::int AS n
                                  FROM e JOIN lib ON lib.code = e.critere GROUP BY e.critere, lib.libelle) y),
        'par_unite', (SELECT COALESCE(json_agg(json_build_object('unite', u, 'n', n, 'bloquant', b) ORDER BY b DESC, n DESC), '[]'::json)
                        FROM (SELECT unite AS u, count(DISTINCT frs_id)::int AS n,
                                     count(DISTINCT frs_id) FILTER (WHERE gravite = 'bloquant')::int AS b
                                FROM e GROUP BY unite) z)),
      -- Vérité terrain : un défaut planté n'est compté comme DÉTECTÉ que si l'agent a relevé
      -- le bon critère sur la bonne fiche. substring(m.mot from 8) retire le préfixe
      -- defaut: — relever D12 sur une fiche piégée en B5 est une coïncidence, pas une détection.
      'methode', (SELECT json_build_object(
        'taille_fragment', (SELECT taille_fragment FROM r),
        'defauts_plantes', (SELECT count(*)::int FROM frs f
                              JOIN frs_mot_cle m ON m.frs_id = f.id
                             WHERE f.date_redaction = (SELECT jour FROM r) AND m.mot LIKE 'defaut:%'),
        'defauts_detectes', (SELECT count(*)::int FROM frs f
                               JOIN frs_mot_cle m ON m.frs_id = f.id
                               JOIN frs_audit a ON a.frs_id = f.id AND a.run_id = (SELECT id FROM r)
                              WHERE m.mot LIKE 'defaut:%' AND substring(m.mot from 8) = a.critere))),
      'fiches', (SELECT COALESCE(json_agg(json_build_object(
                    'frs_id', frs_id, 'titre', titre, 'unite', unite, 'code_ggd', code_ggd,
                    'commune', commune, 'date_redaction', date_redaction, 'n_ecarts', n_ecarts,
                    'criteres', criteres,
                    'gravite_max', CASE rang_max WHEN 3 THEN 'bloquant' WHEN 2 THEN 'majeur' ELSE 'mineur' END)
                    ORDER BY rang_max DESC, unite, frs_id), '[]'::json) FROM par_fiche)
    ) AS rapport`;
  return { text, values };
}

function buildRapportFicheQuery(jour, frsId) {
  const text = `
    WITH r AS (SELECT id FROM frs_audit_run WHERE jour = $1::date),
    lib(code, libelle) AS (VALUES ${LIBELLES})
    SELECT json_build_object(
      'frs_id', f.id, 'titre', f.titre, 'unite', f.unite, 'code_ggd', f.code_ggd,
      'commune', f.commune,
      'date_redaction', to_char(f.date_redaction,'YYYY-MM-DD'),
      'texte', f.texte,
      'ecarts', (SELECT COALESCE(json_agg(json_build_object(
                    'critere', a.critere, 'libelle', lib.libelle, 'gravite', a.gravite,
                    'source', a.source, 'fondement', a.fondement, 'extrait', a.extrait,
                    'explication', a.explication, 'confiance', a.confiance)
                    ORDER BY ${RANG_GRAVITE.replace(/gravite/g, 'a.gravite')} DESC, a.critere), '[]'::json)
                   FROM frs_audit a JOIN r ON a.run_id = r.id JOIN lib ON lib.code = a.critere
                  WHERE a.frs_id = f.id)
    ) AS fiche
    FROM frs f WHERE f.id = $2`;
  return { text, values: [jour, frsId] };
}

// Lot d'une analyse À LA DEMANDE : les fiches d'une sélection, avec les champs que le
// fragment transmet au workflow. `porte_pii` est calculé en JS (regles.mjs::portePii) après
// chargement — une seule définition pour batch, sélection et texte volant.
function buildLotQuery(ids) {
  const text = `
    SELECT f.id, to_char(f.date_redaction, 'YYYY-MM-DD') AS date_redaction,
           f.titre, f.unite, f.code_ggd, f.commune, f.texte
      FROM frs f
     WHERE f.id = ANY($1::int[])
     ORDER BY f.id`;
  return { text, values: [ids] };
}

module.exports = { buildRapportQuery, buildRapportFicheQuery, buildLotQuery };
