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
