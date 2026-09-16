const http = require('http');
const { Pool } = require('pg');
const { buildListQuery, buildCountQuery, buildDetailQuery, buildSignauxFaiblesQuery, buildAgregatsQuery, buildSignauxQuery } = require('./fiches');
const { buildRapportQuery, buildRapportFicheQuery, buildLotQuery } = require('./audit/rapport');
const { buildStructurelIdsQuery } = require('./audit/structurel');
const { validerFrs, buildInsertFrsQuery, buildInsertMotsClesQuery } = require('./redaction');
const {
  buildRefGgdQuery, buildRefUnitesQuery, buildRefMotsClesQuery, buildRefCommunesQuery,
} = require('./referentiel');

const pool = new Pool({
  host: process.env.PGHOST || 'postgres',
  port: 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || 'rens',
  max: 4,
});
// Pool d'ÉCRITURE, séparé. Le rôle rens_redaction (migration 009) ne sait qu'insérer : il ne
// peut ni lire ni modifier une fiche. Deux connexions suffisent — une rédaction est un geste
// humain, pas un flux. Sans PGUSER_REDACTION, le pool n'est pas créé et POST /frs répond 503
// plutôt que d'écrire avec le rôle de lecture.
const poolEcriture = process.env.PGUSER_REDACTION
  ? new Pool({
      host: process.env.PGHOST || 'postgres', port: 5432,
      user: process.env.PGUSER_REDACTION, password: process.env.PGPASSWORD_REDACTION,
      database: process.env.PGDATABASE || 'rens', max: 2,
    })
  : null;

const TOKEN = process.env.API_TOKEN || '';
// Fail-closed : sans token configuré, refus de démarrer plutôt que de servir
// l'API ouverte en silence (aligné rgp-api / cote-api). L'ancien garde
// `if (TOKEN && …)` sautait l'auth quand le secret manquait.
if (!TOKEN && require.main === module) {
  console.error('FATAL: API_TOKEN manquant — refus de démarrer');
  process.exit(1);
}

const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const err = (res, code, c, m) => json(res, code, { error: { code: c, message: m } });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ''; let trop = false;
    req.on('data', (c) => {
      d += c;
      // Borne dure AVANT le parse : un corps sans fin ne doit pas remplir la mémoire du
      // conteneur. 64 Ko couvre largement 8000 caractères de texte et ses métadonnées.
      if (d.length > 65536 && !trop) { trop = true; reject(new Error('body_trop_grand')); req.destroy(); }
    });
    req.on('end', () => !trop && resolve(d));
    req.on('error', reject);
  });
}

function createHandler(poolArg = pool) {
  return async (req, res) => {
    const u = new URL(req.url, 'http://x');
    // Journal d'exploitation : méthode, route, présence d'auth — pas le contenu
    // des fiches. Les query strings d'audit (jour, frs_id) sont des identifiants
    // techniques, pas le corps des FRS.
    console.log(JSON.stringify({ t: new Date().toISOString(), m: req.method, p: u.pathname, auth: !!req.headers.authorization }));

    if (u.pathname === '/health') return json(res, 200, { data: { ok: true } });

    // Sans jeton configuré (TOKEN === ""), aucune comparaison ne doit réussir —
    // sinon un en-tête "Bearer " (jeton vide) passerait l'authentification.
    if (!TOKEN || (req.headers.authorization || '') !== 'Bearer ' + TOKEN)
      return err(res, 401, 'unauthorized', 'Token invalide ou manquant');

    if (u.pathname === '/agregats' && req.method === 'GET') {
      const date = (u.searchParams.get('date') || '').trim();
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return err(res, 400, 'bad_request', "Paramètre 'date' invalide (YYYY-MM-DD)");
      try {
        const q = buildAgregatsQuery(date);
        const r = await poolArg.query(q.text, q.values);
        return json(res, 200, { data: r.rows[0].agregats });
      } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }
    }

    if (u.pathname === '/signaux' && req.method === 'GET') {
      const date = (u.searchParams.get('date') || '').trim();
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return err(res, 400, 'bad_request', "Paramètre 'date' invalide (YYYY-MM-DD)");
      try {
        const q = buildSignauxQuery(u.searchParams);
        const r = await poolArg.query(q.text, q.values);
        return json(res, 200, { data: r.rows });
      } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }
    }

    if (u.pathname === '/signaux-faibles' && req.method === 'GET') {
      try {
        const q = buildSignauxFaiblesQuery(u.searchParams);
        const r = await poolArg.query(q.text, q.values);
        return json(res, 200, { data: r.rows });
      } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }
    }

    if (u.pathname === '/fiches' && req.method === 'GET') {
      try {
        const q = buildListQuery(u.searchParams);
        const c = buildCountQuery(u.searchParams);
        const [r, cr] = await Promise.all([poolArg.query(q.text, q.values), poolArg.query(c.text, c.values)]);
        return json(res, 200, { data: r.rows, total: cr.rows[0].total });
      } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }
    }

    const mFiche = u.pathname.match(/^\/fiches\/(\d+)$/);
    if (mFiche && req.method === 'GET') {
      try {
        const q = buildDetailQuery(parseInt(mFiche[1], 10));
        const r = await poolArg.query(q.text, q.values);
        if (!r.rows.length) return err(res, 404, 'not_found', `Fiche ${mFiche[1]} introuvable`);
        return json(res, 200, { data: r.rows[0] });
      } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }
    }

    // Référentiels de rédaction : GGD, unités, mots-clés (listes compactes). Les communes
    // passent par /referentiel/communes?code_dept=… (35k lignes, filtrées par département).
    if (u.pathname === '/referentiel' && req.method === 'GET') {
      try {
        const [ggd, unites, mots] = await Promise.all([
          poolArg.query(buildRefGgdQuery().text, buildRefGgdQuery().values),
          poolArg.query(buildRefUnitesQuery().text, buildRefUnitesQuery().values),
          poolArg.query(buildRefMotsClesQuery().text, buildRefMotsClesQuery().values),
        ]);
        return json(res, 200, {
          data: {
            ggd: ggd.rows,
            unites: unites.rows,
            mots_cles: mots.rows.map((r) => r.mot),
          },
        });
      } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }
    }

    if (u.pathname === '/referentiel/communes' && req.method === 'GET') {
      const codeDept = (u.searchParams.get('code_dept') || '').trim();
      const qTxt = (u.searchParams.get('q') || '').trim();
      const limitRaw = u.searchParams.get('limit');
      const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;
      const q = buildRefCommunesQuery(codeDept, qTxt, limit);
      // Soit un département, soit une recherche nationale d'au moins 2 caractères.
      if (!q) {
        return err(res, 400, 'bad_request',
          codeDept ? "Paramètres invalides" : "Indiquer code_dept ou q (≥ 2 caractères)");
      }
      try {
        const r = await poolArg.query(q.text, q.values);
        return json(res, 200, { data: r.rows });
      } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }
    }

    if (u.pathname === '/audit/rapport' && req.method === 'GET') {
      const jour = (u.searchParams.get('jour') || '').trim();
      if (jour && !/^\d{4}-\d{2}-\d{2}$/.test(jour)) return err(res, 400, 'bad_request', "Paramètre 'jour' invalide (YYYY-MM-DD)");
      try {
        const q = buildRapportQuery(jour || null, (u.searchParams.get('ggd') || '').trim());
        const r = await poolArg.query(q.text, q.values);
        const rapport = r.rows[0] && r.rows[0].rapport;
        // Aucun run pour ce jour : 404 explicite. Un rapport vide se confondrait avec « tout est conforme ».
        if (!rapport || !rapport.run) return err(res, 404, 'no_run', `Aucun audit pour ${jour || 'le dernier jour'}`);
        return json(res, 200, { data: rapport });
      } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }
    }

    if (u.pathname === '/audit/fiche' && req.method === 'GET') {
      const jour = (u.searchParams.get('jour') || '').trim();
      const id = parseInt(u.searchParams.get('frs_id'), 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return err(res, 400, 'bad_request', "Paramètre 'jour' requis (YYYY-MM-DD)");
      if (!Number.isInteger(id)) return err(res, 400, 'bad_request', "Paramètre 'frs_id' requis");
      try {
        const q = buildRapportFicheQuery(jour, id);
        const r = await poolArg.query(q.text, q.values);
        if (!r.rows.length) return err(res, 404, 'not_found', `Fiche ${id} introuvable`);
        return json(res, 200, { data: r.rows[0].fiche });
      } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }
    }

    // Lot d'une analyse à la demande : les fiches d'une sélection, plus les écarts
    // déterministes calculés sur cette même sélection. Le BFF compose le fragment et appelle
    // le workflow ; rens-api ne parle pas à IAka sur ce chemin.
    if (u.pathname === '/audit/lot' && req.method === 'GET') {
      const ids = (u.searchParams.get('frs_ids') || '').split(',')
        .map((x) => parseInt(x, 10)).filter(Number.isInteger);
      if (!ids.length) return err(res, 400, 'bad_request', "Paramètre 'frs_ids' requis (entiers séparés par des virgules)");
      // Borne dure : au-delà, l'exécution du workflow dépasse la minute et le lot n'a plus
      // rien d'interactif. Le contrôle exhaustif, c'est le batch nocturne.
      if (ids.length > 20) return err(res, 400, 'bad_request', 'Sélection limitée à 20 fiches');
      try {
        const q = buildLotQuery(ids);
        const qs = buildStructurelIdsQuery(ids);
        const [rf, rs] = await Promise.all([poolArg.query(q.text, q.values), poolArg.query(qs.text, qs.values)]);
        if (!rf.rows.length) return err(res, 404, 'not_found', 'Aucune fiche pour ces identifiants');
        // porte_pii en JS (regles.mjs) : même règle que le batch et l'analyse d'un texte volant.
        const { portePii } = await import('./audit/regles.mjs');
        const fiches = rf.rows.map((f) => ({ ...f, porte_pii: portePii(f.texte) }));
        return json(res, 200, { data: { fiches, structurels: rs.rows } });
      } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }
    }

    // Rédaction d'une FRS depuis l'application. SEULE écriture de cette API, et la seule à
    // emprunter le pool d'écriture. La lecture nécessaire à la validation (le référentiel) se
    // fait avec le pool de lecture : rens_redaction n'a pas le droit de SELECT.
    if (u.pathname === '/frs' && req.method === 'POST') {
      if (!poolEcriture) return err(res, 503, 'ecriture_indisponible', "L'écriture n'est pas configurée sur ce service");
      let corps;
      try {
        corps = JSON.parse((await readBody(req)) || '{}');
      } catch { return err(res, 400, 'bad_request', 'Corps JSON illisible'); }

      // Validation contre les référentiels. Les communes sont bornées au département du GGD
      // demandé — on ne charge jamais les 35k d'un coup pour valider une fiche.
      const codeGgd = typeof corps.code_ggd === 'string' ? corps.code_ggd.trim() : '';
      const codeDept = codeGgd.replace(/^GGD\s*/i, '');
      let refs;
      try {
        const qCom = buildRefCommunesQuery(codeDept || '__', '', 2000);
        const [ggd, unites, mots, communes] = await Promise.all([
          poolArg.query(buildRefGgdQuery().text, buildRefGgdQuery().values),
          poolArg.query(buildRefUnitesQuery().text, buildRefUnitesQuery().values),
          poolArg.query(buildRefMotsClesQuery().text, buildRefMotsClesQuery().values),
          qCom
            ? poolArg.query(qCom.text, qCom.values)
            : Promise.resolve({ rows: [] }),
        ]);
        refs = {
          ggd: ggd.rows,
          unites: unites.rows,
          mots_cles: mots.rows.map((r) => r.mot),
          communes: communes.rows,
        };
      } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }

      const v = validerFrs(corps, refs);
      if (!v.ok) return err(res, 400, v.code, v.message);

      // Fiche et mots-clés dans UNE transaction : une fiche dont les mots-clés manqueraient
      // sortirait des regroupements sans que rien ne le signale.
      const client = await poolEcriture.connect();
      try {
        await client.query('BEGIN');
        const qf = buildInsertFrsQuery(v.valeur);
        const id = (await client.query(qf.text, qf.values)).rows[0].id;
        const qm = buildInsertMotsClesQuery(id, v.valeur.mots_cles);
        if (qm) await client.query(qm.text, qm.values);
        await client.query('COMMIT');
        return json(res, 201, { data: { id } });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('db_error', e.message);
        return err(res, 500, 'db_error', "La fiche n'a pas pu être enregistrée");
      } finally {
        client.release();
      }
    }

    return err(res, 404, 'not_found', 'Route inconnue');
  };
}

if (require.main === module) {
  http.createServer(createHandler()).listen(8080, () => console.log('rens-api :8080'));
}

module.exports = { createHandler };
