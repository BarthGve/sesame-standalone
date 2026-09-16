import { useRef, useState } from "react";
import { Button } from "@gouvfr-lasuite/cunningham-react";
import RensResult from "./RensResult";
import AideSynthese from "./AideSynthese";
import { htmlVersContenu } from "../../lib/pdfDoc";

// Vue plein écran de la synthèse : bouton retour en haut à gauche, export PDF à droite, et au
// centre soit les engrenages de construction pendant l'analyse, soit l'erreur, soit la synthèse.
export default function SyntheseView({
  pending, synthError, markdown, onBack, onRetry,
}: {
  pending: boolean;
  synthError?: string;
  markdown?: string;
  onBack: () => void;
  onRetry: () => void;
}) {
  const resultRef = useRef<HTMLDivElement>(null);
  const [aideOuverte, setAideOuverte] = useState(false);

  // Export PDF : on repart du HTML RÉELLEMENT rendu (react-markdown) pour ne pas ré-implémenter
  // la conversion markdown→blocs. pdfmake est chargé à la demande (plusieurs centaines de Ko de
  // polices) — même pattern que les pages évaluation / synthèse.
  async function exporterPdf() {
    const html = resultRef.current?.innerHTML ?? "";
    if (!html.trim()) return;
    const [{ default: pdfMake }, { default: polices }] = await Promise.all([
      import("pdfmake/build/pdfmake"),
      import("pdfmake/build/vfs_fonts"),
    ]);
    pdfMake.addVirtualFileSystem(polices);
    pdfMake.fonts = {
      Roboto: { normal: "Roboto-Regular.ttf", bold: "Roboto-Medium.ttf", italics: "Roboto-Italic.ttf", bolditalics: "Roboto-MediumItalic.ttf" },
    };
    pdfMake
      .createPdf({
        info: { title: "Synthèse RENS" },
        pageMargins: [40, 48, 40, 56],
        content: htmlVersContenu(html),
        defaultStyle: { font: "Roboto", fontSize: 10, lineHeight: 1.35 },
        styles: {
          h1: { fontSize: 16, bold: true, color: "#000091", margin: [0, 0, 0, 8] },
          h2: { fontSize: 13, bold: true, color: "#000091", margin: [0, 10, 0, 4] },
          h3: { fontSize: 11, bold: true, margin: [0, 8, 0, 3] },
          p: { margin: [0, 0, 0, 6] },
          liste: { margin: [0, 0, 0, 6] },
        },
        footer: (page: number, total: number) => ({
          columns: [
            { text: "Synthèse RENS — aide à l'analyse.", fontSize: 7, color: "#5b5b6b" },
            { text: `${page} / ${total}`, fontSize: 7, color: "#5b5b6b", alignment: "right" },
          ],
          margin: [40, 12, 40, 0],
        }),
      })
      .download("synthese-rens.pdf");
  }

  const canExport = !pending && !synthError && !!markdown;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "1.5rem 2rem 2rem", boxSizing: "border-box", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
        <Button variant="tertiary" color="neutral" size="small" onClick={onBack}
          icon={<span className="material-icons" aria-hidden>arrow_back</span>}>
          Retour au flux
        </Button>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Button variant="tertiary" color="neutral" size="small" onClick={() => setAideOuverte(true)}
            icon={<span className="material-icons" aria-hidden>help_outline</span>}>
            Aide
          </Button>
          {canExport && (
            <Button variant="secondary" size="small" onClick={exporterPdf}
              icon={<span className="material-icons" aria-hidden>picture_as_pdf</span>}>
              Export PDF
            </Button>
          )}
        </div>
      </div>

      {aideOuverte && <AideSynthese onClose={() => setAideOuverte(false)} />}

      {/* Construction en cours : engrenages centrés. */}
      {pending && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, color: "#000091" }}>
          <div className="rens-gears" role="status" aria-label="Construction de la synthèse en cours">
            <span className="material-icons gear-a" aria-hidden>settings</span>
            <span className="material-icons gear-b" aria-hidden>settings</span>
          </div>
          <span style={{ fontSize: 15 }}>Construction de la synthèse…</span>
        </div>
      )}

      {/* Erreur : message + réessai. */}
      {!pending && synthError && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
          <p role="alert" style={{ color: "#e1000f", fontSize: 14, margin: 0 }}>{synthError}</p>
          <Button onClick={onRetry} icon={<span className="material-icons" aria-hidden>refresh</span>}>Réessayer</Button>
        </div>
      )}

      {/* Synthèse prête. */}
      {!pending && !synthError && markdown && (
        <div ref={resultRef} style={{ flex: 1, overflowY: "auto", border: "1px solid #eee", borderRadius: 12, background: "#fafafb", padding: "16px 20px" }}>
          <RensResult markdown={markdown} />
        </div>
      )}
    </div>
  );
}
