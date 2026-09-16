const http = require('http');
const { pipeline } = require('stream');
const { Pool } = require('pg');
const perq = require('./perquisition');
const photo = require('./photo');

// MinIO joint EN INTERNE (nom docker `minio`, réseau privé) — jamais exposé.
// Client instancié à la demande (première photo) pour ne pas exiger le paquet
// `minio` dans les tests qui n'importent que les fonctions métier.
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'perquisitions';
let _minio;
function getMinio() {
  if (_minio) return _minio;
  const { Client } = require('minio');
  _minio = new Client({
    endPoint: process.env.MINIO_ENDPOINT || 'minio',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY,
    secretKey: process.env.MINIO_SECRET_KEY,
  });
  return _minio;
}

const pool = new Pool({
  host: process.env.PGHOST || 'postgres',
  port: 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || 'rgp',
  max: 4,
});
const TOKEN = process.env.API_TOKEN || '';
// Fail-closed : sans token configuré, on refuse de démarrer plutôt que de servir
// l'API ouverte en silence (le garde « TOKEN && » plus bas serait sinon sauté).
if (!TOKEN && require.main === module) {
  console.error('FATAL: API_TOKEN manquant — refus de démarrer');
  process.exit(1);
}

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const err = (res, code, c, m) => json(res, code, { error: { code: c, message: m } });

const SELECT_UNA = `
  SELECT u.id, u.unite, un.description AS unite_libelle,
         u.numero, u.annee,
         u.unite || '/' || u.numero || '/' || u.annee AS una,
         u.synthese, u.type_document, t.libelle AS type_libelle, t.description AS type_description,
         u.nigend_de, u.urgent, u.sensible,
         u.groupe, g.libelle AS groupe_libelle,
         u.commune, c.nom AS commune_libelle, c.code_postal AS commune_code_postal,
         u.date_limit, u.date_submit
  FROM una u
  LEFT JOIN unite un ON un.code = u.unite
  LEFT JOIN type_document t ON t.id = u.type_document
  LEFT JOIN groupe g ON g.id = u.groupe
  LEFT JOIN communes c ON c.code_insee = u.commune
  WHERE u.unite = $1 AND u.numero = $2 AND u.annee = $3`;

function parseUna(params) {
  const combo = params.get('una') || params.get('pv') || params.get('numero') || '';
  let unite, numero, annee;
  if (combo.includes('/')) [unite, numero, annee] = combo.split('/');
  else { unite = params.get('unite'); numero = params.get('numero'); annee = params.get('annee'); }
  return [parseInt(unite, 10), parseInt(numero, 10), parseInt(annee, 10)];
}

// Valeurs autorisées pour le type de lieu du fait (table compagnon una_lieu).
const LIEU_TYPES = ['LOCAL_PRO', 'HABITATION', 'LIEU_PUBLIC', 'VEHICULE', 'INDETERMINE'];

const SELECT_LIST = `
  SELECT u.id, u.unite, un.description AS unite_libelle,
         u.numero, u.annee,
         u.unite || '/' || u.numero || '/' || u.annee AS una,
         u.synthese, u.type_document, t.libelle AS type_libelle, t.description AS type_description,
         u.nigend_de, u.urgent, u.sensible,
         u.groupe, g.libelle AS groupe_libelle,
         u.commune, c.nom AS commune_libelle, c.code_postal AS commune_code_postal,
         u.date_limit, u.date_submit,
         l.type_lieu, l.adresse_norm AS lieu_adresse, l.latitude AS lieu_latitude, l.longitude AS lieu_longitude,
         (SELECT count(*) FROM perquisition pq WHERE pq.una_id = u.id)::int AS nb_perquisitions
  FROM una u
  LEFT JOIN unite un ON un.code = u.unite
  LEFT JOIN type_document t ON t.id = u.type_document
  LEFT JOIN groupe g ON g.id = u.groupe
  LEFT JOIN communes c ON c.code_insee = u.commune
  LEFT JOIN LATERAL (
    SELECT type_lieu, adresse_norm, latitude, longitude
    FROM una_lieu WHERE una_id = u.id
    ORDER BY updated_at DESC LIMIT 1
  ) l ON true`;

// Liste filtrée de procédures. Filtres optionnels : type (libellé/id), unite, annee, groupe (libellé/id), urgent, sensible, type_lieu (enum LIEU_TYPES), limit.
async function listUna(params, poolArg = pool) {
  const where = [], vals = [];
  const eq = (col, v) => { vals.push(v); where.push(col + ' = $' + vals.length); };
  const type = params.get('type');
  if (type) { if (/^\d+$/.test(type)) eq('u.type_document', parseInt(type, 10)); else { vals.push(type); where.push('t.libelle ILIKE $' + vals.length); } }
  const unite = params.get('unite'); if (unite && /^\d+$/.test(unite)) eq('u.unite', parseInt(unite, 10));
  const annee = params.get('annee'); if (annee && /^\d+$/.test(annee)) eq('u.annee', parseInt(annee, 10));
  const groupe = params.get('groupe');
  if (groupe) { if (/^\d+$/.test(groupe)) eq('u.groupe', parseInt(groupe, 10)); else { vals.push(groupe); const i = vals.length; where.push('(g.libelle ILIKE $' + i + ' OR g.libelle ILIKE \'Groupe \'||$' + i + ')'); } }
  const urgent = params.get('urgent'); if (urgent === 'true' || urgent === 'false') eq('u.urgent', urgent === 'true');
  const sensible = params.get('sensible'); if (sensible === 'true' || sensible === 'false') eq('u.sensible', sensible === 'true');
  const typeLieu = params.get('type_lieu'); if (typeLieu && LIEU_TYPES.includes(typeLieu)) eq('l.type_lieu', typeLieu);
  let limit = parseInt(params.get('limit'), 10);
  if (!Number.isInteger(limit) || limit <= 0) limit = 200;
  if (limit > 1000) limit = 1000;
  let sql = SELECT_LIST;
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY u.annee DESC, u.numero DESC LIMIT ' + limit;
  const r = await poolArg.query(sql, vals);
  return r.rows;
}

// Borne anti-DoS mémoire (photos base64 scellés). Défaut 15 Mo, aligné BFF.
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES ?? 15 * 1024 * 1024);

function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let b = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        if (typeof req.destroy === 'function') req.destroy();
        // Code stable consommé par le handler HTTP (413), pas un dump.
        const e = new Error('BODY_TOO_LARGE');
        e.code = 'BODY_TOO_LARGE';
        reject(e);
        return;
      }
      b += c;
    });
    // Ne JAMAIS logger le corps : les POST portent des données de procédure
    // (perquisitionné, adresse, OPJ, IMEI, plaques, IBAN). On ne trace rien ici.
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve(null); } });
    req.on('error', (e) => reject(e));
  });
}

// Résout une commune depuis une entrée : code INSEE (ex. 49331, 2A004) ou nom.
// Retourne { code } si résolue (null si entrée vide), sinon { error:{c,m} }.
// Le code INSEE est prioritaire ; un nom n'est accepté que s'il est non ambigu.
async function resolveCommune(client, raw) {
  const s = String(raw).trim();
  if (!s) return { code: null };
  if (/^(\d{5}|2[ab]\d{3})$/i.test(s)) {
    const r = await client.query('SELECT code_insee FROM communes WHERE code_insee = upper($1)', [s]);
    if (r.rows.length) return { code: r.rows[0].code_insee };
    return { error: { c: 'commune_inconnue', m: `Commune (code INSEE) "${s}" inconnue` } };
  }
  const norm = fold(s).toLowerCase();
  // Match tolérant en 3 paliers (du + strict au + souple) : « Le Lion d'Angers » (espace)
  // doit trouver « Le Lion-d'Angers » (tiret). Séparateurs = espaces/tirets/apostrophes/points.
  const SEP = "[-''’.[:space:]]";                 // classe SQL (apostrophe doublée)
  const squash = (x) => x.replace(/[-'’.\s]/g, '');
  const stripArt = (x) => x.replace(/^(l['’]|le\s+|la\s+|les\s+)/, '');
  const paliers = [
    ['nom_norm = $1', norm],                       // 1. exact
    [`regexp_replace(nom_norm, '${SEP}', '', 'g') = $1`, squash(norm)],            // 2. sans séparateurs
    [`regexp_replace(regexp_replace(nom_norm, '^(l[''’]|le |la |les )', ''), '${SEP}', '', 'g') = $1`,
      squash(stripArt(norm))],                     // 3. sans article ni séparateurs
  ];
  for (const [where, param] of paliers) {
    const r = await client.query(`SELECT code_insee FROM communes WHERE ${where}`, [param]);
    if (r.rows.length === 1) return { code: r.rows[0].code_insee };
    if (r.rows.length > 1) return { error: { c: 'commune_ambigue', m: `Nom de commune "${s}" ambigu (${r.rows.length} correspondances) ; précise le code INSEE` } };
  }
  return { error: { c: 'commune_inconnue', m: `Commune "${s}" inconnue` } };
}

// Création/allocation d'un numéro de procédure (UNA).
// body: { unite (code, requis), type (libelle ou id, requis), synthese (optionnel), urgent (bool, défaut false), sensible (bool, défaut false), groupe (libelle ou id, optionnel), commune (nom ou code INSEE, optionnel), type_lieu (enum LIEU_TYPES, optionnel), adresse (optionnel), annee (optionnel = année courante) }
async function createUna(body, poolArg = pool) {
  const unite = parseInt(body.unite, 10);
  if (!Number.isInteger(unite)) return { code: 400, c: 'bad_request', m: 'Champ "unite" (code entier) requis' };
  const annee = body.annee ? parseInt(body.annee, 10) : new Date().getFullYear();
  if (!Number.isInteger(annee)) return { code: 400, c: 'bad_request', m: '"annee" invalide' };
  const typeRaw = body.type != null ? String(body.type) : '';
  if (!typeRaw) return { code: 400, c: 'bad_request', m: 'Champ "type" requis (ex: PVEJ)' };
  const synthese = body.synthese != null && String(body.synthese).trim() !== '' ? String(body.synthese) : null;
  const urgent = body.urgent === true || body.urgent === 'true' || body.urgent === 1;
  const sensible = body.sensible === true || body.sensible === 'true' || body.sensible === 1;
  // Lieu du fait (classé en amont par l'agent). type_lieu hors enum = ignoré (pas d'erreur).
  const typeLieu = body.type_lieu != null && LIEU_TYPES.includes(String(body.type_lieu)) ? String(body.type_lieu) : null;
  const adresse = body.adresse != null && String(body.adresse).trim() !== '' ? String(body.adresse) : null;

  const client = await poolArg.connect();
  try {
    // unité connue ?
    const un = await client.query('SELECT code FROM unite WHERE code=$1', [unite]);
    if (!un.rows.length) return { code: 400, c: 'unite_inconnue', m: `Unité ${unite} inconnue` };

    // type → id
    const t = await client.query('SELECT id FROM type_document WHERE libelle=$1 OR id::text=$1 LIMIT 1', [typeRaw]);
    if (!t.rows.length) return { code: 400, c: 'type_inconnu', m: `Type "${typeRaw}" inconnu` };
    const typeId = t.rows[0].id;

    // groupe optionnel → id (scopé à l'unité)
    let groupeId = null;
    if (body.groupe != null && String(body.groupe) !== '') {
      const gRaw = String(body.groupe);
      const g = await client.query("SELECT id FROM groupe WHERE unite=$2 AND (libelle ILIKE $1 OR libelle ILIKE 'Groupe '||$1 OR id::text=$1) LIMIT 1", [gRaw, unite]);
      if (!g.rows.length) return { code: 400, c: 'groupe_inconnu', m: `Groupe "${gRaw}" inconnu pour l'unité ${unite}` };
      groupeId = g.rows[0].id;
    }

    // commune optionnelle → code INSEE. NON bloquant : un nom non reconnu/ambigu
    // (l'agent LLM donne souvent une forme approximative) ne doit PAS empêcher
    // d'allouer le numéro de PV. On crée sans commune et on remonte un warning.
    let communeCode = null;
    let communeWarning = null;
    if (body.commune != null && String(body.commune) !== '') {
      const rc = await resolveCommune(client, body.commune);
      if (rc.error) communeWarning = `Commune "${body.commune}" non enregistrée (${rc.error.c}) : procédure créée sans commune.`;
      else communeCode = rc.code;
    }

    // allocation atomique du numéro (lock par unité+année)
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [unite, annee]);
    const mx = await client.query('SELECT COALESCE(MAX(numero),0)+1 AS n FROM una WHERE unite=$1 AND annee=$2', [unite, annee]);
    const numero = mx.rows[0].n;
    const ins = await client.query(
      'INSERT INTO una (unite, numero, annee, type_document, groupe, synthese, urgent, sensible, commune, date_submit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now()) RETURNING id',
      [unite, numero, annee, typeId, groupeId, synthese, urgent, sensible, communeCode]
    );
    // Lieu du fait : ligne compagnon una_lieu (seulement si un indice de lieu est fourni).
    if (typeLieu || adresse) {
      await client.query(
        'INSERT INTO una_lieu (una_id, type_lieu, adresse_norm, commune) VALUES ($1,$2,$3,$4)',
        [ins.rows[0].id, typeLieu, adresse, communeCode]
      );
    }
    await client.query('COMMIT');

    const r = await client.query(SELECT_UNA, [unite, numero, annee]);
    return { code: 200, data: r.rows[0], warning: communeWarning };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('create_error', e.message);
    return { code: 500, c: 'db_error', m: 'Erreur base de données' };
  } finally {
    client.release();
  }
}

// Modification d un UNA existant. Identité (unite/numero/annee) IMMUABLE : sert seulement à cibler la ligne.
// body: { una|unite+numero+annee (identité, requis) } + champs à modifier : synthese, type, groupe, urgent, sensible, nigend_de, date_limit.
async function updateUna(body, poolArg = pool) {
  let unite, numero, annee;
  const combo = body.una || body.pv || (typeof body.numero === 'string' ? body.numero : '');
  if (typeof combo === 'string' && combo.includes('/')) [unite, numero, annee] = combo.split('/');
  else { unite = body.unite; numero = body.numero; annee = body.annee; }
  const ui = parseInt(unite, 10), ni = parseInt(numero, 10), ai = parseInt(annee, 10);
  if (![ui, ni, ai].every(Number.isInteger))
    return { code: 400, c: 'bad_request', m: 'Identité requise : una (unite/numero/annee) ou les 3 champs séparés' };
  // Lieu du fait (table compagnon una_lieu) : modifiable a posteriori.
  const typeLieu = body.type_lieu != null && LIEU_TYPES.includes(String(body.type_lieu)) ? String(body.type_lieu) : null;
  const adresse = body.adresse != null && String(body.adresse).trim() !== '' ? String(body.adresse) : null;

  const client = await poolArg.connect();
  try {
    const cur = await client.query('SELECT id FROM una WHERE unite=$1 AND numero=$2 AND annee=$3', [ui, ni, ai]);
    if (!cur.rows.length) return { code: 404, c: 'not_found', m: `UNA ${ui}/${ni}/${ai} introuvable` };

    const sets = [], vals = [];
    const setf = (col, v) => { vals.push(v); sets.push(col + '=$' + vals.length); };

    if ('synthese' in body) setf('synthese', body.synthese === '' ? null : body.synthese);
    if ('urgent' in body) setf('urgent', body.urgent === true || body.urgent === 'true' || body.urgent === 1);
    if ('sensible' in body) setf('sensible', body.sensible === true || body.sensible === 'true' || body.sensible === 1);
    if ('nigend_de' in body) setf('nigend_de', (body.nigend_de === null || body.nigend_de === '') ? null : parseInt(body.nigend_de, 10));
    if ('date_limit' in body) setf('date_limit', body.date_limit || null);
    if ('type' in body && body.type != null && String(body.type) !== '') {
      const t = await client.query('SELECT id FROM type_document WHERE libelle=$1 OR id::text=$1 LIMIT 1', [String(body.type)]);
      if (!t.rows.length) return { code: 400, c: 'type_inconnu', m: `Type "${body.type}" inconnu` };
      setf('type_document', t.rows[0].id);
    }
    if ('groupe' in body) {
      if (body.groupe === null || String(body.groupe) === '') setf('groupe', null);
      else {
        const g = await client.query("SELECT id FROM groupe WHERE unite=$2 AND (libelle ILIKE $1 OR libelle ILIKE 'Groupe '||$1 OR id::text=$1) LIMIT 1", [String(body.groupe), ui]);
        if (!g.rows.length) return { code: 400, c: 'groupe_inconnu', m: `Groupe "${body.groupe}" inconnu pour l unité ${ui}` };
        setf('groupe', g.rows[0].id);
      }
    }
    if ('commune' in body) {
      if (body.commune === null || String(body.commune) === '') setf('commune', null);
      else {
        const rc = await resolveCommune(client, body.commune);
        if (rc.error) return { code: 400, c: rc.error.c, m: rc.error.m };
        setf('commune', rc.code);
      }
    }
    if (!sets.length && !typeLieu && !adresse) return { code: 400, c: 'bad_request', m: 'Aucun champ modifiable fourni (synthese, type, groupe, urgent, sensible, nigend_de, date_limit, commune, type_lieu, adresse)' };

    if (sets.length) {
      vals.push(ui, ni, ai);
      const q = `UPDATE una SET ${sets.join(', ')} WHERE unite=$${vals.length-2} AND numero=$${vals.length-1} AND annee=$${vals.length}`;
      await client.query(q, vals);
    }

    // Type de lieu : upsert dans una_lieu (attribution manuelle → confiance 1.0).
    if (typeLieu || adresse) {
      const unaId = cur.rows[0].id;
      const upd = await client.query(
        "UPDATE una_lieu SET type_lieu=COALESCE($2,type_lieu), adresse_norm=COALESCE($3,adresse_norm), confiance=1.0, extrait='attribué via modification', updated_at=now() WHERE una_id=$1",
        [unaId, typeLieu, adresse]
      );
      if (upd.rowCount === 0)
        await client.query(
          "INSERT INTO una_lieu (una_id, type_lieu, adresse_norm, confiance, extrait) VALUES ($1,$2,$3,1.0,'attribué via modification')",
          [unaId, typeLieu, adresse]
        );
    }

    const r = await client.query(SELECT_UNA, [ui, ni, ai]);
    return { code: 200, data: r.rows[0] };
  } catch (e) {
    console.error('update_error', e.message);
    return { code: 500, c: 'db_error', m: 'Erreur base de données' };
  } finally { client.release(); }
}

function fold(v){ return typeof v==="string" ? v.normalize("NFD").replace(/[\u0300-\u036f]/g,"") : (v===null?"":v); }
function compact(r){ return { una:r.una, unite:r.unite, numero:r.numero, annee:r.annee, type:r.type_libelle, groupe:fold(r.groupe_libelle), synthese:fold(r.synthese), urgent:r.urgent, sensible:r.sensible }; }

const server = http.createServer(async (req, res) => {
  try {
  const u = new URL(req.url, 'http://x');
  // Journal d'exploitation SANS les paramètres de requête : en GET, certaines
  // routes portent des données de procédure en query (commune, ?identifiant=,
  // et les écritures-via-GET /procedure/creer & /modifier). On ne trace que
  // méthode, route, présence d'un jeton, agent et IP — de quoi diagnostiquer
  // sans exposer de PII dans `docker logs`.
  console.log(JSON.stringify({ t: new Date().toISOString(), m: req.method, p: u.pathname, auth: !!req.headers.authorization, ua: req.headers["user-agent"], ip: req.headers["cf-connecting-ip"] }));

  if (u.pathname === '/health') return json(res, 200, { data: { ok: true } });

  if ((req.headers.authorization || '') !== 'Bearer ' + TOKEN)
    return err(res, 401, 'unauthorized', 'Token invalide ou manquant');

  // PHOTOS (scellés) — MinIO joint en interne. Le BFF forwarde /api/photo ici.
  if (u.pathname === '/photo' && req.method === 'POST') {
    const body = await readBody(req);
    if (body === null) return err(res, 400, 'bad_request', 'Corps JSON invalide');
    try {
      const out = await photo.uploadPhoto(getMinio(), MINIO_BUCKET, body);
      if (out.data) return json(res, 200, { data: out.data });
      return err(res, out.code, out.error.code, out.error.message);
    } catch (e) { console.error('photo_upload_error', e.message); return err(res, 502, 'photo_upload', 'Stockage indisponible'); }
  }
  if (u.pathname === '/photo' && req.method === 'GET') {
    const key = u.searchParams.get('key') || '';
    let out;
    try {
      out = await photo.getPhoto(getMinio(), MINIO_BUCKET, key);
    } catch (e) { console.error('photo_get_error', e.message); return err(res, 404, 'not_found', 'Photo introuvable'); }
    if (out.error) return err(res, out.code, out.error.code, out.error.message);
    res.writeHead(200, { 'Content-Type': out.mime });
    // pipeline absorbe un hoquet de flux (MinIO/déconnexion) sans laisser remonter
    // un 'error' non écouté qui tuerait le process.
    return pipeline(out.stream, res, (e) => { if (e) { console.error('photo_get_stream', e.message); res.destroy(); } });
  }

  // PERQUISITIONS
  if (u.pathname === '/perquisition' && req.method === 'POST') {
    const body = await readBody(req);
    if (body === null) return err(res, 400, 'bad_request', 'Corps JSON invalide');
    const out = await perq.createPerquisition(pool, body);
    if (out.data) return json(res, 200, { data: out.data });
    return err(res, out.code, out.error.code, out.error.message);
  }
  if (u.pathname === '/perquisition/objets' && req.method === 'POST') {
    const body = await readBody(req);
    if (body === null) return err(res, 400, 'bad_request', 'Corps JSON invalide');
    const out = await perq.addObjets(pool, body);
    if (out.data) return json(res, 200, { data: out.data });
    return err(res, out.code, out.error.code, out.error.message);
  }
  if (u.pathname === '/perquisition/objet/update' && req.method === 'POST') {
    const body = await readBody(req);
    if (body === null) return err(res, 400, 'bad_request', 'Corps JSON invalide');
    const out = await perq.updateObjet(pool, body);
    if (out.data) return json(res, 200, { data: out.data });
    return err(res, out.code, out.error.code, out.error.message);
  }
  if (u.pathname === '/perquisition/objet/delete' && req.method === 'POST') {
    const body = await readBody(req);
    if (body === null) return err(res, 400, 'bad_request', 'Corps JSON invalide');
    const out = await perq.deleteObjet(pool, body);
    if (out.data) return json(res, 200, { data: out.data });
    return err(res, out.code, out.error.code, out.error.message);
  }
  if (u.pathname === '/perquisitions' && req.method === 'GET') {
    const out = await perq.listPerquisitions(pool, u.searchParams);
    if (out.data) return json(res, 200, { data: out.data });
    return err(res, out.code, out.error.code, out.error.message);
  }
  if (u.pathname === '/perquisition' && req.method === 'GET') {
    const id = parseInt(u.searchParams.get('id'), 10);
    if (!Number.isInteger(id)) return err(res, 400, 'bad_request', 'Paramètre id (entier) requis');
    const out = await perq.getPerquisition(pool, id);
    if (out.data) return json(res, 200, { data: out.data });
    return err(res, out.code, out.error.code, out.error.message);
  }
  if (u.pathname === '/objets/recherche' && req.method === 'GET') {
    const out = await perq.searchObjets(pool, u.searchParams);
    if (out.data) return json(res, 200, { data: out.data });
    return err(res, out.code, out.error.code, out.error.message);
  }

  // LISTE : GET /procedures (+ alias /pvs) avec filtres
  if ((u.pathname === '/procedures' || u.pathname === '/pvs') && req.method === 'GET') {
    try { return json(res, 200, { data: await listUna(u.searchParams) }); }
    catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }
  }

  // TYPES : GET /types -> liste autoritative des types de procédure (aide le LLM à choisir)
  if (u.pathname === '/types' && req.method === 'GET') {
    try {
      const r = await pool.query('SELECT id, libelle, description, mots_cles FROM type_document ORDER BY id');
      return json(res, 200, { data: r.rows });
    } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }
  }

  // COMMUNES : GET /communes?q=segre — recherche typeahead (accent-insensible) pour le sélecteur front.
  // q numérique (4-5 chiffres) → filtre code postal ou début de code INSEE ; sinon → préfixe de nom.
  if (u.pathname === '/communes' && req.method === 'GET') {
    const q = (u.searchParams.get('q') || '').trim();
    if (q.length < 2) return json(res, 200, { data: [] });
    let limit = parseInt(u.searchParams.get('limit'), 10);
    if (!Number.isInteger(limit) || limit <= 0) limit = 20;
    if (limit > 100) limit = 100;
    try {
      let rows;
      if (/^\d{4,5}$/.test(q)) {
        rows = (await pool.query(
          'SELECT code_insee, nom, code_postal FROM communes WHERE code_postal LIKE $1 OR code_insee LIKE $1 ORDER BY nom LIMIT ' + limit,
          [q + '%'])).rows;
      } else {
        rows = (await pool.query(
          'SELECT code_insee, nom, code_postal FROM communes WHERE nom_norm LIKE $1 ORDER BY nom LIMIT ' + limit,
          [fold(q).toLowerCase() + '%'])).rows;
      }
      return json(res, 200, { data: rows });
    } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }
  }

  // MODIFICATION : POST /procedure/modifier (+ /pv/modifier) — identité immuable
  if ((u.pathname === '/modifier' || u.pathname === '/procedure/modifier' || u.pathname === '/pv/modifier') && (req.method === 'POST' || req.method === 'GET')) {
    const body = req.method === 'GET' ? Object.fromEntries(u.searchParams) : await readBody(req);
    if (body === null) return err(res, 400, 'bad_request', 'Corps JSON invalide');
    const out = await updateUna(body);
    if (out.data) return json(res, out.code, { data: out.data });
    return err(res, out.code, out.c, out.m);
  }

  // CREATE via GET (contournement bug IAka sur POST) : params en query
  if (u.pathname === '/procedure/creer' && req.method === 'GET') {
    const out = await createUna(Object.fromEntries(u.searchParams));
    if (out.data) return json(res, out.code, { data: out.data });
    return err(res, out.code, out.c, out.m);
  }

  const isPV = u.pathname === '/procedure' || u.pathname === '/pv';

  // LECTURE : GET
  if (isPV && req.method === 'GET') {
    const [ui, ni, ai] = parseUna(u.searchParams);
    if (![ui, ni, ai].every(Number.isInteger)) return err(res, 400, 'bad_request', 'Numéro attendu: unite/numero/annee (entiers)');
    try {
      const r = await pool.query(SELECT_UNA, [ui, ni, ai]);
      if (!r.rows.length) return err(res, 404, 'not_found', `UNA ${ui}/${ni}/${ai} introuvable`);
      return json(res, 200, { data: r.rows[0] });
    } catch (e) { console.error('db_error', e.message); return err(res, 500, 'db_error', 'Erreur base de données'); }
  }

  // CRÉATION : POST → génère un nouveau numéro de procédure
  if (isPV && req.method === 'POST') {
    const body = await readBody(req);
    if (body === null) return err(res, 400, 'bad_request', 'Corps JSON invalide');
    const out = await createUna(body);
    if (out.data) return json(res, out.code, out.warning ? { data: out.data, warning: out.warning } : { data: out.data });
    return err(res, out.code, out.c, out.m);
  }

  return err(res, 404, 'not_found', 'Route inconnue');
  } catch (e) {
    if (e?.code === 'BODY_TOO_LARGE' || e?.message === 'BODY_TOO_LARGE') {
      return err(res, 413, 'body_too_large', 'Corps de requête trop volumineux');
    }
    console.error('handler_unhandled', e?.message);
    return err(res, 500, 'internal_error', 'Erreur interne');
  }
});

if (require.main === module) server.listen(8080, () => console.log('rgp-api :8080'));

module.exports = { createUna, listUna, updateUna, LIEU_TYPES };
