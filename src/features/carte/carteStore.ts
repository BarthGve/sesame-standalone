import { createPersistedStore } from "../../lib/createPersistedStore";
import { queryMap } from "../../lib/api";
import { listLayers, type FeatureCollection } from "../../lib/geo";

// État de la carte conservé hors composant : il survit aux changements de vue
// (l'écran est démonté quand on navigue ailleurs). La requête tourne ICI, donc une
// cartographie lancée puis quittée continue et son résultat apparaît au retour.

const MESSAGES: Record<string, string> = {
  IAKA_UPSTREAM: "IAka a renvoyé une erreur. Réessayez.",
  IAKA_TIMEOUT: "Délai dépassé. Réessayez.",
  TIMEOUT: "Délai dépassé côté navigateur. La cartographie peut être encore en cours ; réessayez.",
  GEOJSON_INVALID: "Réponse IAka non conforme (GeoJSON attendu).",
};

export type Show = Record<string, boolean>;

// Cartographie en vol, persistée pour reprendre le polling après un F5 : la requête
// tourne côté serveur (détachée), on la retrouve par son jobId.
export type EnVol = { jobId: string; startedAt: number };

export type CarteState = {
  data: FeatureCollection | null;
  loading: boolean;
  error: string | null;
  show: Show;
  draft: string;
  enVol: EnVol | null;
};

// Persistance F5 : résultat carto, filtres d'affichage, brouillon de question ET le
// job en vol (pour reprendre une cartographie lancée juste avant le reload). Jamais
// `loading`/`error` : `loading` est ré-armé par la reprise (voir resumeIfPending).
const DEFAUT_SHOW: Show = {}; // vide = tout visible par défaut (voir visibleLayers)

const store = createPersistedStore<CarteState>(
  { data: null, loading: false, error: null, show: DEFAUT_SHOW, draft: "", enVol: null },
  {
    key: "carte:etat",
    keys: ["data", "show", "draft", "enVol"],
    write: (s) => JSON.stringify({ data: s.data, show: s.show, draft: s.draft, enVol: s.enVol }),
    read: (raw) => {
      const p = JSON.parse(raw) as Partial<CarteState>;
      return {
        data: p.data ?? null,
        show: p.show ?? DEFAUT_SHOW,
        draft: p.draft ?? "",
        enVol: p.enVol ?? null,
      };
    },
  }
);

export function setDraft(draft: string) {
  store.set({ draft });
}

export function toggle(layerId: string) {
  const cur = store.get();
  const visible = visibleLayers(cur.data, cur.show);
  store.set({ show: { ...cur.show, [layerId]: !(visible[layerId] ?? true) } });
}

// Complète `show` : toute couche présente dans data non listée = visible.
export function visibleLayers(data: FeatureCollection | null, show: Show): Show {
  const out: Show = {};
  const layers = data ? listLayers(data) : [];
  for (const id of layers) out[id] = show[id] ?? true;
  // conserve d'éventuelles clés déjà connues même si absentes du data courant
  for (const [k, v] of Object.entries(show)) if (!(k in out)) out[k] = v;
  return out;
}

function echec(code: string) {
  store.set({
    error: MESSAGES[code] ?? "Erreur inconnue.",
    data: { type: "FeatureCollection", features: [] },
    loading: false,
    enVol: null,
  });
}

export async function run(q: string) {
  const query = q.trim();
  if (!query || store.get().loading) return;
  store.set({ loading: true, error: null });
  try {
    // `onStart` fige le job en vol dès le 202 : un F5 pourra reprendre le polling.
    const data = await queryMap(query, fetch, {
      onStart: (jobId) => store.set({ enVol: { jobId, startedAt: Date.now() } }),
    });
    store.set({ data, loading: false, enVol: null });
  } catch (e) {
    echec((e as Error).message);
  }
}

// Reprise après un F5 : un job en vol persisté est re-pollé (sans relancer la
// requête). Job inconnu (serveur redémarré) → nettoyage silencieux, l'utilisateur
// relance. `loading` est ré-armé ici pour que l'écran et la pastille du menu
// signalent « en cours ».
export async function resumeIfPending() {
  const { enVol, loading } = store.get();
  if (!enVol || loading) return;
  store.set({ loading: true, error: null });
  try {
    const data = await queryMap("", fetch, { resumeJobId: enVol.jobId });
    store.set({ data, loading: false, enVol: null });
  } catch (e) {
    const code = (e as Error).message;
    if (code === "JOB_INCONNU") store.set({ loading: false, enVol: null });
    else echec(code);
  }
}
resumeIfPending();

export const useCarte = store.use;
