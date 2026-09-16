const { test } = require('node:test');
const assert = require('node:assert');
const { validerFrs, buildInsertFrsQuery, buildInsertMotsClesQuery, MAX } = require('./redaction');

const REFS = {
  ggd: [{ code: 'GGD 49', code_dept: '49', nom_departement: 'Maine-et-Loire' }],
  unites: [{ code_ggd: 'GGD 49', nom: 'COB Segré' }],
  communes: [{ nom: 'Segré' }, { nom: 'Angers' }],
  mots_cles: ['rassemblement', 'stupéfiants', 'rodéo'],
};

const bon = (extra = {}) => ({
  titre: 'Rassemblement', unite: 'COB Segré', code_ggd: 'GGD 49',
  departement: 'Maine-et-Loire', commune: 'Segré', texte: 'Des faits constatés.',
  mots_cles: ['rassemblement'], ...extra,
});

test('une fiche complète et rattachée à des valeurs connues est acceptée', () => {
  const r = validerFrs(bon(), REFS);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.valeur.titre, 'Rassemblement');
  assert.deepStrictEqual(r.valeur.mots_cles, ['rassemblement']);
});

test('un champ obligatoire absent est refusé en nommant le champ', () => {
  for (const champ of ['titre', 'unite', 'code_ggd', 'departement', 'commune', 'texte']) {
    const corps = bon(); delete corps[champ];
    const r = validerFrs(corps, REFS);
    assert.strictEqual(r.ok, false, `${champ} absent devrait être refusé`);
    assert.match(r.message, new RegExp(champ), `le message doit nommer ${champ}`);
  }
});

test('les bornes de longueur sont tenues', () => {
  assert.strictEqual(validerFrs(bon({ titre: 'x'.repeat(MAX.titre + 1) }), REFS).ok, false);
  assert.strictEqual(validerFrs(bon({ texte: 'x'.repeat(MAX.texte + 1) }), REFS).ok, false);
  assert.strictEqual(validerFrs(bon({ texte: 'x'.repeat(MAX.texte) }), REFS).ok, true);
});

test('un GGD hors référentiel est refusé', () => {
  assert.strictEqual(validerFrs(bon({ code_ggd: 'GGD 99' }), REFS).ok, false);
});

test('une unité hors GGD ou hors référentiel est refusée', () => {
  assert.strictEqual(validerFrs(bon({ unite: 'COB Inexistante' }), REFS).ok, false);
});

test('une commune hors département est refusée', () => {
  assert.strictEqual(validerFrs(bon({ commune: 'Nulle-Part' }), REFS).ok, false);
});

test('le département doit coller au GGD du référentiel', () => {
  assert.strictEqual(validerFrs(bon({ departement: 'Paris' }), REFS).ok, false);
});

test('un mot-clé « defaut: » est rejeté — c\'est le marqueur de vérité terrain', () => {
  const r = validerFrs(bon({ mots_cles: ['rassemblement', 'defaut:B5'] }), REFS);
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /defaut:/);
});

test('un mot-clé hors référentiel est refusé', () => {
  const r = validerFrs(bon({ mots_cles: ['mot-inventé'] }), REFS);
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /référentiel/i);
});

test('les mots-clés sont bornés en nombre et en longueur', () => {
  assert.strictEqual(validerFrs(bon({ mots_cles: Array(MAX.motsCles + 1).fill('rodéo') }), REFS).ok, false);
});

test('les doublons de mots-clés sont repliés', () => {
  const r = validerFrs(bon({ mots_cles: ['rodéo', 'rodéo', 'stupéfiants'] }), REFS);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.valeur.mots_cles, ['rodéo', 'stupéfiants']);
});

test('la date fournie par le client est ignorée : le serveur impose la sienne', () => {
  const r = validerFrs(bon({ date_redaction: '2019-01-01' }), REFS);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.valeur.date_redaction, undefined);
  const q = buildInsertFrsQuery(r.valeur);
  assert.match(q.text, /CURRENT_DATE/);
  assert.ok(!q.values.includes('2019-01-01'));
});

test('l\'insertion est paramétrée et rend l\'identifiant créé', () => {
  const q = buildInsertFrsQuery(validerFrs(bon(), REFS).valeur);
  assert.match(q.text, /INSERT INTO frs/);
  assert.match(q.text, /RETURNING id/);
  assert.ok(q.text.includes('$1'));
  assert.ok(!q.text.includes('Rassemblement'), 'aucune valeur interpolée dans le SQL');
});

test('sans mot-clé, aucune requête de mots-clés n\'est produite', () => {
  assert.strictEqual(buildInsertMotsClesQuery(12, []), null);
  const q = buildInsertMotsClesQuery(12, ['a', 'b']);
  assert.match(q.text, /INSERT INTO frs_mot_cle/);
  assert.deepStrictEqual(q.values, [12, ['a', 'b']]);
});
