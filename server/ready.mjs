export async function probeIaka(cfg, fetchImpl = fetch) {
  if (!cfg.baseUrl) return { reachable: false };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2000);
  try {
    const res = await fetchImpl(cfg.baseUrl, { method: "GET", signal: ctrl.signal });
    return { reachable: Boolean(res && (res.ok || res.status)) };
  } catch {
    return { reachable: false };
  } finally {
    clearTimeout(t);
  }
}
