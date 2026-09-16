// Générateur DÉTERMINISTE du seed FRS — jeu NATIONAL (métropole + Outre-mer).
// ~1000 fiches / jour du 2026-07-17 au 2026-07-22 inclus. Aucune dépendance, aucun Math.random :
// PRNG mulberry32 à graine fixe → sortie stable et reproductible.
// Usage : node server/rens-api/seed/generate.mjs
//
// Les rattachements (GGD, unité, commune, mots-clés) viennent du MÊME catalogue que
// load-referentiels.mjs (catalogue.mjs + communes-fr.json). Après chargement du SQL :
//   node seed/load-referentiels.mjs
// pour peupler ref_* — le formulaire et le cron liront alors exactement ces valeurs.
//
// GIPASP : plaques d'immatriculation mentionnées quand il y a une atteinte SUPPOSÉE à l'ordre
// public / la sûreté ; identités de personnes uniquement si elles sont susceptibles de porter
// atteinte à la sécurité publique / de l'État ET ont été contrôlées. Tout est FICTIF (plaques et
// identités générées par fiche).
import { writeFileSync } from 'node:fs';
import {
  esc, PL, PRENOMS, NOMS, HANDLES, PLATS,
  THEMES, JOURS, TRAMES, appliquerDefauts,
} from './corpus.mjs';
import { unitesParGgd, catalogueGgd, communesParDept } from './catalogue.mjs';
import { buildLot } from './build-lot.mjs';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260717);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const randint = (n) => Math.floor(rng() * n);

function plaque() {
  const l = () => PL[randint(PL.length)];
  return `${l()}${l()}-${100 + randint(900)}-${l()}${l()}`;
}
function identite() {
  const an = 1968 + randint(40);
  return `${pick(PRENOMS)} ${pick(NOMS)}, né(e) le ${String(1 + randint(28)).padStart(2, '0')}/${String(1 + randint(12)).padStart(2, '0')}/${an}`;
}
function pseudo() { return '@' + pick(HANDLES); }
function url() { return pick(PLATS) + pick(HANDLES); }
function fill(t) {
  return t.replace(/\{PLAQUE\}/g, () => plaque())
          .replace(/\{IDENTITE\}/g, () => identite())
          .replace(/\{PSEUDO\}/g, () => pseudo())
          .replace(/\{URL\}/g, () => url());
}

function fmtInsertPortable(f) {
  const out = [];
  out.push(
    `INSERT INTO frs (date_redaction, titre, unite, code_ggd, departement, commune, texte) VALUES ` +
    `('${f.date}', '${esc(f.titre)}', '${esc(f.unite)}', '${f.ggd}', '${esc(f.dep)}', '${esc(f.commune)}', '${esc(f.texte)}');`
  );
  f.mots.forEach((mot, i) => {
    out.push(`INSERT INTO frs_mot_cle (frs_id, mot, ordre) VALUES (currval('frs_id_seq'), '${esc(mot)}', ${i});`);
  });
  return out.join('\n');
}

// Communes COG + unités = même source que load-referentiels / ref_*.
const communesByDept = communesParDept();
const unitesByGgd = unitesParGgd();
const ggdByCode = Object.fromEntries(catalogueGgd().map((g) => [g.code, g]));

function rattacher(codeDept) {
  const ggd = `GGD ${codeDept}`;
  const g = ggdByCode[ggd];
  const unites = unitesByGgd.get(ggd);
  const communes = communesByDept.get(codeDept);
  if (!g || !unites?.length || !communes?.length) return null;
  return {
    ggd,
    dep: g.nom_departement,
    unite: pick(unites),
    commune: pick(communes),
  };
}

const fiches = [];

// 1) Bruit de fond national via buildLot (unités + communes du catalogue uniquement).
for (const day of JOURS) {
  const lot = buildLot({
    pick, randint, random: rng, fill,
    nBruit: 950 + randint(100),
    trameProb: 0, // trames injectées explicitement ci-dessous (volume de test stable)
    auditDefauts: 0,
    communesByDept,
    unitesByGgd,
  });
  for (const f of lot) fiches.push({ ...f, date: day });
}

// 2) Trames : 2–3 fiches/jour/trame, rattachements catalogue.
for (const tr of TRAMES) {
  let i = 0;
  for (const day of JOURS) {
    const perDay = 2 + randint(2);
    for (let k = 0; k < perDay; k++) {
      const code = tr.codes[i % tr.codes.length];
      i++;
      const r = rattacher(code);
      if (!r) continue;
      fiches.push({
        date: day,
        ...r,
        titre: tr.titre,
        texte: fill(tr.texte),
        mots: [...tr.mots, `signal-faible:${tr.code}`],
      });
    }
  }
}

// 3) BIAIS pilote (démo synthèse) : pic « violences urbaines » le 21/07.
const BIAS_DAY = '2026-07-21';
const BIAS_N = 300;
const biasTheme = THEMES.find((t) => t.theme === 'violences urbaines');
const codesOk = [...unitesByGgd.keys()]
  .map((g) => g.replace(/^GGD\s*/, ''))
  .filter((c) => communesByDept.get(c)?.length);
for (let k = 0; k < BIAS_N; k++) {
  const r = rattacher(pick(codesOk));
  if (!r) continue;
  fiches.push({
    date: BIAS_DAY,
    ...r,
    titre: pick(biasTheme.titres),
    texte: fill(pick(biasTheme.textes)),
    mots: biasTheme.mots.slice(),
  });
}

// 4) Défauts plantés (vérité terrain audit) — une seule passe en fin de génération.
const avecDefauts = appliquerDefauts(fiches, rng, 40);

avecDefauts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ggd < b.ggd ? -1 : 1));

const header = `-- Seed FRS NATIONAL généré par generate.mjs (déterministe, graine 20260717). NE PAS éditer à la main.\n` +
  `-- ${avecDefauts.length} fiches, 2026-07-17 → 2026-07-22, métropole + Outre-mer. Identités/plaques fictives, catégories GIPASP.\n` +
  `-- Rattachements issus du catalogue (catalogue.mjs + communes-fr.json) = mêmes valeurs que ref_*.\n` +
  `-- Après chargement : node seed/load-referentiels.mjs.\nBEGIN;\n`;
const body = avecDefauts.map(fmtInsertPortable).join('\n');
const footer = `\nCOMMIT;\n`;

writeFileSync(new URL('./frs_seed.sql', import.meta.url), header + body + footer);
console.error(`écrit frs_seed.sql : ${avecDefauts.length} fiches`);
