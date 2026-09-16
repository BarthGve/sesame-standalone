import { useSyncExternalStore } from "react";

// Petit store hors-React partagé par les features (synthese, pv, rgp) : état en
// singleton de module (survit aux changements de vue), abonnement via
// useSyncExternalStore, persistance sessionStorage optionnelle. Factorise le trio
// load/save/subscribe qui était recopié dans chaque store.

export type Persist<S> = {
  key: string;
  // Clés de l'état dont la modification déclenche une écriture.
  keys: (keyof S)[];
  // Parse la valeur stockée (string) en patch d'état à réhydrater.
  read: (raw: string) => Partial<S>;
  // Sérialise l'état à persister ; renvoyer null retire la clé du stockage.
  write: (state: S) => string | null;
};

export type Store<S> = {
  get: () => S;
  set: (patch: Partial<S>) => void;
  subscribe: (listener: () => void) => () => void;
  use: () => S;
};

export function createPersistedStore<S extends object>(
  initial: S,
  persist?: Persist<S>
): Store<S> {
  function load(): Partial<S> {
    if (!persist) return {};
    try {
      const raw = sessionStorage.getItem(persist.key);
      return raw == null ? {} : persist.read(raw);
    } catch {
      return {};
    }
  }

  let state: S = { ...initial, ...load() };
  const listeners = new Set<() => void>();

  function save() {
    if (!persist) return;
    try {
      const out = persist.write(state);
      if (out == null) sessionStorage.removeItem(persist.key);
      else sessionStorage.setItem(persist.key, out);
    } catch {
      /* stockage indisponible → persistance ignorée */
    }
  }

  function set(patch: Partial<S>) {
    state = { ...state, ...patch };
    if (persist && persist.keys.some((k) => k in patch)) save();
    listeners.forEach((l) => l());
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    get: () => state,
    set,
    subscribe,
    use: () => useSyncExternalStore(subscribe, () => state),
  };
}
