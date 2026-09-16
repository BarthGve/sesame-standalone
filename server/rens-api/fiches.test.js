const { test } = require('node:test');
const assert = require('node:assert');
const { buildListQuery, buildCountQuery, buildDetailQuery, buildSignauxFaiblesQuery, buildAgregatsQuery, buildSignauxQuery } = require('./fiches');

const P = (s) => new URLSearchParams(s);

test('buildAgregatsQuery : date fournie → $1', () => {
  const q = buildAgregatsQuery('2026-05-15');
  assert.match(q.text, /json_build_object/);
  assert.match(q.text, /'top_mots'/);
  assert.match(q.text, /'par_ggd'/);
  assert.match(q.text, /'top_communes'/);
  assert.match(q.text, /'total_veille'/);
  assert.match(q.text, /\$1::date/);
  assert.deepStrictEqual(q.values, ['2026-05-15']);
});

test('buildAgregatsQuery : sans date → veille de la date courante (CURRENT_DATE - 1)', () => {
  const q = buildAgregatsQuery('');
  assert.match(q.text, /\(CURRENT_DATE - 1\)/);
  assert.deepStrictEqual(q.values, []);
});

test('buildSignauxQuery : défauts, date via $1, exclut signal-faible, flag emergent', () => {
  const q = buildSignauxQuery(P('date=2026-05-31'));
  assert.match(q.text, /BETWEEN \(\$1::date\) - 30 AND \(\$1::date\)/);
  assert.match(q.text, /> \(\$1::date\) - 7/);
  assert.match(q.text, /NOT LIKE 'signal-faible:%'/);
  assert.match(q.text, /n BETWEEN 5 AND 20 AND depts >= 3/);
  assert.match(q.text, /AS emergent/);
  assert.deepStrictEqual(q.values, ['2026-05-31']);
});

test('buildSignauxQuery : sans date → veille de la date courante (CURRENT_DATE - 1), knobs custom', () => {
  const q = buildSignauxQuery(P('window=60&recent=14&min=3&max=50&depts=2'));
  assert.match(q.text, /\(CURRENT_DATE - 1\)\) - 60/);
  assert.match(q.text, /n BETWEEN 3 AND 50 AND depts >= 2/);
  assert.deepStrictEqual(q.values, []);
});

test('buildSignauxFaiblesQuery : défauts 5/20/3, exclut signal-faible:%', () => {
  const q = buildSignauxFaiblesQuery(P(''));
  assert.match(q.text, /GROUP BY m\.mot/);
  assert.match(q.text, /HAVING count\(\*\) BETWEEN \$1 AND \$2 AND count\(DISTINCT f\.code_ggd\) >= \$3/);
  assert.match(q.text, /NOT LIKE 'signal-faible:%'/);
  assert.match(q.text, /to_char\(min\(f\.date_redaction\)/);
  assert.deepStrictEqual(q.values, [5, 20, 3]);
});

test('buildSignauxFaiblesQuery : paramètres min/max/depts', () => {
  const q = buildSignauxFaiblesQuery(P('min=3&max=12&depts=2'));
  assert.deepStrictEqual(q.values, [3, 12, 2]);
});

test('buildSignauxFaiblesQuery : valeurs invalides → défauts', () => {
  const q = buildSignauxFaiblesQuery(P('min=x&max=1&depts=0'));
  assert.deepStrictEqual(q.values, [5, 20, 3]);
});

test('buildListQuery : sans filtre → dernier jour (veille) + LIMIT/OFFSET défaut', () => {
  const q = buildListQuery(P(''));
  assert.match(q.text, /FROM frs f/);
  assert.match(q.text, /LEFT JOIN frs_mot_cle m/);
  assert.match(q.text, /WHERE f\.date_redaction = \(SELECT max\(date_redaction\) FROM frs\)/);
  assert.match(q.text, /GROUP BY f\.id/);
  assert.match(q.text, /ORDER BY f\.date_redaction DESC/);
  assert.match(q.text, /LIMIT 100 OFFSET 0/);
  assert.deepStrictEqual(q.values, []);
});

test('buildListQuery : pagination limit + offset', () => {
  const q = buildListQuery(P('date=2026-03-04&limit=20&offset=40'));
  assert.match(q.text, /LIMIT 20 OFFSET 40/);
  assert.deepStrictEqual(q.values, ['2026-03-04']);
});

test('buildListQuery : q présent → PAS de défaut dernier-jour (drill-in cross-dates)', () => {
  const q = buildListQuery(P('q=faux agent'));
  assert.doesNotMatch(q.text, /max\(date_redaction\)/);
  assert.deepStrictEqual(q.values, ['%faux agent%']);
});

test('buildListQuery : ggd seul → garde le défaut dernier jour (affine dans la veille)', () => {
  const q = buildListQuery(P('ggd=GGD 49'));
  assert.match(q.text, /f\.code_ggd = \$1/);
  assert.match(q.text, /max\(date_redaction\)/);
  assert.deepStrictEqual(q.values, ['GGD 49']);
});

test('buildCountQuery : mêmes filtres, count(*)', () => {
  const q = buildCountQuery(P('date=2026-03-04&ggd=GGD 49'));
  assert.match(q.text, /SELECT count\(\*\)::int AS total FROM frs f WHERE/);
  assert.match(q.text, /f\.date_redaction = \$1/);
  assert.match(q.text, /f\.code_ggd = \$2/);
  assert.deepStrictEqual(q.values, ['2026-03-04', 'GGD 49']);
});

test('buildCountQuery : sans filtre → dernier jour', () => {
  assert.match(buildCountQuery(P('')).text, /max\(date_redaction\)/);
});

test('buildListQuery : filtre date + ggd', () => {
  const q = buildListQuery(P('date=2026-03-04&ggd=GGD 49'));
  assert.match(q.text, /f\.date_redaction = \$1/);
  assert.match(q.text, /f\.code_ggd = \$2/);
  assert.deepStrictEqual(q.values, ['2026-03-04', 'GGD 49']);
});

test('buildListQuery : recherche q → titre/texte/unité/commune/GGD/mot ILIKE', () => {
  const q = buildListQuery(P('q=rodeo'));
  assert.match(q.text, /f\.titre ILIKE \$1/);
  assert.match(q.text, /f\.texte ILIKE \$1/);
  assert.match(q.text, /f\.unite ILIKE \$1/);
  assert.match(q.text, /f\.commune ILIKE \$1/);
  assert.match(q.text, /f\.code_ggd ILIKE \$1/);
  assert.match(q.text, /frs_mot_cle mk/);
  assert.deepStrictEqual(q.values, ['%rodeo%']);
});

test('buildListQuery : mot(s) du référentiel → match exact, OR, lève le défaut jour', () => {
  const q = buildListQuery(P('mot=rodéo&mot=deal'));
  assert.match(q.text, /mk\.mot = ANY\(\$1::text\[\]\)/);
  assert.doesNotMatch(q.text, /max\(date_redaction\)/);
  assert.deepStrictEqual(q.values, [['rodéo', 'deal']]);
});

test('buildListQuery : mots=a,b aussi accepté ; marqueurs techniques exclus', () => {
  const q = buildListQuery(P('mots=drone,defaut:A1,signal-faible:x'));
  assert.deepStrictEqual(q.values, [['drone']]);
});

test('buildListQuery : plage from/to (ex. un mois)', () => {
  const q = buildListQuery(P('from=2026-05-01&to=2026-05-31'));
  assert.match(q.text, /f\.date_redaction >= \$1/);
  assert.match(q.text, /f\.date_redaction <= \$2/);
  assert.deepStrictEqual(q.values, ['2026-05-01', '2026-05-31']);
});

test('buildListQuery : filtre commune ILIKE en sous-chaîne', () => {
  const q = buildListQuery(P('commune=Cholet'));
  assert.match(q.text, /f\.commune ILIKE \$1/);
  assert.deepStrictEqual(q.values, ['%Cholet%']);
});

test('buildListQuery : commune remontée dans le SELECT', () => {
  assert.match(buildListQuery(P('')).text, /f\.commune/);
});

test('buildListQuery : limit borné à 500', () => {
  assert.match(buildListQuery(P('limit=99999')).text, /LIMIT 500/);
  assert.match(buildListQuery(P('limit=abc')).text, /LIMIT 100/);
});

test('buildListQuery : date_redaction sélectionné via to_char (TZ-independent)', () => {
  const q = buildListQuery(P(''));
  assert.match(q.text, /to_char\(f\.date_redaction, 'YYYY-MM-DD'\) AS date_redaction/);
});

test('buildDetailQuery : id paramétré', () => {
  const q = buildDetailQuery(42);
  assert.match(q.text, /WHERE f\.id = \$1/);
  assert.deepStrictEqual(q.values, [42]);
});

test('les marqueurs techniques sont exclus de TOUTES les agrégations par mot-clé', () => {
  const requetes = [
    buildSignauxQuery(P('date=2026-08-04')).text,
    buildSignauxFaiblesQuery(P('')).text,
    buildAgregatsQuery('2026-08-04').text,
  ];
  for (const t of requetes) {
    assert.match(t, /NOT LIKE 'signal-faible:%'/);
    assert.match(t, /NOT LIKE 'defaut:%'/);
  }
});

test('buildListQuery : les mots-clés rendus au front excluent les marqueurs techniques', () => {
  const t = buildListQuery(P('date=2026-08-04')).text;
  assert.match(t, /FILTER \(WHERE m\.mot IS NOT NULL AND m\.mot NOT LIKE 'defaut:%' AND m\.mot NOT LIKE 'signal-faible:%'\)/);
});
