// FRONTIÈRE DE CONFIANCE. Tout ce qui sort d'un agent est une entrée non fiable :
// codes inventés, identifiants hallucinés, gravité inflatée, JSON entouré de prose.
// Rien n'est persisté sans avoir été validé ici.

import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { estCodeValide, graviteDe } = require_('./criteres.js');

const CONFIANCES = ['haute', 'moyenne'];

// Les modèles encadrent volontiers leur JSON de ``` ou d'une phrase. On récupère le
// premier tableau JSON équilibré plutôt que d'exiger une sortie parfaite.
function extraireJSON(brut) {
  if (typeof brut !== 'string') return brut;
  const sansFences = brut.replace(/```(?:json)?/gi, '').trim();
  const debut = sansFences.indexOf('[');
  const fin = sansFences.lastIndexOf(']');
  if (debut === -1 || fin <= debut) throw new Error('SORTIE_ILLISIBLE');
  try {
    return JSON.parse(sansFences.slice(debut, fin + 1));
  } catch {
    throw new Error('SORTIE_ILLISIBLE');
  }
}

// Verdict sur la présence de données à caractère personnel. Il ne reproche rien, donc il
// n'exige pas de fondement — mais il exige un booléen : « peut-être » n'est pas un verdict,
// et le serveur ne retirera des signalements que sur une affirmation nette.
function lireDcp(e, autorises, rejets) {
  const frsId = Number(e.frs_id);
  if (!Number.isInteger(frsId) || !autorises.has(frsId)) {
    rejets.push({ raison: 'frs_id hors du fragment', entree: e }); return null;
  }
  if (typeof e.porte_dcp !== 'boolean') {
    rejets.push({ raison: 'porte_dcp absent ou non booléen', entree: e }); return null;
  }
  return {
    frs_id: frsId, porte_dcp: e.porte_dcp,
    explication: typeof e.explication === 'string' && e.explication.trim() ? e.explication.trim() : null,
  };
}

export function parseSortieAgents(brut, idsAutorises) {
  const donnees = extraireJSON(brut);
  const liste = Array.isArray(donnees) ? donnees : donnees && Array.isArray(donnees.ecarts) ? donnees.ecarts : null;
  if (!liste) throw new Error('SORTIE_ILLISIBLE');

  const autorises = new Set(idsAutorises);
  const ecarts = [], dcp = [], rejets = [];

  for (const e of liste) {
    if (!e || typeof e !== 'object') { rejets.push({ raison: 'entree_non_objet', entree: e }); continue; }
    // Sans `type`, l'entrée est un écart : le contrat existant ne bouge pas.
    if (e.type === 'dcp') {
      const d = lireDcp(e, autorises, rejets);
      if (d) dcp.push(d);
      continue;
    }
    const frsId = Number(e.frs_id);
    if (!Number.isInteger(frsId) || !autorises.has(frsId)) {
      rejets.push({ raison: 'frs_id hors du fragment', entree: e }); continue;
    }
    if (!estCodeValide(e.critere)) {
      rejets.push({ raison: 'critere inconnu', entree: e }); continue;
    }
    const fondement = typeof e.fondement === 'string' ? e.fondement.trim() : '';
    if (!fondement) {
      // Règle de fond : sans article citable, le signalement n'est pas opposable.
      rejets.push({ raison: 'fondement manquant', entree: e }); continue;
    }
    ecarts.push({
      frs_id: frsId,
      critere: e.critere,
      gravite: graviteDe(e.critere), // jamais e.gravite
      fondement,
      extrait: typeof e.extrait === 'string' && e.extrait.trim() ? e.extrait.trim() : null,
      explication: typeof e.explication === 'string' && e.explication.trim() ? e.explication.trim() : null,
      confiance: CONFIANCES.includes(e.confiance) ? e.confiance : 'moyenne',
    });
  }
  return { ecarts, dcp, rejets };
}
