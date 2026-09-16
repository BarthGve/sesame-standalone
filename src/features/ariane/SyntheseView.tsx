import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Dossier } from "./arianeApi";
import { formatDateFr } from "./dates";

const mdComponents: Components = {
  table: ({ children }) => <div style={{ overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>{children}</table></div>,
  th: ({ children }) => <th style={{ textAlign: "left", padding: "6px 10px", borderBottom: "2px solid #ddd", color: "#5C5F63" }}>{children}</th>,
  td: ({ children }) => <td style={{ padding: "6px 10px", borderBottom: "1px solid #eee" }}>{children}</td>,
  p: ({ children }) => <p style={{ margin: "0 0 8px" }}>{children}</p>,
};

export default function SyntheseView({ dossier }: { dossier: Dossier }) {
  const { affaire } = dossier;
  return (
    <div style={{ lineHeight: 1.5 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16, fontSize: 13, color: "#5b5b6b" }}>
        <span><strong>Affaire :</strong> {affaire.nature}</span>
        <span><strong>Réf :</strong> {affaire.reference}</span>
        <span><strong>Service :</strong> {affaire.service}</span>
        {affaire.periode.debut && <span><strong>Période :</strong> {formatDateFr(affaire.periode.debut)} → {formatDateFr(affaire.periode.fin ?? "")}</span>}
        <span><strong>Cotes :</strong> {affaire.nb_cotes}</span>
      </div>
      <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{dossier.synthese}</Markdown>
    </div>
  );
}
