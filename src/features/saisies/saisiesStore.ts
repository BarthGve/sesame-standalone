import { createPersistedStore } from "../../lib/createPersistedStore";
import {
  buildPerquisitionPayload,
  savePerquisition,
  getPerquisition,
  addObjets as apiAddObjets,
  updateObjet as apiUpdateObjet,
  deleteObjet as apiDeleteObjet,
  apiObjetToDraft,
  uploadPhoto,
  type Procedure,
  type PerquisitionDetail,
  type ApiObjet,
} from "./perquisitionApi";
import { identifyObject } from "./identify";
import { mockIdentify } from "./mockIdentify";
import { buildDraftFrom } from "./objetChamps";
import { objetComplet, type ObjetSaisi, type Perquisition } from "./types";

// État de l'écran Perquisitions conservé HORS composant (singleton de module), au
// même titre que rensStore / pvStore. Sans ça, quitter la page démonte SaisiesApp
// et perd tout : navigation, perquisition en cours ET le lot d'identification en
// cours (la « progress bar » repartait de zéro). Pas de persistance sessionStorage :
// le lot contient des objets File / URLs d'aperçu non sérialisables — l'état survit
// à la navigation SPA, pas à un rechargement complet (F5).

const IDENTIFY_MESSAGES: Record<string, string> = {
  IDENTIFY_TIMEOUT: "Délai dépassé côté IAka. Réessaie.",
  IDENTIFY_UPSTREAM: "IAka a renvoyé une erreur. Réessaie.",
  OBJET_INVALID: "Réponse IAka non conforme (JSON objet attendu).",
  IMAGE_REQUISE: "Aucune image reçue.",
  LECTURE_FICHIER: "Lecture du fichier impossible.",
};

export type SaveState = { status: "idle" | "saving" | "ok" | "err"; msg?: string; id?: number };
export type BatchStatus = "staging" | "pending" | "done" | "error";
export interface BatchItem {
  id: string;
  previewUrl: string;
  status: BatchStatus;
  numeroScelle: string;
  lieu: string;
  draft?: ObjetSaisi;
  error?: string;
  file?: File;
}

export type SaisiesState = {
  screen: "home" | "una" | "perq";
  selectedUna: Procedure | null;
  perquisition: Perquisition | null;
  editingPerq: boolean;
  perqMode: "create" | "consult";
  opened: PerquisitionDetail | null;
  editingObjet: { objetId: number; draft: ObjetSaisi } | null;
  showPv: boolean;
  creating: boolean;
  saveState: SaveState;
  // Lot d'identification en cours (survit à la navigation).
  items: BatchItem[];
  uploading: boolean;
  uploadError: string | null;
};

const initial: SaisiesState = {
  screen: "home",
  selectedUna: null,
  perquisition: null,
  editingPerq: false,
  perqMode: "create",
  opened: null,
  editingObjet: null,
  showPv: false,
  creating: false,
  saveState: { status: "idle" },
  items: [],
  uploading: false,
  uploadError: null,
};

const store = createPersistedStore<SaisiesState>(initial); // pas de persist : en mémoire
const get = store.get;
const set = store.set;
export const useSaisies = store.use;

/** Lecture d'état pour tests (pas d'usage UI). */
export function getSaisiesState() {
  return get();
}

/** Remet le store à l'état initial (tests uniquement). */
export function resetSaisiesForTests() {
  get().items.forEach((it) => it.previewUrl && URL.revokeObjectURL(it.previewUrl));
  set({ ...initial, items: [], saveState: { status: "idle" } });
}

let __id = 0;
const nextId = () => `obj_${++__id}`;

// --- lot d'identification ------------------------------------------------
function clearBatch() {
  get().items.forEach((it) => it.previewUrl && URL.revokeObjectURL(it.previewUrl));
  set({ items: [], uploading: false, uploadError: null });
}

function updateItem(id: string, patch: Partial<BatchItem>) {
  set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
}

export function addFiles(files: FileList | null) {
  if (!files) return;
  const arr = Array.from(files);
  const news: BatchItem[] = arr.map((f) => ({
    id: nextId(), previewUrl: URL.createObjectURL(f), status: "staging" as const, numeroScelle: "", lieu: "", file: f,
  }));
  set({ items: [...get().items, ...news], uploadError: null, saveState: { status: "idle" } });
}

export async function addDemo() {
  const id = nextId();
  set({ items: [...get().items, { id, previewUrl: "", status: "pending" as const, numeroScelle: "", lieu: "" }], uploadError: null, saveState: { status: "idle" } });
  try {
    const res = await mockIdentify();
    updateItem(id, { status: "done", draft: buildDraftFrom(res, id) });
  } catch {
    updateItem(id, { status: "error", error: "Démo indisponible." });
  }
}

export async function analyze(id: string) {
  const item = get().items.find((x) => x.id === id);
  if (!item || item.status !== "staging" || !item.numeroScelle.trim() || !item.file) return;
  updateItem(id, { status: "pending" });
  try {
    const res = await identifyObject(item.file);
    const draft = { ...buildDraftFrom(res, id), numeroScelle: item.numeroScelle, lieu: item.lieu };
    updateItem(id, { status: "done", draft, error: undefined });
  } catch (e) {
    updateItem(id, { status: "error", error: IDENTIFY_MESSAGES[(e as Error).message] ?? "Erreur d'identification." });
  }
}

export function patchItem(id: string, patch: Partial<BatchItem>) {
  updateItem(id, patch);
}

export function removeItem(id: string) {
  const it = get().items.find((x) => x.id === id);
  if (it?.previewUrl) URL.revokeObjectURL(it.previewUrl);
  set({ items: get().items.filter((x) => x.id !== id) });
}

// --- navigation / cycle de vie perquisition ------------------------------
function resetBatch() {
  clearBatch();
  set({ perquisition: null, editingPerq: false, saveState: { status: "idle" }, perqMode: "create", opened: null, editingObjet: null, showPv: false });
}

export function pickUna(p: Procedure) { set({ selectedUna: p, screen: "una" }); }
export function backToHome() { set({ creating: false, screen: "home" }); }
export function backToUna() { set({ screen: "una" }); }

export function beginCreate() { resetBatch(); set({ creating: true }); }
export function cancelCreate() { set({ creating: false }); }

export function submitSetup(p: Perquisition) {
  resetBatch();
  set({ perquisition: p, creating: false, screen: "perq" });
}

export function startEditPerq() { set({ editingPerq: true }); }
export function submitEditPerq(p: Perquisition) { set({ perquisition: p, editingPerq: false }); }

export async function openExisting(id: number) {
  set({ saveState: { status: "saving" } });
  try {
    const detail = await getPerquisition(id);
    clearBatch();
    set({ opened: detail, perqMode: "consult", saveState: { status: "idle" }, editingObjet: null, showPv: false, screen: "perq" });
  } catch (e) {
    set({ saveState: { status: "err", msg: (e as Error).message } });
  }
}

export function setShowPv(v: boolean) { set({ showPv: v }); }

// --- édition d'un objet enregistré ---------------------------------------
export function startEditObjet(o: ApiObjet) {
  set({ saveState: { status: "idle" }, editingObjet: { objetId: o.id, draft: apiObjetToDraft(o) } });
}
export function setEditObjetDraft(draft: ObjetSaisi) {
  const e = get().editingObjet;
  if (e) set({ editingObjet: { ...e, draft } });
}
export function cancelEditObjet() { set({ editingObjet: null }); }

export async function saveObjetEdit() {
  const e = get().editingObjet;
  if (!e) return;
  if (!objetComplet(e.draft)) { set({ saveState: { status: "err", msg: "Objet incomplet." } }); return; }
  set({ saveState: { status: "saving" } });
  try {
    const refreshed = await apiUpdateObjet(e.objetId, e.draft);
    set({ opened: refreshed, editingObjet: null, saveState: { status: "ok", id: refreshed.id } });
  } catch (err) {
    set({ saveState: { status: "err", msg: (err as Error).message } });
  }
}

export async function deleteObjetEdit() {
  const e = get().editingObjet;
  if (!e) return;
  set({ saveState: { status: "saving" } });
  try {
    const refreshed = await apiDeleteObjet(e.objetId);
    set({ opened: refreshed, editingObjet: null, saveState: { status: "ok", id: refreshed.id } });
  } catch (err) {
    set({ saveState: { status: "err", msg: (err as Error).message } });
  }
}

// --- validation du lot : upload des photos puis enregistrement ------------
export async function validerTout() {
  const st = get();
  const doneItems = st.items.filter((it) => it.status === "done" && it.draft);
  if (!doneItems.length) return;
  set({ uploadError: null, uploading: true, saveState: { status: "saving" } });

  let drafts: ObjetSaisi[];
  try {
    drafts = await Promise.all(
      doneItems.map(async (it) => {
        if (it.file) { const key = await uploadPhoto(it.file); return { ...it.draft!, photo: key }; }
        return it.draft!;
      })
    );
  } catch (e) {
    const code = (e as Error).message;
    set({ uploading: false, saveState: { status: "idle" }, uploadError: code === "LECTURE_FICHIER" ? "Lecture d'une photo impossible." : "Échec de l'envoi d'une photo. Réessayez." });
    return;
  }

  try {
    if (st.perqMode === "create") {
      const perq = get().perquisition;
      if (!perq || !perq.una) { set({ uploading: false, saveState: { status: "err", msg: "Perquisition incomplète." } }); return; }
      const { id } = await savePerquisition(buildPerquisitionPayload(perq, perq.una, drafts));
      // Committée : on bascule en consultation et on vide le lot AVANT le rechargement,
      // pour qu'un reclic ne puisse pas re-POSTer (la branche consult est gardée par `opened`).
      clearBatch();
      set({ perqMode: "consult", uploading: false, saveState: { status: "ok", id } });
      try { const detail = await getPerquisition(id); set({ opened: detail }); } catch { /* enregistré ; on ne re-poste pas */ }
    } else {
      const op = get().opened;
      if (!op) { set({ uploading: false }); return; }
      const refreshed = await apiAddObjets(op.id, drafts);
      clearBatch();
      set({ opened: refreshed, uploading: false, saveState: { status: "ok", id: op.id } });
    }
  } catch (e) {
    set({ uploading: false, saveState: { status: "err", msg: (e as Error).message } });
  }
}
