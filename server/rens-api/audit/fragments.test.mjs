import { test } from 'node:test';
import assert from 'node:assert';
import { decouper, composerFragment, CHAMPS_FRAGMENT } from './fragments.mjs';

const fiche = (id, extra = {}) => ({
  id, date_redaction: '2026-08-04', titre: 'T' + id, unite: 'COB X', code_ggd: 'GGD 49',
  commune: 'Segré', texte: 'texte ' + id, porte_pii: true, ...extra,
});

test('decouper : découpe en paquets de la taille demandée, reste inclus', () => {
  const f = Array.from({ length: 95 }, (_, i) => fiche(i + 1));
  const frags = decouper(f, 40);
  assert.strictEqual(frags.length, 3);
  assert.deepStrictEqual(frags.map((x) => x.length), [40, 40, 15]);
  assert.strictEqual(frags[2][14].id, 95);
});

test('decouper : liste vide → aucun fragment', () => {
  assert.deepStrictEqual(decouper([], 40), []);
});

test('decouper : taille invalide → repli sur 40 plutôt que boucle infinie', () => {
  const f = Array.from({ length: 41 }, (_, i) => fiche(i + 1));
  assert.strictEqual(decouper(f, 0).length, 2);
  assert.strictEqual(decouper(f, -3).length, 2);
});

test('composerFragment : liste blanche — un champ inconnu ne passe pas', () => {
  const { fiches } = composerFragment(1, [fiche(7, { secret: 'x', mots_cles: ['a'], motif: 'inventé' })]);
  // `motif` n'est pas un champ de la FRS : même présent en base, il ne part pas au workflow.
  assert.strictEqual(fiches[0].motif, undefined);
  assert.deepStrictEqual(Object.keys(fiches[0]).sort(), [...CHAMPS_FRAGMENT].sort());
  assert.strictEqual(fiches[0].secret, undefined);
  assert.strictEqual(fiches[0].mots_cles, undefined);
});

test("composerFragment : le marqueur de vérité terrain ne fuit JAMAIS dans le prompt", () => {
  const piegee = fiche(9, { mots_cles: ['stupéfiants', 'defaut:B5'], defaut: 'B5' });
  const payload = JSON.stringify(composerFragment(2, [piegee]));
  assert.ok(!payload.includes('defaut:'), 'le mot-clé defaut: est présent dans le fragment');
  assert.ok(!payload.includes('"defaut"'), 'le champ defaut est présent dans le fragment');
});

test('composerFragment : porte le rang du fragment', () => {
  assert.strictEqual(composerFragment(5, [fiche(1)]).fragment, 5);
});
