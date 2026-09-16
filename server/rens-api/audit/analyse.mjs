// Assemblage du rapport d'une analyse À LA DEMANDE (sélection de 1 à 20 fiches depuis le
// front), par opposition au run nocturne qui, lui, est persisté et fait foi.
//
// La conformité n'est pas demandée aux agents : elle est DÉDUITE. Une fiche est conforme
// lorsque aucun des douze critères n'a relevé d'écart — c'est un fait vérifiable, là où un
// « cette fiche est conforme parce que… » rédigé par un modèle serait une affirmation
// invérifiable, et opposable à personne. Le rapport montre donc la grille complète : ce qui
// a été contrôlé, et ce qui a été relevé.

import { filtrerEcarts, consensusDcp, RANG } from './regles.mjs';
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { CRITERES, graviteDe, fondementDe } = require_('./criteres.js');

// Un seul critère est évaluable en SQL (l'ancienneté) : tout le reste se lit dans le texte.
const EN_SQL = new Set(['C10']);

export function construireRapportAnalyse({ fiches, structurels = [], ecarts = [], dcp = [], rejets = [] }) {
  const parFiche = new Map(fiches.map((f) => [f.id, []]));
  // Le filtre est partagé avec le batch nocturne : mêmes règles, mêmes deux chemins.
  const { retenus, ecartes: ecartesRegle, horsPerimetre, discordants } = filtrerEcarts({ fiches, ecarts, dcp });
  // MÊME lecture des verdicts que le filtre : le rapport ne peut pas afficher « aucune donnée
  // personnelle » sur une fiche dont les griefs, eux, ont été conservés.
  const { verdict: verdictDcp } = consensusDcp(dcp);

  // Écarts déterministes d'abord : gravité et fondement dérivés du code, jamais du modèle.
  for (const l of structurels) {
    if (!parFiche.has(l.frs_id) || horsPerimetre.has(l.frs_id)) continue;
    parFiche.get(l.frs_id).push({
      critere: l.critere, libelle: CRITERES[l.critere].libelle,
      gravite: graviteDe(l.critere), fondement: fondementDe(l.critere),
      source: 'sql', extrait: null, explication: null, confiance: null,
    });
  }
  // Puis les écarts rendus par les agents, déjà validés par parse.mjs. Un écart visant une
  // fiche hors sélection est ignoré : mieux vaut le perdre que le rattacher au hasard.
  //
  // Dédoublonnage sur (fiche, critère, extrait) : les trois agents reçoivent le même
  // fragment et relèvent parfois le même passage. En base, la contrainte UNIQUE
  // (run_id, frs_id, critere) l'absorbe ; ici rien n'est persisté, donc on le fait nous-mêmes,
  // sans quoi le rapport affiche deux fois le même grief. À doublon, la version la plus sûre
  // gagne. Deux passages DIFFÉRENTS sous le même critère restent distincts : une croyance et
  // une donnée de santé sont deux griefs, pas un.
  const vus = new Map();
  for (const e of retenus) {
    const cle = `${e.frs_id}|${e.critere}|${(e.extrait || '').trim().toLowerCase()}`;
    const dejaVu = vus.get(cle);
    if (dejaVu) {
      if (e.confiance === 'haute' && dejaVu.confiance !== 'haute') {
        dejaVu.confiance = 'haute';
        dejaVu.explication = e.explication ?? dejaVu.explication;
      }
      continue;
    }
    const entree = {
      critere: e.critere, libelle: CRITERES[e.critere].libelle,
      gravite: e.gravite, fondement: e.fondement, source: 'llm',
      extrait: e.extrait, explication: e.explication, confiance: e.confiance,
    };
    vus.set(cle, entree);
    parFiche.get(e.frs_id).push(entree);
  }

  const codes = Object.keys(CRITERES).sort();
  const parGravite = {};

  const sortie = fiches.map((f) => {
    const liste = parFiche.get(f.id).sort((a, b) => RANG[b.gravite] - RANG[a.gravite] || a.critere.localeCompare(b.critere));
    const releves = new Set(liste.map((e) => e.critere));
    for (const e of liste) parGravite[e.gravite] = (parGravite[e.gravite] || 0) + 1;

    return {
      frs_id: f.id, titre: f.titre, unite: f.unite, code_ggd: f.code_ggd, commune: f.commune,
      date_redaction: f.date_redaction, texte: f.texte,
      // null = aucun verdict rendu. On ne présume jamais l'absence de donnée personnelle.
      porte_dcp: verdictDcp.has(f.id) ? verdictDcp.get(f.id) : null,
      hors_perimetre: horsPerimetre.has(f.id),
      conforme: liste.length === 0,
      gravite_max: liste.length ? liste[0].gravite : null,
      ecarts: liste,
      // La grille intégrale, y compris ce qui passe : sans elle, « conforme » ne dit pas
      // sur quoi la fiche a été contrôlée, et l'absence d'écart se confond avec l'absence
      // de contrôle.
      controles: codes.map((code) => ({
        critere: code, libelle: CRITERES[code].libelle, fondement: CRITERES[code].fondement,
        source: EN_SQL.has(code) ? 'sql' : 'llm',
        statut: releves.has(code) ? 'ecart' : 'ok',
      })),
    };
  });

  const nonConformes = sortie.filter((f) => !f.conforme).length;
  return {
    fiches: sortie,
    resume: {
      total: sortie.length,
      conformes: sortie.length - nonConformes,
      non_conformes: nonConformes,
      ecarts: sortie.reduce((n, f) => n + f.ecarts.length, 0),
      par_gravite: parGravite,
      // Écarts retirés par une règle du décret, pas par le modèle : comptés, jamais tus.
      ecarts_ecartes: ecartesRegle,
      // Fiches sans donnée à caractère personnel : hors du champ du décret, donc valides.
      hors_perimetre: horsPerimetre.size,
      // Fiches où les agents se contredisent sur la présence d'une personne. La fiche reste
      // dans le décret ; le désaccord est compté plutôt que résolu en silence — c'est le seul
      // signal qu'un contrôleur a pour savoir où la détection hésite.
      dcp_discordants: discordants.length,
      // Les entrées écartées par la frontière de confiance sont COMPTÉES : un rapport qui
      // tairait ses rejets laisserait croire à une couverture qu'il n'a pas eue.
      rejets: rejets.length,
    },
  };
}
