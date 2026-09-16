import MapView from "../../components/MapView";
import SearchBar from "../../components/SearchBar";
import Legend from "../../components/Legend";
import CarteNotice from "./CarteNotice";
import { useCarte, setDraft, toggle, run } from "./carteStore";

export default function CartePage() {
  const { data, loading, error, show, draft } = useCarte();
  const empty = data && data.features.length === 0 && !loading;

  return (
    <div style={{ height: "100%", minWidth: 0, overflowY: "auto", boxSizing: "border-box", display: "flex", flexDirection: "column", padding: "2rem", gap: 24 }}>
      <SearchBar onSubmit={run} loading={loading} value={draft} onChange={setDraft} />
      {loading && <p style={{ margin: 0, color: "#5b5b6b" }}>Génération de la requête et cartographie en cours… (jusqu'à ~8 min).</p>}
      {error && <p role="alert" style={{ color: "#e1000f", margin: 0 }}>{error}</p>}
      {empty && !error && <p style={{ margin: 0 }}>Aucun point pour cette requête.</p>}
      <div
        style={{
          flex: 1, minHeight: 0, maxHeight: "55vh", position: "relative", display: "flex",
          border: "1px solid var(--c--globals--colors--gray-200, #ddd)", borderRadius: 8,
          overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        }}
      >
        <MapView data={data} show={show} />
        {data && data.features.length > 0 && (
          <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 1, maxWidth: 280, maxHeight: "60%", overflowY: "auto", background: "#fff", borderRadius: 6, boxShadow: "0 1px 6px rgba(0,0,0,0.18)" }}>
            <Legend data={data} show={show} onToggle={toggle} />
          </div>
        )}
      </div>
      <CarteNotice />
    </div>
  );
}
