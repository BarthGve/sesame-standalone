'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

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

async function run() {
  const pool = new Pool({
    host: process.env.PGHOST || 'postgres',
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || 'rgp',
  });
  try {
    await applyTracked(pool, path.join(__dirname, 'migrations'));
    await pool.query(
      fs.readFileSync(path.join(__dirname, 'seed', 'minimal.sql'), 'utf8'),
    );
  } finally {
    await pool.end();
  }
}

module.exports = { migrate, applyTracked, run };
