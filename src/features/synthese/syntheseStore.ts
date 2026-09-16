import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createPersistedStore } from "../../lib/createPersistedStore";
import { encodePiece, sendSynthese, resumeSynthese } from "./syntheseApi";
import { extraireXmlPdf } from "../../lib/lrpgn/pdfXml";
import { parseLrpgn, type ContexteProcedure } from "../../lib/lrpgn/lrpgn";

// État de l'analyse conservé hors du composant : il survit aux changements de
// vue (l'écran est démonté quand on navigue ailleurs dans l'app). La requête
// tourne ici, donc une analyse lancée puis quittée continue et son résultat est
// retrouvé au retour.

const MESSAGES: Record<string, string> = {
  SYNTHESE_TIMEOUT: "Délai dépassé. Réessayez.",
  SYNTHESE_UPSTREAM: "Service d'analyse indisponible. Réessayez.",
  SYNTHESE_INVALIDE: "Réponse IAka non conforme (texte attendu).",
  FICHIERS_REQUIS: "Ajoutez au moins une pièce de procédure.",
  LECTURE_FICHIER: "Lecture du fichier impossible.",
  ERREUR_INCONNUE: "Erreur inconnue.",
};

// Convertit le markdown IAka en HTML pour l'éditeur (réutilise react-markdown,
// pas de parseur markdown supplémentaire).
function markdownToHtml(md: string): string {
  return renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: [remarkGfm] }, md)
  );
}

export type SyntheseState = {
  pieces: File[];
  loading: boolean;
  error: string | null;
  html: string;
  // Job de synthèse en cours : persisté pour reprendre le polling après un F5
  // (le job tourne côté serveur, détaché du client).
  jobId: string | null;
  // Horodatage (ms) du lancement : pilote la barre d'attente pour qu'elle
  // reflète le temps réel écoulé, sans repartir de zéro au retour sur la page.
  startedAt: number | null;
  // Données certaines lues dans la pièce jointe XML des PDF LRPGN. Le XML brut
  // est persisté ; `contexte` en est redéduit au chargement plutôt que stocké
  // deux fois.
  xml: string | null;
  contexte: ContexteProcedure | null;
};

// Persistance du résultat/édition à travers un rechargement complet (F5).
// On persiste le html ET le xml : sans ce dernier, l'analyse réapparaissait
// après un F5 mais le cartouche de contexte disparaissait, la pièce d'origine
// n'étant pas rejouable (`pieces` contient des File, non sérialisables).
// `loading` n'est jamais restauré : la requête est perdue au reload, le
// restaurer laisserait un spinner bloqué.
// Format stocké : JSON { html, xml }. Une valeur écrite par une version
// antérieure est une chaîne html brute — elle reste relue correctement.
const store = createPersistedStore<SyntheseState>(
  { pieces: [], loading: false, error: null, html: "", xml: null, contexte: null, jobId: null, startedAt: null },
  {
    key: "synthese:html",
    keys: ["html", "xml", "jobId", "startedAt"],
    read: (raw) => {
      try {
        const stocke = JSON.parse(raw);
        if (stocke && typeof stocke === "object") {
          const xml = typeof stocke.xml === "string" ? stocke.xml : null;
          return {
            html: typeof stocke.html === "string" ? stocke.html : "",
            xml,
            contexte: xml ? parseLrpgn(xml) : null,
            jobId: typeof stocke.jobId === "string" ? stocke.jobId : null,
            startedAt: typeof stocke.startedAt === "number" ? stocke.startedAt : null,
          };
        }
      } catch {
        /* format historique : la chaîne html brute */
      }
      return { html: raw };
    },
    write: (s) => (s.html || s.xml || s.jobId ? JSON.stringify({ html: s.html, xml: s.xml, jobId: s.jobId, startedAt: s.startedAt }) : null),
  }
);

export function setPieces(pieces: File[]) {
  store.set({ pieces, error: null, xml: null, contexte: null });
  const piece = pieces[0];
  if (!piece) return;
  // Extraction best-effort et hors du chemin critique : la pièce est déjà posée,
  // l'analyse peut être lancée sans attendre, et un échec ne se voit pas.
  extraireXmlPdf(piece)
    .then((xml) => {
      // La sélection a pu changer pendant l'extraction : résultat périmé ignoré.
      if (store.get().pieces[0] !== piece || !xml) return;
      store.set({ xml, contexte: parseLrpgn(xml) });
    })
    .catch(() => {});
}

export function setError(error: string | null) {
  store.set({ error });
}

// Écrit le HTML depuis l'éditeur (édition manuelle de l'utilisateur).
export function setHtml(html: string) {
  if (html !== store.get().html) store.set({ html });
}

export function clear() {
  store.set({ pieces: [], html: "", error: null, xml: null, contexte: null });
}

export async function run() {
  if (!store.get().pieces.length || store.get().loading) return;
  store.set({ loading: true, error: null, startedAt: Date.now() });
  try {
    const encodees = await Promise.all(store.get().pieces.map(encodePiece));
    const texte = await sendSynthese(encodees, store.get().xml, fetch, (jobId) => store.set({ jobId }));
    store.set({ html: markdownToHtml(texte), loading: false, jobId: null, startedAt: null });
  } catch (e) {
    const code = (e as Error).message;
    store.set({ error: MESSAGES[code] ?? MESSAGES.ERREUR_INCONNUE, loading: false, jobId: null, startedAt: null });
  }
}

// Reprise après un F5 : si un jobId a été persisté et qu'aucun résultat n'est
// encore là, on re-poll le job (qui tourne côté serveur). Job inconnu (conteneur
// BFF redémarré) → on nettoie silencieusement.
export async function resumeIfPending() {
  const { jobId, html, loading } = store.get();
  if (!jobId || html || loading) return;
  store.set({ loading: true, error: null });
  try {
    const texte = await resumeSynthese(jobId);
    store.set({ html: markdownToHtml(texte), loading: false, jobId: null });
  } catch (e) {
    const code = (e as Error).message;
    // Job perdu (redémarrage serveur) : pas d'erreur bloquante, on repart propre.
    if (code === "JOB_INCONNU") store.set({ loading: false, jobId: null });
    else store.set({ error: MESSAGES[code] ?? MESSAGES.ERREUR_INCONNUE, loading: false, jobId: null });
  }
}
resumeIfPending();

export const useSynthese = store.use;

// Lecture hors React (tests, appelants non-composants).
export const lireEtat = store.get;
