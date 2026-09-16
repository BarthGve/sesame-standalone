// Autocomplétion d'adresse via le BFF (/api/adresses), same-origin.

export interface AdresseSuggestion {
  label: string; // libellé complet ("12 Rue X, 13360 Roquevaire")
  name: string; // voie + numéro ("12 Rue X")
  commune: string; // ville
  codePostal: string;
  insee: string; // code INSEE (citycode)
}

export async function searchAdresse(
  query: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<AdresseSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const url = `/api/adresses?q=${encodeURIComponent(q)}`;
  const res = await fetchImpl(url, { signal });
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: AdresseSuggestion[] };
  return body.data ?? [];
}
