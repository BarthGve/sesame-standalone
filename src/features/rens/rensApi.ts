import { runJobAsync } from "../../lib/runJobAsync";

export type Fiche = {
  id: number;
  date_redaction: string;
  titre: string;
  unite: string;
  code_ggd: string;
  departement: string;
  commune: string | null;
  mots_cles: string[];
  texte: string;
};

export type FicheFilters = {
  date?: string;
  ggd?: string;
  commune?: string;
  /** Mots-clés exacts du référentiel (ref_mot_cle), un ou plusieurs. */
  mots?: string[];
  q?: string;
  limit?: number;
  offset?: number;
};

export type FichesPage = { fiches: Fiche[]; total: number };

export type GgdRef = { code: string; code_dept: string; nom_departement: string };
export type CommuneRef = { code_insee: string; nom: string; code_dept: string };

export type ReferentielListes = {
  ggd: GgdRef[];
  mots_cles: string[];
};

async function orThrow(res: Response): Promise<unknown> {
  if (!res.ok) {
    let code = "ERREUR_INCONNUE";
    try {
      const error = ((await res.json()) as { error?: unknown }).error;
      if (typeof error === "string") {
        code = error;
      } else if (error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string") {
        code = (error as { code: string }).code;
      }
    } catch {
      /* ignore */
    }
    throw new Error(code);
  }
  return res.json();
}

export async function fetchFiches(filters: FicheFilters, fetchImpl: typeof fetch = fetch): Promise<FichesPage> {
  const p = new URLSearchParams();
  if (filters.date) p.set("date", filters.date);
  if (filters.ggd) p.set("ggd", filters.ggd);
  if (filters.commune) p.set("commune", filters.commune);
  for (const m of filters.mots ?? []) {
    const t = m.trim();
    if (t) p.append("mot", t);
  }
  if (filters.q) p.set("q", filters.q);
  if (filters.limit != null) p.set("limit", String(filters.limit));
  if (filters.offset != null) p.set("offset", String(filters.offset));
  const res = await fetchImpl("/api/rens/fiches?" + p.toString());
  const body = (await orThrow(res)) as { data: Fiche[]; total?: number };
  return { fiches: body.data ?? [], total: body.total ?? (body.data?.length ?? 0) };
}

/** Détail d'une fiche par identifiant (navigation croisée Contrôle → Flux). */
export async function fetchFicheById(id: number, fetchImpl: typeof fetch = fetch): Promise<Fiche> {
  const res = await fetchImpl(`/api/rens/fiche?id=${encodeURIComponent(String(id))}`);
  const body = (await orThrow(res)) as { data: Fiche };
  return body.data;
}

// La synthèse enchaîne deux workflows IAka (synthèse puis zoom) : trop long pour une
// réponse HTTP directe (proxy d'accès ~100s). Job asynchrone : POST → jobId → poll
// /api/job/status. Marge front > budget serveur, comme pvApi/evaluation.
const RENS_TIMEOUT_MS = 660000;

export async function sendRensPrompt(prompt: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const { markdown } = await runJobAsync<{ markdown: string }>(
    "/api/rens/synthese", { prompt }, { fetchImpl, timeoutMs: RENS_TIMEOUT_MS }
  );
  return markdown ?? "";
}

/** GGD + mots-clés du référentiel (`ref_ggd`, `ref_mot_cle`) — listes des filtres. */
export async function fetchReferentielListes(fetchImpl: typeof fetch = fetch): Promise<ReferentielListes> {
  const res = await fetchImpl("/api/rens/referentiel");
  const body = (await orThrow(res)) as { data?: { ggd?: GgdRef[]; mots_cles?: string[] } };
  return {
    ggd: body.data?.ggd ?? [],
    mots_cles: body.data?.mots_cles ?? [],
  };
}

/** @deprecated préférer fetchReferentielListes — conservé pour les tests existants. */
export async function fetchGgd(fetchImpl: typeof fetch = fetch): Promise<GgdRef[]> {
  return (await fetchReferentielListes(fetchImpl)).ggd;
}

/**
 * Communes du référentiel (`ref_commune`), en autocomplete borné.
 * - avec `codeDept` : filtré au département (q optionnel) ;
 * - sans : recherche nationale, `q` ≥ 2 caractères requis côté API.
 */
export async function fetchCommunes(
  opts: { codeDept?: string; q?: string; limit?: number; fetchImpl?: typeof fetch } = {},
): Promise<CommuneRef[]> {
  const f = opts.fetchImpl ?? fetch;
  const p = new URLSearchParams();
  if (opts.codeDept) p.set("code_dept", opts.codeDept);
  if (opts.q) p.set("q", opts.q);
  if (opts.limit != null) p.set("limit", String(opts.limit));
  const res = await f("/api/rens/referentiel/communes?" + p.toString());
  const body = (await orThrow(res)) as { data?: CommuneRef[] };
  return body.data ?? [];
}
