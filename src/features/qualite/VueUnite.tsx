import type { Rapport } from "./qualiteApi";
import { C, Encart, Icone, Puce } from "./ui";

// Ce que la liste de fiches ne dit pas : QUI produit les écarts. C'est l'information
// qui déclenche une action de formation plutôt qu'un travail de correction.
export function VueUnite({ unites }: { unites: Rapport["synthese"]["par_unite"] }) {
  if (unites.length === 0) {
    return <Encart>Aucune unité concernée sur cette journée.</Encart>;
  }
  const triees = [...unites].sort((a, b) => b.bloquant - a.bloquant || b.n - a.n);
  const max = Math.max(...triees.map((u) => u.n));

  const th: React.CSSProperties = {
    textAlign: "left", fontSize: 12, color: C.gris, fontWeight: 600,
    padding: "8px 12px", borderBottom: `1px solid ${C.bord}`, whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = { padding: "10px 12px", borderBottom: `1px solid #f0f0f0`, fontSize: 13, color: C.texte };

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", background: C.fond, border: `1px solid ${C.bord}`, borderRadius: 10, overflow: "hidden" }}>
      <thead>
        <tr>
          <th scope="col" style={th}>Unité</th>
          <th scope="col" style={{ ...th, width: "45%" }}>Fiches en écart</th>
          <th scope="col" style={{ ...th, textAlign: "right" }}>Dont bloquants</th>
        </tr>
      </thead>
      <tbody>
        {triees.map((u) => (
          <tr key={u.unite}>
            <td style={{ ...td, fontWeight: u.bloquant > 0 ? 600 : 400 }}>
              {u.bloquant > 0 && <Icone nom="priority_high" taille={14} couleur={C.bloquant} />} {u.unite}
            </td>
            <td style={td}>
              {/* Barre proportionnelle : le classement se lit d'un coup d'œil, sans comparer
                  des nombres ligne à ligne. */}
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span aria-hidden style={{ height: 8, borderRadius: 4, background: u.bloquant > 0 ? C.bloquant : C.mineur, width: `${Math.max(6, (u.n / max) * 100)}%`, opacity: 0.85 }} />
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{u.n}</span>
              </span>
            </td>
            <td style={{ ...td, textAlign: "right" }}>
              {u.bloquant > 0
                ? <Puce couleur={C.bloquant} fond={C.bloquantFond}>{u.bloquant}</Puce>
                : <span style={{ color: C.gris }}>0</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
