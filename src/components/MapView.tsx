import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { ignStyle } from "../lib/mapStyle";
import { computeBounds, listLayers, splitByLayer, colorForLayer, markerPoints } from "../lib/geo";
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
  const handlers = useRef<Map<string, { layer: string; click: any; enter: any; leave: any }>>(new Map());
  const showRef = useRef<Show>({});
  showRef.current = data ? visibleLayers(data, show ?? {}) : {};

  const applyVisibility = (m: maplibregl.Map) => {
    for (const id of known.current) {
      const v = showRef.current[id] ?? true;
      for (const suff of ["-circle", "-fill", "-line", "-line-pts"]) {
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

      for (const id of known.current) {
        if (ids.includes(id)) continue;
        const source = srcId(id);
        const h = handlers.current.get(id);
        if (h) {
          m.off("click", h.layer, h.click);
          m.off("mouseenter", h.layer, h.enter);
          m.off("mouseleave", h.layer, h.leave);
          handlers.current.delete(id);
        }
        for (const suff of ["-circle", "-fill", "-line", "-line-pts"]) {
          const lid = source + suff;
          if (m.getLayer(lid)) m.removeLayer(lid);
        }
        for (const s of [source, `${source}-pts`]) if (m.getSource(s)) m.removeSource(s);
        known.current.delete(id);
      }

      for (const id of ids) {
        const feats = grouped[id] ?? [];
        const fc = { type: "FeatureCollection", features: feats } as FeatureCollection;
        const color = colorForLayer(id, ids);
        const source = srcId(id);
        const ptsSource = `${source}-pts`;

        if (m.getSource(source)) {
          (m.getSource(source) as maplibregl.GeoJSONSource).setData(fc as any);
          if (m.getSource(ptsSource)) (m.getSource(ptsSource) as maplibregl.GeoJSONSource).setData(markerPoints(feats) as any);
          // Resync couleur : la couleur est indexée sur l'ordre des couches, qui peut
          // avoir changé depuis la requête précédente (2 → 3 couches). Sans ça, une
          // couche réutilisée garde son ancienne couleur alors que la légende (recalculée
          // à chaque rendu) affiche la nouvelle → décalage carte/légende.
          const setCol = (suff: string, prop: string) => {
            const lid = `${source}${suff}`;
            if (m.getLayer(lid)) m.setPaintProperty(lid, prop, color);
          };
          setCol("-circle", "circle-color");
          setCol("-fill", "fill-color");
          setCol("-line", "line-color");
          setCol("-line-pts", "circle-color");
          continue;
        }
        m.addSource(source, { type: "geojson", data: fc as any });
        known.current.add(id);

        // Popup au clic (commun aux points et aux marqueurs des couches linéaires).
        const attachPopup = (layerId: string) => {
          const click = (e: any) => {
            const f = e.features?.[0]; if (!f) return;
            new maplibregl.Popup({ maxWidth: "320px" }).setLngLat((f.geometry as any).coordinates)
              .setHTML(popupHtml(f.properties as Record<string, unknown>)).addTo(m);
          };
          const enter = () => (m.getCanvas().style.cursor = "pointer");
          const leave = () => (m.getCanvas().style.cursor = "");
          m.on("click", layerId, click);
          m.on("mouseenter", layerId, enter);
          m.on("mouseleave", layerId, leave);
          handlers.current.set(id, { layer: layerId, click, enter, leave });
        };

        if (isPoint(feats)) {
          m.addLayer({ id: `${source}-circle`, type: "circle", source,
            paint: { "circle-color": color, "circle-radius": 6, "circle-stroke-width": 1, "circle-stroke-color": "#fff" } });
          attachPopup(`${source}-circle`);
        } else {
          m.addLayer({ id: `${source}-fill`, type: "fill", source, paint: { "fill-color": color, "fill-opacity": 0.3 } });
          // Trait plus épais, et qui S'ÉPAISSIT en dézoomant : un ouvrage linéaire
          // (barrage, seuil…) fait quelques dizaines de mètres — en petite échelle il
          // se réduit à un sous-pixel invisible. On compense par la largeur d'écran.
          m.addLayer({ id: `${source}-line`, type: "line", source,
            paint: { "line-color": color, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 5, 9, 3.5, 14, 2] } });
          // UN marqueur cliquable par ouvrage, à un point représentatif (source de
          // points dédiée). Rayon fixe → visible à toute échelle là où la ligne
          // disparaît en petit ; porte les propriétés → popup au clic (la ligne seule
          // n'est pas cliquable).
          m.addSource(ptsSource, { type: "geojson", data: markerPoints(feats) as any });
          m.addLayer({ id: `${source}-line-pts`, type: "circle", source: ptsSource,
            paint: { "circle-color": color,
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 4, 12, 5],
              "circle-stroke-width": 1, "circle-stroke-color": "#fff" } });
          attachPopup(`${source}-line-pts`);
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
