const { test } = require('node:test');
const assert = require('node:assert');
const { createUna, listUna, updateUna } = require('./server');

// Pool factice pour updateUna : existingLieu = una_lieu a déjà une ligne (UPDATE touche 1) ou non (0 -> INSERT).
function makeUpdatePool({ existingLieu = false } = {}) {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT id FROM una WHERE unite/.test(sql)) return { rows: [{ id: 126 }] };
      if (/UPDATE una_lieu/.test(sql)) return { rowCount: existingLieu ? 1 : 0, rows: [] };
      if (/INSERT INTO una_lieu/.test(sql)) return { rows: [] };
      if (/^\s*SELECT u\.id/.test(sql)) return { rows: [{ una: '15127/126/2026' }] };
      return { rows: [], rowCount: 0 }; // UPDATE una, etc.
    },
    release() {},
  };
  return { pool: { connect: async () => client }, calls };
}
const has = (calls, re) => calls.some((c) => re.test(c.sql));

// Pool factice pour listUna : capture la requête, renvoie des lignes fixes.
function makeListPool() {
  const calls = [];
  const pool = { async query(sql, vals) { calls.push({ sql, vals }); return { rows: [{ una: '15127/1/2026' }] }; } };
  return { pool, calls };
}

// Pool factice : dispatch selon le SQL, enregistre chaque appel pour assertion.
function makeFakePool({ commune = '49050' } = {}) {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM unite WHERE code/.test(sql)) return { rows: [{ code: 15127 }] };
      if (/FROM type_document WHERE/.test(sql)) return { rows: [{ id: 1 }] };
      if (/FROM groupe WHERE/.test(sql)) return { rows: [{ id: 7 }] };
      if (/FROM communes WHERE nom_norm/.test(sql)) return { rows: commune ? [{ code_insee: commune }] : [] };
      if (/MAX\(numero\)/.test(sql)) return { rows: [{ n: 127 }] };
      if (/INSERT INTO una\b/.test(sql)) return { rows: [{ id: 999 }] };
      if (/INSERT INTO una_lieu/.test(sql)) return { rows: [] };
      if (/^\s*SELECT u\.id/.test(sql)) return { rows: [{ una: '15127/127/2026' }] };
      return { rows: [] }; // BEGIN / COMMIT / advisory lock
    },
    release() {},
  };
  return { pool: { connect: async () => client }, calls };
}

const lieuCall = (calls) => calls.find((c) => /INSERT INTO una_lieu/.test(c.sql));

test('createUna : type_lieu + commune → ligne una_lieu écrite', async () => {
  const { pool, calls } = makeFakePool();
  const out = await createUna(
    { unite: 15127, type: 'PVEJ', synthese: 'cambriolage à la boulangerie', commune: 'Candé', type_lieu: 'LOCAL_PRO' },
    pool
  );
  assert.equal(out.code, 200);
  const lc = lieuCall(calls);
  assert.ok(lc, 'INSERT una_lieu attendu');
  // [una_id, type_lieu, adresse_norm, commune]
  assert.deepStrictEqual(lc.params, [999, 'LOCAL_PRO', null, '49050']);
});

test('createUna : adresse seule (sans type_lieu) → una_lieu écrite avec type_lieu null', async () => {
  const { pool, calls } = makeFakePool();
  const out = await createUna(
    { unite: 15127, type: 'PVEJ', synthese: 'cambriolage', adresse: '12 rue des Lilas' },
    pool
  );
  assert.equal(out.code, 200);
  const lc = lieuCall(calls);
  assert.ok(lc, 'INSERT una_lieu attendu');
  assert.equal(lc.params[1], null);          // type_lieu
  assert.equal(lc.params[2], '12 rue des Lilas'); // adresse_norm
});

test('createUna : aucun indice de lieu → pas de ligne una_lieu', async () => {
  const { pool, calls } = makeFakePool();
  const out = await createUna({ unite: 15127, type: 'PVEJ', synthese: 'cambriolage' }, pool);
  assert.equal(out.code, 200);
  assert.equal(lieuCall(calls), undefined);
});

test('createUna : type_lieu hors énum → ignoré (pas d\'erreur, pas de una_lieu)', async () => {
  const { pool, calls } = makeFakePool();
  const out = await createUna(
    { unite: 15127, type: 'PVEJ', synthese: 'cambriolage', type_lieu: 'COMMERCE' },
    pool
  );
  assert.equal(out.code, 200);            // valeur invalide n'échoue pas la création
  assert.equal(lieuCall(calls), undefined); // ni type_lieu valide ni adresse → pas d'écriture lieu
});

test('createUna : commune non reconnue → créée sans commune + warning (non bloquant)', async () => {
  const { pool, calls } = makeFakePool({ commune: null });
  const out = await createUna(
    { unite: 15127, type: 'PVEJ', synthese: 'cambriolage', commune: 'Segré' },
    pool
  );
  assert.equal(out.code, 200);                 // pas de 400 : le numéro est alloué
  assert.match(out.warning, /Segr/);           // warning remonté à l'appelant
  const unaInsert = calls.find((c) => /INSERT INTO una\b/.test(c.sql));
  assert.equal(unaInsert.params[8], null);     // commune NULL en base
});

test('createUna : INSERT una porte RETURNING id', async () => {
  const { pool, calls } = makeFakePool();
  await createUna({ unite: 15127, type: 'PVEJ', synthese: 'x', type_lieu: 'HABITATION' }, pool);
  const unaInsert = calls.find((c) => /INSERT INTO una\b/.test(c.sql));
  assert.match(unaInsert.sql, /RETURNING id/);
});

test('listUna : JOINt una_lieu et expose les champs lieu', async () => {
  const { pool, calls } = makeListPool();
  await listUna(new URLSearchParams(''), pool);
  assert.match(calls[0].sql, /una_lieu/);
  assert.match(calls[0].sql, /l\.type_lieu/);
});

test('listUna : expose le nombre de perquisitions par UNA', async () => {
  const { pool, calls } = makeListPool();
  await listUna(new URLSearchParams(''), pool);
  assert.match(calls[0].sql, /count\(\*\) FROM perquisition pq WHERE pq\.una_id = u\.id/);
  assert.match(calls[0].sql, /AS nb_perquisitions/);
});

test('listUna : filtre type_lieu valide → clause l.type_lieu', async () => {
  const { pool, calls } = makeListPool();
  await listUna(new URLSearchParams('type_lieu=LOCAL_PRO'), pool);
  assert.match(calls[0].sql, /l\.type_lieu = \$1/);
  assert.deepStrictEqual(calls[0].vals, ['LOCAL_PRO']);
});

test('listUna : type_lieu hors énum → ignoré (aucun filtre)', async () => {
  const { pool, calls } = makeListPool();
  await listUna(new URLSearchParams('type_lieu=COMMERCE'), pool);
  assert.doesNotMatch(calls[0].sql, /l\.type_lieu = /);
  assert.deepStrictEqual(calls[0].vals, []);
});

test('updateUna : type_lieu seul, aucune ligne una_lieu → INSERT', async () => {
  const { pool, calls } = makeUpdatePool({ existingLieu: false });
  const out = await updateUna({ una: '15127/126/2026', type_lieu: 'LIEU_PUBLIC' }, pool);
  assert.equal(out.code, 200);
  assert.ok(has(calls, /UPDATE una_lieu/), 'UPDATE una_lieu tenté');
  assert.ok(has(calls, /INSERT INTO una_lieu/), 'INSERT una_lieu (aucune ligne existante)');
  assert.ok(!has(calls, /UPDATE una SET/), 'pas d\'UPDATE una (aucun champ una fourni)');
});

test('updateUna : type_lieu, ligne una_lieu existante → UPDATE seul (pas d\'INSERT)', async () => {
  const { pool, calls } = makeUpdatePool({ existingLieu: true });
  const out = await updateUna({ una: '15127/126/2026', type_lieu: 'LOCAL_PRO' }, pool);
  assert.equal(out.code, 200);
  assert.ok(has(calls, /UPDATE una_lieu/), 'UPDATE una_lieu');
  assert.ok(!has(calls, /INSERT INTO una_lieu/), 'pas d\'INSERT (ligne déjà là)');
});

test('updateUna : type_lieu hors énum et aucun champ → 400', async () => {
  const { pool } = makeUpdatePool();
  const out = await updateUna({ una: '15127/126/2026', type_lieu: 'COMMERCE' }, pool);
  assert.equal(out.code, 400);
});
