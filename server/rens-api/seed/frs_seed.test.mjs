import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('./frs_seed.sql', import.meta.url), 'utf8');

test('seed : volume national ~6000 fiches (5000-7000)', () => {
  const n = (sql.match(/INSERT INTO frs \(/g) || []).length;
  assert.ok(n >= 5000 && n <= 7000, `attendu 5000-7000 fiches, obtenu ${n}`);
});

test('seed : couverture nationale (métropole + Outre-mer)', () => {
  for (const ggd of ['GGD 13', 'GGD 33', 'GGD 59', 'GGD 2A', 'GGD 973', 'GGD 974', 'GGD 976']) {
    assert.ok(sql.includes(`'${ggd}'`), `GGD manquant : ${ggd}`);
  }
  const ggds = new Set((sql.match(/'GGD [0-9AB]+'/g) || []));
  assert.ok(ggds.size >= 80, `attendu >=80 GGD, obtenu ${ggds.size}`);
});

test('seed : bornes de dates 2026-07-17 → 2026-07-22 (et rien en dehors)', () => {
  assert.ok(sql.includes("'2026-07-17'"), 'début 2026-07-17 manquant');
  assert.ok(sql.includes("'2026-07-22'"), 'fin 2026-07-22 manquante');
  // Dates de RÉDACTION : premier littéral de chaque INSERT.
  const dates = new Set([...sql.matchAll(/VALUES \('(2026-\d{2}-\d{2})'/g)].map((m) => m[1]));
  assert.ok(dates.size === 6, `attendu 6 jours de rédaction, obtenu ${dates.size}`);
  for (const d of dates) {
    assert.ok(d >= '2026-07-17' && d <= '2026-07-22', `date hors plage : ${d}`);
  }
});

test("seed : le dump n'écrit que les colonnes réelles de la FRS", () => {
  const inserts = sql.split('INSERT INTO frs (').slice(1);
  assert.ok(inserts.length > 5000);
  for (const i of inserts.slice(0, 200)) {
    const ligne = i.split('\n')[0];
    assert.match(ligne, /date_redaction, titre, unite, code_ggd, departement, commune, texte\)/);
    assert.doesNotMatch(ligne, /motif|date_evenement|origine_info/);
  }
});

test('seed : 3 trames de signaux faibles plantées (hook technique)', () => {
  for (const code of ['signal-faible:demarchage-faux-agent', 'signal-faible:survol-drone-sensible', 'signal-faible:reperage-exploitation']) {
    const count = (sql.match(new RegExp(code, 'g')) || []).length;
    assert.ok(count >= 8, `trame ${code} : attendu >=8 occurrences, obtenu ${count}`);
  }
});

// Chaque trame a un mot-clé NATUREL signature rare-mais-dispersé, sinon la découverte par
// agrégation (GROUP BY mot HAVING count BETWEEN 5 AND 20) ne l'isolera pas du bruit.
test('seed : mots-clés signatures rares-mais-dispersés (8-24)', () => {
  const countMot = (mot) => (sql.match(new RegExp(`, '${mot.replace(/'/g, "''")}', `, 'g')) || []).length;
  for (const mot of ['faux agent', 'drone', 'exploitation agricole']) {
    const n = countMot(mot);
    assert.ok(n >= 8 && n <= 24, `signature "${mot}" : attendu 8-24, obtenu ${n} (collision avec le bruit ?)`);
  }
});
