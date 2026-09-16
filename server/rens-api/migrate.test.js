const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { migrate, applyTracked, seedIfEmpty } = require('./migrate');

test('migrate : applique les SQL triés, 001_frs.sql en premier', async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      return { rows: [] };
    },
  };
  const files = await migrate(pool, path.join(__dirname, 'migrations'));
  assert.equal(files[0], '001_frs.sql');
  assert.ok(files.includes('012_redaction_returning.sql'));
  assert.match(queries[0], /CREATE TABLE frs/i);
});

test('applyTracked : saute un fichier déjà enregistré', async () => {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (/to_regclass/.test(sql)) return { rows: [{ frs: null }] };
      if (/SELECT filename FROM schema_migrations/.test(sql)) return { rows: [] };
      if (/SELECT 1 FROM schema_migrations/.test(sql)) {
        return { rows: values && values[0] === '001_frs.sql' ? [{ '?column?': 1 }] : [] };
      }
      return { rows: [] };
    },
  };
  await applyTracked(pool, path.join(__dirname, 'migrations'));
  const applied = queries.filter((q) => /CREATE TABLE frs\b/i.test(q.sql));
  assert.equal(applied.length, 0, '001 déjà tracked : pas rejoué');
});

test('applyTracked : schéma déjà là, tracking vide → enregistre sans rejouer', async () => {
  const inserts = [];
  const pool = {
    async query(sql, values) {
      if (/to_regclass/.test(sql)) return { rows: [{ frs: 'frs' }] };
      if (/SELECT filename FROM schema_migrations/.test(sql)) return { rows: [] };
      if (/INSERT INTO schema_migrations/.test(sql)) inserts.push(values[0]);
      return { rows: [] };
    },
  };
  const files = await applyTracked(pool, path.join(__dirname, 'migrations'));
  assert.ok(files.includes('001_frs.sql'));
  assert.ok(inserts.includes('001_frs.sql'));
  assert.ok(inserts.includes('012_redaction_returning.sql'));
});

test('seedIfEmpty : no-op si frs déjà peuplée', async () => {
  let wrote = false;
  const pool = {
    async query(sql) {
      if (/count\(/i.test(sql)) return { rows: [{ n: 12 }] };
      wrote = true;
      return { rows: [] };
    },
  };
  assert.equal(await seedIfEmpty(pool), false);
  assert.equal(wrote, false);
});

test('run utilise PGUSER_MIGRATE plutôt que PGUSER', () => {
  const src = require('fs').readFileSync(path.join(__dirname, 'migrate.js'), 'utf8');
  assert.match(src, /PGUSER_MIGRATE/);
  assert.match(src, /PGPASSWORD_MIGRATE/);
});
