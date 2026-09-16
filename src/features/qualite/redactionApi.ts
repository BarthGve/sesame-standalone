import { runJobAsync } from "../../lib/runJobAsync";
import type { RapportAnalyse } from "./analyseApi";

export type GgdRef = {
  code: string;
  code_dept: string;
  nom_departement: string;
};

export type UniteRef = {
  code_ggd: string;
  nom: string;
};

export type CommuneRef = {
  code_insee: string;
  nom: string;
  code_dept: string;
};

export type Referentiel = {
  ggd: GgdRef[];
  unites: UniteRef[];
  mots_cles: string[];
};

export type Brouillon = {
  titre: string;
  unite: string;
  code_ggd: string;
  departement: string;
  commune: string;
  texte: string;
  mots_cles: string[];
};

// Mêmes bornes que le serveur (server/rens-api/redaction.js). Le front les applique pour
// prévenir AVANT l'envoi ; le serveur reste seul juge — un contrôle de saisie n'est pas
// une frontière de confiance.
export const MAX_TEXTE = 8000;
export const MAX_TITRE = 200;
export const MAX_MOTS_CLES = 10;

// Une seule fiche, mais le même workflow qu'une sélection de vingt : la file d'attente côté
// IAka domine la durée, pas le nombre de fiches.
const ANALYSE_TIMEOUT_MS = 660000;

type Opts = { signal?: AbortSignal; fetchImpl?: typeof fetch; intervalMs?: number };

export function analyserTexte(b: Brouillon, opts: Opts = {}): Promise<RapportAnalyse> {
  return runJobAsync<RapportAnalyse>("/api/rens/audit/analyse-texte", b, {
    timeoutMs: ANALYSE_TIMEOUT_MS, signal: opts.signal, fetchImpl: opts.fetchImpl,
    intervalMs: opts.intervalMs,
  });
}

export async function enregistrerFiche(b: Brouillon, opts: Opts = {}): Promise<number> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f("/api/rens/frs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b),
    signal: opts.signal,
  });
  let corps: { error?: { message?: string }; data?: { id?: number } };
  try {
    corps = await res.json();
  } catch {
    throw new Error("La réponse du serveur est illisible.");
  }
  // Le message du serveur nomme le champ fautif : le remplacer par un code priverait le
  // rédacteur de la seule information utile.
  if (!res.ok) throw new Error(corps?.error?.message || "La fiche n'a pas pu être enregistrée.");
  return corps.data!.id as number;
}

export async function fetchReferentiel(opts: Opts = {}): Promise<Referentiel> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f("/api/rens/referentiel", { signal: opts.signal });
  if (!res.ok) throw new Error("REFERENTIEL_INDISPONIBLE");
  const corps = await res.json();
  const data = corps.data ?? {};
  return {
    ggd: data.ggd ?? [],
    unites: data.unites ?? [],
    mots_cles: data.mots_cles ?? [],
  };
}

export async function fetchCommunes(
  codeDept: string,
  opts: Opts & { q?: string } = {},
): Promise<CommuneRef[]> {
  const f = opts.fetchImpl ?? fetch;
  const params = new URLSearchParams({ code_dept: codeDept });
  if (opts.q) params.set("q", opts.q);
  const res = await f(`/api/rens/referentiel/communes?${params}`, { signal: opts.signal });
  if (!res.ok) throw new Error("COMMUNES_INDISPONIBLES");
  const corps = await res.json();
  return (corps.data ?? []) as CommuneRef[];
}
