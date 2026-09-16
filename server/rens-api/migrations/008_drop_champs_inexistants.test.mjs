// server/rens-api/migrations/008_drop_champs_inexistants.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('./008_drop_champs_inexistants.sql', import.meta.url), 'utf8');

test('008 : retire les trois colonnes que la FRS ne porte pas', () => {
  for (const c of ['motif', 'date_evenement', 'origine_info']) {
    assert.match(sql, new RegExp(`ALTER TABLE frs DROP COLUMN IF EXISTS ${c};`), `${c} non retirée`);
  }
  assert.match(sql, /DROP INDEX IF EXISTS idx_frs_date_evt/);
});

test('008 : reprend le droit d\'écriture devenu sans objet', () => {
  assert.match(sql, /REVOKE UPDATE \(motif, date_evenement, origine_info\) ON frs FROM rens_seed/);
});

test("008 : ne touche à AUCUNE colonne réelle de la FRS", () => {
  const reelles = ['titre', 'texte', 'unite', 'code_ggd', 'departement', 'commune', 'date_redaction'];
  for (const c of reelles) {
    assert.doesNotMatch(sql, new RegExp(`DROP COLUMN[^;]*\\b${c}\\b`), `${c} menacée`);
  }
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM/);
});
