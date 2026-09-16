import { test } from 'node:test';
import assert from 'node:assert';
import { execWorkflow, mapConcurrent } from './iaka.mjs';

const cfg = { baseUrl: 'https://iaka.test', jwt: 'J', tenantId: 'T', pollIntervalMs: 1, pollTimeoutMs: 50 };
const rep = (obj, ok = true, status = 200) => ({ ok, status, json: async () => obj, text: async () => JSON.stringify(obj) });

test('poste app_id + prompt puis poll jusqu\'à SUCCESS', async () => {
  const appels = [];
  const fetchImpl = async (url, opt) => {
    appels.push(url);
    if (opt?.method === 'POST') return rep({ execution_id: 'X1' });
    return appels.length < 4 ? rep({ status: 'RUNNING' }) : rep({ status: 'SUCCESS', result: '[]' });
  };
  const r = await execWorkflow({ prompt: '{"fragment":1}', appId: 'A', cfg, fetchImpl, sleep: async () => {} });
  assert.strictEqual(r, '[]');
  assert.match(appels[0], /\/workflows\/execute$/);
  assert.match(appels[1], /\/workflows\/executions\/X1\?tenant_id=T$/);
});

test('statut ERROR → IAKA_UPSTREAM', async () => {
  const fetchImpl = async (u, o) => (o?.method === 'POST' ? rep({ execution_id: 'X' }) : rep({ status: 'ERROR' }));
  await assert.rejects(() => execWorkflow({ prompt: 'p', appId: 'A', cfg, fetchImpl, sleep: async () => {} }), /IAKA_UPSTREAM/);
});

test('exécution jamais terminée → IAKA_TIMEOUT', async () => {
  const fetchImpl = async (u, o) => (o?.method === 'POST' ? rep({ execution_id: 'X' }) : rep({ status: 'RUNNING' }));
  await assert.rejects(() => execWorkflow({ prompt: 'p', appId: 'A', cfg, fetchImpl, sleep: async () => {} }), /IAKA_TIMEOUT/);
});

test('HTTP non ok au déclenchement → IAKA_UPSTREAM', async () => {
  const fetchImpl = async () => rep({}, false, 500);
  await assert.rejects(() => execWorkflow({ prompt: 'p', appId: 'A', cfg, fetchImpl, sleep: async () => {} }), /IAKA_UPSTREAM/);
});

test('executePath / statusPath custom sont utilisés', async () => {
  const urls = [];
  const custom = {
    ...cfg,
    executePath: '/v2/run',
    statusPath: '/v2/jobs/{id}',
  };
  const fetchImpl = async (url, opt) => {
    urls.push(url);
    if (opt?.method === 'POST') return rep({ execution_id: 'E1' });
    return rep({ status: 'SUCCESS', result: '[]' });
  };
  await execWorkflow({ prompt: 'p', appId: 'A', cfg: custom, fetchImpl, sleep: async () => {} });
  assert.equal(urls[0], 'https://iaka.test/v2/run');
  assert.ok(urls[1].startsWith('https://iaka.test/v2/jobs/E1'));
});

test('mapConcurrent : respecte la limite et conserve l\'ordre des résultats', async () => {
  let enCours = 0, max = 0;
  const fn = async (n) => {
    enCours++; max = Math.max(max, enCours);
    await new Promise((r) => setTimeout(r, 5));
    enCours--; return n * 2;
  };
  const r = await mapConcurrent([1, 2, 3, 4, 5, 6, 7], 3, fn);
  assert.deepStrictEqual(r, [2, 4, 6, 8, 10, 12, 14]);
  assert.ok(max <= 3, `concurrence observée ${max} > 3`);
});

test('mapConcurrent : un rejet n\'interrompt pas les autres (les échecs sont gérés par l\'appelant)', async () => {
  const fn = async (n) => { if (n === 2) throw new Error('boom'); return n; };
  const r = await mapConcurrent([1, 2, 3], 2, async (n) => fn(n).catch((e) => ({ erreur: e.message })));
  assert.deepStrictEqual(r, [1, { erreur: 'boom' }, 3]);
});
