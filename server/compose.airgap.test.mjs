import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");
const init = readFileSync(join(root, "infra/postgres/init/05-rens-migrate-seed.sh"), "utf8");
const passwords = readFileSync(join(root, "infra/postgres/init/02-passwords.sql"), "utf8");
const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");

test("postgres-debug n'écoute que sur 127.0.0.1:5432", () => {
  assert.match(compose, /127\.0\.0\.1:5432:5432/);
  assert.doesNotMatch(compose, /^\s+-\s+"5432:5432"/m);
});

test("API_TOKEN interpolé depuis .env.example (RGP/RENS/COTE)", () => {
  assert.match(compose, /API_TOKEN: \$\{RGP_API_TOKEN:-changeme\}/);
  assert.match(compose, /API_TOKEN: \$\{RENS_API_TOKEN:-changeme\}/);
  assert.match(compose, /API_TOKEN: \$\{COTE_API_TOKEN:-changeme\}/);
});

test("postgres init monte migrations + seed FRS et rens-api migre en sesame", () => {
  assert.match(compose, /\/opt\/rens\/migrations/);
  assert.match(compose, /\/opt\/rens\/frs_seed\.sql/);
  assert.match(compose, /PGUSER_MIGRATE: sesame/);
  assert.match(init, /\/opt\/rens\/migrations/);
  assert.match(init, /frs_seed\.sql/);
  assert.match(init, /schema_migrations/);
});

test("rens_seed a un mot de passe local-dev", () => {
  assert.match(passwords, /rens_seed LOGIN PASSWORD 'rens-seed-local-dev'/);
  assert.match(compose, /PGPASSWORD_SEED: rens-seed-local-dev/);
});

test("CI docker compose build sans push ni up", () => {
  assert.match(ci, /docker compose build/);
  assert.doesNotMatch(ci, /docker compose up/);
  assert.doesNotMatch(ci, /docker push/);
});
