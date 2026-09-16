import { test } from 'node:test';
import assert from 'node:assert';
import { creerRun, creerFragments, enregistrerStructurels, enregistrerEcarts, marquerFragment, cloreRun } from './store.mjs';

function faux(reponses = {}) {
  const appels = [];
  return {
    appels,
    query: async (text, values) => {
      appels.push({ text, values });
      for (const [motif, rep] of Object.entries(reponses)) if (text.includes(motif)) return rep;
      return { rows: [], rowCount: 0 };
    },
  };
}

test('creerRun : supprime le run du jour avant de le recréer (idempotence)', async () => {
  const c = faux({ 'INSERT INTO frs_audit_run': { rows: [{ id: 7 }] } });
  const id = await creerRun(c, { jour: '2026-08-04', tailleFragment: 40 });
  assert.strictEqual(id, 7);
  assert.match(c.appels[0].text, /DELETE FROM frs_audit_run WHERE jour = \$1/);
  assert.deepStrictEqual(c.appels[0].values, ['2026-08-04']);
});

test('creerFragments : un fragment par rang, puis le total sur le run', async () => {
  const c = faux();
  await creerFragments(c, 7, [[{ id: 1 }, { id: 2 }], [{ id: 3 }]]);
  assert.match(c.appels[0].text, /INSERT INTO frs_audit_fragment/);
  assert.deepStrictEqual(c.appels[0].values, [7, 0, [1, 2]]);
  assert.deepStrictEqual(c.appels[1].values, [7, 1, [3]]);
  assert.match(c.appels[2].text, /UPDATE frs_audit_run SET fragments_total/);
  assert.deepStrictEqual(c.appels[2].values, [7, 2]);
});

test('enregistrerStructurels : gravité dérivée du code, source = sql', async () => {
  const c = faux();
  const n = await enregistrerStructurels(c, 7, [{ frs_id: 1, critere: 'C10' }, { frs_id: 2, critere: 'C10' }]);
  assert.strictEqual(n, 2);
  assert.match(c.appels[0].text, /INSERT INTO frs_audit/);
  assert.deepStrictEqual(c.appels[0].values.slice(0, 6), [7, 1, 'C10', 'mineur', 'sql', 'CSI R. 236-24']);
  assert.strictEqual(c.appels[1].values[5], 'CSI R. 236-24');
});

test('enregistrerEcarts : upsert conservant la confiance la plus haute', async () => {
  const c = faux();
  await enregistrerEcarts(c, 7, [{ frs_id: 3, critere: 'A4', gravite: 'majeur', fondement: 'R.236-22', extrait: 'e', explication: 'x', confiance: 'haute' }]);
  assert.match(c.appels[0].text, /ON CONFLICT \(run_id, frs_id, critere\) DO UPDATE/);
  assert.match(c.appels[0].text, /frs_audit\.confiance = 'moyenne'/);
  assert.deepStrictEqual(c.appels[0].values.slice(0, 5), [7, 3, 'A4', 'majeur', 'llm']);
});

test('enregistrerEcarts : liste vide → aucune requête', async () => {
  const c = faux();
  assert.strictEqual(await enregistrerEcarts(c, 7, []), 0);
  assert.strictEqual(c.appels.length, 0);
});

test('marquerFragment : porte le message d\'erreur, tronqué', async () => {
  const c = faux();
  await marquerFragment(c, 7, 3, 'echec', 'x'.repeat(600));
  assert.match(c.appels[0].text, /UPDATE frs_audit_fragment SET statut/);
  assert.deepStrictEqual(c.appels[0].values.slice(0, 3), [7, 3, 'echec']);
  assert.strictEqual(c.appels[0].values[3].length, 500);
});

test('cloreRun : complet si tous les fragments sont ok', async () => {
  const c = faux({ 'FROM frs_audit_fragment': { rows: [{ total: 3, ok: 3 }] } });
  assert.strictEqual(await cloreRun(c, 7, 120), 'complet');
});

test('cloreRun : un jour sans production est COMPLET, pas partiel', async () => {
  const c = faux({ 'FROM frs_audit_fragment': { rows: [{ total: 0, ok: 0 }] } });
  assert.strictEqual(await cloreRun(c, 7, 0), 'complet');
});

test('cloreRun : partiel dès qu\'un fragment manque — jamais silencieux', async () => {
  const c = faux({ 'FROM frs_audit_fragment': { rows: [{ total: 3, ok: 2 }] } });
  assert.strictEqual(await cloreRun(c, 7, 120), 'partiel');
  const maj = c.appels.find((a) => a.text.includes('UPDATE frs_audit_run'));
  assert.ok(maj.values.includes('partiel'));
});
