// Autocomplétion d'adresse via la Base Adresse Nationale (BAN),
// API souveraine data.gouv.fr — https://api-adresse.data.gouv.fr
// CORS ouvert : appel direct depuis le client, aucune clé requise.

export interface AdresseSuggestion {
  label: string; // libellé complet ("12 Rue X, 13360 Roquevaire")
  name: string; // voie + numéro ("12 Rue X")
  commune: string; // ville
  codePostal: string;
  insee: string; // code INSEE (citycode)
}

interface BanFeature {
  properties: {
    label: string;
    name: string;
    city: string;
    postcode: string;
    citycode: string;
  };
}

const ENDPOINT = "https://api-adresse.data.gouv.fr/search/";

export async function searchAdresse(
  query: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<AdresseSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&limit=6&autocomplete=1`;
  const res = await fetchImpl(url, { signal });
  if (!res.ok) throw new Error("BAN_UPSTREAM");
  const body = (await res.json()) as { features?: BanFeature[] };
  return (body.features ?? []).map((f) => ({
    label: f.properties.label,
    name: f.properties.name,
    commune: f.properties.city,
    codePostal: f.properties.postcode,
    insee: f.properties.citycode,
  }));
}
