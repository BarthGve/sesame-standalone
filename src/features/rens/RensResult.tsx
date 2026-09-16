import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Rendu markdown accordé à la charte (tableaux GFM, gras, listes).
const mdComponents: Components = {
  table: ({ children }) => (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th style={{ textAlign: "left", padding: "6px 10px", borderBottom: "2px solid #ddd", color: "#5C5F63", whiteSpace: "nowrap" }}>{children}</th>
  ),
  td: ({ children }) => <td style={{ padding: "6px 10px", borderBottom: "1px solid #eee" }}>{children}</td>,
  p: ({ children }) => <p style={{ margin: "0 0 8px" }}>{children}</p>,
  a: ({ children, href }) => <a href={href} style={{ color: "#000091" }}>{children}</a>,
};

export default function RensResult({ markdown }: { markdown: string }) {
  return (
    <div style={{ lineHeight: 1.5 }}>
      <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{markdown}</Markdown>
    </div>
  );
}
