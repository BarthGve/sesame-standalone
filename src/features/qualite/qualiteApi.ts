export type Gravite = "bloquant" | "majeur" | "mineur";

export type Ecart = {
  critere: string; libelle: string; gravite: Gravite;
  source: "sql" | "llm"; fondement: string | null;
  extrait: string | null; explication: string | null;
  confiance: "haute" | "moyenne" | null;
};

export type FicheLigne = {
  frs_id: number; titre: string; unite: string; code_ggd: string; commune: string;
  date_redaction: string; n_ecarts: number; criteres: string[]; gravite_max: Gravite;
};

export type FicheDetail = {
  frs_id: number; titre: string; unite: string; code_ggd: string; commune: string;
  date_redaction: string;
  texte: string; ecarts: Ecart[];
};

export type Rapport = {
  run: {
    jour: string; statut: "en_cours" | "complet" | "partiel" | "echec";
    termine_a: string | null; total_fiches: number;
    fragments_total: number; fragments_ok: number; taille_fragment: number;
  };
  synthese: {
    fiches_non_conformes: number;
    taux_conformite: number | null;
    par_gravite: Partial<Record<Gravite, number>>;
    par_critere: { critere: string; libelle: string; n: number }[];
    par_unite: { unite: string; n: number; bloquant: number }[];
  };
  methode: { taille_fragment: number; defauts_plantes: number; defauts_detectes: number };
  fiches: FicheLigne[];
};

async function lire<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // On remonte le code du BFF : « no_run » et « db_error » n'appellent pas le même message.
    throw new Error(body?.error?.code || `http_${res.status}`);
  }
  return body.data as T;
}

export function fetchRapport(jour: string | null, ggd: string): Promise<Rapport> {
  const p = new URLSearchParams();
  if (jour) p.set("jour", jour);
  if (ggd) p.set("ggd", ggd);
  const q = p.toString();
  return lire<Rapport>("/api/rens/audit/rapport" + (q ? "?" + q : ""));
}

export function fetchFicheAudit(jour: string, frsId: number): Promise<FicheDetail> {
  return lire<FicheDetail>(`/api/rens/audit/fiche?jour=${encodeURIComponent(jour)}&frs_id=${frsId}`);
}
