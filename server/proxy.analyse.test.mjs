import { test } from 'node:test';
import assert from 'node:assert';
import { createHandler } from './proxy.mjs';

const cfg = { rensApiUrl: 'https://rens.test', rensApiToken: 'TK', qualiteAppId: 'APP', tenantId: 'T', jwt: 'J' };

const faireReq = (url, body) => {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    url, method: 'POST', headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; },
    on(evt, fn) {
      if (evt === 'data') chunks.forEach((c) => fn(c));
      if (evt === 'end') fn();
      return this;
    },
  };
};
const faireRes = () => {
  const r = { code: 0, corps: '' };
  r.writeHead = (c) => { r.code = c; };
  r.end = (b) => { r.corps = b || ''; };
  return r;
};

// Le lot renvoyé par rens-api : une fiche saine, une fiche au motif absent (écart SQL).
const lot = {
  data: {
    fiches: [
      { id: 1, titre: 'A', unite: 'COB X', code_ggd: 'GGD 49', commune: 'C', date_redaction: '2026-08-05',
        texte: 'Faits constatés.', porte_pii: false, mots_cles: ['defaut:B5'] },
      { id: 2, titre: 'B', unite: 'COB X', code_ggd: 'GGD 49', commune: 'C', date_redaction: '2016-01-05',
        texte: 'Autres faits.', porte_pii: false },
    ],
    // Un seul écart déterministe subsiste : l'ancienneté (C10). Les contrôles sur le motif
    // et la date d'événement portaient sur des champs que la FRS ne contient pas.
    structurels: [{ frs_id: 2, critere: 'C10' }],
  },
};

const attendre = async (h, jobId) => {
  for (let i = 0; i < 50; i++) {
    const res = faireRes();
    await h({ url: `/api/job/status?jobId=${jobId}`, method: 'GET', headers: {} }, res);
    const v = JSON.parse(res.corps);
    if (v.status === 'done' || v.status === 'error') return v;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('job jamais terminé');
};

test('POST /api/rens/audit/analyse rend un jobId immédiatement', async () => {
  const h = createHandler({ cfg, fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(lot) }),
    rensWorkflow: async () => '[]' });
  const res = faireRes();
  await h(faireReq('/api/rens/audit/analyse', { frs_ids: [1, 2] }), res);
  assert.strictEqual(res.code, 202);
  assert.ok(JSON.parse(res.corps).jobId);
});

test('le rapport rend chaque fiche avec sa grille de 9 contrôles', async () => {
  const h = createHandler({ cfg, fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(lot) }),
    rensWorkflow: async () => JSON.stringify([{ frs_id: 1, critere: 'A4', fondement: 'CSI R. 236-22, II à IV',
      extrait: 'Faits constatés', explication: 'x', confiance: 'haute' }]) });
  const res = faireRes();
  await h(faireReq('/api/rens/audit/analyse', { frs_ids: [1, 2] }), res);
  const v = await attendre(h, JSON.parse(res.corps).jobId);
  assert.strictEqual(v.status, 'done', v.error);
  const r = v.result;
  assert.strictEqual(r.fiches.length, 2);
  assert.strictEqual(r.fiches[0].controles.length, 9);
  assert.strictEqual(r.fiches[0].conforme, false);
  assert.strictEqual(r.fiches[0].ecarts[0].critere, 'A4');
  // La fiche 2 porte l'unique écart déterministe qui subsiste, calculé en SQL.
  assert.deepStrictEqual(r.fiches[1].ecarts.map((e) => e.critere), ['C10']);
  assert.ok(r.fiches[1].ecarts.every((e) => e.source === 'sql'));
  assert.strictEqual(r.resume.conformes, 0);
});

test('le prompt envoyé au workflow ne contient jamais le marqueur defaut:', async () => {
  let vu = '';
  const h = createHandler({ cfg, fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(lot) }),
    rensWorkflow: async ({ prompt }) => { vu = prompt; return '[]'; } });
  const res = faireRes();
  await h(faireReq('/api/rens/audit/analyse', { frs_ids: [1, 2] }), res);
  await attendre(h, JSON.parse(res.corps).jobId);
  assert.ok(!vu.includes('defaut:'), 'le marqueur de vérité terrain a fuité dans le prompt');
});

test('sélection vide ou au-delà de 20 fiches : refus immédiat, sans job', async () => {
  const h = createHandler({ cfg, fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(lot) }),
    rensWorkflow: async () => '[]' });
  for (const ids of [[], Array.from({ length: 21 }, (_, i) => i + 1)]) {
    const res = faireRes();
    await h(faireReq('/api/rens/audit/analyse', { frs_ids: ids }), res);
    assert.strictEqual(res.code, 400);
  }
});

test('une sortie illisible met le job en erreur, jamais un rapport « tout conforme »', async () => {
  const h = createHandler({ cfg, fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(lot) }),
    rensWorkflow: async () => "je n'ai pas pu analyser" });
  const res = faireRes();
  await h(faireReq('/api/rens/audit/analyse', { frs_ids: [1, 2] }), res);
  const v = await attendre(h, JSON.parse(res.corps).jobId);
  assert.strictEqual(v.status, 'error');
});

// --- Contrôle a priori : analyse d'un brouillon qui n'est pas en base --------------------

const BROUILLON = {
  titre: 'Rassemblement', unite: 'COB Segré', code_ggd: 'GGD 49',
  departement: 'Maine-et-Loire', commune: 'Segré',
  texte: 'Contrôle de M. Karim BENNANI, de confession musulmane.',
};

test("analyse-texte : un brouillon est analysé sans que rens-api soit appelé", async () => {
  // Le brouillon n'a pas de ligne en base : il n'y a rien à charger, et surtout rien à
  // écrire tant que le rédacteur n'a pas tranché.
  let appelsRens = 0;
  const h = createHandler({
    cfg,
    fetchImpl: async () => { appelsRens++; throw new Error('rens-api ne doit pas être appelé'); },
    rensWorkflow: async () => JSON.stringify([
      { type: 'dcp', frs_id: 0, porte_dcp: true, explication: 'Identité citée.' },
      { frs_id: 0, critere: 'B5', fondement: 'CSI R. 236-23',
        extrait: 'de confession musulmane', explication: 'Croyance.', confiance: 'haute' },
    ]),
  });
  const res = faireRes();
  await h(faireReq('/api/rens/audit/analyse-texte', BROUILLON), res);
  assert.strictEqual(res.code, 202);
  const v = await attendre(h, JSON.parse(res.corps).jobId);
  assert.strictEqual(v.status, 'done', v.error);
  assert.strictEqual(appelsRens, 0);
  assert.strictEqual(v.result.fiches.length, 1);
  assert.strictEqual(v.result.fiches[0].frs_id, 0);
  assert.deepStrictEqual(v.result.fiches[0].ecarts.map((e) => e.critere), ['B5']);
});

test('analyse-texte : un brouillon vide ou hors bornes est refusé avant tout appel', async () => {
  for (const corps of [{}, { titre: 'T' }, { texte: 'x' }, { titre: 'T', texte: 'x'.repeat(8001) }]) {
    const h = createHandler({ cfg, fetchImpl: async () => { throw new Error('pas d\'appel attendu'); },
      rensWorkflow: async () => { throw new Error('pas de workflow attendu'); } });
    const res = faireRes();
    await h(faireReq('/api/rens/audit/analyse-texte', corps), res);
    assert.strictEqual(res.code, 400, `corps invalide accepté : ${JSON.stringify(corps).slice(0, 40)}`);
    assert.strictEqual(JSON.parse(res.corps).error, 'BROUILLON_INVALIDE');
  }
});

test("analyse-texte : porte_pii est calculé sur le texte saisi, pas lu d'une base", async () => {
  // Ce booléen décide de la sortie du champ du décret. Sur un texte volant il ne peut venir
  // que de portePii : absent, une fiche sans personne garderait tous ses griefs.
  let promptVu = null;
  const h = createHandler({
    cfg,
    fetchImpl: async () => { throw new Error('pas d\'appel attendu'); },
    rensWorkflow: async ({ prompt }) => { promptVu = JSON.parse(prompt); return '[]'; },
  });
  const res = faireRes();
  await h(faireReq('/api/rens/audit/analyse-texte', {
    ...BROUILLON, texte: 'Des dégradations ont été constatées sur du mobilier urbain.',
  }), res);
  await attendre(h, JSON.parse(res.corps).jobId);
  assert.strictEqual(promptVu.fiches.length, 1);
  assert.strictEqual(promptVu.fiches[0].id, 0);
  assert.strictEqual(promptVu.fiches[0].porte_pii, false);
});

test('analyse-texte : un écart visant un autre identifiant est rejeté, pas rattaché au brouillon', async () => {
  // La frontière anti-hallucination ne s'assouplit pas parce que le brouillon a un
  // identifiant de convention.
  const h = createHandler({
    cfg,
    fetchImpl: async () => { throw new Error('pas d\'appel attendu'); },
    rensWorkflow: async () => JSON.stringify([
      { frs_id: 4213, critere: 'B5', fondement: 'CSI R. 236-23', extrait: 'x', explication: 'y', confiance: 'haute' },
    ]),
  });
  const res = faireRes();
  await h(faireReq('/api/rens/audit/analyse-texte', BROUILLON), res);
  const v = await attendre(h, JSON.parse(res.corps).jobId);
  assert.strictEqual(v.result.fiches[0].ecarts.length, 0);
  assert.strictEqual(v.result.resume.rejets, 1);
});
