// Client Ariane : upload des pieces au proxy (/api/ariane) puis polling du job
// (/api/ariane/status) jusqu'au contrat final. Voir docs/.../2026-07-19-ariane-design.md 4.4/6.

import type { MetaPiece } from "./metaXml";

export type Role = "mis_en_cause" | "victime" | "temoin" | "enqueteur" | "requis" | "magistrat" | "autre";
export type RoleCote = { role: Role; cote: string };
export type Partie = { id: string; nom: string; role: Role; roles?: RoleCote[]; aliases: string[]; qualite: string; premiere_cote: string };
export type Evenement = { id: string; date: string; precision: string; libelle: string; cote_source: string; parties: string[] };
export type Acte = { id: string; date: string; type: string; cote: string; libelle: string; redacteur: string | null; concernes: string[] };
export type Relation = { source: string; cible: string; type: string; libelle: string; cotes: string[] };
export type Affaire = { reference: string; nature: string; service: string; periode: { debut: string | null; fin: string | null }; nb_cotes: number };
export type Dossier = { affaire: Affaire; synthese: string; parties: Partie[]; evenements: Evenement[]; actes: Acte[]; relations: Relation[] };
export type PieceIgnoree = { cote: string; raison: string };
// Etat de l'indexation RAG du job. Distinct de l'etat d'analyse : une defaillance
// RAG n'altere ni le dossier ni le champ `error` du job.
export type RagEtat = { indexees: number; total: number; erreur: string | null };
export type JobStatus = { status: string; progress: { done: number; total: number }; result?: Dossier; error?: string; pieces_ignorees?: PieceIgnoree[]; avertissements?: string[]; rag?: RagEtat };
export type PieceEncodee = { base64: string; mime: string; filename: string; meta?: MetaPiece };

export const ACCEPT_ATTR = ".pdf";
export const TAILLE_MAX_OCTETS = 20 * 1024 * 1024;

export function encodePiece(file: File): Promise<PieceEncodee> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string; // "data:<mime>;base64,<data>"
      const comma = res.indexOf(",");
      resolve({ base64: res.slice(comma + 1), mime: file.type || "application/pdf", filename: file.name });
    };
    reader.onerror = () => reject(new Error("LECTURE_FICHIER"));
    reader.readAsDataURL(file);
  });
}

async function errorCode(res: { json: () => Promise<unknown> }): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? "ERREUR_INCONNUE";
  } catch {
    return "ERREUR_INCONNUE";
  }
}

export async function startAnalyse(files: PieceEncodee[], fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl("/api/ariane", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
  if (!res.ok) throw new Error(await errorCode(res));
  const { jobId } = (await res.json()) as { jobId?: string };
  if (!jobId) throw new Error("ARIANE_INVALIDE");
  return jobId;
}

export async function fetchStatus(jobId: string, fetchImpl: typeof fetch = fetch): Promise<JobStatus> {
  const res = await fetchImpl(`/api/ariane/status?jobId=${encodeURIComponent(jobId)}`, { method: "GET" });
  if (!res.ok) throw new Error(await errorCode(res));
  return (await res.json()) as JobStatus;
}
