const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeIdent, extractIdentifiants } = require('./perquisition');

test('normalizeIdent : majuscules, sépérateurs retirés', () => {
  assert.strictEqual(normalizeIdent('ab-123 cd'), 'AB123CD');
  assert.strictEqual(normalizeIdent(' vf1.234/56 '), 'VF123456');
  assert.strictEqual(normalizeIdent(null), '');
});

test('extractIdentifiants : mapping TRANSPORT', () => {
  const champs = [
    { cle: 'nmr_immatriculation', valeur: 'AB-123-CD' },
    { cle: 'numero_serie', valeur: 'VF1234567' },
    { cle: 'couleur', valeur: 'rouge' },
  ];
  assert.deepStrictEqual(extractIdentifiants('TRANSPORT', champs), [
    { type: 'IMMATRICULATION', valeur: 'AB-123-CD', valeur_norm: 'AB123CD' },
    { type: 'VIN', valeur: 'VF1234567', valeur_norm: 'VF1234567' },
  ]);
});

test('extractIdentifiants : fallback numero -> NUMERO_SERIE pour catégorie non mappée', () => {
  assert.deepStrictEqual(extractIdentifiants('BIJOU', [{ cle: 'numero', valeur: 'X9' }]),
    [{ type: 'NUMERO_SERIE', valeur: 'X9', valeur_norm: 'X9' }]);
});

test('extractIdentifiants : valeurs vides ignorées', () => {
  assert.deepStrictEqual(extractIdentifiants('MULTIMEDIA', [{ cle: 'imei', valeur: '' }]), []);
});

test('extractIdentifiants : numero non mappé si catégorie a déjà un mapping', () => {
  // ARME mappe numero -> NUMERO_SERIE_ARME (pas le fallback générique)
  assert.deepStrictEqual(extractIdentifiants('ARME', [{ cle: 'numero', valeur: 'A1' }]),
    [{ type: 'NUMERO_SERIE_ARME', valeur: 'A1', valeur_norm: 'A1' }]);
});

const { addObjets } = require('./perquisition');

test('addObjets : perquisition_id manquant -> 400', async () => {
  const pool = { connect: async () => { throw new Error('should not connect'); } };
  const out = await addObjets(pool, { objets: [{ categorie: 'DIVERS', champs: [] }] });
  assert.equal(out.code, 400);
});

test('addObjets : objets vide -> 400', async () => {
  const pool = { connect: async () => { throw new Error('should not connect'); } };
  const out = await addObjets(pool, { perquisition_id: 5, objets: [] });
  assert.equal(out.code, 400);
});

test('addObjets : perquisition inexistante -> 404', async () => {
  const client = { query: async () => ({ rows: [] }), release() {} };
  const pool = { connect: async () => client };
  const out = await addObjets(pool, { perquisition_id: 999, objets: [{ categorie: 'DIVERS', champs: [] }] });
  assert.equal(out.code, 404);
  assert.equal(out.error.code, 'not_found');
});

// Validation d'énumération EN AMONT (avant transaction) : un objet invalide ne doit
// jamais ouvrir de connexion — sinon la contrainte CHECK/NOT NULL casserait tout le lot.
const noConnect = { connect: async () => { throw new Error('ne doit pas se connecter'); } };

test('addObjets : categorie manquante -> 400 sans connexion', async () => {
  const out = await addObjets(noConnect, { perquisition_id: 5, objets: [{ numero_scelle: 'S1' }] });
  assert.equal(out.code, 400);
  assert.match(out.error.message, /objets\[0\].*categorie/);
});

test('addObjets : situation hors énum -> 400 sans connexion', async () => {
  const out = await addObjets(noConnect, { perquisition_id: 5, objets: [{ categorie: 'DIVERS', situation: 'PLACARD' }] });
  assert.equal(out.code, 400);
  assert.match(out.error.message, /situation.*invalide/);
});

test('addObjets : situation valide -> passe la validation (atteint la connexion)', async () => {
  const client = { query: async () => ({ rows: [] }), release() {} };
  const out = await addObjets({ connect: async () => client }, { perquisition_id: 999, objets: [{ categorie: 'DIVERS', situation: 'SAISI_SOUS_SCELLE' }] });
  assert.equal(out.code, 404, 'la validation passe, on atteint le contrôle d\'existence (404)');
});

const { createPerquisition } = require('./perquisition');

test('createPerquisition : type_lieu hors énum -> 400 sans connexion', async () => {
  const out = await createPerquisition(noConnect, { adresse: '1 rue X', type_lieu: 'CHATEAU', objets: [] });
  assert.equal(out.code, 400);
  assert.match(out.error.message, /type_lieu.*invalide/);
});

test('createPerquisition : objet sans categorie -> 400 sans connexion', async () => {
  const out = await createPerquisition(noConnect, { adresse: '1 rue X', type_lieu: 'DOMICILE', objets: [{ numero_scelle: 'S1' }] });
  assert.equal(out.code, 400);
  assert.match(out.error.message, /categorie/);
});

test('updateObjet : situation hors énum (avec categorie) -> 400 sans connexion', async () => {
  const out = await updateObjet(noConnect, { objet_id: 3, categorie: 'DIVERS', situation: 'AILLEURS' });
  assert.equal(out.code, 400);
  assert.match(out.error.message, /situation.*invalide/);
});

const { updateObjet } = require('./perquisition');

// Faux pool/client ENREGISTREUR : capture chaque query(sql, params) émis pour pouvoir
// affirmer quel SQL a réellement été exécuté. Répond juste ce qu'il faut pour que
// updateObjet atteigne son COMMIT puis la relecture getPerquisition sans planter :
//  - la recherche `SELECT perquisition_id FROM objet_saisi WHERE id=$1` renvoie 1 ligne
//    (ou 0 si found=false, pour tester le 404) ;
//  - la 1re requête de getPerquisition (`FROM perquisition p JOIN una`) renvoie 1 ligne ;
//  - la requête des objets (`SELECT * FROM objet_saisi WHERE perquisition_id=$1`) renvoie
//    une liste vide, pour que la boucle de relecture (qui relit elle-même les tables
//    d'estimation) ne s'exécute pas et ne pollue pas nos assertions sur les verbes SQL.
function makeRecordingPool({ found = true } = {}) {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql: String(sql), params });
      const s = String(sql);
      if (s.includes('SELECT perquisition_id FROM objet_saisi')) return { rows: found ? [{ perquisition_id: 1 }] : [] };
      if (s.includes('FROM perquisition p JOIN una')) return { rows: [{ id: 1, una_id: 1, una: '1/1/2024' }] };
      return { rows: [] };
    },
    release() {},
  };
  return { pool: { connect: async () => client }, calls };
}

test('updateObjet : objet_id manquant -> 400', async () => {
  const pool = { connect: async () => { throw new Error('no'); } };
  const out = await updateObjet(pool, { categorie: 'DIVERS', champs: [] });
  assert.equal(out.code, 400);
});

// NOUVEAU CONTRAT (remplace l'ancien « categorie manquante -> 400 ») : categorie n'est
// plus requise, un appel « estimation seule » est valide.
test('updateObjet : appel estimation seule accepté (categorie non requise)', async () => {
  const { pool } = makeRecordingPool();
  const out = await updateObjet(pool, { objet_id: 5, estimation: { prixMoyen: 1000, devise: 'EUR' } });
  assert.equal(out.code, 200);
});

test('updateObjet : objet inexistant -> 404', async () => {
  const { pool } = makeRecordingPool({ found: false });
  const out = await updateObjet(pool, { objet_id: 999, categorie: 'DIVERS', champs: [] });
  assert.equal(out.code, 404);
  assert.equal(out.error.code, 'not_found');
});

test('updateObjet : estimation seule -> UPDATE estim_* + rebuild sources/hypotheses, SANS toucher champs/identifiants/descriptif', async () => {
  const { pool, calls } = makeRecordingPool();
  const out = await updateObjet(pool, {
    objet_id: 42,
    estimation: {
      prixBas: 8500, prixMoyen: 10200, prixHaut: 11800, devise: 'EUR',
      confiance: 0.7, avertissement: 'AVERT',
      sources: [{ site: 'LaCentrale', url: 'https://x/1', prix: 10490 }],
      hypotheses: ['Kilométrage 120000'],
    },
  });
  assert.equal(out.code, 200);
  // UPDATE des colonnes estim_* avec les bons paramètres (ordre = shape canonique).
  const estUpd = calls.find((c) => /UPDATE objet_saisi SET estim_prix_bas/.test(c.sql));
  assert.ok(estUpd, 'UPDATE estim_* attendu');
  assert.deepEqual(estUpd.params, [8500, 10200, 11800, 'EUR', 0.7, 'AVERT', 42]);
  // Sources + hypotheses reconstruites (DELETE puis INSERT ordonné).
  assert.ok(calls.some((c) => /DELETE FROM objet_estimation_source/.test(c.sql)), 'DELETE sources');
  const insSrc = calls.find((c) => /INSERT INTO objet_estimation_source/.test(c.sql));
  assert.ok(insSrc, 'INSERT source');
  assert.deepEqual(insSrc.params, [42, 'LaCentrale', 'https://x/1', 10490, 0]);
  assert.ok(calls.some((c) => /DELETE FROM objet_estimation_hypothese/.test(c.sql)), 'DELETE hypotheses');
  const insHyp = calls.find((c) => /INSERT INTO objet_estimation_hypothese/.test(c.sql));
  assert.ok(insHyp, 'INSERT hypothese');
  assert.deepEqual(insHyp.params, [42, 'Kilométrage 120000', 0]);
  // Ne touche NI le descriptif NI les champs/identifiants.
  assert.ok(!calls.some((c) => /UPDATE objet_saisi SET categorie/.test(c.sql)), 'pas d UPDATE descriptif');
  assert.ok(!calls.some((c) => /DELETE FROM objet_champ/.test(c.sql)), 'pas de DELETE objet_champ');
  assert.ok(!calls.some((c) => /DELETE FROM objet_identifiant/.test(c.sql)), 'pas de DELETE objet_identifiant');
});

test('updateObjet : descriptif (categorie + champs) sans estimation -> UPDATE descriptif + rebuild champs, SANS toucher estim_*', async () => {
  const { pool, calls } = makeRecordingPool();
  const out = await updateObjet(pool, {
    objet_id: 7, categorie: 'TRANSPORT', sous_type: 'VOITURE',
    numero_scelle: 'SC1', situation: 'SAISI_SOUS_SCELLE', lieu: 'Garage',
    champs: [{ cle: 'nmr_immatriculation', libelle: 'Immat', valeur: 'AB-123-CD' }],
  });
  assert.equal(out.code, 200);
  const descUpd = calls.find((c) => /UPDATE objet_saisi SET categorie/.test(c.sql));
  assert.ok(descUpd, 'UPDATE descriptif attendu');
  assert.deepEqual(descUpd.params, ['TRANSPORT', 'VOITURE', 'SC1', 'SAISI_SOUS_SCELLE', 'Garage', 7]);
  assert.ok(calls.some((c) => /DELETE FROM objet_champ/.test(c.sql)), 'DELETE objet_champ');
  assert.ok(calls.some((c) => /DELETE FROM objet_identifiant/.test(c.sql)), 'DELETE objet_identifiant');
  assert.ok(calls.some((c) => /INSERT INTO objet_champ/.test(c.sql)), 'INSERT objet_champ');
  // Aucune écriture d'estimation.
  assert.ok(!calls.some((c) => /UPDATE objet_saisi SET estim_prix_bas/.test(c.sql)), 'pas d UPDATE estim_*');
  assert.ok(!calls.some((c) => /DELETE FROM objet_estimation_source/.test(c.sql)), 'pas de DELETE sources');
  assert.ok(!calls.some((c) => /DELETE FROM objet_estimation_hypothese/.test(c.sql)), 'pas de DELETE hypotheses');
});

// updateObjet SAIT désormais persister une estimation portée par un appel complet
// (forme descriptif + estimation). NB : l'écran d'édition des saisies n'envoie pas
// encore d'estimation (apiObjetToDraft ne reconstruit pas estimationPrix) — c'est la
// capacité serveur qui est vérifiée ici, pas ce chemin front.
test('updateObjet : appel complet (descriptif + estimation) persiste l estimation', async () => {
  const { pool, calls } = makeRecordingPool();
  const out = await updateObjet(pool, {
    objet_id: 9, categorie: 'TRANSPORT', sous_type: 'VOITURE',
    numero_scelle: 'SC9', situation: 'SAISI_SOUS_SCELLE', lieu: 'Box',
    estimation: { prixBas: 1000, prixMoyen: 1500, prixHaut: 2000, devise: 'EUR', confiance: 0.6, avertissement: 'A', sources: [], hypotheses: [] },
    champs: [{ cle: 'couleur', libelle: 'Couleur', valeur: 'rouge' }],
  });
  assert.equal(out.code, 200);
  const estUpd = calls.find((c) => /UPDATE objet_saisi SET estim_prix_bas/.test(c.sql));
  assert.ok(estUpd, 'estimation persistée');
  assert.deepEqual(estUpd.params, [1000, 1500, 2000, 'EUR', 0.6, 'A', 9]);
  assert.ok(calls.some((c) => /UPDATE objet_saisi SET categorie/.test(c.sql)), 'descriptif aussi mis à jour');
});

// GARDE ANTI-EFFACEMENT : une estimation présente mais sans montant exploitable est
// refusée AVANT toute connexion — elle ne doit jamais s'appliquer comme un effacement
// des montants déjà en base (données remontées à l'AGRASC).
test('updateObjet : estimation vide {} -> 400 avant toute connexion', async () => {
  const pool = { connect: async () => { throw new Error('ne doit pas se connecter'); } };
  const out = await updateObjet(pool, { objet_id: 5, estimation: {} });
  assert.equal(out.code, 400);
  assert.equal(out.error.code, 'bad_request');
});

test('updateObjet : estimation sans montant (devise/sources seules) -> 400, non appliquée', async () => {
  const pool = { connect: async () => { throw new Error('ne doit pas se connecter'); } };
  const out = await updateObjet(pool, { objet_id: 5, estimation: { devise: 'EUR', sources: [{ site: 'X' }], hypotheses: ['h'] } });
  assert.equal(out.code, 400);
  assert.equal(out.error.code, 'bad_request');
});

// Reconstruction conditionnelle des tables enfant : sans la clé sources/hypotheses,
// on ne touche pas aux lignes existantes (pas de DELETE) ; avec [] on les vide.
test('updateObjet : estimation exploitable sans clé sources/hypotheses -> tables enfant intactes', async () => {
  const { pool, calls } = makeRecordingPool();
  const out = await updateObjet(pool, { objet_id: 5, estimation: { prixMoyen: 1500, devise: 'EUR' } });
  assert.equal(out.code, 200);
  assert.ok(calls.some((c) => /UPDATE objet_saisi SET estim_prix_bas/.test(c.sql)), 'estim_* mis à jour');
  assert.ok(!calls.some((c) => /DELETE FROM objet_estimation_source/.test(c.sql)), 'sources non touchées');
  assert.ok(!calls.some((c) => /DELETE FROM objet_estimation_hypothese/.test(c.sql)), 'hypotheses non touchées');
});

test('updateObjet : estimation exploitable avec sources: [] -> vidage explicite', async () => {
  const { pool, calls } = makeRecordingPool();
  const out = await updateObjet(pool, { objet_id: 5, estimation: { prixMoyen: 1500, sources: [], hypotheses: [] } });
  assert.equal(out.code, 200);
  assert.ok(calls.some((c) => /DELETE FROM objet_estimation_source/.test(c.sql)), 'DELETE sources (vidage explicite)');
  assert.ok(calls.some((c) => /DELETE FROM objet_estimation_hypothese/.test(c.sql)), 'DELETE hypotheses (vidage explicite)');
});

const { deleteObjet } = require('./perquisition');

test('deleteObjet : objet_id manquant -> 400', async () => {
  const pool = { connect: async () => { throw new Error('no'); } };
  const out = await deleteObjet(pool, {});
  assert.equal(out.code, 400);
});

test('deleteObjet : objet inexistant -> 404', async () => {
  const client = { query: async () => ({ rows: [] }), release() {} };
  const pool = { connect: async () => client };
  const out = await deleteObjet(pool, { objet_id: 999 });
  assert.equal(out.code, 404);
  assert.equal(out.error.code, 'not_found');
});
