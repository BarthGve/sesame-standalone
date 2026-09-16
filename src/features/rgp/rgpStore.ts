import { createPersistedStore } from "../../lib/createPersistedStore";
import { sendRgpPrompt, type RgpReply } from "./rgpApi";

// État de la conversation RGP conservé hors composant : il survit aux changements
// de vue (l'écran est démonté quand on navigue ailleurs). La requête tourne ICI,
// donc un traitement lancé puis quitté continue et son résultat apparaît au retour.

export type Echange = { id: number; prompt: string; reply?: RgpReply; error?: string };

const MESSAGES: Record<string, string> = {
  IAKA_TIMEOUT: "Délai dépassé. Réessayez.",
  IAKA_UPSTREAM: "Service RGP indisponible. Réessayez.",
  ERREUR_INCONNUE: "Erreur inconnue.",
};

export type RgpState = {
  echanges: Echange[];
  draft: string;
  // id de l'échange en cours de traitement, ou null. loading = pendingId !== null.
  pendingId: number | null;
};

// Persistance à travers un rechargement (F5) : conversation + brouillon, jamais
// `pendingId` (la requête en vol est perdue au reload, on ne restaure pas d'état
// « en cours »). Un échange resté « en cours » est marqué interrompu à la relecture.
const store = createPersistedStore<RgpState>(
  { echanges: [], draft: "", pendingId: null },
  {
    key: "rgp:conversation",
    keys: ["echanges", "draft"],
    write: (s) => JSON.stringify({ echanges: s.echanges, draft: s.draft }),
    read: (raw) => {
      const { echanges, draft } = JSON.parse(raw) as { echanges?: Echange[]; draft?: string };
      return {
        echanges: Array.isArray(echanges)
          ? echanges.map((x) =>
              x.reply || x.error
                ? x
                : { ...x, error: "Traitement interrompu (page rechargée). Renvoyez la demande." }
            )
          : [],
        draft: draft ?? "",
      };
    },
  }
);

let nextId = store.get().echanges.reduce((m, x) => Math.max(m, x.id), 0) + 1;

export function setDraft(draft: string) {
  store.set({ draft });
}

export function clear() {
  // Abandonne le suivi d'un éventuel traitement en cours (pendingId → null) : la
  // requête orpheline se résoudra sans toucher à l'état (id introuvable, cf. send).
  store.set({ echanges: [], draft: "", pendingId: null });
}

export async function send(prompt: string) {
  const p = prompt.trim();
  if (!p || store.get().pendingId !== null) return;
  const id = nextId++;
  store.set({ echanges: [...store.get().echanges, { id, prompt: p }], draft: "", pendingId: id });
  const patchEchange = (patch: Partial<Echange>) =>
    store.set({
      echanges: store.get().echanges.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      // Ne rend la main que si CE traitement est encore le courant (un clear() ou
      // un nouvel envoi a pu changer pendingId entre-temps → on n'y touche pas).
      ...(store.get().pendingId === id ? { pendingId: null } : {}),
    });
  try {
    const reply = await sendRgpPrompt(p);
    patchEchange({ reply });
  } catch (err) {
    const code = (err as Error).message;
    patchEchange({ error: MESSAGES[code] ?? code });
  }
}

export const useRgp = store.use;

// Lecture directe de l'état — réservée aux tests (le store est un singleton de module).
export function snapshotForTest(): RgpState {
  return store.get();
}
