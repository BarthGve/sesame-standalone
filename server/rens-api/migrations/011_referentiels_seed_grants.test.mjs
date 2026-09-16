import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('./011_referentiels_seed_grants.sql', import.meta.url), 'utf8');

test('011 : rens_seed peut lire et enrichir les référentiels', () => {
  assert.match(sql, /GRANT SELECT, INSERT ON ref_ggd, ref_unite, ref_commune, ref_mot_cle TO rens_seed/);
  assert.match(sql, /GRANT USAGE, SELECT ON SEQUENCE ref_unite_id_seq TO rens_seed/);
});

test('011 : rens_seed ne gagne pas le droit de réécrire le catalogue officiel', () => {
  // UPDATE/DELETE ouvriraient la porte à un cron qui efface le COG par erreur.
  assert.doesNotMatch(sql, /GRANT[^;]*\b(UPDATE|DELETE)\b[^;]*ON ref_/s);
});

test('011 : l\'API reste en lecture seule sur les référentiels', () => {
  assert.doesNotMatch(sql, /GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*TO rens_api/s);
  assert.doesNotMatch(sql, /GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*TO rens_ro/s);
});
