import { test } from 'node:test';
import assert from 'node:assert';
import { buildLot } from './build-lot.mjs';
import { unitesParGgd } from './catalogue.mjs';
import { DEPTS } from './corpus.mjs';

// Aléa déterministe pour des tests stables.
function rng(seed = 1) {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 0x100000000;
  };
}

/** Référentiels de test : unités catalogue + communes corpus. */
function refsTest() {
  const unitesByGgd = unitesParGgd();
  const communesByDept = new Map(DEPTS.map(([c, , com]) => [c, com]));
  return { unitesByGgd, communesByDept };
}

function harness(seed = 42, extra = {}) {
  const random = rng(seed);
  const pick = (arr) => arr[Math.floor(random() * arr.length)];
  const randint = (n) => Math.floor(random() * n);
  const fill = (t) => t.replace(/\{PLAQUE\}/g, 'AB-123-CD')
    .replace(/\{IDENTITE\}/g, 'Jean DUPONT')
    .replace(/\{PSEUDO\}/g, '@x')
    .replace(/\{URL\}/g, 'x.com/x');
  return buildLot({
    pick, randint, random, fill,
    nBruit: 20, trameProb: 1, auditDefauts: 5,
    ...refsTest(),
    ...extra,
  });
}

test('buildLot : refuse de tourner sans référentiels', () => {
  const random = rng(1);
  assert.throws(
    () => buildLot({
      pick: (a) => a[0],
      randint: () => 0,
      random,
      fill: (t) => t,
      nBruit: 5,
      unitesByGgd: new Map(),
      communesByDept: new Map(),
    }),
    /référentiels vides/,
  );
});

test('buildLot : chaque fiche porte une unité et une commune du référentiel', () => {
  const { unitesByGgd, communesByDept } = refsTest();
  const fiches = harness();
  assert.ok(fiches.length >= 20);
  for (const f of fiches.slice(0, 30)) {
    assert.match(f.ggd, /^GGD /);
    const unites = unitesByGgd.get(f.ggd) || [];
    assert.ok(unites.includes(f.unite), `unité hors référentiel : ${f.unite} (${f.ggd})`);
    const code = f.ggd.replace(/^GGD\s*/, '');
    const communes = communesByDept.get(code) || [];
    assert.ok(communes.includes(f.commune), `commune hors référentiel : ${f.commune}`);
    assert.ok(f.dep);
    assert.ok(Array.isArray(f.mots));
  }
});

test('buildLot : préfère les communes officielles du référentiel quand fournies', () => {
  const communesByDept = new Map([
    ['49', ['Segré-en-Anjou Bleu', 'Cholet']],
  ]);
  // Unités uniquement pour 49 + un autre pour ne pas planter le filtre.
  const unitesByGgd = new Map([
    ['GGD 49', ['COB Angers', 'BTA Cholet']],
    ['GGD 13', ['COB Aix-en-Provence']],
  ]);
  const communesFull = new Map(communesByDept);
  communesFull.set('13', ['Aix-en-Provence']);
  const fiches = harness(7, {
    nBruit: 200, trameProb: 0, auditDefauts: 0,
    unitesByGgd, communesByDept: communesFull,
  });
  const du49 = fiches.filter((f) => f.ggd === 'GGD 49');
  assert.ok(du49.length > 0, 'au moins une fiche GGD 49 attendue');
  for (const f of du49) {
    assert.ok(
      ['Segré-en-Anjou Bleu', 'Cholet'].includes(f.commune),
      `commune hors référentiel : ${f.commune}`,
    );
    assert.ok(['COB Angers', 'BTA Cholet'].includes(f.unite), f.unite);
  }
});

test('buildLot : plante des défauts marqués defaut:', () => {
  const fiches = harness(3, { auditDefauts: 5 });
  const marques = fiches.filter((f) => f.mots.some((m) => m.startsWith('defaut:')));
  assert.strictEqual(marques.length, 5);
});
