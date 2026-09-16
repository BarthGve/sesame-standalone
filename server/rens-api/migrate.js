'use strict';

const fs = require('fs');
const path = require('path');

async function migrate(pool, dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  return files;
}

async function applyTracked(pool, dir) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const { rows: existing } = await pool.query(
    `SELECT to_regclass('public.frs') AS frs`,
  );
  const { rows: tracked } = await pool.query('SELECT filename FROM schema_migrations');
  // Volume déjà migré à la main (wiki ancien) : enregistrer sans rejouer 001
  // (CREATE TABLE sans IF NOT EXISTS).
  if (existing[0].frs && tracked.length === 0) {
    for (const f of files) {
      await pool.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
        [f],
      );
    }
    return files;
  }
  for (const f of files) {
    const { rows } = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [f],
    );
    if (rows.length) continue;
    await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
  }
  return files;
}

async function seedIfEmpty(pool) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM frs');
  if (rows[0].n > 0) return false;
  await pool.query(
    fs.readFileSync(path.join(__dirname, 'seed', 'frs_seed.sql'), 'utf8'),
  );
  return true;
}

async function run() {
  const { Pool } = require('pg');
  const pool = new Pool({
    host: process.env.PGHOST || 'postgres',
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER_MIGRATE || process.env.PGUSER,
    password: process.env.PGPASSWORD_MIGRATE || process.env.PGPASSWORD,
    database: process.env.PGDATABASE || 'rens',
  });
  try {
    await applyTracked(pool, path.join(__dirname, 'migrations'));
    await seedIfEmpty(pool);
  } finally {
    await pool.end();
  }
}

module.exports = { migrate, applyTracked, seedIfEmpty, run };
