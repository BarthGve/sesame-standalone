export type RuntimeConfig = {
  tiles: boolean;
  tilesUrl: string | null;
  ban: boolean;
  workflows: Record<string, boolean>;
  rag: boolean;
};

const EMPTY: RuntimeConfig = {
  tiles: false,
  tilesUrl: null,
  ban: false,
  workflows: {},
  rag: false,
};

export async function fetchRuntimeConfig(
  fetchImpl: typeof fetch = fetch
): Promise<RuntimeConfig> {
  try {
    const res = await fetchImpl("/api/config");
    if (!res.ok) return EMPTY;
    const body = await res.json();
    return (body.data as RuntimeConfig) ?? EMPTY;
  } catch {
    return EMPTY;
  }
}
