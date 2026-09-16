import { useState } from "react";
import { Button, Input } from "@gouvfr-lasuite/cunningham-react";

export default function SearchBar({
  onSubmit, loading, value, onChange,
}: { onSubmit: (q: string) => void; loading: boolean; value?: string; onChange?: (v: string) => void }) {
  // Contrôlé si `value`/`onChange` fournis (persistance du brouillon via le store),
  // sinon état interne — rétro-compatible.
  const [interne, setInterne] = useState("");
  const q = value ?? interne;
  const setQ = onChange ?? setInterne;
  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}
      onSubmit={(e) => { e.preventDefault(); if (q.trim()) onSubmit(q.trim()); }}
    >
      <h1 style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 24, color: "#000091", marginTop: 0, marginBottom: 6 }}>
        <span className="material-icons" aria-hidden style={{ color: "#000091" }}>
          map
        </span>
        Interroger la base BDSP
      </h1>
      <Input
        label="Question"
        fullWidth
        value={q}
        onChange={(e) => setQ((e.target as HTMLInputElement).value)}
        placeholder="ex. communes où décès sur la voie publique"
        disabled={loading}
      />
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button type="submit" disabled={loading}>
          {loading ? "Recherche…" : "Cartographier"}
        </Button>
      </div>
    </form>
  );
}
