// server/rens-api/migrations/012_redaction_returning.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('./012_redaction_returning.sql', import.meta.url), 'utf8');

test('012 : SELECT (id) pour RETURNING, sans ouvrir la table en lecture', () => {
  assert.match(sql, /GRANT SELECT \(id\) ON frs TO rens_redaction/);
  assert.doesNotMatch(sql, /GRANT\s+SELECT\s+ON\s+frs\s+TO/i);
});
