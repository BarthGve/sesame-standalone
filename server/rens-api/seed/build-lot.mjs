// Construction d'un lot de FRS (bruit + trames + défauts plantés).
// Partagé par generate.mjs (déterministe → SQL) et nightly.mjs (aléa réel → INSERT).
//
// Doctrine : TOUS les rattachements viennent des référentiels fournis en entrée
// (unitesByGgd, communesByDept, et la liste des GGD du corpus qui ont des unités).
// Aucune unité n'est inventée ici — si le catalogue est vide pour un GGD, ce GGD
// n'est pas tiré.

import { THEMES, TRAMES, DEPTS, GGDS, appliquerDefauts } from './corpus.mjs';

/**
 * @param {{
 *   pick: (arr: any[]) => any,
 *   randint: (n: number) => number,
 *   random: () => number,
 *   fill: (t: string) => string,
 *   nBruit?: number,
 *   trameProb?: number,
 *   auditDefauts?: number,
 *   communesByDept?: Map<string, string[]>,
 *   unitesByGgd?: Map<string, string[]>,
 * }} opts
 */
export function buildLot({
  pick, randint, random, fill,
  nBruit,
  trameProb = 0.4,
  auditDefauts = 40,
  communesByDept = new Map(),
  unitesByGgd = new Map(),
}) {
  const fiches = [];
  const byCode = Object.fromEntries(DEPTS.map(([c, dep, com]) => [c, { dep, com }]));

  // GGD pour lesquels on a AU MOINS une unité ET une commune dans les refs.
  const ggdsDisponibles = GGDS.filter((g) => {
    const code = g.ggd.replace(/^GGD\s*/, '');
    const unites = unitesByGgd.get(g.ggd);
    const communes = communesByDept.get(code);
    return unites?.length && communes?.length;
  });

  if (!ggdsDisponibles.length) {
    throw new Error(
      'référentiels vides : charger ref_unite et ref_commune (node seed/load-referentiels.mjs) avant de générer des FRS',
    );
  }

  const rattacher = (ggd, dep, codeDept, fallbackCommunes) => {
    const unites = unitesByGgd.get(ggd);
    const communes = communesByDept.get(codeDept)?.length
      ? communesByDept.get(codeDept)
      : fallbackCommunes;
    if (!unites?.length || !communes?.length) return null;
    return {
      ggd,
      dep,
      commune: pick(communes),
      unite: pick(unites),
    };
  };

  const n = nBruit ?? (900 + randint(301));
  for (let k = 0; k < n; k++) {
    const g = pick(ggdsDisponibles);
    const th = pick(THEMES);
    const code = g.ggd.replace(/^GGD\s*/, '');
    const r = rattacher(g.ggd, g.dep, code, g.communes);
    if (!r) continue;
    fiches.push({
      ...r,
      titre: pick(th.titres),
      texte: fill(pick(th.textes)),
      mots: th.mots.slice(),
    });
  }

  for (const tr of TRAMES) {
    if (random() >= trameProb) continue;
    // Uniquement des codes de trame pour lesquels le référentiel a des unités.
    const codesOk = tr.codes.filter((c) => {
      const ggd = `GGD ${c}`;
      return unitesByGgd.get(ggd)?.length && (
        communesByDept.get(c)?.length || byCode[c]?.com?.length
      );
    });
    if (!codesOk.length) continue;
    const code = pick(codesOk);
    const g = byCode[code];
    const r = rattacher(`GGD ${code}`, g.dep, code, g.com);
    if (!r) continue;
    fiches.push({
      ...r,
      titre: tr.titre,
      texte: fill(tr.texte),
      mots: [...tr.mots, `signal-faible:${tr.code}`],
    });
  }

  return appliquerDefauts(fiches, random, auditDefauts);
}
