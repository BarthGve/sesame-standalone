// Client PV transport : envoie les notes de terrain au proxy (/api/pvtcmp), qui
// les transmet au workflow IAka et renvoie le projet de PV rédigé en texte (HTML
// éditable), comme la page d'analyse d'audition. Plus de génération Word.

import { runJobAsync } from "../../lib/runJobAsync";

export type PieceEncodee = { base64: string; mime: string; filename: string };

export const TAILLE_MAX_OCTETS = 5 * 1024 * 1024;

// .md / .txt uniquement pour l'instant (l'agent n'OCR pas les images).
export const ACCEPT_ATTR = ".md,.markdown,.txt";

export function encodePiece(file: File): Promise<PieceEncodee> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string; // "data:<mime>;base64,<data>"
      const comma = res.indexOf(",");
      resolve({
        base64: res.slice(comma + 1),
        mime: file.type || "text/plain",
        filename: file.name,
      });
    };
    reader.onerror = () => reject(new Error("LECTURE_FICHIER"));
    reader.readAsDataURL(file);
  });
}

// La génération d'un PV est longue : le BFF poll IAka jusqu'à POLL_TIMEOUT_MS
// (600s en prod). Le front doit tenir STRICTEMENT plus longtemps que ce budget
// serveur, sinon il abandonne avant que le serveur ait rendu le texte.
const PV_TIMEOUT_MS = 660000;

export async function sendPv(
  files: PieceEncodee[],
  fetchImpl: typeof fetch = fetch,
  onJobId?: (jobId: string) => void
): Promise<string> {
  const { texte } = await runJobAsync<{ texte?: string }>(
    "/api/pvtcmp",
    { files },
    { fetchImpl, onStart: onJobId, timeoutMs: PV_TIMEOUT_MS }
  );
  if (!texte) throw new Error("PVTCMP_INVALIDE");
  return texte;
}

// Reprend un job de PV déjà lancé (après un F5) : re-poll sans relancer.
export async function resumePv(jobId: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const { texte } = await runJobAsync<{ texte?: string }>("/api/pvtcmp", null, { fetchImpl, resumeJobId: jobId, timeoutMs: PV_TIMEOUT_MS });
  if (!texte) throw new Error("PVTCMP_INVALIDE");
  return texte;
}
