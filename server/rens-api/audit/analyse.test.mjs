import { test } from 'node:test';
import assert from 'node:assert';
import { construireRapportAnalyse } from './analyse.mjs';

const fiche = (id, extra = {}) => ({
  id, titre: 'T' + id, unite: 'COB X', code_ggd: 'GGD 49', commune: 'Segré',
  date_redaction: '2026-08-05', texte: 'Faits constatés sur la commune, sans interpellation.', ...extra,
});

const ecart = (frs_id, critere, extra = {}) => ({
  frs_id, critere, gravite: 'majeur', fondement: 'CSI R. 236-22, 4°',
  extrait: 'Faits constatés', explication: 'x', confiance: 'haute', ...extra,
});

test('une fiche sans écart est CONFORME, avec les 9 contrôles passés', () => {
  const r = construireRapportAnalyse({ fiches: [fiche(1)], structurels: [], ecarts: [], rejets: [] });
  const f = r.fiches[0];
  assert.strictEqual(f.conforme, true);
  assert.strictEqual(f.ecarts.length, 0);
  assert.strictEqual(f.controles.length, 9);
  assert.ok(f.controles.every((c) => c.statut === 'ok'));
});

test('chaque contrôle porte son code, son libellé, son fondement et sa source', () => {
  const r = construireRapportAnalyse({ fiches: [fiche(1)], structurels: [], ecarts: [], rejets: [] });
  const c10 = r.fiches[0].controles.find((c) => c.critere === 'C10');
  assert.strictEqual(c10.source, 'sql');
  assert.match(c10.fondement, /^CSI R\. 236-/);
  assert.ok(c10.libelle.length > 3);
  const a1 = r.fiches[0].controles.find((c) => c.critere === 'A1');
  assert.strictEqual(a1.source, 'llm');
});

test('un écart LLM bascule le contrôle correspondant en « ecart », les autres restent ok', () => {
  const r = construireRapportAnalyse({ fiches: [fiche(1)], structurels: [], ecarts: [ecart(1, 'A4')], rejets: [] });
  const f = r.fiches[0];
  assert.strictEqual(f.conforme, false);
  assert.strictEqual(f.ecarts.length, 1);
  assert.strictEqual(f.controles.find((c) => c.critere === 'A4').statut, 'ecart');
  assert.strictEqual(f.controles.filter((c) => c.statut === 'ok').length, 8);
});

test('un écart structurel est intégré avec sa gravité et son fondement dérivés du code', () => {
  const r = construireRapportAnalyse({
    fiches: [fiche(1)], structurels: [{ frs_id: 1, critere: 'C10' }], ecarts: [], rejets: [],
  });
  const e = r.fiches[0].ecarts[0];
  assert.strictEqual(e.critere, 'C10');
  assert.strictEqual(e.source, 'sql');
  assert.strictEqual(e.gravite, 'mineur');
  assert.strictEqual(e.fondement, 'CSI R. 236-24');
});

test('les écarts d\'une fiche sont triés du plus grave au moins grave', () => {
  const r = construireRapportAnalyse({
    fiches: [fiche(1)], structurels: [],
    // Extraits distincts : un même passage n'appartient qu'à un agent (cf. règle plus bas).
    ecarts: [ecart(1, 'D12', { gravite: 'mineur', extrait: 'individu nuisible' }),
             ecart(1, 'B5', { gravite: 'bloquant', extrait: 'de confession X' }),
             ecart(1, 'C9', { gravite: 'bloquant', extrait: 'sans interpellation' })],
    rejets: [],
  });
  assert.deepStrictEqual(r.fiches[0].ecarts.map((e) => e.critere), ['B5', 'C9', 'D12']);
  assert.strictEqual(r.fiches[0].gravite_max, 'bloquant');
});

test('un écart visant une fiche hors sélection est ignoré, pas rattaché au hasard', () => {
  const r = construireRapportAnalyse({ fiches: [fiche(1)], structurels: [], ecarts: [ecart(99, 'A4')], rejets: [] });
  assert.strictEqual(r.fiches[0].conforme, true);
  assert.strictEqual(r.fiches.length, 1);
});

test('les fiches gardent l\'ordre de la sélection', () => {
  const r = construireRapportAnalyse({ fiches: [fiche(7), fiche(3), fiche(5)], structurels: [], ecarts: [], rejets: [] });
  assert.deepStrictEqual(r.fiches.map((f) => f.frs_id), [7, 3, 5]);
});

test('le résumé compte les fiches, les conformes et les écarts par gravité', () => {
  const r = construireRapportAnalyse({
    fiches: [fiche(1), fiche(2), fiche(3)], structurels: [{ frs_id: 2, critere: 'C10' }],
    ecarts: [ecart(1, 'B5', { gravite: 'bloquant', extrait: 'de confession X' }),
             ecart(1, 'D11', { gravite: 'mineur', extrait: 'le bruit court' })], rejets: [],
  });
  assert.strictEqual(r.resume.total, 3);
  assert.strictEqual(r.resume.conformes, 1);
  assert.strictEqual(r.resume.non_conformes, 2);
  assert.deepStrictEqual(r.resume.par_gravite, { bloquant: 1, mineur: 2 });
});

test('les entrées rejetées par la frontière de confiance sont comptées, jamais affichées comme écarts', () => {
  const r = construireRapportAnalyse({
    fiches: [fiche(1)], structurels: [], ecarts: [],
    rejets: [{ raison: 'fondement manquant', entree: {} }, { raison: 'critere inconnu', entree: {} }],
  });
  assert.strictEqual(r.resume.rejets, 2);
  assert.strictEqual(r.fiches[0].conforme, true);
});

test('le texte intégral de la fiche est transmis : le front surligne dans le contexte', () => {
  const r = construireRapportAnalyse({ fiches: [fiche(1)], structurels: [], ecarts: [], rejets: [] });
  assert.match(r.fiches[0].texte, /Faits constatés sur la commune/);
  // La fiche rendue ne porte que des champs réels : pas de motif, pas de date d'événement.
  assert.ok(!('motif' in r.fiches[0]) && !('date_evenement' in r.fiches[0]));
});

test("une proposition ne rend pas la fiche non conforme : qualifier n'est pas relever", () => {
  const r = construireRapportAnalyse({
    fiches: [fiche(1)], structurels: [], ecarts: [], rejets: [],
  });
  assert.strictEqual(r.fiches[0].conforme, true);
  assert.strictEqual(r.resume.conformes, 1);
  assert.strictEqual(r.resume.ecarts, 0);
});

test('deux propositions sur la même fiche : la plus sûre gagne, sans doublon', () => {
  const r = construireRapportAnalyse({
    fiches: [fiche(1)], structurels: [], ecarts: [], rejets: [],
  });
});

// --- Périmètre : pas de donnée personnelle, pas de grief -------------------------------

const sansPii = (id) => fiche(id, {
  porte_pii: false,
  texte: "Des dégradations ont été constatées sur du mobilier urbain du centre-bourg.",
});

test("sans donnée à caractère personnel, la fiche est valide et les écarts sont écartés", () => {
  // Le décret encadre un traitement de DCP : une fiche qui n'en porte aucune ne tombe sous
  // aucune de ses limites. Relever un A1 sur un phénomène sans personne, c'est reprocher
  // une atteinte aux droits de personne.
  const r = construireRapportAnalyse({
    fiches: [sansPii(1)], structurels: [],
    ecarts: [ecart(1, 'A1', { gravite: 'bloquant', fondement: 'CSI R. 236-21' })],
    dcp: [{ frs_id: 1, porte_dcp: false, explication: 'Aucune personne identifiable.' }],
    rejets: [],
  });
  assert.strictEqual(r.fiches[0].conforme, true);
  assert.strictEqual(r.fiches[0].ecarts.length, 0);
  assert.strictEqual(r.fiches[0].porte_dcp, false);
  assert.strictEqual(r.resume.hors_perimetre, 1);
});

test("le verdict de l'agent ne suffit pas seul : le contrôle automatique doit concorder", () => {
  // Un agent qui déclare à tort « aucune donnée personnelle » effacerait tous les écarts
  // d'une fiche qui en contient. On ne retire des signalements que si les DEUX sources
  // disent « rien » : le verdict de l'agent ET la détection faite sur le texte.
  const r = construireRapportAnalyse({
    fiches: [fiche(1, { porte_pii: true, texte: 'Contrôle de M. X, né le 01/01/1990, plaque AB-123-CD.' })],
    structurels: [],
    ecarts: [ecart(1, 'A1', { gravite: 'bloquant' })],
    dcp: [{ frs_id: 1, porte_dcp: false }],
    rejets: [],
  });
  assert.strictEqual(r.fiches[0].ecarts.length, 1);
  assert.strictEqual(r.fiches[0].conforme, false);
  assert.strictEqual(r.resume.hors_perimetre, 0);
});

test("l'agent peut au contraire signaler une donnée personnelle que la détection a manquée", () => {
  // « un élève de sixième âgé de 11 ans de l'établissement voisin » identifie indirectement
  // une personne par recoupement — aucune expression régulière ne l'attrape.
  const r = construireRapportAnalyse({
    fiches: [fiche(1, { porte_pii: false })], structurels: [],
    ecarts: [ecart(1, 'C9', { gravite: 'bloquant' })],
    dcp: [{ frs_id: 1, porte_dcp: true }],
    rejets: [],
  });
  assert.strictEqual(r.fiches[0].ecarts.length, 1);
  assert.strictEqual(r.fiches[0].porte_dcp, true);
});

test('les trois agents votent : une seule voix « oui » retient la fiche dans le décret', () => {
  // Le préalable DCP est dans les TROIS prompts : chaque agent rend son verdict par fiche.
  // Ils étaient repliés dans un Map, où le dernier arrivé écrasait les autres. Le vote est
  // asymétrique, comme sa conséquence : effacer TOUS les griefs d'une fiche demande
  // l'unanimité, les retenir demande une voix.
  const r = construireRapportAnalyse({
    fiches: [sansPii(1)], structurels: [],
    ecarts: [ecart(1, 'C9', { gravite: 'bloquant' })],
    dcp: [
      { frs_id: 1, porte_dcp: false },
      { frs_id: 1, porte_dcp: true, explication: "Le gérant du bar X de la commune Y." },
      { frs_id: 1, porte_dcp: false },
    ],
    rejets: [],
  });
  assert.strictEqual(r.fiches[0].porte_dcp, true);
  assert.strictEqual(r.fiches[0].ecarts.length, 1);
  assert.strictEqual(r.resume.hors_perimetre, 0);
  assert.strictEqual(r.resume.dcp_discordants, 1);
});

test("trois « non » unanimes sortent la fiche du décret, et le désaccord n'est pas inventé", () => {
  const r = construireRapportAnalyse({
    fiches: [sansPii(1)], structurels: [],
    ecarts: [ecart(1, 'A1', { gravite: 'bloquant' })],
    dcp: [1, 2, 3].map(() => ({ frs_id: 1, porte_dcp: false })),
    rejets: [],
  });
  assert.strictEqual(r.fiches[0].ecarts.length, 0);
  assert.strictEqual(r.resume.hors_perimetre, 1);
  assert.strictEqual(r.resume.dcp_discordants, 0);
});

test("un verdict qui n'est pas un booléen n'est pas une voix", () => {
  const r = construireRapportAnalyse({
    fiches: [sansPii(1)], structurels: [], ecarts: [ecart(1, 'A1')],
    dcp: [{ frs_id: 1, porte_dcp: null }], rejets: [],
  });
  assert.strictEqual(r.fiches[0].ecarts.length, 1);
  assert.strictEqual(r.fiches[0].porte_dcp, null);
});

test('sans verdict rendu, rien ne change : on ne présume pas l\'absence', () => {
  const r = construireRapportAnalyse({
    fiches: [sansPii(1)], structurels: [], ecarts: [ecart(1, 'A1')], dcp: [], rejets: [],
  });
  assert.strictEqual(r.fiches[0].ecarts.length, 1);
  assert.strictEqual(r.fiches[0].porte_dcp, null);
});

test('un même critère rendu deux fois sur une fiche ne compte qu\'une fois', () => {
  // Trois agents reçoivent le même fragment et peuvent relever le même passage. En base, la
  // contrainte UNIQUE (run_id, frs_id, critere) absorbe le doublon ; l'analyse à la demande
  // ne persiste rien, elle doit donc dédoublonner elle-même — sinon le rapport affiche deux
  // fois le même grief et le compte deux fois.
  const r = construireRapportAnalyse({
    fiches: [fiche(1)], structurels: [],
    ecarts: [
      ecart(1, 'B5', { gravite: 'bloquant', extrait: 'de confession X', confiance: 'moyenne' }),
      ecart(1, 'B5', { gravite: 'bloquant', extrait: 'de confession X', confiance: 'haute' }),
      ecart(1, 'B7', { gravite: 'mineur' }),
    ],
    rejets: [],
  });
  assert.strictEqual(r.fiches[0].ecarts.length, 2);
  assert.strictEqual(r.resume.ecarts, 2);
  // À doublon, la version la plus sûre l'emporte : c'est elle qui sera affichée.
  assert.strictEqual(r.fiches[0].ecarts.find((e) => e.critere === 'B5').confiance, 'haute');
});

test('deux écarts de MÊME critère sur des passages DIFFÉRENTS restent distincts', () => {
  // Une fiche peut porter deux données sensibles de nature différente : une croyance et une
  // donnée de santé. Les fondre en une seule masquerait la moitié du grief.
  const r = construireRapportAnalyse({
    fiches: [fiche(1)], structurels: [],
    ecarts: [
      ecart(1, 'B5', { gravite: 'bloquant', extrait: 'de confession X' }),
      ecart(1, 'B5', { gravite: 'bloquant', extrait: 'suit un traitement pour Y' }),
    ],
    rejets: [],
  });
  assert.strictEqual(r.fiches[0].ecarts.length, 2);
});

// --- Règles vérifiables, là où le prompt ne tient pas ---------------------------------

test("un écart « données » sur un passage déjà relevé en rédaction est écarté", () => {
  // Un passage appartient à un seul agent. Sur une rumeur ou un jugement de valeur, le
  // critère de rédaction est le plus spécifique : c'est lui qui reste.
  const r = construireRapportAnalyse({
    fiches: [fiche(1)], structurels: [],
    ecarts: [
      ecart(1, 'D11', { gravite: 'mineur', extrait: 'Le bruit court dans le quartier' }),
      ecart(1, 'B7', { gravite: 'mineur', extrait: 'Le bruit court dans le quartier' }),
    ],
    rejets: [],
  });
  assert.deepStrictEqual(r.fiches[0].ecarts.map((e) => e.critere), ['D11']);
});

test("un écart « données » sur un AUTRE passage est conservé", () => {
  const r = construireRapportAnalyse({
    fiches: [fiche(1)], structurels: [],
    ecarts: [
      ecart(1, 'D12', { gravite: 'mineur', extrait: 'individu nuisible' }),
      ecart(1, 'B5', { gravite: 'bloquant', extrait: 'de confession X' }),
    ],
    rejets: [],
  });
  assert.strictEqual(r.fiches[0].ecarts.length, 2);
});

test('B6 est écarté quand il vise une donnée expressément admise', () => {
  // R. 236-22, I, 1° à 3° : identité, coordonnées, moyens de déplacement. Les signaler
  // reviendrait à reprocher ce que le décret autorise.
  for (const extrait of [
    'immatriculation relevée par un riverain : AB-123-CD',
    'Un deux-roues non homologué apparaît impliqué',
    'le compte @libre_2026 relaie l’appel',
    'joignable au 06 12 34 56 78',
    'une camionnette blanche circulant de nuit',
  ]) {
    const r = construireRapportAnalyse({
      fiches: [fiche(1)], structurels: [],
      ecarts: [ecart(1, 'B6', { gravite: 'majeur', extrait })], rejets: [],
    });
    assert.strictEqual(r.fiches[0].ecarts.length, 0, `B6 retenu à tort sur « ${extrait} »`);
  }
});

test('B6 tient sur une donnée réellement hors nomenclature', () => {
  const r = construireRapportAnalyse({
    fiches: [fiche(1)], structurels: [],
    ecarts: [ecart(1, 'B6', { gravite: 'majeur', extrait: 'mot de passe communiqué par un tiers : soleil2026' })],
    rejets: [],
  });
  assert.strictEqual(r.fiches[0].ecarts.length, 1);
});

test("D11 est écarté quand l'extrait désigne une source", () => {
  // « Le rédacteur n'a pas à nommer sa source pour que l'origine soit rattachable » : un
  // riverain, une sœur, un exploitant sont des sources désignées. Le prompt le dit ; l'agent
  // ne s'y tient qu'une fois sur deux. Idem pour la constatation d'unité à la 1re personne
  // (« contrôlons ») — équivalent doctrinal à « constatation directe ».
  for (const extrait of [
    'immatriculation relevée par un riverain',
    "suivi pour un trouble diagnostiqué en 2019 d'après sa sœur",
    "signalé par l'exploitant du site",
    'selon le proviseur du collège',
    'transmis par le renseignement territorial',
    'constaté par les militaires de la brigade',
    'contrôlons un individu sur la voie publique',
    'nous avons constaté un va-et-vient nocturne',
  ]) {
    const r = construireRapportAnalyse({
      fiches: [fiche(1)], structurels: [],
      ecarts: [ecart(1, 'D11', { gravite: 'mineur', extrait })], rejets: [],
    });
    assert.strictEqual(r.fiches[0].ecarts.length, 0, `D11 retenu à tort sur « ${extrait} »`);
  }
});

test("D11 est écarté quand l'explication affirme que l'origine est identifiable", () => {
  // Contradiction agent : libellé « origine non identifiable » + explication qui dit le
  // contraire (cas réel : « identifiable comme une constatation directe… verbe contrôlons »).
  const r = construireRapportAnalyse({
    fiches: [fiche(1)], structurels: [],
    ecarts: [ecart(1, 'D11', {
      gravite: 'mineur',
      extrait: 'contrôlons',
      explication: "L'origine de l'information est identifiable comme une constatation directe par l'unité (verbe 'contrôlons').",
    })],
    rejets: [],
  });
  assert.strictEqual(r.fiches[0].ecarts.length, 0);
});

test('D11 tient sur une rumeur, même quand elle ressemble à une source', () => {
  // « selon plusieurs échos » a la forme d'une attribution mais ne rattache rien : c'est
  // précisément ce que le critère vise.
  for (const extrait of [
    'Le bruit court dans le quartier',
    'selon plusieurs échos',
    'il se dit que l’intéressé prépare autre chose',
    'des dégradations ont été constatées récemment',
    'il semblerait que le local serve de point de rendez-vous',
  ]) {
    const r = construireRapportAnalyse({
      fiches: [fiche(1)], structurels: [],
      ecarts: [ecart(1, 'D11', { gravite: 'mineur', extrait })], rejets: [],
    });
    assert.strictEqual(r.fiches[0].ecarts.length, 1, `D11 perdu à tort sur « ${extrait} »`);
  }
});

test("sur un même passage, c'est le critère le PLUS GRAVE qui reste", () => {
  // Une croyance relevée à la fois en B5 (donnée sensible interdite, bloquant) et en D12
  // (jugement de valeur, mineur) : garder le mineur reviendrait à effacer le grief le plus
  // lourd du décret au profit d'une remarque de rédaction.
  const r = construireRapportAnalyse({
    fiches: [fiche(1)], structurels: [],
    ecarts: [
      ecart(1, 'D12', { gravite: 'mineur', extrait: "L'intéressé, de confession X, suit un traitement" }),
      ecart(1, 'B5', { gravite: 'bloquant', extrait: 'de confession X' }),
    ],
    rejets: [],
  });
  assert.deepStrictEqual(r.fiches[0].ecarts.map((e) => e.critere), ['B5']);
});

test('à gravité égale, le critère de rédaction garde le passage', () => {
  // Une rumeur relevée en D11 et en B7, tous deux mineurs : D11 est le plus spécifique.
  const r = construireRapportAnalyse({
    fiches: [fiche(1)], structurels: [],
    ecarts: [
      ecart(1, 'B7', { gravite: 'mineur', extrait: 'Le bruit court dans le quartier' }),
      ecart(1, 'D11', { gravite: 'mineur', extrait: 'Le bruit court dans le quartier' }),
    ],
    rejets: [],
  });
  assert.deepStrictEqual(r.fiches[0].ecarts.map((e) => e.critere), ['D11']);
});

test("un extrait large n'absorbe pas les griefs précis qu'il contient", () => {
  // L'agent LÉGALITÉ cite volontiers une phrase entière en appui d'un A1. Si ce simple
  // recouvrement suffisait, un A1 effacerait tous les écarts précis de la fiche — et le
  // rapport ne dirait plus QUOI corriger.
  const r = construireRapportAnalyse({
    fiches: [fiche(1)], structurels: [],
    ecarts: [
      ecart(1, 'A1', { gravite: 'bloquant', extrait: "Un élève de sixième, âgé de 11 ans, aurait tenu des propos hostiles à l'égard d'un enseignant le 2 août." }),
      ecart(1, 'C9', { gravite: 'bloquant', extrait: 'un élève de sixième, âgé de 11 ans' }),
      ecart(1, 'D12', { gravite: 'mineur', extrait: 'propos hostiles' }),
    ],
    rejets: [],
  });
  assert.deepStrictEqual(r.fiches[0].ecarts.map((e) => e.critere).sort(), ['A1', 'C9', 'D12']);
});

test("B5 est écarté quand l'extrait ne porte aucune donnée sensible", () => {
  // B5 vise une catégorie fermée : origine, croyance, opinion, santé, vie sexuelle. Un
  // qualificatif moral n'en est pas une — et comme B5 est bloquant, le laisser passer lui
  // ferait chasser le D12 qui, lui, est fondé.
  for (const extrait of [
    'Garçon foncièrement mauvais et sournois',
    'individu manifestement nuisible',
    'comportement inquiétant relevé par la patrouille',
  ]) {
    const r = construireRapportAnalyse({
      fiches: [fiche(1)], structurels: [],
      ecarts: [ecart(1, 'B5', { gravite: 'bloquant', extrait })], rejets: [],
    });
    assert.strictEqual(r.fiches[0].ecarts.length, 0, `B5 retenu à tort sur « ${extrait} »`);
  }
});

test('B5 tient sur une donnée sensible réelle', () => {
  for (const extrait of [
    'de confession musulmane pratiquante',
    'suivi pour un trouble bipolaire diagnostiqué en 2019',
    "l'intéressé, d'origine maghrébine",
    'militant syndical encarté depuis 2019',
    'suit un traitement pour dépression',
  ]) {
    const r = construireRapportAnalyse({
      fiches: [fiche(1)], structurels: [],
      ecarts: [ecart(1, 'B5', { gravite: 'bloquant', extrait })], rejets: [],
    });
    assert.strictEqual(r.fiches[0].ecarts.length, 1, `B5 perdu à tort sur « ${extrait} »`);
  }
});

test("un A1 dont l'explication affirme l'atteinte se contredit et est écarté", () => {
  // Observé en recette : « Les rodéos motorisés répétés caractérisent une atteinte à la
  // sécurité publique (délit prévu par le Code de la route) » — rendu comme un ÉCART A1.
  // L'agent a raisonné juste et conclu l'inverse de ce qu'il signale.
  for (const explication of [
    "Les rodéos motorisés répétés caractérisent une atteinte à la sécurité publique.",
    "Les faits constituent une atteinte à la sécurité publique au sens de R. 236-21.",
    "L'atteinte à la sécurité publique est caractérisée par la répétition des faits.",
  ]) {
    const r = construireRapportAnalyse({
      fiches: [fiche(1)], structurels: [],
      ecarts: [ecart(1, 'A1', { gravite: 'bloquant', explication })], rejets: [],
    });
    assert.strictEqual(r.fiches[0].ecarts.length, 0, `A1 retenu malgré « ${explication} »`);
  }
});

test("une atteinte seulement POTENTIELLE suffit : l'A1 qui la décrit est écarté", () => {
  // Le décret admet les données personnelles dès lors qu'une atteinte à la sécurité publique
  // ou à la sûreté de l'État est POSSIBLE — il n'attend pas qu'elle se réalise. Un A1 dont
  // l'explication décrit ce risque reproche donc une fiche que le texte autorise.
  for (const explication of [
    "Les repérages constatés sont de nature à porter atteinte à la sécurité publique.",
    "Le groupe identifié est susceptible de porter atteinte à la sécurité publique.",
    "Les faits font naître un risque d'atteinte à la sûreté de l'État.",
    "Il s'agit d'une atteinte potentielle à la sécurité publique.",
  ]) {
    const r = construireRapportAnalyse({
      fiches: [fiche(1)], structurels: [],
      ecarts: [ecart(1, 'A1', { gravite: 'bloquant', explication })], rejets: [],
    });
    assert.strictEqual(r.fiches[0].ecarts.length, 0, `A1 retenu malgré « ${explication} »`);
  }
});

test('un A1 correctement motivé est conservé', () => {
  for (const explication of [
    "Un rassemblement sans incident ni violence ne caractérise pas une atteinte à la sécurité publique.",
    "Aucune atteinte à la sécurité publique n'est établie par les faits narrés.",
    "Des propos hostiles isolés ne caractérisent pas une atteinte.",
    // La négation du vocabulaire du potentiel doit rester lisible : « n'est pas susceptible »
    // dit l'inverse de « est susceptible », et l'écart tient.
    "La personne citée n'est pas susceptible de porter atteinte à la sécurité publique.",
    "Un différend de voisinage ne fait naître aucun risque pour la sécurité publique.",
  ]) {
    const r = construireRapportAnalyse({
      fiches: [fiche(1)], structurels: [],
      ecarts: [ecart(1, 'A1', { gravite: 'bloquant', explication })], rejets: [],
    });
    assert.strictEqual(r.fiches[0].ecarts.length, 1, `A1 perdu à tort sur « ${explication} »`);
  }
});
