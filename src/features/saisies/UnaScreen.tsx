import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@gouvfr-lasuite/cunningham-react";
import { listPerquisitions, type Procedure, type PerquisitionSummary } from "./perquisitionApi";

const BORDER = "#e2e2ec";
const MUTED = "#5b5b6b";

export default function UnaScreen({
  una,
  onBack,
  onNew,
  onOpen,
  creating = false,
  form = null,
}: {
  una: Procedure;
  onBack: () => void;
  onNew: () => void;
  onOpen: (id: number) => void;
  creating?: boolean;       // un formulaire de création est ouvert en dessous
  form?: ReactNode;         // rendu inline sous la liste (pas de nouvelle page)
}) {
  const [rows, setRows] = useState<PerquisitionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listPerquisitions(una.una)
      .then((r) => { if (alive) setRows(r); })
      .catch((e) => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [una.una]);

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "2rem", boxSizing: "border-box" }}>
      <h1 style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 24, color: "#000091", marginTop: 0, marginBottom: 6 }}>
        <span className="material-icons" aria-hidden style={{ color: "#000091" }}>
          search
        </span>
        Perquisitions
      </h1>
      <div style={{ width: "100%", maxWidth: 1040 }}>
        <Button variant="secondary" size="small" onClick={onBack} style={{ margin: "6px 0 14px" }}>← Changer d'UNA</Button>
        <div style={{ fontSize: 15, fontWeight: 700 }}>UNA {una.una}</div>
        <div style={{ fontSize: 13, color: MUTED, margin: "3px 0 20px" }}>
          {[una.type || una.type_libelle, una.commune_libelle].filter(Boolean).join(" · ")}
          {una.synthese ? ` — ${una.synthese}` : ""}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Perquisitions enregistrées</h2>
          {!creating && <Button onClick={onNew} icon={<span className="material-icons" aria-hidden style={{ fontSize: 18 }}>add</span>}>Nouvelle perquisition</Button>}
        </div>

        {loading && <div style={{ color: MUTED, fontSize: 13 }}>Chargement…</div>}
        {error && <div style={{ color: "#e1000f", fontSize: 13 }}>{error}</div>}
        {!loading && !error && rows.length === 0 && <div style={{ color: MUTED, fontSize: 13 }}>Aucune perquisition. Créez-en une.</div>}
        {rows.length > 0 && (
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => onOpen(p.id)}
                  style={{ width: "100%", textAlign: "left", padding: "12px 14px", borderRadius: 8, border: `1px solid ${BORDER}`, background: "#fff", cursor: "pointer" }}
                >
                  <div style={{ fontWeight: 700 }}>{p.adresse}</div>
                  <div style={{ fontSize: 12.5, color: MUTED, marginTop: 3 }}>
                    {[p.commune_libelle, `${p.nb_objets} objet(s)`].filter(Boolean).join(" · ")}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Formulaire de création rendu INLINE, sous la liste — pas de nouvelle page. */}
        {form}
      </div>
    </div>
  );
}
