import { createPersistedStore } from "../../lib/createPersistedStore";
import { encodePiece, sendPv, resumePv } from "./pvApi";

// État conservé hors composant : survit aux changements de vue (l'écran est
// démonté à la navigation). Une génération lancée puis quittée continue et son
// résultat est retrouvé au retour.

const MESSAGES: Record<string, string> = {
  PVTCMP_TIMEOUT: "Délai dépassé. La génération du PV est longue, réessayez.",
  PVTCMP_UPSTREAM: "Service de génération indisponible. Réessayez.",
  PVTCMP_INGESTION: "Le fichier n'a pas pu être ingéré par IAka (incident temporaire). Réessayez dans un instant.",
  PVTCMP_INVALIDE: "Réponse IAka non conforme (texte de PV attendu).",
  FICHIERS_REQUIS: "Ajoutez vos notes de terrain (.md ou .txt).",
  LECTURE_FICHIER: "Lecture du fichier impossible.",
  ERREUR_INCONNUE: "Erreur inconnue.",
};

export type PvState = {
  pieces: File[];
  loading: boolean;
  error: string | null;
  // Projet de PV rédigé en HTML éditable (comme l'analyse d'audition).
  resultat: string | null;
  // Job en cours : persisté pour reprendre le polling après un F5 (le job tourne
  // côté serveur, détaché du client).
  jobId: string | null;
  // Horodatage (ms) du lancement : pilote la barre d'attente pour qu'elle reflète
  // le temps réel écoulé, sans repartir de zéro au retour sur la page / après F5.
  startedAt: number | null;
};

// Persistance à travers un rechargement (F5) : le résultat ET le jobId d'une
// génération en cours. `pieces` (File) n'est pas sérialisable ; `loading` n'est
// pas restauré (on le repose seulement si on reprend réellement un job).
const store = createPersistedStore<PvState>(
  { pieces: [], loading: false, error: null, resultat: null, jobId: null, startedAt: null },
  {
    key: "pvtransport:resultat",
    keys: ["resultat", "jobId", "startedAt"],
    read: (raw) => {
      const o = JSON.parse(raw);
      // Seul un résultat texte (string) est restauré : un ancien résultat au format
      // Word (objet) est ignoré plutôt que réaffiché dans un état qui n'existe plus.
      if (o && typeof o === "object")
        return { resultat: typeof o.resultat === "string" ? o.resultat : null, jobId: typeof o.jobId === "string" ? o.jobId : null, startedAt: typeof o.startedAt === "number" ? o.startedAt : null };
      return { resultat: typeof o === "string" ? o : null };
    },
    write: (s) => (s.resultat || s.jobId ? JSON.stringify({ resultat: s.resultat, jobId: s.jobId, startedAt: s.startedAt }) : null),
  }
);

export function setPieces(pieces: File[]) {
  store.set({ pieces, error: null });
}

export function setError(error: string | null) {
  store.set({ error });
}

// Édition du projet de PV dans la zone d'édition (comme l'analyse d'audition).
export function setPv(html: string) {
  store.set({ resultat: html });
}

export function clear() {
  store.set({ pieces: [], resultat: null, error: null });
}

export async function run() {
  if (!store.get().pieces.length || store.get().loading) return;
  store.set({ loading: true, error: null, startedAt: Date.now() });
  try {
    const encodees = await Promise.all(store.get().pieces.map(encodePiece));
    const resultat = await sendPv(encodees, fetch, (jobId) => store.set({ jobId }));
    store.set({ resultat, loading: false, jobId: null, startedAt: null });
  } catch (e) {
    const code = (e as Error).message;
    store.set({ error: MESSAGES[code] ?? MESSAGES.ERREUR_INCONNUE, loading: false, jobId: null, startedAt: null });
  }
}

// Reprise après un F5 : jobId persisté + pas encore de résultat → on re-poll le
// job (qui tourne côté serveur). Job inconnu (BFF redémarré) → nettoyage silencieux.
export async function resumeIfPending() {
  const { jobId, resultat, loading } = store.get();
  if (!jobId || resultat || loading) return;
  store.set({ loading: true, error: null });
  try {
    const r = await resumePv(jobId);
    store.set({ resultat: r, loading: false, jobId: null });
  } catch (e) {
    const code = (e as Error).message;
    if (code === "JOB_INCONNU") store.set({ loading: false, jobId: null });
    else store.set({ error: MESSAGES[code] ?? MESSAGES.ERREUR_INCONNUE, loading: false, jobId: null });
  }
}
resumeIfPending();

export const usePv = store.use;
