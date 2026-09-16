const { test } = require('node:test');
const assert = require('node:assert');
const { buildRapportQuery, buildRapportFicheQuery } = require('./rapport');

test('rapport : renvoie run, synthese et fiches en un seul objet', () => {
  const q = buildRapportQuery('2026-08-04', '');
  assert.match(q.text, /'run'/);
  assert.match(q.text, /'synthese'/);
  assert.match(q.text, /'fiches'/);
  assert.deepStrictEqual(q.values, ['2026-08-04']);
});

test('rapport : sans jour → dernier run terminé', () => {
  const q = buildRapportQuery(null, '');
  assert.match(q.text, /ORDER BY jour DESC[\s\S]*LIMIT 1/);
  assert.deepStrictEqual(q.values, []);
});

test('rapport : le filtre GGD est paramétré', () => {
  const q = buildRapportQuery('2026-08-04', 'GGD 49');
  assert.deepStrictEqual(q.values, ['2026-08-04', 'GGD 49']);
  assert.match(q.text, /f\.code_ggd = \$2/);
});

test('rapport : la couverture (fragments) fait partie du run, pas d\'une option', () => {
  const q = buildRapportQuery('2026-08-04', '');
  assert.match(q.text, /fragments_total/);
  assert.match(q.text, /fragments_ok/);
  assert.match(q.text, /'statut', r\.statut/);
});

test('rapport : gravite_max ordonne bloquant > majeur > mineur', () => {
  const q = buildRapportQuery('2026-08-04', '');
  assert.match(q.text, /WHEN 'bloquant' THEN 3/);
  assert.match(q.text, /WHEN 'majeur' THEN 2/);
});

test('rapport : agrège par critère et par unité', () => {
  const q = buildRapportQuery('2026-08-04', '');
  assert.match(q.text, /'par_critere'/);
  assert.match(q.text, /'par_unite'/);
  assert.match(q.text, /'par_gravite'/);
});

test('detail fiche : texte intégral et écarts, paramétrés', () => {
  const q = buildRapportFicheQuery('2026-08-04', 1204);
  assert.match(q.text, /f\.texte/);
  assert.match(q.text, /'ecarts'/);
  assert.deepStrictEqual(q.values, ['2026-08-04', 1204]);
});

test('rapport : bloc methode — défauts plantés et défauts effectivement détectés', () => {
  const q = buildRapportQuery('2026-08-04', '');
  assert.match(q.text, /'methode'/);
  assert.match(q.text, /'defauts_plantes'/);
  assert.match(q.text, /'defauts_detectes'/);
  assert.match(q.text, /LIKE 'defaut:%'/);
});

test("rapport : un défaut n'est « détecté » que si le critère relevé est celui qui a été planté", () => {
  const q = buildRapportQuery('2026-08-04', '');
  assert.match(q.text, /substring\(m\.mot from 8\) = a\.critere/);
});

test('lot : les fiches sélectionnées sont chargées par identifiants, paramétrées', () => {
  const { buildLotQuery } = require('./rapport');
  const q = buildLotQuery([12, 34]);
  assert.match(q.text, /f\.id = ANY\(\$1::int\[\]\)/);
  assert.match(q.text, /f\.texte/);
  assert.deepStrictEqual(q.values, [[12, 34]]);
});

test("lot : l'ordre de la sélection n'est pas imposé par la base, il l'est côté serveur", () => {
  const { buildLotQuery } = require('./rapport');
  assert.match(buildLotQuery([2, 1]).text, /ORDER BY f\.id/);
});

