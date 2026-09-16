import { createPersistedStore } from "../../lib/createPersistedStore";
import { encodePiece, startAnalyse, fetchStatus, type Dossier, type PieceIgnoree, type RagEtat } from "./arianeApi";
import { streamChat, purgeCorpusApi, type ChatMessage } from "./arianeChatApi";
import { extraireXmlPdf } from "../../lib/lrpgn/pdfXml";
import { parseLrpgn } from "../../lib/lrpgn/lrpgn";
import { contexteVersMeta, contexteVersMetaDocument } from "./metaXml";

// État de la page Ariane hors composant : pièces choisies, job en cours, contrat,
// vue active et cote sélectionnée. La boucle POST→poll tourne ICI.

export type ViewKey = "synthese" | "parties" | "faits" | "actes" | "reseau" | "questions";

const MESSAGES: Record<string, string> = {
  ARIANE_TIMEOUT: "Délai dépassé. Réessayez.",
  ARIANE_UPSTREAM: "Service d'analyse indisponible. Réessayez.",
  ARIANE_INVALIDE: "Réponse d'analyse non conforme. Réessayez.",
  FICHIERS_REQUIS: "Ajoutez au moins une pièce PDF.",
  LECTURE_FICHIER: "Lecture d'un fichier impossible.",
  ARIANE_RAG_CHAT: "Le service de questions est indisponible. Réessayez.",
  ARIANE_RAG_PURGE: "Les documents n'ont pas pu être retirés du corpus. Vérifiez avant de relancer une démonstration.",
  ARIANE_RAG_INDISPONIBLE: "Questions indisponibles : corpus non configuré.",
  ERREUR_INCONNUE: "Erreur inconnue.",
};
const msg = (code: string) => MESSAGES[code] ?? code;

const STATUS_LABELS: Record<string, string> = {
  pending: "Préparation…",
  map: "Extraction des pièces…",
  reduce: "Consolidation…",
};
const statusLabel = (status: string) => STATUS_LABELS[status] ?? "Analyse en cours…";

export type ArianeState = {
  pieces: File[];
  running: boolean;
  statusLabel: string;
  progress: { done: number; total: number };
  dossier?: Dossier;
  // Pièces écartées par le MAP best-effort : le dossier est incomplet, il faut le dire.
  piecesIgnorees: PieceIgnoree[];
  // Avertissements de métadonnées (ex : gabarit de nom de fichier inconnu) : le dossier
  // est complet mais son interprétation est incertaine, il faut le dire aussi.
  avertissements: string[];
  error?: string;
  view: ViewKey;
  selectedCote?: string;
  // Job en cours : persisté pour reprendre le polling après un F5 (le job tourne
  // côté serveur, détaché du client).
  jobId?: string;
  // Indexation RAG du job, tenue à l'écart de l'état d'analyse : une défaillance ici
  // ne doit ni vider le dossier ni renseigner `error`.
  rag: RagEtat;
  messages: ChatMessage[];
  streaming: boolean;
};

const RAG_VIDE: RagEtat = { indexees: 0, total: 0, erreur: null };

// Persistance à travers un rechargement (F5) : le contrat final (dossier) ET le
// jobId d'une analyse en cours, plus le contexte d'écran (vue, cote) et l'état
// d'indexation RAG (qui active l'onglet Questions). `pieces` (File) et les
// messages de chat ne sont pas persistés (éphémères).
const store = createPersistedStore<ArianeState>(
  {
    pieces: [], running: false, statusLabel: "", progress: { done: 0, total: 0 }, piecesIgnorees: [], avertissements: [], view: "synthese",
    rag: RAG_VIDE, messages: [], streaming: false,
  },
  {
    key: "ariane:etat",
    // progress + statusLabel persistés : après un F5, la barre reprend à sa
    // dernière position. rag persisté aussi : sinon l'onglet Questions serait
    // grisé après un F5 (dossier restauré mais indexees retombé à 0).
    keys: ["jobId", "dossier", "piecesIgnorees", "avertissements", "view", "selectedCote", "progress", "statusLabel", "rag"],
    read: (raw) => {
      try {
        const o = JSON.parse(raw);
        return {
          jobId: typeof o.jobId === "string" ? o.jobId : undefined,
          dossier: o.dossier ?? undefined,
          piecesIgnorees: Array.isArray(o.piecesIgnorees) ? o.piecesIgnorees : [],
          avertissements: Array.isArray(o.avertissements) ? o.avertissements : [],
          view: o.view ?? "synthese",
          selectedCote: o.selectedCote ?? undefined,
          progress: o.progress && typeof o.progress.done === "number" ? o.progress : { done: 0, total: 0 },
          statusLabel: typeof o.statusLabel === "string" ? o.statusLabel : "",
          rag: o.rag && typeof o.rag.indexees === "number" ? o.rag : RAG_VIDE,
        };
      } catch {
        return {};
      }
    },
    write: (s) =>
      s.jobId || s.dossier
        ? JSON.stringify({ jobId: s.jobId, dossier: s.dossier, piecesIgnorees: s.piecesIgnorees, avertissements: s.avertissements, view: s.view, selectedCote: s.selectedCote, progress: s.progress, statusLabel: s.statusLabel, rag: s.rag })
        : null,
  }
);

export function setPieces(pieces: File[]) {
  store.set({ pieces, error: undefined });
}

export function setView(view: ViewKey) {
  store.set({ view });
}

export function selectCote(selectedCote?: string) {
  store.set({ selectedCote });
}

export function reset() {
  store.set({ pieces: [], running: false, statusLabel: "", progress: { done: 0, total: 0 }, dossier: undefined, piecesIgnorees: [], avertissements: [], error: undefined, selectedCote: undefined, jobId: undefined });
}

type RunDeps = { sleep?: (ms: number) => Promise<void>; intervalMs?: number; maxPolls?: number };

export async function run(deps: RunDeps = {}) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const intervalMs = deps.intervalMs ?? 1500;
  const maxPolls = deps.maxPolls ?? 400;
  const { pieces, running } = store.get();
  if (running || pieces.length === 0) return;
  store.set({ running: true, error: undefined, dossier: undefined, piecesIgnorees: [], avertissements: [], selectedCote: undefined, statusLabel: "Préparation…", progress: { done: 0, total: pieces.length }, rag: RAG_VIDE, messages: [], streaming: false });
  try {
    // Le XML LRPGN est embarque dans le PDF. Best-effort de bout en bout : une piece
    // sans XML, ou dont le XML est illisible, suit le chemin habituel sans erreur.
    const encoded = await Promise.all(
      pieces.map(async (piece) => {
        const encodee = await encodePiece(piece);
        try {
          const xml = await extraireXmlPdf(piece);
          const contexte = xml ? parseLrpgn(xml) : null;
          const meta = contexteVersMeta(contexte);
          // Les metadonnees de document servent l'ingestion RAG ; celles des personnes
          // servent la coreference. Elles sont independantes : un XML sans personne
          // qualifie quand meme la piece, et reciproquement.
          const document = contexteVersMetaDocument(contexte, encodee.filename || piece.name);
          if (!meta && !document) return encodee;
          const base = meta ?? { personnes: [], avertissements: [] };
          return { ...encodee, meta: document ? { ...base, document } : base };
        } catch {
          return encodee;
        }
      }),
    );
    const jobId = await startAnalyse(encoded);
    store.set({ jobId }); // persisté : reprise possible après un F5
    await pollLoop(jobId, sleep, intervalMs, maxPolls);
  } catch (e) {
    store.set({ running: false, statusLabel: "", error: msg((e as Error).message), jobId: undefined });
  }
}

// Boucle de suivi d'un job Ariane, partagée par run() et la reprise F5.
async function pollLoop(jobId: string, sleep: (ms: number) => Promise<void>, intervalMs: number, maxPolls: number) {
  for (let i = 0; i < maxPolls; i++) {
    const snap = await fetchStatus(jobId);
    store.set({ progress: snap.progress ?? store.get().progress, statusLabel: statusLabel(snap.status), piecesIgnorees: snap.pieces_ignorees ?? store.get().piecesIgnorees, avertissements: snap.avertissements ?? store.get().avertissements, rag: snap.rag ?? store.get().rag });
    if (snap.status === "done") {
      if (!snap.result) throw new Error("ARIANE_INVALIDE");
      store.set({ dossier: snap.result, running: false, statusLabel: "", jobId: undefined });
      return;
    }
    if (snap.status === "error") throw new Error(snap.error || "ARIANE_UPSTREAM");
    await sleep(intervalMs);
  }
  throw new Error("ARIANE_TIMEOUT");
}

// Reprise après un F5 : un jobId persisté sans dossier → on re-poll le job (qui
// tourne côté serveur). Best-effort : un job perdu (BFF redémarré) ou une reprise
// qui échoue nettoie l'écran sans erreur bloquante.
export async function resumeIfPending(deps: RunDeps = {}) {
  const { jobId, dossier, running } = store.get();
  if (!jobId || dossier || running) return;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // On garde la progression restaurée (persistée) : la barre reprend à sa dernière
  // position au lieu de repartir de zéro le temps du premier poll.
  store.set({ running: true, error: undefined, statusLabel: store.get().statusLabel || "Reprise de l'analyse…" });
  try {
    await pollLoop(jobId, sleep, deps.intervalMs ?? 1500, deps.maxPolls ?? 400);
  } catch {
    store.set({ running: false, statusLabel: "", jobId: undefined });
  }
}
resumeIfPending();

export function resetChat() {
  store.set({ messages: [], streaming: false, error: undefined });
}

type AskDeps = { stream?: typeof streamChat };

// Ajoute la question, puis remplit le message assistant au fil du flux. En cas de
// coupure on garde le texte déjà reçu et l'erreur s'affiche dessous : mieux qu'une
// bulle vide. Aucun contenu de message n'est journalisé.
export async function ask(question: string, deps: AskDeps = {}) {
  const stream = deps.stream ?? streamChat;
  const { messages, streaming } = store.get();
  if (streaming || !question.trim()) return;
  // L'historique envoyé au serveur s'arrête à la question : la bulle assistant vide
  // n'existe que pour l'affichage.
  const historique: ChatMessage[] = [...messages, { role: "user", content: question }];
  store.set({ messages: [...historique, { role: "assistant", content: "" }], streaming: true, error: undefined });
  try {
    await stream(historique, (delta) => {
      const courant = store.get().messages;
      const dernier = courant[courant.length - 1];
      store.set({ messages: [...courant.slice(0, -1), { ...dernier, content: dernier.content + delta }] });
    });
    store.set({ streaming: false });
  } catch (e) {
    store.set({ streaming: false, error: msg((e as Error).message) });
  }
}

type ViderDeps = { purge?: typeof purgeCorpusApi };

// Vide l'écran ET le corpus. Si la purge échoue on NE réinitialise PAS : sinon la
// démonstration suivante répondrait sur l'affaire précédente sans que personne le voie.
// Renvoie true si l'écran a bien été réinitialisé, false si la purge a échoué.
export async function viderTout(deps: ViderDeps = {}): Promise<boolean> {
  const purge = deps.purge ?? purgeCorpusApi;
  try {
    // Garde : sans pièce indexée, purger déclencherait un 503 inutile.
    if (store.get().rag.total > 0) await purge();
    reset();
    store.set({ rag: RAG_VIDE, messages: [], streaming: false });
    return true;
  } catch (e) {
    store.set({ error: msg((e as Error).message) });
    return false;
  }
}

export const useAriane = store.use;

export function snapshotForTest(): ArianeState {
  return store.get();
}

// Seul run() renseigne `rag` en fonctionnement normal. Les tests de viderTout ont
// besoin d'un corpus non vide pour franchir la garde `rag.total > 0` : ce point
// d'amorçage évite d'y rejouer tout le pipeline.
export function seedRagForTest(rag: RagEtat) {
  store.set({ rag });
}
