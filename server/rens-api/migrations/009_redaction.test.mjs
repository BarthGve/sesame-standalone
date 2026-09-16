// server/rens-api/migrations/009_redaction.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('./009_redaction.sql', import.meta.url), 'utf8');

test('009 : le rôle de rédaction peut insérer une fiche et ses mots-clés', () => {
  assert.match(sql, /CREATE ROLE rens_redaction LOGIN/);
  assert.match(sql, /GRANT INSERT ON frs, frs_mot_cle TO rens_redaction/);
});

test('009 : les séquences serial sont ouvertes, sinon l\'INSERT échoue', () => {
  // Un INSERT sur une colonne serial consomme nextval : le GRANT sur la table ne suffit pas.
  for (const s of ['frs_id_seq', 'frs_mot_cle_id_seq']) {
    assert.match(sql, new RegExp(`USAGE, SELECT ON SEQUENCE[^;]*${s}`, 's'), `${s} manquante`);
  }
});

test('009 : RETURNING id impose un SELECT colonne id, pas une lecture de table', () => {
  // PostgreSQL exige SELECT sur les colonnes de RETURNING. On borne à id.
  assert.match(sql, /GRANT SELECT \(id\) ON frs TO rens_redaction/);
  // Pas de SELECT table entière (exfiltration), ni UPDATE/DELETE.
  assert.doesNotMatch(sql, /GRANT\s+SELECT\s+ON\s+(frs|frs_mot_cle)\s+TO\s+rens_redaction/i);
  assert.doesNotMatch(sql, /GRANT[^;]*\b(UPDATE|DELETE)\b[^;]*TO rens_redaction/s);
});

test('009 : les rôles de lecture ne gagnent aucun droit d\'écriture', () => {
  assert.doesNotMatch(sql, /GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*TO rens_api/s);
  assert.doesNotMatch(sql, /GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*TO rens_ro/s);
});
