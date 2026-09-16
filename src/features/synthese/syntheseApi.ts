// Client de synthèse : envoie les pièces de procédure au proxy (/api/synthese),
// qui les transmet en pièces jointes au workflow IAka et renvoie le texte.

import { runJobAsync } from "../../lib/runJobAsync";

export type PieceEncodee = { base64: string; mime: string; filename: string };

export const TAILLE_MAX_OCTETS = 20 * 1024 * 1024;

export const FORMATS_ACCEPTES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.oasis.opendocument.text",
];

export const ACCEPT_ATTR = ".jpg,.jpeg,.png,.pdf,.docx,.odt";

export function encodePiece(file: File): Promise<PieceEncodee> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string; // "data:<mime>;base64,<data>"
      const comma = res.indexOf(",");
      resolve({
        base64: res.slice(comma + 1),
        mime: file.type || "application/octet-stream",
        filename: file.name,
      });
    };
    reader.onerror = () => reject(new Error("LECTURE_FICHIER"));
    reader.readAsDataURL(file);
  });
}

export async function sendSynthese(
  files: PieceEncodee[],
  contexte: string | null = null,
  fetchImpl: typeof fetch = fetch,
  onJobId?: (jobId: string) => void
): Promise<string> {
  const { texte } = await runJobAsync<{ texte?: string }>(
    "/api/synthese",
    // Le contexte n'est envoyé que s'il existe : le workflow ne doit pas voir de
    // champ vide.
    contexte ? { files, contexte } : { files },
    { fetchImpl, onStart: onJobId }
  );
  if (!texte) throw new Error("SYNTHESE_INVALIDE");
  return texte;
}

// Reprend un job de synthèse déjà lancé (après un F5) : re-poll sans relancer.
export async function resumeSynthese(jobId: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const { texte } = await runJobAsync<{ texte?: string }>("/api/synthese", null, { fetchImpl, resumeJobId: jobId });
  if (!texte) throw new Error("SYNTHESE_INVALIDE");
  return texte;
}
