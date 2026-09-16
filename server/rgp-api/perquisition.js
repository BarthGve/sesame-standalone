// perquisition.js — logique perquisitions/objets saisis pour rgp-api.
// Fonctions pures (normalizeIdent, extractIdentifiants) testables sans DB ;
// fonctions DB prennent un pool/client pg (.query) déjà prêt.

// Mapping cle de champ (catalogue front) -> type d'identifiant fort, par catégorie.
const IDENT_MAP = {
  TRANSPORT: { nmr_immatriculation: 'IMMATRICULATION', numero_serie: 'VIN', numero_moteur: 'NUMERO_MOTEUR', numero_bic: 'BIC' },
  MULTIMEDIA: { imei: 'IMEI', numero_sim: 'SIM', numero_appel: 'MSISDN' },
  ARME: { numero: 'NUMERO_SERIE_ARME' },
  DOCUMENT: { numero: 'NUMERO_DOCUMENT' },
  MOYEN_PAIEMENT: { numero_compte: 'NUMERO_COMPTE' },
};

function normalizeIdent(v) {
  return String(v ?? '').toUpperCase().replace(/[\s.\-/]/g, '');
}

function extractIdentifiants(categorie, champs) {
  const map = IDENT_MAP[categorie] || {};
  const hasMap = !!IDENT_MAP[categorie];
  const out = [];
  for (const c of champs || []) {
    const val = c && c.valeur != null ? String(c.valeur).trim() : '';
    if (!val) continue;
    let type = map[c.cle];
    if (!type && !hasMap && c.cle === 'numero') type = 'NUMERO_SERIE';
    if (!type) continue;
    out.push({ type, valeur: val, valeur_norm: normalizeIdent(val) });
  }
  return out;
}

function fold(v) {
  return typeof v === 'string' ? v.normalize('NFD').replace(/[̀-ͯ]/g, '') : (v == null ? '' : v);
}

async function resolveCommuneCode(q, raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { code: null };
  if (/^(\d{5}|2[ab]\d{3})$/i.test(s)) {
    const r = await q.query('SELECT code_insee FROM communes WHERE code_insee = upper($1)', [s]);
    return r.rows.length ? { code: r.rows[0].code_insee } : { error: { code: 'commune_inconnue', message: `Commune "${s}" inconnue` } };
  }
  const r = await q.query('SELECT code_insee FROM communes WHERE nom_norm = $1', [fold(s).toLowerCase()]);
  if (r.rows.length === 1) return { code: r.rows[0].code_insee };
  if (r.rows.length > 1) return { error: { code: 'commune_ambigue', message: `Commune "${s}" ambiguë` } };
  return { error: { code: 'commune_inconnue', message: `Commune "${s}" inconnue` } };
}

async function resolveUnaId(q, body) {
  const idRaw = body.una_id;
  if (idRaw != null && /^\d+$/.test(String(idRaw))) {
    const r = await q.query('SELECT id FROM una WHERE id=$1', [parseInt(idRaw, 10)]);
    return r.rows.length ? { id: r.rows[0].id } : { error: { code: 'una_inconnu', message: `UNA id ${idRaw} introuvable` } };
  }
  const combo = String(body.una || body.pv || '').trim();
  const parts = combo.split('/');
  if (parts.length !== 3) return { error: { code: 'bad_request', message: 'UNA requis : "unite/numero/annee" ou una_id' } };
  const [u, n, a] = parts.map((x) => parseInt(x, 10));
  if (![u, n, a].every(Number.isInteger)) return { error: { code: 'bad_request', message: 'UNA invalide' } };
  const r = await q.query('SELECT id FROM una WHERE unite=$1 AND numero=$2 AND annee=$3', [u, n, a]);
  return r.rows.length ? { id: r.rows[0].id } : { error: { code: 'una_inconnu', message: `UNA ${combo} introuvable` } };
}

async function getPerquisition(pool, id) {
  const p = await pool.query(
    `SELECT p.*, u.unite || '/' || u.numero || '/' || u.annee AS una, c.nom AS commune_libelle
     FROM perquisition p JOIN una u ON u.id = p.una_id
     LEFT JOIN communes c ON c.code_insee = p.commune WHERE p.id = $1`, [id]);
  if (!p.rows.length) return { code: 404, error: { code: 'not_found', message: `Perquisition ${id} introuvable` } };
  const perq = p.rows[0];
  perq.intervenants = (await pool.query('SELECT texte FROM perquisition_intervenant WHERE perquisition_id=$1 ORDER BY ordre', [id])).rows.map((r) => r.texte);
  perq.pieces = (await pool.query('SELECT libelle FROM perquisition_piece WHERE perquisition_id=$1 ORDER BY ordre', [id])).rows.map((r) => r.libelle);
  const objets = (await pool.query('SELECT * FROM objet_saisi WHERE perquisition_id=$1 ORDER BY id', [id])).rows;
  for (const o of objets) {
    o.champs = (await pool.query('SELECT cle, libelle, valeur, source, obligatoire FROM objet_champ WHERE objet_id=$1 ORDER BY ordre', [o.id])).rows;
    o.identifiants = (await pool.query('SELECT type, valeur FROM objet_identifiant WHERE objet_id=$1', [o.id])).rows;
    o.estimation_sources = (await pool.query('SELECT site, url, prix FROM objet_estimation_source WHERE objet_id=$1 ORDER BY ordre', [o.id])).rows;
    o.estimation_hypotheses = (await pool.query('SELECT texte FROM objet_estimation_hypothese WHERE objet_id=$1 ORDER BY ordre', [o.id])).rows.map((r) => r.texte);
    o.categories_alternatives = (await pool.query('SELECT categorie, confiance FROM objet_categorie_alternative WHERE objet_id=$1', [o.id])).rows;
  }
  perq.objets = objets;
  return { code: 200, data: perq };
}

// Insère les champs + identifiants (extraits) d'un objet déjà créé (client de transaction ouvert).
async function insertChampsIdentifiants(client, objId, categorie, champs) {
  const list = champs || [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    await client.query('INSERT INTO objet_champ (objet_id, cle, libelle, valeur, source, obligatoire, ordre) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [objId, c.cle, c.libelle ?? c.cle, c.valeur ?? null, c.source || null, !!c.obligatoire, i]);
  }
  for (const id of extractIdentifiants(categorie, list))
    await client.query('INSERT INTO objet_identifiant (objet_id, type, valeur, valeur_norm) VALUES ($1,$2,$3,$4)', [objId, id.type, id.valeur, id.valeur_norm]);
}

// Énumérations contraintes en base (migrations) — une valeur hors liste ou une
// catégorie manquante casse la transaction multi-objets en un 500 db_error opaque
// qui perd tout le lot. On valide EN AMONT, avant tout BEGIN, pour renvoyer un 400
// précis et ne rien écrire. (perquisition.type_lieu et objet_saisi.situation.)
const TYPE_LIEU_PERQ = ['DOMICILE', 'LOCAL_PRO', 'VEHICULE', 'AUTRE'];
const SITUATIONS = ['SAISI_SOUS_SCELLE', 'SAISI_NON_SCELLE'];

function validerTypeLieu(v) {
  if (v == null || String(v).trim() === '') return null;
  if (!TYPE_LIEU_PERQ.includes(String(v)))
    return { code: 'bad_request', message: `type_lieu "${v}" invalide (attendu : ${TYPE_LIEU_PERQ.join(', ')})` };
  return null;
}

function validerSituation(v, ctx) {
  if (v == null || String(v).trim() === '') return null;
  if (!SITUATIONS.includes(String(v)))
    return { code: 'bad_request', message: `${ctx}situation "${v}" invalide (attendu : ${SITUATIONS.join(', ')})` };
  return null;
}

// Valide un lot d'objets : catégorie non vide (colonne NOT NULL) + situation dans
// l'énum. Renvoie la 1re erreur rencontrée (avec l'index de l'objet fautif) ou null.
function validerObjets(objets) {
  for (let i = 0; i < objets.length; i++) {
    const o = objets[i] || {};
    if (!o.categorie || !String(o.categorie).trim())
      return { code: 'bad_request', message: `objets[${i}] : categorie requise (non vide)` };
    const e = validerSituation(o.situation, `objets[${i}] : `);
    if (e) return e;
  }
  return null;
}

// Insère une liste d'objets (+ champs, identifiants, estimation, alternatives) pour une
// perquisition, via un client de transaction déjà ouvert (BEGIN fait par l'appelant).
async function insertObjets(client, perqId, objets) {
  for (const o of objets) {
    const est = o.estimation || {};
    const obj = await client.query(
      `INSERT INTO objet_saisi (perquisition_id, categorie, sous_type, confiance, numero_scelle, situation, lieu, photo_url,
         estim_prix_bas, estim_prix_moyen, estim_prix_haut, estim_devise, estim_confiance, estim_avertissement)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [perqId, o.categorie, o.sous_type || null, o.confiance ?? null, o.numero_scelle || null,
       o.situation || null, o.lieu || null, o.photo_url || null,
       est.prixBas ?? null, est.prixMoyen ?? null, est.prixHaut ?? null, est.devise || null, est.confiance ?? null, est.avertissement || null]);
    const objId = obj.rows[0].id;
    const champs = o.champs || [];
    await insertChampsIdentifiants(client, objId, o.categorie, champs);
    const sources = est.sources || [];
    for (let i = 0; i < sources.length; i++)
      await client.query('INSERT INTO objet_estimation_source (objet_id, site, url, prix, ordre) VALUES ($1,$2,$3,$4,$5)', [objId, sources[i].site || null, sources[i].url || null, sources[i].prix ?? null, i]);
    const hyps = est.hypotheses || [];
    for (let i = 0; i < hyps.length; i++)
      await client.query('INSERT INTO objet_estimation_hypothese (objet_id, texte, ordre) VALUES ($1,$2,$3)', [objId, String(hyps[i]), i]);
    for (const a of (o.categoriesAlternatives || []))
      await client.query('INSERT INTO objet_categorie_alternative (objet_id, categorie, confiance) VALUES ($1,$2,$3)', [objId, a.categorie, a.confiance ?? null]);
  }
}

// Ajoute des objets à une perquisition existante (transaction dédiée).
async function addObjets(pool, body) {
  const pid = parseInt(body.perquisition_id, 10);
  if (!Number.isInteger(pid)) return { code: 400, error: { code: 'bad_request', message: 'perquisition_id (entier) requis' } };
  if (!Array.isArray(body.objets) || body.objets.length === 0) return { code: 400, error: { code: 'bad_request', message: 'objets[] non vide requis' } };
  const eObj = validerObjets(body.objets);
  if (eObj) return { code: 400, error: eObj };
  const client = await pool.connect();
  try {
    const ex = await client.query('SELECT id FROM perquisition WHERE id=$1', [pid]);
    if (!ex.rows.length) return { code: 404, error: { code: 'not_found', message: `Perquisition ${pid} introuvable` } };
    await client.query('BEGIN');
    await insertObjets(client, pid, body.objets);
    await client.query('COMMIT');
    return await getPerquisition(client, pid);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('perq_add_error', e.message);
    return { code: 500, error: { code: 'db_error', message: 'Erreur base de données' } };
  } finally {
    client.release();
  }
}

// Une estimation n'est « exploitable » que si elle porte au moins un montant
// numérique fini (bas, moyen ou haut). Une estimation vide {} ou sans aucun prix
// n'est pas une instruction d'effacement : c'est une entrée dégénérée qu'on
// refuse, pour ne jamais transformer un appel bancal en perte silencieuse des
// montants déjà en base (données remontées à l'AGRASC).
function estimationExploitable(est) {
  if (!est || typeof est !== 'object') return false;
  return [est.prixBas, est.prixMoyen, est.prixHaut].some((v) => typeof v === 'number' && Number.isFinite(v));
}

// Met à jour un objet existant, en MISE À JOUR PARTIELLE (photo_url toujours inchangé) :
//  - descriptif (categorie, sous_type, numero_scelle, situation, lieu) : mis à jour
//    uniquement si body.categorie est présent ;
//  - champs / identifiants REMPLACÉS uniquement si body.champs est fourni
//    (body.champs === undefined => intacts ; body.champs === [] => vidés) ;
//  - estimation (colonnes estim_* + tables source/hypothese) reconstruite uniquement
//    si body.estimation est présent ET exploitable (même écriture que insertObjets) ;
//    une estimation fournie mais sans montant exploitable est REFUSÉE (400), jamais
//    appliquée comme un effacement.
// Chaque table enfant (sources, hypotheses) n'est reconstruite que si son tableau
// est explicitement fourni : omettre la clé laisse l'existant intact, ne le vide pas.
// Un appel « estimation seule » ({ objet_id, estimation }) ne touche donc ni au
// descriptif, ni aux champs, ni aux identifiants.
async function updateObjet(pool, body) {
  const oid = parseInt(body.objet_id, 10);
  if (!Number.isInteger(oid)) return { code: 400, error: { code: 'bad_request', message: 'objet_id (entier) requis' } };
  // Garde anti-effacement : une estimation présente mais vide/sans montant est
  // rejetée avant toute écriture, plutôt que d'effacer les montants existants.
  if (body.estimation !== undefined && !estimationExploitable(body.estimation))
    return { code: 400, error: { code: 'bad_request', message: 'estimation fournie sans montant exploitable (prix bas, moyen ou haut requis)' } };
  // Le descriptif (dont situation) n'est réécrit que si categorie est fournie :
  // on ne valide donc situation que dans ce cas, avant d'ouvrir la transaction.
  if (body.categorie) {
    if (!String(body.categorie).trim())
      return { code: 400, error: { code: 'bad_request', message: 'categorie fournie mais vide' } };
    const eSit = validerSituation(body.situation, '');
    if (eSit) return { code: 400, error: eSit };
  }
  const client = await pool.connect();
  try {
    const ex = await client.query('SELECT perquisition_id FROM objet_saisi WHERE id=$1', [oid]);
    if (!ex.rows.length) return { code: 404, error: { code: 'not_found', message: `Objet ${oid} introuvable` } };
    const perqId = ex.rows[0].perquisition_id;
    await client.query('BEGIN');
    // Colonnes descriptives : uniquement si categorie fournie.
    if (body.categorie) {
      await client.query(
        'UPDATE objet_saisi SET categorie=$1, sous_type=$2, numero_scelle=$3, situation=$4, lieu=$5 WHERE id=$6',
        [body.categorie, body.sous_type || null, body.numero_scelle || null, body.situation || null, body.lieu || null, oid]);
    }
    // Champs + identifiants : remplacés uniquement si champs explicitement fourni.
    if (body.champs !== undefined) {
      await client.query('DELETE FROM objet_champ WHERE objet_id=$1', [oid]);
      await client.query('DELETE FROM objet_identifiant WHERE objet_id=$1', [oid]);
      await insertChampsIdentifiants(client, oid, body.categorie, body.champs);
    }
    // Estimation : colonnes estim_* + tables reconstruites uniquement si estimation fournie.
    if (body.estimation) {
      const est = body.estimation;
      await client.query(
        'UPDATE objet_saisi SET estim_prix_bas=$1, estim_prix_moyen=$2, estim_prix_haut=$3, estim_devise=$4, estim_confiance=$5, estim_avertissement=$6 WHERE id=$7',
        [est.prixBas ?? null, est.prixMoyen ?? null, est.prixHaut ?? null, est.devise || null, est.confiance ?? null, est.avertissement || null, oid]);
      // Tables enfant reconstruites SEULEMENT si leur tableau est fourni : sources
      // absente => on laisse les sources existantes ; sources: [] => on les vide.
      if (est.sources !== undefined) {
        await client.query('DELETE FROM objet_estimation_source WHERE objet_id=$1', [oid]);
        for (let i = 0; i < est.sources.length; i++)
          await client.query('INSERT INTO objet_estimation_source (objet_id, site, url, prix, ordre) VALUES ($1,$2,$3,$4,$5)', [oid, est.sources[i].site || null, est.sources[i].url || null, est.sources[i].prix ?? null, i]);
      }
      if (est.hypotheses !== undefined) {
        await client.query('DELETE FROM objet_estimation_hypothese WHERE objet_id=$1', [oid]);
        for (let i = 0; i < est.hypotheses.length; i++)
          await client.query('INSERT INTO objet_estimation_hypothese (objet_id, texte, ordre) VALUES ($1,$2,$3)', [oid, String(est.hypotheses[i]), i]);
      }
    }
    await client.query('COMMIT');
    return await getPerquisition(client, perqId);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('perq_update_objet_error', e.message);
    return { code: 500, error: { code: 'db_error', message: 'Erreur base de données' } };
  } finally {
    client.release();
  }
}

// Supprime un objet existant (le CASCADE retire champs/identifiants/estimation/alternatives).
async function deleteObjet(pool, body) {
  const oid = parseInt(body.objet_id, 10);
  if (!Number.isInteger(oid)) return { code: 400, error: { code: 'bad_request', message: 'objet_id (entier) requis' } };
  const client = await pool.connect();
  try {
    const ex = await client.query('SELECT perquisition_id FROM objet_saisi WHERE id=$1', [oid]);
    if (!ex.rows.length) return { code: 404, error: { code: 'not_found', message: `Objet ${oid} introuvable` } };
    const perqId = ex.rows[0].perquisition_id;
    await client.query('DELETE FROM objet_saisi WHERE id=$1', [oid]);
    return await getPerquisition(client, perqId);
  } catch (e) {
    console.error('perq_delete_objet_error', e.message);
    return { code: 500, error: { code: 'db_error', message: 'Erreur base de données' } };
  } finally {
    client.release();
  }
}

async function createPerquisition(pool, body) {
  if (!Array.isArray(body.objets)) return { code: 400, error: { code: 'bad_request', message: 'objets[] requis' } };
  if (!body.adresse || !String(body.adresse).trim()) return { code: 400, error: { code: 'bad_request', message: 'adresse requise' } };
  const eLieu = validerTypeLieu(body.type_lieu);
  if (eLieu) return { code: 400, error: eLieu };
  const eObj = validerObjets(body.objets);
  if (eObj) return { code: 400, error: eObj };
  const client = await pool.connect();
  try {
    const rUna = await resolveUnaId(client, body);
    if (rUna.error) return { code: rUna.error.code === 'una_inconnu' ? 404 : 400, error: rUna.error };
    const rCom = await resolveCommuneCode(client, body.commune);
    if (rCom.error) return { code: 400, error: rCom.error };

    await client.query('BEGIN');
    const perq = await client.query(
      `INSERT INTO perquisition (una_id, adresse, code_postal, commune, latitude, longitude, type_lieu, perquisitionne, opj, date_debut, date_fin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [rUna.id, String(body.adresse), body.code_postal || null, rCom.code,
       body.latitude ?? null, body.longitude ?? null, body.type_lieu || null,
       body.perquisitionne || null, body.opj || null, body.date_debut || null, body.date_fin || null]);
    const perqId = perq.rows[0].id;

    const intervenants = (body.intervenants || []).filter((x) => x && String(x).trim());
    for (let i = 0; i < intervenants.length; i++)
      await client.query('INSERT INTO perquisition_intervenant (perquisition_id, texte, ordre) VALUES ($1,$2,$3)', [perqId, String(intervenants[i]), i]);
    const pieces = (body.pieces || []).filter((x) => x && String(x).trim());
    for (let i = 0; i < pieces.length; i++)
      await client.query('INSERT INTO perquisition_piece (perquisition_id, libelle, ordre) VALUES ($1,$2,$3)', [perqId, String(pieces[i]), i]);

    await insertObjets(client, perqId, body.objets);
    await client.query('COMMIT');
    return await getPerquisition(client, perqId);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('perq_create_error', e.message);
    return { code: 500, error: { code: 'db_error', message: 'Erreur base de données' } };
  } finally {
    client.release();
  }
}

async function listPerquisitions(pool, params) {
  const rUna = await resolveUnaId(pool, { una: params.get('una'), una_id: params.get('una_id') });
  if (rUna.error) return { code: rUna.error.code === 'una_inconnu' ? 404 : 400, error: rUna.error };
  const r = await pool.query(
    `SELECT p.id, p.adresse, p.code_postal, p.commune, c.nom AS commune_libelle, p.type_lieu, p.date_debut, p.created_at,
            (SELECT count(*) FROM objet_saisi o WHERE o.perquisition_id = p.id) AS nb_objets
     FROM perquisition p LEFT JOIN communes c ON c.code_insee = p.commune
     WHERE p.una_id = $1 ORDER BY p.created_at DESC`, [rUna.id]);
  return { code: 200, data: r.rows };
}

async function searchObjets(pool, params) {
  const ident = String(params.get('identifiant') || '').trim();
  if (!ident) return { code: 400, error: { code: 'bad_request', message: 'identifiant requis' } };
  const type = params.get('type');
  const vals = [normalizeIdent(ident)];
  let sql = `SELECT oi.type, oi.valeur, o.id AS objet_id, o.categorie, o.numero_scelle,
              p.id AS perquisition_id, p.adresse, u.unite || '/' || u.numero || '/' || u.annee AS una
             FROM objet_identifiant oi
             JOIN objet_saisi o ON o.id = oi.objet_id
             JOIN perquisition p ON p.id = o.perquisition_id
             JOIN una u ON u.id = p.una_id
             WHERE oi.valeur_norm = $1`;
  if (type) { vals.push(type); sql += ' AND oi.type = $2'; }
  sql += ' ORDER BY o.id';
  const r = await pool.query(sql, vals);
  return { code: 200, data: r.rows };
}

module.exports = { normalizeIdent, extractIdentifiants, insertChampsIdentifiants, insertObjets, createPerquisition, addObjets, updateObjet, deleteObjet, getPerquisition, listPerquisitions, searchObjets };
