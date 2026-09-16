import { test } from 'node:test';
import assert from 'node:assert';
import { parseSortieAgents } from './parse.mjs';

const IDS = [10, 11, 12];
const ok = { frs_id: 10, critere: 'A4', fondement: 'CSI R. 236-22, II à IV', extrait: 'e', explication: 'x', confiance: 'haute' };

test('accepte un tableau JSON nu', () => {
  const r = parseSortieAgents(JSON.stringify([ok]), IDS);
  assert.strictEqual(r.ecarts.length, 1);
  assert.strictEqual(r.ecarts[0].frs_id, 10);
});

test('accepte un objet déjà désérialisé', () => {
  assert.strictEqual(parseSortieAgents([ok], IDS).ecarts.length, 1);
});

test('tolère les clôtures markdown que les modèles ajoutent', () => {
  const r = parseSortieAgents('```json\n' + JSON.stringify([ok]) + '\n```', IDS);
  assert.strictEqual(r.ecarts.length, 1);
});

test('un fragment sain rend un tableau vide, et c\'est un résultat', () => {
  const r = parseSortieAgents('[]', IDS);
  assert.deepStrictEqual(r.ecarts, []);
  assert.deepStrictEqual(r.rejets, []);
});

test('la gravité vient du code, jamais du modèle', () => {
  const r = parseSortieAgents([{ ...ok, critere: 'D12', gravite: 'bloquant' }], IDS);
  assert.strictEqual(r.ecarts[0].gravite, 'mineur');
});

test('rejette un code de critère inventé', () => {
  const r = parseSortieAgents([{ ...ok, critere: 'X9' }], IDS);
  assert.strictEqual(r.ecarts.length, 0);
  assert.match(r.rejets[0].raison, /critere/);
});

test('rejette un frs_id hors du fragment (hallucination d\'identifiant)', () => {
  const r = parseSortieAgents([{ ...ok, frs_id: 999 }], IDS);
  assert.strictEqual(r.ecarts.length, 0);
  assert.match(r.rejets[0].raison, /frs_id/);
});

test('rejette un signalement sans fondement : pas d\'article, pas d\'écart', () => {
  const r = parseSortieAgents([{ ...ok, fondement: '  ' }], IDS);
  assert.strictEqual(r.ecarts.length, 0);
  assert.match(r.rejets[0].raison, /fondement/);
});

test('une confiance inconnue est ramenée à moyenne, pas rejetée', () => {
  const r = parseSortieAgents([{ ...ok, confiance: 'certaine' }], IDS);
  assert.strictEqual(r.ecarts[0].confiance, 'moyenne');
});

test('du texte non JSON lève, pour que le fragment soit marqué en échec', () => {
  assert.throws(() => parseSortieAgents("Je n'ai pas pu analyser ces fiches.", IDS), /SORTIE_ILLISIBLE/);
});

test('trie les rejets sans perdre les écarts valides du même lot', () => {
  const r = parseSortieAgents([ok, { ...ok, critere: 'ZZ' }, { ...ok, frs_id: 11, critere: 'B5' }], IDS);
  assert.strictEqual(r.ecarts.length, 2);
  assert.strictEqual(r.rejets.length, 1);
});



// --- Donnée à caractère personnel ------------------------------------------------------
// Le décret encadre un traitement de DONNÉES À CARACTÈRE PERSONNEL. Une fiche qui n'en
// contient aucune — un phénomène décrit sans personne identifiée ni identifiable — ne
// tombe sous aucune des limites qu'il pose.

const dcp = { type: 'dcp', frs_id: 10, porte_dcp: false,
  explication: "Aucune personne identifiée ni identifiable : ni identité, ni plaque, ni élément permettant un recoupement." };

test('un verdict « sans donnée personnelle » est rangé à part', () => {
  const r = parseSortieAgents([dcp], IDS);
  assert.strictEqual(r.dcp.length, 1);
  assert.strictEqual(r.dcp[0].porte_dcp, false);
  assert.strictEqual(r.ecarts.length, 0);
  assert.strictEqual(r.rejets.length, 0);
});

test('un verdict DCP ne demande pas de fondement : il constate, il ne reproche rien', () => {
  const r = parseSortieAgents([{ type: 'dcp', frs_id: 10, porte_dcp: true }], IDS);
  assert.strictEqual(r.dcp.length, 1);
  assert.strictEqual(r.dcp[0].porte_dcp, true);
});

test('un verdict DCP sur une fiche hors fragment est rejeté', () => {
  const r = parseSortieAgents([{ ...dcp, frs_id: 999 }], IDS);
  assert.strictEqual(r.dcp.length, 0);
  assert.match(r.rejets[0].raison, /frs_id/);
});

test('porte_dcp non booléen est rejeté : « peut-être » n\'est pas un verdict', () => {
  const r = parseSortieAgents([{ ...dcp, porte_dcp: 'non' }], IDS);
  assert.strictEqual(r.dcp.length, 0);
  assert.match(r.rejets[0].raison, /porte_dcp/);
});

test("une entrée sans type reste un écart : le contrat de sortie n'a pas bougé", () => {
  const r = parseSortieAgents([ok], IDS);
  assert.strictEqual(r.ecarts.length, 1);
  assert.deepStrictEqual(r.dcp, []);
});

test("le type « motif » n'est plus reconnu : il est traité comme un écart mal formé", () => {
  // La proposition de qualification a été retirée du cas d'usage. Un agent qui en rendrait
  // encore doit être rejeté, pas suivi.
  const r = parseSortieAgents([{ type: 'motif', frs_id: 10, motif: 'violences-urbaines', fondement: 'CSI R. 236-21' }], IDS);
  assert.strictEqual(r.ecarts.length, 0);
  assert.match(r.rejets[0].raison, /critere/);
});
