import { test } from 'node:test';
import assert from 'node:assert';
import {
  catalogueGgd, catalogueUnites, catalogueMotsCles, catalogueCommunes, communesParDept,
  unitesPourDept, unitesParGgd, GGD_EXTRA,
} from './catalogue.mjs';
import { DEPTS, THEMES, TRAMES } from './corpus.mjs';

test('catalogueGgd : un GGD par département du corpus + extra COG', () => {
  const g = catalogueGgd();
  assert.ok(g.length >= DEPTS.length);
  assert.ok(g.some((x) => x.code === 'GGD 49' && x.nom_departement === 'Maine-et-Loire'));
  assert.ok(g.some((x) => x.code === 'GGD 75'));
  assert.strictEqual(g.length, DEPTS.length + GGD_EXTRA.length);
});

test('unitesPourDept : COB/BTA sur chaque ville + BR/PSIG/CGD au chef-lieu', () => {
  const u = unitesPourDept('49', ['Angers', 'Cholet', 'Saumur']);
  assert.ok(u.includes('COB Angers'));
  assert.ok(u.includes('BTA Cholet'));
  assert.ok(u.includes('BR Angers'));
  assert.ok(u.includes('PSIG Angers'));
  assert.ok(u.includes('CGD Angers'));
  assert.ok(u.includes('EDSR 49'));
});

test('catalogueUnites : au moins une unité par GGD du corpus', () => {
  const u = catalogueUnites();
  assert.ok(u.length > DEPTS.length * 4);
  const parGgd = new Set(u.map((x) => x.code_ggd));
  for (const [code] of DEPTS) {
    assert.ok(parGgd.has(`GGD ${code}`), `unités manquantes pour GGD ${code}`);
  }
  // Exemple doc / design : COB Segré n'est plus forcé — le chef-lieu Maine-et-Loire est Angers.
  assert.ok(u.some((x) => x.code_ggd === 'GGD 49' && x.nom === 'COB Angers'));
});

test('catalogueMotsCles : thèmes + signatures trames, sans marqueur technique', () => {
  const m = catalogueMotsCles();
  assert.ok(m.includes('rodéo'));
  assert.ok(m.includes('faux agent'));
  assert.ok(m.includes('drone'));
  assert.ok(!m.some((x) => x.startsWith('defaut:') || x.startsWith('signal-faible:')));
  // Tous les mots des thèmes y figurent.
  for (const t of THEMES) for (const mot of t.mots) assert.ok(m.includes(mot), mot);
  for (const tr of TRAMES) for (const mot of tr.mots) assert.ok(m.includes(mot), mot);
});

test('unitesParGgd : Map code_ggd → noms', () => {
  const map = unitesParGgd();
  assert.ok(map.get('GGD 49')?.includes('COB Angers'));
  assert.ok(map.get('GGD 13')?.length >= 5);
});

test('catalogueCommunes : COG national (métropole + Corse + outre-mer)', () => {
  const c = catalogueCommunes();
  assert.ok(c.length >= 30000, `attendu >=30k communes, obtenu ${c.length}`);
  // Format normalisé.
  const sample = c[0];
  assert.ok(sample.code_insee && sample.nom && sample.code_dept);
  // Maine-et-Loire : Segré-en-Anjou Bleu (nom officiel COG, pas le diminutif « Segré »).
  assert.ok(c.some((x) => x.code_dept === '49' && x.nom === 'Segré-en-Anjou Bleu'));
  // Outre-mer.
  assert.ok(c.some((x) => x.code_dept === '974'));
  // Pas de doublon de code INSEE.
  assert.strictEqual(new Set(c.map((x) => x.code_insee)).size, c.length);
});

test('communesParDept : index par code département', () => {
  const map = communesParDept();
  assert.ok(map.get('49')?.includes('Segré-en-Anjou Bleu'));
  assert.ok((map.get('01')?.length || 0) > 100);
  assert.ok(map.has('2A') && map.has('973'));
});
