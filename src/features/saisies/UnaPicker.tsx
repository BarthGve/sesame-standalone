import { useEffect, useMemo, useState } from "react";
import { Pagination, usePagination } from "@gouvfr-lasuite/cunningham-react";
import { listProcedures, type Procedure } from "./perquisitionApi";

// Colonnes triables (tri côté client sur les lignes chargées).
type SortKey = "type" | "groupe" | "perq";
const ACCESSORS: Record<SortKey, (p: Procedure) => string | number> = {
  type: (p) => (p.type || p.type_libelle || "").toLowerCase(),
  groupe: (p) => (p.groupe_libelle || "").toLowerCase(),
  perq: (p) => p.nb_perquisitions ?? 0,
};

function formatDate(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR");
}

const BRAND = "#000091";
const BORDER = "#e2e2ec";
const MUTED = "#5b5b6b";
const field: React.CSSProperties = { padding: "9px 12px", borderRadius: 8, border: `1px solid ${BORDER}`, fontFamily: "inherit", fontSize: 14 };
const PAGE_SIZE = 10;

const th: React.CSSProperties = { textAlign: "left", padding: "8px 12px", borderBottom: `2px solid ${BORDER}`, color: MUTED, fontSize: 12.5, textTransform: "uppercase", letterSpacing: ".04em", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "10px 12px", borderBottom: `1px solid #eee`, fontSize: 14, verticalAlign: "top" };

function Marqueur({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ display: "inline-block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", padding: "2px 8px", borderRadius: 999, color, border: `1px solid ${color}`, marginRight: 6 }}>
      {label}
    </span>
  );
}

function SortableTh({ label, col, sort, onSort }: { label: string; col: SortKey; sort: { key: SortKey; dir: "asc" | "desc" } | null; onSort: (k: SortKey) => void }) {
  const active = sort?.key === col;
  return (
    <th style={th} aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(col)}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "transparent", border: "none", padding: 0, cursor: "pointer", font: "inherit", color: active ? BRAND : "inherit", textTransform: "inherit", letterSpacing: "inherit" }}
      >
        {label}
        <span className="material-icons" aria-hidden style={{ fontSize: 16, opacity: active ? 1 : 0.4, textTransform: "none" }}>
          {active ? (sort!.dir === "asc" ? "arrow_upward" : "arrow_downward") : "unfold_more"}
        </span>
      </button>
    </th>
  );
}

export default function UnaPicker({ onPick }: { onPick: (p: Procedure) => void }) {
  const [annee, setAnnee] = useState("");
  const [unite, setUnite] = useState("");
  const [rows, setRows] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { page, setPage, pagesCount, setPagesCount } = usePagination({ defaultPage: 1, pageSize: PAGE_SIZE });
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);

  function toggleSort(key: SortKey) {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
    setPage(1);
  }

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const acc = ACCESSORS[sort.key];
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = acc(a), vb = acc(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * mul;
      return String(va).localeCompare(String(vb), "fr") * mul;
    });
  }, [rows, sort]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    listProcedures({ annee: annee || undefined, unite: unite || undefined, limit: 200 })
      .then((r) => { if (alive) setRows(r); })
      .catch((e) => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [annee, unite]);

  // La pagination porte sur les lignes déjà chargées : on recalcule le nombre de
  // pages et on revient à la première dès que le jeu de résultats change (filtres).
  useEffect(() => {
    setPagesCount(Math.max(1, Math.ceil(rows.length / PAGE_SIZE)));
    setPage(1);
  }, [rows.length, setPagesCount, setPage]);

  const pageRows = sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "2rem", boxSizing: "border-box" }}>
      <h1 style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 24, color: "#000091", marginTop: 0, marginBottom: 6 }}>
        <span className="material-icons" aria-hidden style={{ color: "#000091" }}>
          search
        </span>
        Perquisitions
      </h1>
      <p style={{ margin: "0 0 2rem", color: MUTED, lineHeight: 1.5 }}>
        Sélectionnez une procédure (UNA) pour créer ou consulter ses perquisitions et les objets saisis.
      </p>
      <div style={{ width: "100%", maxWidth: 1040 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>Choisir une procédure (UNA)</h2>
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <input style={field} placeholder="Année (ex. 2026)" value={annee} onChange={(e) => setAnnee(e.target.value.replace(/\D/g, ""))} />
          <input style={field} placeholder="Unité (code)" value={unite} onChange={(e) => setUnite(e.target.value.replace(/\D/g, ""))} />
        </div>
        {loading && <div style={{ color: MUTED, fontSize: 13 }}>Chargement…</div>}
        {error && <div style={{ color: "#e1000f", fontSize: 13 }}>{error}</div>}
        {!loading && !error && rows.length === 0 && <div style={{ color: MUTED, fontSize: 13 }}>Aucune procédure.</div>}

        {!loading && !error && rows.length > 0 && (
          <>
            <div style={{ overflowX: "auto", border: `1px solid ${BORDER}`, borderRadius: 8 }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={th}>UNA</th>
                    <SortableTh label="Type" col="type" sort={sort} onSort={toggleSort} />
                    <th style={th}>Commune</th>
                    <SortableTh label="Groupe" col="groupe" sort={sort} onSort={toggleSort} />
                    <th style={th}>Marqueurs</th>
                    <SortableTh label="Perquisitions" col="perq" sort={sort} onSort={toggleSort} />
                    <th style={th}>Créée le</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => (
                    <tr
                      key={p.una}
                      onClick={() => onPick(p)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(p); } }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Ouvrir la procédure ${p.una}`}
                      title={p.synthese || undefined}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f6f6fb")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={{ ...td, fontWeight: 700, color: BRAND, whiteSpace: "nowrap" }}>{p.una}</td>
                      <td style={{ ...td, color: MUTED }}>{p.type || p.type_libelle || "—"}</td>
                      <td style={td}>
                        {p.commune_libelle || "—"}
                        {p.commune_code_postal && <span style={{ color: MUTED }}> ({p.commune_code_postal})</span>}
                      </td>
                      <td style={{ ...td, color: MUTED }}>{p.groupe_libelle || "—"}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {p.urgent && <Marqueur label="Urgent" color="#e1000f" />}
                        {p.sensible && <Marqueur label="Sensible" color="#b34000" />}
                        {!p.urgent && !p.sensible && <span style={{ color: MUTED }}>—</span>}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {(p.nb_perquisitions ?? 0) === 0 ? (
                          <span style={{ color: MUTED }}>—</span>
                        ) : (p.nb_perquisitions ?? 0) === 1 ? (
                          <span className="material-icons" aria-label="Une perquisition" title="Une perquisition" style={{ fontSize: 18, color: "#18753c", verticalAlign: "middle" }}>check_circle</span>
                        ) : (
                          <span aria-label={`${p.nb_perquisitions} perquisitions`} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <span className="material-icons" aria-hidden style={{ fontSize: 18, color: "#18753c", verticalAlign: "middle" }}>check_circle</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: BRAND, background: "#ececff", border: `1px solid ${BRAND}`, borderRadius: 999, padding: "1px 8px" }}>{p.nb_perquisitions}</span>
                          </span>
                        )}
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap", color: MUTED }}>{formatDate(p.date_submit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(pagesCount ?? 1) > 1 && (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
                <Pagination page={page} onPageChange={setPage} pagesCount={pagesCount} pageSize={PAGE_SIZE} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
