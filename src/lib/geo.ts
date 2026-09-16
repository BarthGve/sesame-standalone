// Géométries GeoJSON supportées (points d'intervention + polygones de zones).
export type Geometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "MultiPoint" | "LineString"; coordinates: [number, number][] }
  | { type: "Polygon" | "MultiLineString"; coordinates: [number, number][][] }
  | { type: "MultiPolygon"; coordinates: [number, number][][][] };

export type Feature = {
  type: "Feature";
  geometry: Geometry;
  properties: Record<string, string | number | null>;
};

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

const PALETTE = [
  "#000091", "#e1000f", "#009081", "#ff732c",
  "#6a6af4", "#a558a0", "#c3992a", "#5770be",
];

// Parcourt toutes les positions [lon,lat] d'une géométrie (Point → MultiPolygon).
function eachPosition(coords: unknown, cb: (lon: number, lat: number) => void): void {
  if (Array.isArray(coords) && typeof coords[0] === "number") {
    cb(coords[0] as number, coords[1] as number);
    return;
  }
  if (Array.isArray(coords)) for (const c of coords) eachPosition(c, cb);
}

// Point représentatif d'une géométrie : la position médiane parmi toutes ses
// positions. Donne UN marqueur à peu près centré pour une ligne/un polygone,
// plutôt qu'une pastille à chaque sommet.
export function representativePoint(f: Feature): [number, number] | null {
  const pts: [number, number][] = [];
  if (f.geometry) eachPosition(f.geometry.coordinates, (lon, lat) => pts.push([lon, lat]));
  if (!pts.length) return null;
  return pts[Math.floor(pts.length / 2)];
}

// UN marqueur ponctuel par feature (au point représentatif), propriétés recopiées.
// Sert à rendre cliquable/visible une couche linéaire ou surfacique par un seul point.
export function markerPoints(features: Feature[]): FeatureCollection {
  const out: Feature[] = [];
  for (const f of features) {
    const c = representativePoint(f);
    if (c) out.push({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: f.properties });
  }
  return { type: "FeatureCollection", features: out };
}

export function computeBounds(fc: FeatureCollection): [[number, number], [number, number]] | null {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  let any = false;
  for (const f of fc.features) {
    if (!f.geometry) continue;
    eachPosition(f.geometry.coordinates, (lon, lat) => {
      any = true;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    });
  }
  return any ? [[minLon, minLat], [maxLon, maxLat]] : null;
}

// Sépare points (interventions) et polygones (zones) — sources MapLibre distinctes.
export function splitByGeometry(fc: FeatureCollection): { points: FeatureCollection; polygons: FeatureCollection } {
  const points: FeatureCollection = { type: "FeatureCollection", features: [] };
  const polygons: FeatureCollection = { type: "FeatureCollection", features: [] };
  for (const f of fc.features) {
    const t = f.geometry?.type;
    if (t === "Point") points.features.push(f);
    else if (t === "Polygon" || t === "MultiPolygon") polygons.features.push(f);
  }
  return { points, polygons };
}

export function listCategories(fc: FeatureCollection): string[] {
  const set = new Set<string>();
  for (const f of fc.features) {
    const c = f.properties.categorie;
    if (typeof c === "string" && c) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "fr"));
}

// Couches de zones présentes (properties.couche), pour la légende.
export function listCouches(fc: FeatureCollection): string[] {
  const set = new Set<string>();
  for (const f of fc.features) {
    const t = f.geometry?.type;
    if (t !== "Polygon" && t !== "MultiPolygon") continue;
    const c = f.properties.couche;
    set.add(typeof c === "string" && c ? c : "zones");
  }
  return [...set].sort((a, b) => a.localeCompare(b, "fr"));
}

export function colorForCategory(cat: string, categories: string[]): string {
  const idx = categories.indexOf(cat);
  return PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length];
}

export function colorForCouche(couche: string, couches: string[]): string {
  const idx = couches.indexOf(couche);
  return PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length];
}

// Plage numérique d'une propriété (pour choroplèthe). null si absente.
export function valueRange(fc: FeatureCollection, key: string): [number, number] | null {
  let min = Infinity, max = -Infinity, any = false;
  for (const f of fc.features) {
    const v = f.properties[key];
    if (typeof v === "number" && Number.isFinite(v)) { any = true; if (v < min) min = v; if (v > max) max = v; }
  }
  return any ? [min, max] : null;
}

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

// Couleur STABLE par nom de couche : dérivée d'un hash du nom, pas de l'ordre
// d'apparition. Une même nature garde donc toujours la même couleur, quelle que
// soit la requête (2 ou 3 couches), et carte ↔ légende s'accordent forcément
// (même nom → même couleur). Le 2ᵉ argument (liste) n'est plus utilisé ; conservé
// pour compat des appels existants. Compromis assumé : collisions possibles si
// beaucoup de couches (palette de 8).
export function colorForLayer(layer: string, _layers?: string[]): string {
  let h = 0;
  for (let i = 0; i < layer.length; i++) h = (h * 31 + layer.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}
