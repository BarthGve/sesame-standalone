// Client IAka minimal pour le job d'audit : POST /workflows/execute puis poll de
// /workflows/executions/{id} jusqu'à SUCCESS. Volontairement dupliqué depuis le BFF
// (server/iaka.mjs) : rens-api est une image Docker distincte, partager un module
// entre deux contextes de build coûterait plus que ces 40 lignes.

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Journalise le détail d'un échec amont puis rend l'erreur générique à propager.
async function upstream(res, etape, appId) {
  const corps = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
  console.error('[audit] IAKA_UPSTREAM', { etape, appId, status: res.status, corps: corps.slice(0, 300) });
  return new Error('IAKA_UPSTREAM');
}

export async function execWorkflow({ prompt, appId, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  const headers = { Authorization: `Bearer ${cfg.jwt}`, 'Content-Type': 'application/json' };

  const execRes = await fetchImpl(`${cfg.baseUrl}/workflows/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ app_id: appId, tenant_id: cfg.tenantId, prompt, langue: 'fr', include_traitement: false }),
  });
  // La cause est LOGGÉE, jamais avalée : sans elle, un fragment en échec se réduit à
  // « IAKA_UPSTREAM » dans frs_audit_fragment.erreur et le run partiel est indiagnosticable.
  if (!execRes.ok) throw await upstream(execRes, 'exec', appId);
  const { execution_id: id } = await execRes.json();
  if (!id) throw new Error('IAKA_UPSTREAM');

  const statusUrl = `${cfg.baseUrl}/workflows/executions/${id}?tenant_id=${cfg.tenantId}`;
  const debut = Date.now();
  while (Date.now() - debut <= cfg.pollTimeoutMs) {
    const res = await fetchImpl(statusUrl, { method: 'GET', headers });
    if (!res.ok) throw await upstream(res, 'poll', appId);
    const body = await res.json();
    if (body.status === 'SUCCESS') return body.result;
    if (body.status === 'ERROR') {
      console.error('[audit] IAKA_STATUS_ERROR', { appId, erreur: String(body.error).slice(0, 300) });
      return Promise.reject(new Error('IAKA_UPSTREAM'));
    }
    await sleep(cfg.pollIntervalMs);
  }
  throw new Error('IAKA_TIMEOUT');
}

// Exécute fn sur items avec au plus `limite` promesses en vol. Les résultats gardent
// l'ordre des items. IAka n'itère pas ; c'est ici que vit la boucle.
export async function mapConcurrent(items, limite, fn) {
  const n = Number.isInteger(limite) && limite > 0 ? limite : 1;
  const out = new Array(items.length);
  let curseur = 0;
  const ouvrier = async () => {
    while (curseur < items.length) {
      const i = curseur++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, ouvrier));
  return out;
}
