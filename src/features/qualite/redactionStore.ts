import { createPersistedStore } from "../../lib/createPersistedStore";
import { MAX_MOTS_CLES, MAX_TEXTE, MAX_TITRE, type Brouillon } from "./redactionApi";

export const BROUILLON_VIDE: Brouillon = {
  titre: "", unite: "", code_ggd: "", departement: "", commune: "", texte: "", mots_cles: [],
};

function estBrouillon(v: unknown): v is Brouillon {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  return typeof b.titre === "string"
    && typeof b.texte === "string"
    && typeof b.unite === "string"
    && typeof b.code_ggd === "string"
    && typeof b.departement === "string"
    && typeof b.commune === "string"
    && Array.isArray(b.mots_cles);
}

function normaliser(b: Brouillon): Brouillon {
  return {
    titre: String(b.titre ?? "").slice(0, MAX_TITRE),
    unite: String(b.unite ?? ""),
    code_ggd: String(b.code_ggd ?? ""),
    departement: String(b.departement ?? ""),
    commune: String(b.commune ?? ""),
    texte: String(b.texte ?? "").slice(0, MAX_TEXTE),
    mots_cles: (Array.isArray(b.mots_cles) ? b.mots_cles : [])
      .filter((m): m is string => typeof m === "string" && m.trim() !== "")
      .slice(0, MAX_MOTS_CLES),
  };
}

function estVide(b: Brouillon): boolean {
  return !b.titre && !b.texte && !b.code_ggd && !b.unite && !b.commune && b.mots_cles.length === 0;
}

type Etat = { brouillon: Brouillon };

const store = createPersistedStore<Etat>(
  { brouillon: BROUILLON_VIDE },
  {
    // sessionStorage : survit aux onglets FrsApp et au rechargement, pas entre sessions navigateur.
    key: "frs:brouillon",
    keys: ["brouillon"],
    write: (s) => (estVide(s.brouillon) ? null : JSON.stringify({ brouillon: s.brouillon })),
    read: (raw) => {
      try {
        const p = JSON.parse(raw) as { brouillon?: unknown };
        if (!estBrouillon(p.brouillon)) return {};
        return { brouillon: normaliser(p.brouillon) };
      } catch {
        return {};
      }
    },
  },
);

/** Fusionne des champs dans le brouillon courant (persisté). */
export function modifierBrouillon(champs: Partial<Brouillon>) {
  store.set({ brouillon: normaliser({ ...store.get().brouillon, ...champs }) });
}

/** Remet le brouillon à zéro (après enregistrement réussi). */
export function reinitialiserBrouillon() {
  store.set({ brouillon: BROUILLON_VIDE });
}

export function useBrouillon(): Brouillon {
  return store.use().brouillon;
}

export function snapshotBrouillon(): Brouillon {
  return store.get().brouillon;
}
