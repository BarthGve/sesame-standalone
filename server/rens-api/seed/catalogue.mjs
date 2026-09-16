// Catalogue canonique des référentiels de rédaction FRS.
//
// Quatre tables, quatre sources :
//   ref_ggd      ← catalogueGgd()
//   ref_unite    ← catalogueUnites()
//   ref_mot_cle  ← catalogueMotsCles()
//   ref_commune  ← catalogueCommunes()  (COG officiel, seed/communes-fr.json, ~35k)
//
// Consommateurs :
//   - load-referentiels.mjs  → peuplement des tables ref_*
//   - generate.mjs           → seed SQL (hors base : mêmes valeurs que ref_*)
//   - nightly / build-lot    → lit ref_* en base (ou le catalogue hors-base)
//   - formulaire + POST /frs → lit ref_* via l'API
//
// Doctrine : on ne crée JAMAIS une FRS avec une unité / commune / GGD / mot-clé
// inventé hors catalogue. Les tables ref_* sont peuplées d'abord ; formulaire et
// cron y puisent ensuite. La réconciliation frs → ref_* ne sert qu'au rattrapage
// historique (anciennes fiches avant le catalogue).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DEPTS, THEMES, TRAMES } from './corpus.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const COMMUNES_JSON = join(root, 'communes-fr.json');

/** GGD hors corpus mais présents dans le COG (Île-de-France, COM absents de DEPTS). */
export const GGD_EXTRA = [
  ['75', 'Paris'], ['92', 'Hauts-de-Seine'], ['93', 'Seine-Saint-Denis'],
  ['94', 'Val-de-Marne'], ['975', 'Saint-Pierre-et-Miquelon'],
  ['977', 'Saint-Barthélemy'], ['978', 'Saint-Martin'],
  ['986', 'Wallis-et-Futuna'], ['987', 'Polynésie française'],
  ['988', 'Nouvelle-Calédonie'],
];

/**
 * Liste des GGD à insérer dans ref_ggd.
 * @returns {{ code: string, code_dept: string, nom_departement: string }[]}
 */
export function catalogueGgd() {
  const out = [];
  for (const [code, dep] of DEPTS) {
    out.push({ code: `GGD ${code}`, code_dept: code, nom_departement: dep });
  }
  for (const [code, dep] of GGD_EXTRA) {
    out.push({ code: `GGD ${code}`, code_dept: code, nom_departement: dep });
  }
  return out;
}

/**
 * Ordre de bataille de démonstration pour un groupement.
 * Une poignée d'unités réalistes (COB/BTA sur les communes principales, BR + PSIG
 * à la préfecture) — pas une COB par commune du COG (le formulaire resterait illisible).
 *
 * @param {string} codeDept
 * @param {string[]} communesPrincipales  2–3 villes du département
 * @returns {string[]}
 */
export function unitesPourDept(codeDept, communesPrincipales) {
  const villes = (communesPrincipales || []).filter(Boolean);
  if (!villes.length) return [];
  const pref = villes[0];
  const noms = new Set();
  // Compagnie / BR / PSIG au chef-lieu.
  noms.add(`CGD ${pref}`);
  noms.add(`BR ${pref}`);
  noms.add(`PSIG ${pref}`);
  // COB / BTA sur chaque ville connue du corpus.
  for (const v of villes) {
    noms.add(`COB ${v}`);
    noms.add(`BTA ${v}`);
  }
  // Une unité « mobile » départementale pour varier les rattachements.
  noms.add(`EDSR ${codeDept}`);
  return [...noms];
}

/**
 * Catalogue complet des unités : une entrée par (code_ggd, nom).
 * @returns {{ code_ggd: string, nom: string }[]}
 */
export function catalogueUnites() {
  const out = [];
  for (const [code, , communes] of DEPTS) {
    const codeGgd = `GGD ${code}`;
    for (const nom of unitesPourDept(code, communes)) {
      out.push({ code_ggd: codeGgd, nom });
    }
  }
  // GGD extra : unités génériques sur le nom de département (pas de ville corpus).
  for (const [code, dep] of GGD_EXTRA) {
    const codeGgd = `GGD ${code}`;
    for (const nom of unitesPourDept(code, [dep])) {
      out.push({ code_ggd: codeGgd, nom });
    }
  }
  return out;
}

/**
 * Mots-clés de rédaction : thèmes + signatures des trames (hors marqueurs techniques).
 * @returns {string[]}
 */
export function catalogueMotsCles() {
  const mots = new Set();
  for (const t of THEMES) {
    for (const m of t.mots || []) if (m && m.length <= 40) mots.add(m);
  }
  for (const tr of TRAMES) {
    for (const m of tr.mots || []) if (m && m.length <= 40) mots.add(m);
  }
  return [...mots].sort((a, b) => a.localeCompare(b, 'fr'));
}

/**
 * Index unités par GGD, pour le générateur hors-base.
 * @returns {Map<string, string[]>}
 */
export function unitesParGgd() {
  const map = new Map();
  for (const u of catalogueUnites()) {
    if (!map.has(u.code_ggd)) map.set(u.code_ggd, []);
    map.get(u.code_ggd).push(u.nom);
  }
  return map;
}

/**
 * Communes officielles (COG : métropole, Corse, outre-mer).
 * Source fichier : seed/communes-fr.json — triplets [code_insee, nom, code_dept].
 * @returns {{ code_insee: string, nom: string, code_dept: string }[]}
 */
export function catalogueCommunes() {
  const raw = JSON.parse(readFileSync(COMMUNES_JSON, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('communes-fr.json : tableau attendu');
  return raw.map(([code_insee, nom, code_dept]) => ({
    code_insee: String(code_insee),
    nom: String(nom),
    code_dept: String(code_dept),
  }));
}

/**
 * Index communes par code département, pour le générateur hors-base.
 * @returns {Map<string, string[]>}  code_dept → noms
 */
export function communesParDept() {
  const map = new Map();
  for (const c of catalogueCommunes()) {
    if (!map.has(c.code_dept)) map.set(c.code_dept, []);
    map.get(c.code_dept).push(c.nom);
  }
  return map;
}
