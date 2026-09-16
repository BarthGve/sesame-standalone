const { test } = require('node:test');
const assert = require('node:assert');
const {
  buildRefGgdQuery, buildRefUnitesQuery, buildRefMotsClesQuery, buildRefCommunesQuery,
} = require('./referentiel');

test('GGD : liste ordonnée, sans paramètre', () => {
  const q = buildRefGgdQuery();
  assert.match(q.text, /FROM ref_ggd/);
  assert.match(q.text, /ORDER BY code_dept/);
  assert.deepStrictEqual(q.values, []);
});

test('unités : toutes, ordonnées par GGD puis nom', () => {
  const q = buildRefUnitesQuery();
  assert.match(q.text, /FROM ref_unite/);
  assert.match(q.text, /ORDER BY code_ggd, nom/);
});

test('mots-clés : liste plate ordonnée', () => {
  const q = buildRefMotsClesQuery();
  assert.match(q.text, /FROM ref_mot_cle/);
  assert.match(q.text, /ORDER BY mot/);
});

test('communes : département + recherche optionnelle paramétrée', () => {
  assert.strictEqual(buildRefCommunesQuery('', ''), null);
  assert.strictEqual(buildRefCommunesQuery('', 'A'), null); // q trop court sans dept
  const q = buildRefCommunesQuery('49', 'Ang');
  assert.match(q.text, /code_dept = \$1/);
  assert.match(q.text, /ILIKE \$2/);
  assert.match(q.text, /LIMIT \$3/);
  assert.deepStrictEqual(q.values[0], '49');
  assert.ok(q.values[1].includes('Ang'));
  assert.ok(!q.text.includes('Ang'), 'aucune valeur interpolée');
});

test('communes : sans q, tout le département', () => {
  const q = buildRefCommunesQuery('2A');
  assert.match(q.text, /code_dept = \$1/);
  assert.doesNotMatch(q.text, /ILIKE/);
  assert.deepStrictEqual(q.values[0], '2A');
});

test('communes : recherche nationale (sans dept) bornée, q ≥ 2', () => {
  const q = buildRefCommunesQuery('', 'Segré', 20);
  assert.match(q.text, /FROM ref_commune/);
  assert.doesNotMatch(q.text, /code_dept =/);
  assert.match(q.text, /ILIKE \$1/);
  assert.match(q.text, /LIMIT \$2/);
  assert.deepStrictEqual(q.values, ['%Segré%', 20]);
  // Plafond 50 même si on demande plus.
  assert.strictEqual(buildRefCommunesQuery('', 'Paris', 999).values[1], 50);
});
