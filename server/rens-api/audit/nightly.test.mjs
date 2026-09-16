import { test } from 'node:test';
import assert from 'node:assert';
import { auditerJour } from './nightly.mjs';

const fiches = (n) => Array.from({ length: n }, (_, i) => ({
  id: i + 1, date_redaction: '2026-08-04', titre: 'T', unite: 'COB X', code_ggd: 'GGD 49',
  commune: 'C', texte: 'texte', porte_pii: true,
}));

function client(fichesDuJour, structurels = []) {
  const appels = [];
  return {
    appels,
    query: async (text, values) => {
      appels.push({ text, values });
      if (text.includes('INSERT INTO frs_audit_run')) return { rows: [{ id: 1 }] };
      if (text.includes("'C10' AS critere")) return { rows: structurels };
      if (text.includes('FROM frs f') || text.includes('FROM frs\n')) return { rows: fichesDuJour };
      if (text.includes('FROM frs_audit_fragment')) {
        const ko = appels.filter((a) => a.text.includes('SET statut') && a.values[2] === 'echec').length;
        const tot = appels.filter((a) => a.text.includes('INSERT INTO frs_audit_fragment')).length;
        return { rows: [{ total: tot, ok: tot - ko }] };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const cfg = { appId: 'A', tailleFragment: 40, concurrence: 2, baseUrl: 'x', jwt: 'j', tenantId: 't', pollIntervalMs: 1, pollTimeoutMs: 10 };

test('découpe 95 fiches en 3 fragments et appelle le workflow 3 fois', async () => {
  let n = 0;
  const c = client(fiches(95));
  const r = await auditerJour({ client: c, jour: '2026-08-04', cfg, deps: { execWorkflow: async () => { n++; return '[]'; } } });
  assert.strictEqual(n, 3);
  assert.strictEqual(r.fragments, 3);
  assert.strictEqual(r.totalFiches, 95);
  assert.strictEqual(r.statut, 'complet');
});

test('un fragment en échec n\'interrompt pas le run, qui finit partiel', async () => {
  let n = 0;
  const c = client(fiches(80));
  const r = await auditerJour({
    client: c, jour: '2026-08-04', cfg,
    deps: { execWorkflow: async () => { n++; if (n === 1) throw new Error('IAKA_TIMEOUT'); return '[]'; } },
  });
  assert.strictEqual(r.statut, 'partiel');
  const echec = c.appels.find((a) => a.text.includes('SET statut') && a.values[2] === 'echec');
  assert.match(echec.values[3], /IAKA_TIMEOUT/);
});

test('une sortie illisible marque le fragment en échec, sans faire tomber le run', async () => {
  const c = client(fiches(40));
  const r = await auditerJour({ client: c, jour: '2026-08-04', cfg, deps: { execWorkflow: async () => 'désolé, je ne peux pas' } });
  assert.strictEqual(r.statut, 'partiel');
  const echec = c.appels.find((a) => a.text.includes('SET statut') && a.values[2] === 'echec');
  assert.match(echec.values[3], /SORTIE_ILLISIBLE/);
});

test('les écarts structurels sont enregistrés même si aucun fragment LLM ne réussit', async () => {
  const c = client(fiches(40), [{ frs_id: 1, critere: 'C10' }, { frs_id: 2, critere: 'C10' }]);
  await auditerJour({ client: c, jour: '2026-08-04', cfg, deps: { execWorkflow: async () => { throw new Error('IAKA_UPSTREAM'); } } });
  const sql = c.appels.filter((a) => a.text.includes('INSERT INTO frs_audit') && a.values[4] === 'sql');
  assert.strictEqual(sql.length, 2);
});

test('jour sans aucune fiche : run complet, zéro fragment, pas d\'appel workflow', async () => {
  let n = 0;
  const c = client([]);
  const r = await auditerJour({ client: c, jour: '2026-08-04', cfg, deps: { execWorkflow: async () => { n++; return '[]'; } } });
  assert.strictEqual(n, 0);
  assert.strictEqual(r.fragments, 0);
  assert.strictEqual(r.statut, 'complet');
});

test('reprise : ne rejoue QUE les fragments en échec, sans recréer le run', async () => {
  const c = client(fiches(0));
  c.query = async (text, values) => {
    c.appels.push({ text, values });
    if (text.includes("g.statut = 'echec'")) return { rows: [{ run_id: 1, rang: 2, frs_ids: [81, 82] }] };
    if (text.includes('f.id = ANY')) return { rows: fiches(2) };
    if (text.includes('FROM frs_audit_fragment')) return { rows: [{ total: 3, ok: 3 }] };
    return { rows: [], rowCount: 0 };
  };
  let n = 0;
  const r = await auditerJour({
    client: c, jour: '2026-08-04', cfg: { ...cfg, reprise: true },
    deps: { execWorkflow: async () => { n++; return '[]'; } },
  });
  assert.strictEqual(n, 1, 'un seul fragment rejoué');
  assert.strictEqual(r.statut, 'complet');
  assert.ok(!c.appels.some((a) => a.text.includes('DELETE FROM frs_audit_run')), 'le run ne doit pas être recréé');
});

test('reprise : plus aucun fragment en échec → rien à faire', async () => {
  const c = client(fiches(0));
  c.query = async (text) => (text.includes("g.statut = 'echec'") ? { rows: [] } : { rows: [], rowCount: 0 });
  let n = 0;
  const r = await auditerJour({
    client: c, jour: '2026-08-04', cfg: { ...cfg, reprise: true },
    deps: { execWorkflow: async () => { n++; return '[]'; } },
  });
  assert.strictEqual(n, 0);
  assert.strictEqual(r.statut, 'complet');
});

test('chaque fragment est écrit via avecClient, un par un (grain de reprise)', async () => {
  const c = client(fiches(80));
  const transactions = [];
  await auditerJour({
    client: c, jour: '2026-08-04', cfg,
    deps: {
      execWorkflow: async () => '[]',
      avecClient: async (fn) => { transactions.push(1); return fn(c); },
    },
  });
  assert.strictEqual(transactions.length, 2, 'une transaction par fragment');
});

test('le prompt envoyé au workflow ne contient jamais le marqueur defaut:', async () => {
  const avecPiege = fiches(3).map((f) => ({ ...f, mots_cles: ['defaut:B5'] }));
  let vu = '';
  const c = client(avecPiege);
  await auditerJour({ client: c, jour: '2026-08-04', cfg, deps: { execWorkflow: async ({ prompt }) => { vu = prompt; return '[]'; } } });
  assert.ok(!vu.includes('defaut:'));
});

test("le batch applique les MÊMES règles que l'analyse à la demande", async () => {
  // Le job allait de parse.mjs directement à l'écriture : il persistait en base des écarts
  // qu'un simple contrôle retire — un A1 affirmant l'atteinte qu'il conteste, un B5 sur un
  // qualificatif moral. Le rapport nocturne affichait donc des griefs que l'analyse à la
  // demande, elle, écartait.
  const c = client(fiches(2));
  await auditerJour({
    client: c, jour: '2026-08-04', cfg,
    deps: {
      execWorkflow: async () => JSON.stringify([
        { frs_id: 1, critere: 'A1', fondement: 'CSI R. 236-21', extrait: 'texte',
          explication: 'Les faits caractérisent une atteinte à la sécurité publique.', confiance: 'haute' },
        { frs_id: 1, critere: 'B5', fondement: 'CSI R. 236-23', extrait: 'individu nuisible',
          explication: 'x', confiance: 'haute' },
        { frs_id: 2, critere: 'C9', fondement: 'CSI R. 236-25', extrait: 'élève de 11 ans',
          explication: 'Mineur de moins de treize ans.', confiance: 'haute' },
      ]),
    },
  });
  const ecrits = c.appels.filter((a) => a.text.includes('INSERT INTO frs_audit') && a.values[4] === 'llm');
  assert.deepStrictEqual(ecrits.map((a) => a.values[2]), ['C9'], 'seul le C9 fondé doit être persisté');
});

test("le batch n'enregistre rien pour une fiche sans donnée personnelle", async () => {
  const sans = fiches(1).map((f) => ({ ...f, porte_pii: false }));
  const c = client(sans);
  await auditerJour({
    client: c, jour: '2026-08-04', cfg,
    deps: {
      execWorkflow: async () => JSON.stringify([
        { type: 'dcp', frs_id: 1, porte_dcp: false, explication: 'Aucune personne identifiable.' },
        { frs_id: 1, critere: 'D12', fondement: 'CSI R. 236-30', extrait: 'individu nuisible', explication: 'x', confiance: 'haute' },
      ]),
    },
  });
  const ecrits = c.appels.filter((a) => a.text.includes('INSERT INTO frs_audit') && a.values[4] === 'llm');
  assert.strictEqual(ecrits.length, 0);
});
