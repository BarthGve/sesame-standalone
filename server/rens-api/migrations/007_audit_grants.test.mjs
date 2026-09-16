// server/rens-api/migrations/007_audit_grants.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('./007_audit_grants.sql', import.meta.url), 'utf8');

test('007 : le rôle d\'écriture peut alimenter les trois tables d\'audit', () => {
  // Sans ces droits, le job nocturne échoue en « permission denied » à la première
  // écriture et le run entier est perdu — la migration 006 n'en posait aucun.
  for (const t of ['frs_audit_run', 'frs_audit_fragment', 'frs_audit']) {
    assert.match(sql, new RegExp(`GRANT[^;]*ON ${t}[^;]*TO rens_seed`, 's'), `${t} : pas de droit d'écriture`);
  }
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON frs_audit_run/);
});

test('007 : les séquences serial sont ouvertes au rôle d\'écriture', () => {
  // Un INSERT sur une colonne serial consomme nextval : sans USAGE sur la séquence,
  // le GRANT sur la table ne suffit pas.
  for (const s of ['frs_audit_run_id_seq', 'frs_audit_fragment_id_seq', 'frs_audit_id_seq']) {
    assert.match(sql, new RegExp(`USAGE, SELECT ON SEQUENCE[^;]*${s}`, 's'), `${s} manquante`);
  }
});

test('007 : le job doit pouvoir mettre à jour motif, date d\'événement et origine', () => {
  // Les trois colonnes ajoutées par 006 sont alimentées par l'alimentation nocturne,
  // qui n'avait jusqu'ici qu'un INSERT sur frs.
  assert.match(sql, /GRANT UPDATE\s*\([^)]*motif[^)]*\)\s*ON frs TO rens_seed/s);
});

test('007 : l\'API reste en LECTURE seule sur l\'audit', () => {
  assert.match(sql, /GRANT SELECT ON frs_audit_run, frs_audit_fragment, frs_audit TO rens_api, rens_ro/);
  assert.doesNotMatch(sql, /GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*TO rens_api/);
});
