import { test } from 'node:test';
import assert from 'node:assert';
import { createHandler } from './proxy.mjs';

const cfg = { rensApiUrl: 'https://rens.test', rensApiToken: 'TK' };
const faireReq = (url) => ({ url, method: 'GET', headers: {} });
const faireRes = () => {
  const r = { code: 0, corps: '', entetes: {} };
  r.writeHead = (c, h) => { r.code = c; r.entetes = h; };
  r.end = (b) => { r.corps = b; };
  return r;
};

test('/api/rens/audit/rapport forwarde jour et ggd avec le Bearer serveur', async () => {
  let vue = null;
  const fetchImpl = async (url, opt) => {
    vue = { url, auth: opt.headers.Authorization };
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: { run: { jour: '2026-08-04' } } }) };
  };
  const h = createHandler({ cfg, fetchImpl });
  const res = faireRes();
  await h(faireReq('/api/rens/audit/rapport?jour=2026-08-04&ggd=GGD%2049'), res);
  assert.strictEqual(res.code, 200);
  assert.match(vue.url, /^https:\/\/rens\.test\/audit\/rapport\?jour=2026-08-04&ggd=GGD(%20|\+)49$/);
  assert.strictEqual(vue.auth, 'Bearer TK');
  assert.match(res.corps, /2026-08-04/);
});

test('/api/rens/audit/fiche forwarde frs_id', async () => {
  let vue = '';
  const fetchImpl = async (url) => { vue = url; return { ok: true, status: 200, text: async () => '{"data":{}}' }; };
  const h = createHandler({ cfg, fetchImpl });
  await h(faireReq('/api/rens/audit/fiche?jour=2026-08-04&frs_id=1204'), faireRes());
  assert.match(vue, /\/audit\/fiche\?jour=2026-08-04&frs_id=1204$/);
});

test('404 amont (aucun audit) est transmis tel quel, pas transformé en rapport vide', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, text: async () => '{"error":{"code":"no_run","message":"Aucun audit"}}' });
  const h = createHandler({ cfg, fetchImpl });
  const res = faireRes();
  await h(faireReq('/api/rens/audit/rapport?jour=2026-08-04'), res);
  assert.strictEqual(res.code, 404);
  assert.match(res.corps, /no_run/);
});
