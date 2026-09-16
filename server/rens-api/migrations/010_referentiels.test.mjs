// server/rens-api/migrations/010_referentiels.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('./010_referentiels.sql', import.meta.url), 'utf8');

test('010 : les quatre tables de référentiel existent', () => {
  for (const t of ['ref_ggd', 'ref_unite', 'ref_commune', 'ref_mot_cle']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${t}`), t);
  }
});

test('010 : les unités sont rattachées à un GGD', () => {
  assert.match(sql, /code_ggd\s+text NOT NULL REFERENCES ref_ggd/);
  assert.match(sql, /UNIQUE \(code_ggd, nom\)/);
});

test('010 : la réconciliation part de frs / frs_mot_cle', () => {
  assert.match(sql, /INSERT INTO ref_ggd[\s\S]*FROM frs/s);
  assert.match(sql, /INSERT INTO ref_unite[\s\S]*FROM frs/s);
  assert.match(sql, /INSERT INTO ref_mot_cle[\s\S]*FROM frs_mot_cle/s);
  assert.match(sql, /INSERT INTO ref_commune[\s\S]*FROM frs/s);
});

test('010 : les marqueurs techniques ne deviennent pas des mots-clés de rédaction', () => {
  assert.match(sql, /NOT LIKE 'defaut:%'/);
  assert.match(sql, /NOT LIKE 'signal-faible:%'/);
});

test('010 : lecture seule pour rens_api / rens_ro, aucune écriture client', () => {
  assert.match(sql, /GRANT SELECT ON ref_ggd, ref_unite, ref_commune, ref_mot_cle TO rens_api/);
  assert.match(sql, /GRANT SELECT ON ref_ggd, ref_unite, ref_commune, ref_mot_cle TO rens_ro/);
  assert.doesNotMatch(sql, /GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*ON ref_/s);
  assert.doesNotMatch(sql, /GRANT[^;]*ON ref_[^;]*TO rens_redaction/s);
});
