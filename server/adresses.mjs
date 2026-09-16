// Autocomplétion d'adresse via Addok/BAN local (BAN_API_URL).
// Amont ko ou BAN off → [] pour ne pas casser la saisie libre. Ne jamais logger q.

function searchUrl(banApiUrl, q) {
  const base = banApiUrl.replace(/\/+$/, "");
  const qs = `q=${encodeURIComponent(q)}&limit=6&autocomplete=1`;
  if (base.endsWith("/search")) return `${base}/?${qs}`;
  return `${base}/search/?${qs}`;
}

export async function searchAdresses(q, cfg, fetchImpl = fetch) {
  const query = String(q ?? "").trim();
  if (query.length < 3 || !cfg?.banApiUrl) return [];
  try {
    const res = await fetchImpl(searchUrl(cfg.banApiUrl, query));
    if (!res.ok) return [];
    const body = await res.json();
    return (body.features ?? []).map((f) => ({
      label: f.properties.label,
      name: f.properties.name,
      commune: f.properties.city,
      codePostal: f.properties.postcode,
      insee: f.properties.citycode,
    }));
  } catch {
    return [];
  }
}
