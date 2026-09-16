# Carte composable — Bloc 4 (front multi-couche + timeout BFF) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher la carte composable multi-couches dans l'écran carte : chaque feature est taggée `properties._layer`, la légende et les toggles se construisent depuis `meta.layers`, et le BFF laisse au workflow multi-agents le temps de répondre.

**Architecture:** Le workflow IAka (déjà branché sur `/api/query` via `IAKA_CARTE_APP_ID`) renvoie une FeatureCollection `{features:[...{properties._layer}], meta:{layers,scope,relation,coverage_note}}`. Le front rend **une source MapLibre par `_layer`** (cercles pour les points, fill+contour pour les polygones), colore par couche, et pilote la visibilité par couche. La légende vient de `meta.layers`. Aucune nouvelle route BFF ; on relève seulement le délai de poll côté carte.

**Tech Stack:** React 19 + TS + Vite, MapLibre GL, Vitest (jsdom), Node `node --test` (BFF).

## Global Constraints

- **INTERDIT emoji/émoticône dans le front** — icônes vectorielles / Material Icons / SVG / texte uniquement (verbatim CLAUDE.md).
- Tests front = Vitest (`src/**/*.test.{ts,tsx}`), jsdom. Tests BFF = `node --test` (`server/*.test.mjs`).
- Commande tests front : `npm test`. Tests BFF : `node --test server/<fichier>.test.mjs`.
- Ne pas casser l'API publique des fonctions de `src/lib/geo.ts` déjà testées dans `src/lib/geo.test.ts` (ajouter, pas remplacer).
- Le contrat de sortie du workflow : `properties._layer` ∈ {`eoliennes`, `interv`, …} ; `meta.layers = [{id,label,count}]`, `meta.scope`, `meta.relation`, `meta.coverage_note`.

---

## File Structure

- `src/lib/geo.ts` — MODIFIER : étendre le type `meta`, ajouter `listLayers`, `splitByLayer`, `colorForLayer`. (fonctions pures, testées)
- `src/lib/geo.test.ts` — MODIFIER : tests des nouvelles fonctions.
- `src/features/carte/carteStore.ts` — MODIFIER : `show` devient `Record<string, boolean>` (visibilité par couche) ; `toggle(layerId)`.
- `src/features/carte/carteStore.test.ts` — MODIFIER : tests du nouveau modèle `show`.
- `src/components/Legend.tsx` — RÉÉCRIRE : légende par couche depuis `meta.layers` (fallback `listLayers`), toggle par couche, `coverage_note`.
- `src/components/MapView.tsx` — RÉÉCRIRE : une source MapLibre par `_layer`, style par géométrie, couleur + visibilité par couche.
- `src/features/carte/CartePage.tsx` — MODIFIER : câbler le nouveau `show` (Record) + passer `meta`.
- `server/geojson.test.mjs` — MODIFIER : cas « FeatureCollection propre avec meta » (préservation de `meta`) + robustesse trace.
- `server/proxy.mjs` — MODIFIER : délai de poll spécifique carte (le workflow multi-agents dépasse 60 s).

---

### Task 1 : geo.ts — helpers `_layer`

**Files:**
- Modify: `src/lib/geo.ts`
- Test: `src/lib/geo.test.ts`

**Interfaces:**
- Produces :
  - `type LayerMeta = { id: string; label?: string; geom?: string; count?: number }`
  - `FeatureCollection.meta` étendu avec `layers?: LayerMeta[]`, `scope?: unknown`, `relation?: unknown`, `coverage_note?: string`
  - `listLayers(fc: FeatureCollection): string[]` — ids de `_layer` présents, dans l'ordre d'apparition
  - `splitByLayer(fc: FeatureCollection): Record<string, Feature[]>` — features groupées par `_layer` (clé `"_"` si absent)
  - `colorForLayer(layer: string, layers: string[]): string`

- [ ] **Step 1 : Écrire les tests (échouent)**

Ajouter à la fin de `src/lib/geo.test.ts` :

```ts
import { listLayers, splitByLayer, colorForLayer } from "./geo";

const fcLayers = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [2, 48] }, properties: { _layer: "eoliennes" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [3, 49] }, properties: { _layer: "interv" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [3, 49] }, properties: { _layer: "eoliennes" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [1, 47] }, properties: {} },
  ],
} as any;

describe("_layer helpers", () => {
  it("listLayers renvoie les couches dans l'ordre d'apparition", () => {
    expect(listLayers(fcLayers)).toEqual(["eoliennes", "interv"]);
  });
  it("splitByLayer groupe par _layer, clé '_' si absent", () => {
    const g = splitByLayer(fcLayers);
    expect(g.eoliennes).toHaveLength(2);
    expect(g.interv).toHaveLength(1);
    expect(g._).toHaveLength(1);
  });
  it("colorForLayer est stable et distinct par index", () => {
    const layers = ["eoliennes", "interv"];
    expect(colorForLayer("eoliennes", layers)).toBe(colorForLayer("eoliennes", layers));
    expect(colorForLayer("eoliennes", layers)).not.toBe(colorForLayer("interv", layers));
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `npm test -- src/lib/geo.test.ts`
Expected: FAIL (`listLayers is not a function`).

- [ ] **Step 3 : Implémenter dans `src/lib/geo.ts`**

Étendre le type `meta` (remplacer la ligne `meta?: { titre?: ... }`) :

```ts
export type LayerMeta = { id: string; label?: string; geom?: string; count?: number };

export type FeatureCollection = {
  type: "FeatureCollection";
  meta?: {
    titre?: string; question?: string; count?: number;
    layers?: LayerMeta[];
    scope?: unknown;
    relation?: unknown;
    coverage_note?: string;
  };
  features: Feature[];
};
```

Ajouter à la fin du fichier :

```ts
// Couche d'appartenance d'une feature (contrat carte composable).
function layerOf(f: Feature): string {
  const l = f.properties._layer;
  return typeof l === "string" && l ? l : "_";
}

// Ids de couches présents, dans l'ordre de première apparition (hors "_").
export function listLayers(fc: FeatureCollection): string[] {
  const seen: string[] = [];
  for (const f of fc.features) {
    const l = f.properties._layer;
    if (typeof l === "string" && l && !seen.includes(l)) seen.push(l);
  }
  return seen;
}

// Regroupe les features par _layer (clé "_" pour celles sans couche).
export function splitByLayer(fc: FeatureCollection): Record<string, Feature[]> {
  const out: Record<string, Feature[]> = {};
  for (const f of fc.features) (out[layerOf(f)] ??= []).push(f);
  return out;
}

export function colorForLayer(layer: string, layers: string[]): string {
  const idx = layers.indexOf(layer);
  return PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length];
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `npm test -- src/lib/geo.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/lib/geo.ts src/lib/geo.test.ts
git commit -m "feat(carte): helpers _layer (listLayers/splitByLayer/colorForLayer) + meta.layers"
```

---

### Task 2 : carteStore — visibilité par couche

**Files:**
- Modify: `src/features/carte/carteStore.ts`
- Test: `src/features/carte/carteStore.test.ts`

**Interfaces:**
- Consumes : `listLayers` (Task 1).
- Produces :
  - `type Show = Record<string, boolean>` (remplace `{points; zones}`)
  - `toggle(layerId: string): void`
  - `visibleLayers(data, show): Show` — helper qui complète `show` : toute couche inconnue est visible par défaut
  - `useCarte`, `run`, `setDraft` inchangés

- [ ] **Step 1 : Écrire/adapter les tests (échouent)**

Remplacer le contenu de `src/features/carte/carteStore.test.ts` par (garder les imports/mocks existants du fichier s'il en a — sinon ceci suffit) :

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

beforeEach(() => { localStorage.clear(); vi.resetModules(); });

describe("carteStore — visibilité par couche", () => {
  it("toggle bascule la visibilité d'une couche", async () => {
    const { toggle, useCarte } = await import("./carteStore");
    // simulate a store snapshot read via getState is internal; on teste toggle via le store
    toggle("eoliennes");
    // après un premier toggle sur couche par défaut visible -> masquée
    // (lecture via le hook n'est pas dispo hors composant ; on vérifie la persistance)
    expect(JSON.parse(localStorage.getItem("carte:etat") || "{}").show?.eoliennes).toBe(false);
    toggle("eoliennes");
    expect(JSON.parse(localStorage.getItem("carte:etat") || "{}").show?.eoliennes).toBe(true);
  });

  it("visibleLayers rend visibles par défaut les couches inconnues", async () => {
    const { visibleLayers } = await import("./carteStore");
    const data = { type: "FeatureCollection", features: [
      { type: "Feature", geometry: { type: "Point", coordinates: [2,48] }, properties: { _layer: "eoliennes" } },
      { type: "Feature", geometry: { type: "Point", coordinates: [3,49] }, properties: { _layer: "interv" } },
    ] } as any;
    expect(visibleLayers(data, { interv: false })).toEqual({ eoliennes: true, interv: false });
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `npm test -- src/features/carte/carteStore.test.ts`
Expected: FAIL (`toggle`/`visibleLayers` signature/export).

- [ ] **Step 3 : Implémenter dans `src/features/carte/carteStore.ts`**

Remplacer le type `Show`, le défaut, `toggle`, et ajouter `visibleLayers` :

```ts
import { listLayers } from "../../lib/geo";
// ...
export type Show = Record<string, boolean>;

const DEFAUT_SHOW: Show = {};   // vide = tout visible par défaut (voir visibleLayers)
```

Dans `createPersistedStore`, l'état initial `show: DEFAUT_SHOW` et `read` : `show: p.show ?? DEFAUT_SHOW`.

Remplacer `toggle` :

```ts
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
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `npm test -- src/features/carte/carteStore.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/features/carte/carteStore.ts src/features/carte/carteStore.test.ts
git commit -m "feat(carte): visibilité par couche dans carteStore (show=Record, toggle(layerId))"
```

---

### Task 3 : Legend — depuis meta.layers, toggle par couche

**Files:**
- Rewrite: `src/components/Legend.tsx`
- Test: Create `src/components/Legend.test.tsx`

**Interfaces:**
- Consumes : `listLayers`, `colorForLayer` (Task 1), `Show`, `visibleLayers` (Task 2).
- Produces : `<Legend data show onToggle />` où `onToggle(layerId: string)`.

- [ ] **Step 1 : Écrire le test (échoue)**

Créer `src/components/Legend.test.tsx` :

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Legend from "./Legend";

const data = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [2,48] }, properties: { _layer: "eoliennes" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [3,49] }, properties: { _layer: "interv" } },
  ],
  meta: {
    layers: [
      { id: "eoliennes", label: "Éoliennes", count: 46 },
      { id: "interv", label: "Interventions (pendaison)", count: 7 },
    ],
    coverage_note: "Constructions : Grand Est ; interventions : mai-juin 2026.",
  },
} as any;

describe("Legend", () => {
  it("affiche une entrée par couche depuis meta.layers, avec label et count", () => {
    render(<Legend data={data} show={{}} onToggle={() => {}} />);
    expect(screen.getByText(/Éoliennes/)).toBeInTheDocument();
    expect(screen.getByText(/46/)).toBeInTheDocument();
    expect(screen.getByText(/Interventions/)).toBeInTheDocument();
    expect(screen.getByText(/Grand Est/)).toBeInTheDocument();
  });
  it("toggle appelle onToggle avec l'id de couche", () => {
    const onToggle = vi.fn();
    render(<Legend data={data} show={{}} onToggle={onToggle} />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onToggle).toHaveBeenCalledWith("eoliennes");
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `npm test -- src/components/Legend.test.tsx`
Expected: FAIL (ancienne Legend attend `onToggle("points"|"zones")`).

- [ ] **Step 3 : Réécrire `src/components/Legend.tsx`**

```tsx
import { listLayers, colorForLayer } from "../lib/geo";
import type { FeatureCollection, LayerMeta } from "../lib/geo";
import { visibleLayers, type Show } from "../features/carte/carteStore";

export default function Legend({
  data, show, onToggle,
}: {
  data: FeatureCollection | null;
  show?: Show;
  onToggle?: (layerId: string) => void;
}) {
  if (!data || !data.features.length) return null;
  const ids = listLayers(data);
  if (!ids.length) return null;
  const metaById = new Map<string, LayerMeta>((data.meta?.layers ?? []).map((l) => [l.id, l]));
  const vis = visibleLayers(data, show ?? {});
  const countOf = (id: string) => metaById.get(id)?.count ?? data.features.filter((f) => f.properties._layer === id).length;

  return (
    <aside style={{ padding: 8, minWidth: 220 }}>
      <h2 style={{ fontSize: 16, margin: "0 0 6px" }}>{data.meta?.titre ?? "Couches"}</h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {ids.map((id) => (
          <li key={id} style={{ display: "flex", alignItems: "center", gap: 6, margin: "3px 0" }}>
            <input type="checkbox" checked={vis[id] ?? true} onChange={() => onToggle?.(id)} />
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: colorForLayer(id, ids), flex: "0 0 auto" }} />
            <span>{metaById.get(id)?.label ?? id} ({countOf(id)})</span>
          </li>
        ))}
      </ul>
      {data.meta?.coverage_note && (
        <p style={{ fontSize: 12, color: "#5b5b6b", margin: "8px 0 0" }}>{data.meta.coverage_note}</p>
      )}
    </aside>
  );
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `npm test -- src/components/Legend.test.tsx`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src/components/Legend.tsx src/components/Legend.test.tsx
git commit -m "feat(carte): légende par couche depuis meta.layers + coverage_note"
```

---

### Task 4 : MapView — une source par couche

**Files:**
- Rewrite: `src/components/MapView.tsx`

**Interfaces:**
- Consumes : `listLayers`, `splitByLayer`, `colorForLayer`, `computeBounds` (geo.ts) ; `Show`, `visibleLayers` (carteStore).
- Produces : `<MapView data show />` où `show: Show` (Record).

Note : MapView n'est pas testé unitairement (MapLibre en jsdom). Vérification manuelle via `npm run dev:all` en Task 6.

- [ ] **Step 1 : Réécrire `src/components/MapView.tsx`**

```tsx
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { ignStyle } from "../lib/mapStyle";
import { computeBounds, listLayers, splitByLayer, colorForLayer } from "../lib/geo";
import { visibleLayers, type Show } from "../features/carte/carteStore";
import type { FeatureCollection, Feature } from "../lib/geo";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const srcId = (id: string) => `layer-${id}`;
const isPoint = (fs: Feature[]) => fs.some((f) => f.geometry?.type === "Point" || f.geometry?.type === "MultiPoint");

// Popup générique : liste les propriétés lisibles (hors technique).
function popupHtml(props: Record<string, unknown>): string {
  const skip = new Set(["_layer"]);
  const rows = Object.entries(props)
    .filter(([k, v]) => !skip.has(k) && v != null && v !== "")
    .map(([k, v]) => `<div><strong>${esc(k)}</strong> : ${esc(String(v).slice(0, 200))}</div>`);
  return rows.join("") || "<em>(sans détail)</em>";
}

export default function MapView({ data, show }: { data: FeatureCollection | null; show?: Show }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const known = useRef<Set<string>>(new Set());     // ids de couches déjà ajoutés
  const showRef = useRef<Show>({});
  showRef.current = data ? visibleLayers(data, show ?? {}) : {};

  const applyVisibility = (m: maplibregl.Map) => {
    for (const id of known.current) {
      const v = showRef.current[id] ?? true;
      for (const suff of ["-circle", "-fill", "-line"]) {
        const lid = srcId(id) + suff;
        if (m.getLayer(lid)) m.setLayoutProperty(lid, "visibility", v ? "visible" : "none");
      }
    }
  };

  useEffect(() => {
    if (!container.current) return;
    if (!map.current) {
      map.current = new maplibregl.Map({ container: container.current, style: ignStyle(), center: [2.4, 46.6], zoom: 5 });
      map.current.addControl(new maplibregl.NavigationControl(), "top-right");
    }
    const ro = new ResizeObserver(() => map.current?.resize());
    ro.observe(container.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !data) return;

    const apply = () => {
      const ids = listLayers(data);
      const grouped = splitByLayer(data);

      for (const id of ids) {
        const feats = grouped[id] ?? [];
        const fc = { type: "FeatureCollection", features: feats } as FeatureCollection;
        const color = colorForLayer(id, ids);
        const source = srcId(id);

        if (m.getSource(source)) {
          (m.getSource(source) as maplibregl.GeoJSONSource).setData(fc as any);
          continue;
        }
        m.addSource(source, { type: "geojson", data: fc as any });
        known.current.add(id);

        if (isPoint(feats)) {
          m.addLayer({ id: `${source}-circle`, type: "circle", source,
            paint: { "circle-color": color, "circle-radius": 6, "circle-stroke-width": 1, "circle-stroke-color": "#fff" } });
          m.on("click", `${source}-circle`, (e) => {
            const f = e.features?.[0]; if (!f) return;
            new maplibregl.Popup({ maxWidth: "320px" }).setLngLat((f.geometry as any).coordinates)
              .setHTML(popupHtml(f.properties as Record<string, unknown>)).addTo(m);
          });
          m.on("mouseenter", `${source}-circle`, () => (m.getCanvas().style.cursor = "pointer"));
          m.on("mouseleave", `${source}-circle`, () => (m.getCanvas().style.cursor = ""));
        } else {
          m.addLayer({ id: `${source}-fill`, type: "fill", source, paint: { "fill-color": color, "fill-opacity": 0.3 } });
          m.addLayer({ id: `${source}-line`, type: "line", source, paint: { "line-color": color, "line-width": 1.5 } });
        }
      }

      applyVisibility(m);
      const b = computeBounds(data);
      if (b) m.fitBounds(b, { padding: 60, maxZoom: 12, duration: 600 });
    };

    if (m.isStyleLoaded()) apply();
    else m.once("load", apply);
  }, [data]);

  useEffect(() => { const m = map.current; if (m) applyVisibility(m); }, [show, data]);

  return <div ref={container} style={{ flex: 1, minHeight: 0 }} />;
}
```

- [ ] **Step 2 : Typecheck**

Run: `npx tsc -b --noEmit` (ou `npm run build` en Task 6)
Expected: pas d'erreur de type sur MapView (les imports `Show`/`visibleLayers`/`Feature` existent).

- [ ] **Step 3 : Commit**

```bash
git add src/components/MapView.tsx
git commit -m "feat(carte): MapView une source MapLibre par _layer (points+polygones), couleur/visibilité par couche"
```

---

### Task 5 : CartePage — câblage du nouveau show

**Files:**
- Modify: `src/features/carte/CartePage.tsx`

**Interfaces:**
- Consumes : `useCarte`, `setDraft`, `toggle`, `run` (carteStore) ; `MapView`, `Legend`.

- [ ] **Step 1 : Adapter `CartePage.tsx`**

`useCarte()` fournit désormais `show: Show` (Record). `MapView` et `Legend` reçoivent ce `show`, `Legend.onToggle={toggle}`. Remplacer les lignes concernées :

```tsx
        <MapView data={data} show={show} />
        {data && data.features.length > 0 && (
          <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 1, maxWidth: 280, maxHeight: "60%", overflowY: "auto", background: "#fff", borderRadius: 6, boxShadow: "0 1px 6px rgba(0,0,0,0.18)" }}>
            <Legend data={data} show={show} onToggle={toggle} />
          </div>
        )}
```

(`toggle` importé depuis `./carteStore` prend maintenant un `layerId: string` — signature compatible avec `Legend.onToggle`.)

- [ ] **Step 2 : Typecheck + tests front complets**

Run: `npm test`
Expected: PASS (aucune régression ; `carteStore`, `geo`, `Legend` verts).

- [ ] **Step 3 : Commit**

```bash
git add src/features/carte/CartePage.tsx
git commit -m "feat(carte): CartePage câble la visibilité par couche (toggle(layerId))"
```

---

### Task 6 : BFF — délai de poll carte + robustesse extractGeoJSON

**Files:**
- Modify: `server/proxy.mjs`
- Test: `server/geojson.test.mjs`

**Interfaces:**
- Consumes : `extractGeoJSON` (server/geojson.mjs), route `/api/query`.
- Produces : le job carte poll assez longtemps pour le workflow multi-agents.

- [ ] **Step 1 : Test de préservation de meta (échoue si régression)**

Ajouter à `server/geojson.test.mjs` :

```js
test("extractGeoJSON — FeatureCollection propre entre ```json préserve meta", () => {
  const out = "```json\n" + JSON.stringify({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: [2, 48] }, properties: { _layer: "eoliennes" } }],
    meta: { layers: [{ id: "eoliennes", label: "Éoliennes", count: 1 }], coverage_note: "Grand Est" },
  }) + "\n```";
  const fc = extractGeoJSON(out);
  assert.equal(fc.type, "FeatureCollection");
  assert.equal(fc.features.length, 1);
  assert.equal(fc.meta.layers[0].id, "eoliennes");
});
```

- [ ] **Step 2 : Lancer, vérifier**

Run: `node --test server/geojson.test.mjs`
Expected: PASS (extractGeoJSON préserve déjà `meta` ; ce test verrouille le contrat).

- [ ] **Step 3 : Délai de poll spécifique carte dans `server/proxy.mjs`**

Le workflow carte dure 34–450 s ; le défaut `pollTimeoutMs` (60 s) est trop court. Dans la route `/api/query` (`runJob(jobId, async () => { … await run({ question, cfg }) … })`), passer un `cfg` au délai relevé, sans toucher les autres workflows :

Repérer, dans la route `/api/query`, l'appel `geojson = await run({ question, cfg });` et le remplacer par :

```js
              geojson = await run({ question, cfg: { ...cfg, pollTimeoutMs: cfg.cartePollTimeoutMs ?? 480000 } });
```

Puis, dans le bloc `const cfg = { … }` (démarrage direct), ajouter la clé :

```js
    cartePollTimeoutMs: Number(process.env.CARTE_POLL_TIMEOUT_MS ?? 480000),
```

- [ ] **Step 4 : Vérifier que le BFF démarre + tests BFF**

Run: `node --test server/geojson.test.mjs server/proxy.test.mjs`
Expected: PASS.

- [ ] **Step 5 : Vérification manuelle bout-en-bout**

Run: `npm run dev:all` puis dans l'écran carte saisir :
« les éoliennes et les interventions où le compte-rendu parle de pendaison à moins de 10 km d'une éolienne en mai-juin »
Attendu (≤ ~8 min) : 2 couches (éoliennes + interventions) de couleurs distinctes, légende avec labels/counts + note de couverture, toggles qui masquent/affichent chaque couche, popups au clic. (Le workflow IAka peut échouer par intermittence `fetch failed` — relancer.)

- [ ] **Step 6 : Commit**

```bash
git add server/proxy.mjs server/geojson.test.mjs
git commit -m "feat(carte): délai de poll carte 480s (workflow multi-agents) + test meta extractGeoJSON"
```

---

## Notes de vérification (self-review)

- **Couverture spec** : `_layer` rendu (T1/T4), légende `meta.layers` + `coverage_note` (T3), toggle par couche (T2/T4/T5), FeatureCollection via `/api/query` existant (T6), timeout workflow (T6), pas d'emoji (composants en icônes/texte). `meta.scope`/`meta.relation` sont transportés dans le type mais non affichés en v1 (YAGNI ; dispo pour une itération).
- **Types** : `Show = Record<string, boolean>` cohérent entre carteStore (T2), Legend (T3), MapView (T4), CartePage (T5). `visibleLayers`/`toggle` signatures identiques partout.
- **Risque** : MapView non testé unitairement (MapLibre/jsdom) — couvert par la vérif manuelle T6. `Legend` importe `visibleLayers`/`Show` depuis carteStore : dépendance composant→feature acceptable (déjà le sens des imports existants).
