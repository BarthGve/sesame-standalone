import { createPersistedStore } from "../../lib/createPersistedStore";
import { fetchFiches, sendRensPrompt, type Fiche, type FicheFilters } from "./rensApi";

// État de l'écran RENS conservé hors composant : filtres + liste + conversation de
// synthèse survivent aux changements de vue. Les requêtes tournent ICI.

const MESSAGES: Record<string, string> = {
  IAKA_TIMEOUT: "Délai dépassé. Réessayez.",
  IAKA_UPSTREAM: "Service de synthèse indisponible. Réessayez.",
  RENS_UPSTREAM: "Base RENS indisponible. Réessayez.",
  RENS_INVALIDE: "Réponse de synthèse vide. Reformulez.",
  // Codes du client de job asynchrone (runJobAsync) : la synthèse passe par le job store.
  TIMEOUT: "Délai dépassé. La synthèse peut être encore en cours ; réessayez.",
  JOB_INCONNU: "Synthèse introuvable (service redémarré). Relancez-la.",
  UPSTREAM: "Service de synthèse indisponible. Réessayez.",
  START_FAILED: "La synthèse n'a pas pu être lancée. Réessayez.",
  ABORTED: "Synthèse interrompue.",
  INTERNAL_ERROR: "Erreur interne du service de synthèse.",
  ERREUR_INCONNUE: "Erreur inconnue.",
};
const msg = (code: string) => MESSAGES[code] ?? MESSAGES.ERREUR_INCONNUE;

export const PAGE_SIZE = 10;

export type RensState = {
  filters: FicheFilters;
  fiches: Fiche[];
  total: number;
  page: number; // 0-indexé
  selected: Fiche | null; // fiche ouverte en détail
  loadingList: boolean;
  listError?: string;
  prompt: string;
  markdown?: string;
  synthError?: string;
  pending: boolean;
};

const store = createPersistedStore<RensState>(
  { filters: {}, fiches: [], total: 0, page: 0, selected: null, loadingList: false, prompt: "", pending: false },
  {
    key: "rens:etat",
    keys: ["filters", "prompt"],
    write: (s) => JSON.stringify({ filters: s.filters, prompt: s.prompt }),
    read: (raw) => {
      const { filters, prompt } = JSON.parse(raw) as { filters?: FicheFilters; prompt?: string };
      return { filters: filters ?? {}, prompt: prompt ?? "" };
    },
  }
);

export function setFilters(patch: Partial<FicheFilters>) {
  // Tout changement de filtre revient à la 1re page.
  store.set({ filters: { ...store.get().filters, ...patch }, page: 0 });
}

export function setPage(page: number) {
  store.set({ page: Math.max(0, page) });
}

export function select(fiche: Fiche | null) {
  store.set({ selected: fiche });
}

// Date du jour au format API 'YYYY-MM-DD' (fuseau local, pas d'UTC pour éviter un
// décalage de jour en soirée).
function todayISO() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Au montage : cale le flux sur la DATE COURANTE. Sans date, l'API renvoie toutes
// les fiches, tous jours confondus ; on veut « les fiches du jour ». Ne touche pas
// à un filtre date déjà choisi par l'utilisateur.
export function ensureDay() {
  if (store.get().filters.date) return;
  store.set({ filters: { ...store.get().filters, date: todayISO() }, page: 0 });
}

export async function loadFiches() {
  store.set({ loadingList: true, listError: undefined });
  const { filters, page } = store.get();
  try {
    const { fiches, total } = await fetchFiches({ ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
    store.set({ fiches, total, loadingList: false });
  } catch (e) {
    store.set({ loadingList: false, listError: msg((e as Error).message) });
  }
}

export function setPrompt(prompt: string) {
  store.set({ prompt });
}

// Efface la synthèse affichée (après confirmation côté écran).
export function clearSynthese() {
  store.set({ markdown: undefined, synthError: undefined });
}

export async function runSynthese() {
  // Prompt optionnel : la synthèse quotidienne tourne sans question (les workflows RENS sont
  // autonomes). On garde le prompt comme éventuel angle d'analyse.
  const p = store.get().prompt.trim();
  if (store.get().pending) return;
  store.set({ pending: true, markdown: undefined, synthError: undefined });
  try {
    const markdown = await sendRensPrompt(p);
    store.set({ markdown, pending: false });
  } catch (e) {
    store.set({ synthError: msg((e as Error).message), pending: false });
  }
}

export const useRens = store.use;

export function snapshotForTest(): RensState {
  return store.get();
}
