import { runJobAsync } from "../../lib/runJobAsync";
import type { Gravite } from "./qualiteApi";

export type Controle = {
  critere: string;
  libelle: string;
  fondement: string;
  source: "sql" | "llm";
  statut: "ok" | "ecart";
};

export type EcartAnalyse = {
  critere: string;
  libelle: string;
  gravite: Gravite;
  fondement: string;
  source: "sql" | "llm";
  extrait: string | null;
  explication: string | null;
  confiance: "haute" | "moyenne" | null;
};

export type FicheAnalysee = {
  frs_id: number;
  titre: string;
  unite: string;
  code_ggd: string;
  commune: string | null;
  date_redaction: string;
  texte: string;
  porte_dcp: boolean | null;
  hors_perimetre: boolean;
  conforme: boolean;
  gravite_max: Gravite | null;
  ecarts: EcartAnalyse[];
  controles: Controle[];
};

export type RapportAnalyse = {
  fiches: FicheAnalysee[];
  resume: {
    total: number;
    conformes: number;
    non_conformes: number;
    ecarts: number;
    par_gravite: Partial<Record<Gravite, number>>;
    hors_perimetre?: number;
    ecarts_ecartes?: number;
    rejets: number;
  };
};

export const MAX_SELECTION = 20;

// Le workflow met une à deux minutes sur 20 fiches, et jusqu'à cinq en cas de file
// d'attente côté IAka : job asynchrone, marge front supérieure au budget serveur.
const ANALYSE_TIMEOUT_MS = 660000;

export function lancerAnalyse(
  frsIds: number[],
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<RapportAnalyse> {
  return runJobAsync<RapportAnalyse>(
    "/api/rens/audit/analyse",
    { frs_ids: frsIds },
    { timeoutMs: ANALYSE_TIMEOUT_MS, signal: opts.signal, fetchImpl: opts.fetchImpl },
  );
}
