import type { TimelineEntry } from "./graph";
import { formatDateFr } from "./dates";

export default function Timeline({ entries, onSelectCote, selectedCote }: { entries: TimelineEntry[]; onSelectCote: (cote: string) => void; selectedCote?: string }) {
  if (entries.length === 0) return <p style={{ color: "#929292" }}>Aucun élément.</p>;
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, borderLeft: "2px solid #e5e5e5" }}>
      {entries.map((e) => (
        <li key={e.id} style={{ position: "relative", padding: "0 0 18px 18px" }}>
          <span aria-hidden style={{ position: "absolute", left: -6, top: 4, width: 10, height: 10, borderRadius: "50%", background: "#000091" }} />
          <div style={{ fontSize: 12, color: "#5b5b6b", fontWeight: 600 }}>
            {formatDateFr(e.date)}
            {e.tag && <span style={{ marginLeft: 8, fontWeight: 400, textTransform: "uppercase", fontSize: 10, color: "#929292" }}>{e.tag}</span>}
          </div>
          <div style={{ fontSize: 14, margin: "2px 0 4px" }}>{e.libelle}</div>
          <button
            type="button"
            onClick={() => onSelectCote(e.cote)}
            style={{
              fontSize: 11, padding: "2px 8px", borderRadius: 10, cursor: "pointer",
              border: "1px solid " + (selectedCote === e.cote ? "#000091" : "#d5d5d5"),
              background: selectedCote === e.cote ? "#ececff" : "#fff", color: "#000091",
            }}
          >
            {e.cote}
          </button>
        </li>
      ))}
    </ol>
  );
}
