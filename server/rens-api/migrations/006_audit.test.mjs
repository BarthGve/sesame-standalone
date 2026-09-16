// server/rens-api/migrations/006_audit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('./006_audit.sql', import.meta.url), 'utf8');

test('006 : ajoute les 3 colonnes frs, toutes NULLables', () => {
  assert.match(sql, /ALTER TABLE frs ADD COLUMN motif\s+text;/);
  assert.match(sql, /ALTER TABLE frs ADD COLUMN date_evenement\s+date;/);
  assert.match(sql, /ALTER TABLE frs ADD COLUMN origine_info\s+text;/);
  assert.doesNotMatch(sql, /ADD COLUMN (motif|date_evenement|origine_info)[^;]*NOT NULL/);
});

test('006 : frs_audit_run a un jour UNIQUE (idempotence du rejeu)', () => {
  assert.match(sql, /CREATE TABLE frs_audit_run/);
  assert.match(sql, /jour\s+date NOT NULL UNIQUE/);
});

test('006 : frs_audit dédoublonne en base sur (run_id, frs_id, critere)', () => {
  assert.match(sql, /UNIQUE \(run_id, frs_id, critere\)/);
});

test('006 : les tables d\'audit cascadent depuis le run', () => {
  const cascades = sql.match(/REFERENCES frs_audit_run\(id\) ON DELETE CASCADE/g) || [];
  assert.strictEqual(cascades.length, 2, 'fragment et audit cascadent tous deux');
});

test('006 : frs_audit_fragment trace le statut, sans quoi « conforme » et « non traité » sont indiscernables', () => {
  assert.match(sql, /CREATE TABLE frs_audit_fragment/);
  assert.match(sql, /statut\s+text NOT NULL DEFAULT 'en_attente'/);
  assert.match(sql, /frs_ids\s+integer\[\] NOT NULL/);
});
