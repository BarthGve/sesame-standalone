const { test } = require('node:test');
const assert = require('node:assert');
const { CRITERES, graviteDe, fondementDe, estCodeValide } = require('./criteres');

test('les 12 codes de la grille sont présents, et eux seuls', () => {
  assert.deepStrictEqual(
    Object.keys(CRITERES).sort(),
    ['A1', 'A4', 'B5', 'B6', 'B7', 'C9', 'C10', 'D11', 'D12'].sort()
  );
});

test('chaque critère porte une gravité connue et une famille connue', () => {
  const gravites = ['bloquant', 'majeur', 'mineur'];
  const familles = ['legalite', 'donnees', 'redaction', 'structurel'];
  for (const [code, c] of Object.entries(CRITERES)) {
    assert.ok(gravites.includes(c.gravite), `${code} : gravité inconnue`);
    assert.ok(familles.includes(c.famille), `${code} : famille inconnue`);
    assert.ok(c.libelle.length > 3, `${code} : libellé vide`);
  }
});

test('les critères bloquants sont exactement A1, B5, C9', () => {
  const bloquants = Object.entries(CRITERES).filter(([, c]) => c.gravite === 'bloquant').map(([k]) => k);
  assert.deepStrictEqual(bloquants.sort(), ['A1', 'B5', 'C9']);
});

test('le seul critère évaluable en SQL est C10 : tout le reste se lit dans le texte', () => {
  // Conséquence directe du retrait du motif et de la date d'événement, qui ne sont pas des
  // champs de la FRS : le contrôle déterministe se réduit à l'ancienneté de la fiche.
  const struct = Object.entries(CRITERES).filter(([, c]) => c.famille === 'structurel').map(([k]) => k);
  assert.deepStrictEqual(struct, ['C10']);
});

test("aucun critère ne porte sur un champ absent de la FRS", () => {
  // Le motif d'enregistrement se rattache à la fiche entité, pas à la FRS : un critère qui
  // le contrôlerait relèverait un écart imputable à personne.
  for (const [code, c] of Object.entries(CRITERES)) {
    assert.doesNotMatch(c.libelle, /motif/i, `${code} : contrôle un champ que la FRS ne porte pas`);
  }
  assert.strictEqual(CRITERES.C2, undefined);
  assert.strictEqual(CRITERES.A3, undefined);
  // C8 : la conservation se calcule sur la date de création de la fiche, toujours connue —
  // la datation des faits dans le texte n'en est pas une condition.
  assert.strictEqual(CRITERES.C8, undefined);
});

test('graviteDe dérive la gravité du code, et refuse un code inconnu', () => {
  assert.strictEqual(graviteDe('A1'), 'bloquant');
  assert.strictEqual(graviteDe('D12'), 'mineur');
  assert.throws(() => graviteDe('Z9'), /Z9/);
});

test('chaque critère cite un article du CSI : sans fondement, pas de verdict opposable', () => {
  for (const [code, c] of Object.entries(CRITERES)) {
    assert.match(c.fondement, /^CSI R\. 236-\d+/, `${code} : fondement absent ou mal formé`);
  }
  assert.strictEqual(fondementDe('C10'), 'CSI R. 236-24');
  assert.throws(() => fondementDe('Z9'), /Z9/);
});

test('estCodeValide filtre ce qui vient du LLM', () => {
  assert.strictEqual(estCodeValide('B5'), true);
  assert.strictEqual(estCodeValide('b5'), false);
  assert.strictEqual(estCodeValide(''), false);
  assert.strictEqual(estCodeValide(undefined), false);
});

test("le référentiel des motifs a disparu avec le champ qu'il validait", () => {
  assert.strictEqual(require('./criteres').MOTIFS, undefined);
});
