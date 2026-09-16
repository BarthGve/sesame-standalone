import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { MUTATIONS, appliquerDefauts } from './corpus.mjs';

const base = () => Array.from({ length: 200 }, (_, i) => ({
  titre: 'T' + i, unite: 'COB X', ggd: 'GGD 49', dep: 'Maine-et-Loire', commune: 'Segré',
  texte: 'Faits constatés le 3 août sur la commune, sans interpellation.',
  mots: ['ordre public'],
}));

test('chaque mutation porte un code de la grille et une fonction', () => {
  const codes = ['A1', 'A4', 'B5', 'B6', 'B7', 'C9', 'D11', 'D12'];
  for (const m of MUTATIONS) {
    assert.ok(codes.includes(m.code), `code inattendu : ${m.code}`);
    assert.strictEqual(typeof m.applique, 'function');
  }
  assert.deepStrictEqual([...new Set(MUTATIONS.map((m) => m.code))].sort(), codes.sort());
});

test("ni C10 ni les critères retirés ne sont plantés", () => {
  // C10 : la purge à 90 jours le rend inatteignable. C2 et A3 : ils portaient sur le motif,
  // qui n'est pas un champ de la FRS.
  for (const code of ['C10', 'C2', 'A3', 'C8']) {
    assert.ok(!MUTATIONS.some((m) => m.code === code), `${code} ne doit plus être planté`);
  }
});

test('aucune mutation ne pose un champ absent de la FRS', () => {
  const base = { texte: 'Faits constatés le 3 août sur la commune.', mots: [] };
  for (const m of MUTATIONS) {
    const f = m.applique({ ...base });
    for (const champ of ['motif', 'date_evenement', 'origine_info']) {
      assert.ok(!(champ in f), `${m.code} : pose « ${champ} », qui n'existe pas à la saisie`);
    }
  }
});

test('appliquerDefauts : marque chaque fiche mutée d\'un mot-clé defaut:<code>', () => {
  let n = 0;
  const rand = () => (n++ % 7) / 7;
  const f = appliquerDefauts(base(), rand, 40);
  const mutees = f.filter((x) => x.mots.some((m) => m.startsWith('defaut:')));
  assert.strictEqual(mutees.length, 40);
  for (const m of mutees) {
    const code = m.mots.find((x) => x.startsWith('defaut:')).slice(7);
    assert.ok(MUTATIONS.some((mu) => mu.code === code));
  }
});

test('appliquerDefauts : mute des trames existantes, ne fabrique pas de fiches neuves', () => {
  const avant = base();
  const apres = appliquerDefauts(avant.map((x) => ({ ...x, mots: [...x.mots] })), () => 0.5, 10);
  assert.strictEqual(apres.length, avant.length);
  for (const f of apres) assert.match(f.titre, /^T\d+$/);
});

test("AUCUNE mutation ne remplace le texte de la trame : elle le GREFFE", () => {
  // Une fiche défectueuse écrite « à part » se reconnaîtrait au style et reviendrait
  // à l'identique chaque nuit ; l'agent apprendrait une forme au lieu de raisonner,
  // et le taux de détection mesurerait autre chose que ce qu'on croit.
  const origine = base()[0];
  // Noyau SANS repère temporel : la mutation C8 efface légitimement la date du texte,
  // faute de champ « date d'événement » dans la FRS. Tout le reste de la trame demeure.
  const noyau = 'sur la commune, sans interpellation';
  for (const m of MUTATIONS) {
    const f = m.applique({ ...origine });
    assert.ok(f.texte.includes(noyau), `${m.code} : le texte de la trame a été perdu`);
  }
});

// Les corpus normatifs déposés dans IAka (docs/corpus/*.md) ne doivent contenir AUCUNE
// formule plantée : un agent qui retrouverait dans sa documentation la phrase exacte de la
// fiche piégée ferait de la récupération de chaîne, et l'encart « taux de détection mesuré »
// afficherait un score de recherche plein texte présenté comme une performance d'analyse.
test('les corpus normatifs ne contiennent aucune formule de défaut planté', () => {
  const dir = new URL('../../../docs/corpus/', import.meta.url);
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const corpus = readdirSync(dir).filter((f) => f.endsWith('.md'))
    .map((f) => ({ f, t: norm(readFileSync(new URL(f, dir), 'utf8')) }));
  assert.ok(corpus.length >= 3, 'corpus introuvables');

  const base = { texte: 'TRAME.', motif: 'm', mots: [], date_evenement: 'd', origine_info: 'o' };
  for (const m of MUTATIONS) {
    const greffe = norm(m.applique({ ...base }).texte.replace(/^trame\.?/i, ''));
    if (!greffe) continue;
    const mots = greffe.split(' ');
    for (let i = 0; i + 5 <= mots.length; i++) {
      const span = mots.slice(i, i + 5).join(' ');
      for (const c of corpus) {
        assert.ok(!c.t.includes(span), `${m.code} : « ${span} » figure dans ${c.f}`);
      }
    }
  }
});
