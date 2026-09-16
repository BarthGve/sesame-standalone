import { createPersistedStore } from "../../lib/createPersistedStore";

export type FrsOnglet = "flux" | "synthese" | "controle" | "analyse" | "rediger";

const ONGLETS: FrsOnglet[] = ["flux", "synthese", "controle", "analyse", "rediger"];

export function estOngletFrs(v: string | null | undefined): v is FrsOnglet {
  return !!v && (ONGLETS as string[]).includes(v);
}

export type FrsUiState = {
  onglet: FrsOnglet;
  /** Jour partagé Flux ↔ Contrôle (YYYY-MM-DD). null = défaut de chaque panneau. */
  jour: string | null;
  /** GGD partagé Flux ↔ Contrôle. "" = tous. */
  ggd: string;
  /**
   * Fiche à ouvrir au prochain affichage du panneau cible (Flux ou Contrôle).
   * Non persisté : action ponctuelle de navigation croisée.
   */
  focusFrsId: number | null;
};

const store = createPersistedStore<FrsUiState>(
  { onglet: "flux", jour: null, ggd: "", focusFrsId: null },
  {
    key: "frs:ui",
    keys: ["onglet", "jour", "ggd"],
    write: (s) => JSON.stringify({ onglet: s.onglet, jour: s.jour, ggd: s.ggd }),
    read: (raw) => {
      const p = JSON.parse(raw) as { onglet?: string; jour?: string | null; ggd?: string };
      return {
        onglet: estOngletFrs(p.onglet) ? p.onglet : "flux",
        jour: typeof p.jour === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.jour) ? p.jour : null,
        ggd: typeof p.ggd === "string" ? p.ggd : "",
        // focusFrsId volontairement non restauré
      };
    },
  },
);

export function setOnglet(onglet: FrsOnglet) {
  store.set({ onglet });
}

/** Met à jour le contexte date / GGD partagé (sans toucher l'onglet). */
export function setContexte(patch: { jour?: string | null; ggd?: string }) {
  const next: Partial<FrsUiState> = {};
  if ("jour" in patch) {
    const j = patch.jour;
    next.jour = j && /^\d{4}-\d{2}-\d{2}$/.test(j) ? j : null;
  }
  if ("ggd" in patch) next.ggd = (patch.ggd ?? "").trim();
  if (Object.keys(next).length) store.set(next);
}

/** Demande d'ouverture d'une fiche dans un panneau (consommée une fois par le panneau). */
export function setFocusFrs(id: number | null) {
  store.set({ focusFrsId: id });
}

/**
 * Navigation croisée : pose le contexte + la fiche + l'onglet cible.
 * Ex. Flux → Contrôle, ou Contrôle → Flux.
 */
export function naviguerVersFiche(opts: {
  onglet: FrsOnglet;
  frsId: number;
  jour?: string | null;
  ggd?: string;
}) {
  const patch: Partial<FrsUiState> = {
    onglet: opts.onglet,
    focusFrsId: opts.frsId,
  };
  if (opts.jour !== undefined) {
    const j = opts.jour;
    patch.jour = j && /^\d{4}-\d{2}-\d{2}$/.test(j) ? j : null;
  }
  if (opts.ggd !== undefined) patch.ggd = (opts.ggd ?? "").trim();
  store.set(patch);
}

export const useFrsUi = store.use;

export function snapshotFrsUi(): FrsUiState {
  return store.get();
}
