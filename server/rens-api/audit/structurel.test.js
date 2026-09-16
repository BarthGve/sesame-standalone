const { test } = require('node:test');
const assert = require('node:assert');
const { buildStructurelQuery, buildStructurelIdsQuery } = require('./structurel');

test('le contrôle déterministe se réduit à C10 : les deux autres portaient sur des champs inexistants', () => {
  const q = buildStructurelQuery('2026-08-04');
  assert.match(q.text, /'C10' AS critere/);
  assert.doesNotMatch(q.text, /'C2'|'C8'/);
  assert.doesNotMatch(q.text, /motif|date_evenement|origine_info/);
});

test('C10 : au-delà de dix ans de conservation, comme R. 236-24', () => {
  assert.match(buildStructurelQuery('2026-08-04').text, /date_redaction < \$1::date - INTERVAL '10 years'/);
});

test('le jour est paramétré, jamais interpolé', () => {
  const q = buildStructurelQuery("2026-08-04'; DROP TABLE frs; --");
  assert.doesNotMatch(q.text, /DROP TABLE/);
  assert.deepStrictEqual(q.values, ["2026-08-04'; DROP TABLE frs; --"]);
});

test("buildStructurelIdsQuery : borné à une liste d'identifiants, C10 devient vivant", () => {
  const q = buildStructurelIdsQuery([12, 34]);
  assert.match(q.text, /id = ANY\(\$1::int\[\]\)/);
  assert.match(q.text, /date_redaction < CURRENT_DATE - INTERVAL '10 years'/);
  assert.deepStrictEqual(q.values, [[12, 34]]);
});

test('buildStructurelIdsQuery : liste vide → aucune requête à exécuter', () => {
  assert.strictEqual(buildStructurelIdsQuery([]), null);
});
