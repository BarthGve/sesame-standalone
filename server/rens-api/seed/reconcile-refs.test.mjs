import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Le module n'exporte que la fonction async : on vérifie le contrat en relisant sa source
// (pas de base dans les tests unitaires) et en mockant un client pg.
import { reconcileReferentiels } from './reconcile-refs.mjs';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'reconcile-refs.mjs'), 'utf8');

test('reconcile : les quatre tables sont alimentées depuis frs', () => {
  assert.match(src, /INSERT INTO ref_ggd[\s\S]*FROM frs/s);
  assert.match(src, /INSERT INTO ref_unite[\s\S]*FROM frs/s);
  assert.match(src, /INSERT INTO ref_mot_cle[\s\S]*FROM frs_mot_cle/s);
  assert.match(src, /INSERT INTO ref_commune[\s\S]*FROM frs/s);
});

test('reconcile : les marqueurs techniques restent hors du catalogue de rédaction', () => {
  assert.match(src, /NOT LIKE 'defaut:%'/);
  assert.match(src, /NOT LIKE 'signal-faible:%'/);
});

test('reconcileReferentiels : enchaîne quatre INSERT sur le client fourni', async () => {
  const appels = [];
  const client = {
    query: async (text) => { appels.push(text); return { rowCount: 0 }; },
  };
  await reconcileReferentiels(client);
  assert.strictEqual(appels.length, 4);
  assert.match(appels[0], /ref_ggd/);
  assert.match(appels[1], /ref_unite/);
  assert.match(appels[2], /ref_mot_cle/);
  assert.match(appels[3], /ref_commune/);
});
