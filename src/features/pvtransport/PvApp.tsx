import { Button, useModal } from "@gouvfr-lasuite/cunningham-react";
import ModaleConfirmation from "../../lib/ModaleConfirmation";
import { ACCEPT_ATTR, TAILLE_MAX_OCTETS } from "./pvApi";
import { usePv, setPieces, setPv, clear, run } from "./pvStore";
import DropZone from "../../lib/DropZone";
import PropositionEditor from "../../components/PropositionEditor";
import BarreProgression from "../../components/BarreProgression";
import { htmlVersContenu } from "../../lib/pdfDoc";

const btnStyle = (actif: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 12px",
  borderRadius: 6,
  border: "1px solid var(--c--globals--colors--gray-300, #ddd)",
  background: "#fff",
  color: actif ? "inherit" : "var(--c--globals--colors--gray-400, #9a9a9a)",
  cursor: actif ? "pointer" : "default",
  fontSize: 14,
});

// Texte brut extrait du HTML (repli text/plain de la copie).
function htmlToText(html: string): string {
  const corps = new DOMParser().parseFromString(html, "text/html").body;
  return corps.innerText ?? corps.textContent ?? "";
}

export default function PvApp() {
  const { pieces, loading, error, resultat, startedAt } = usePv();
  const confirmation = useModal();

  // Le workflow ne traite qu'un fichier de notes à la fois → on ne garde que le premier
  // fichier retenu par la zone de dépôt.
  function onFiles(files: File[]) { setPieces(files.slice(0, 1)); }
  function retirer() { setPieces([]); }

  // Le projet de PV a coûté deux à trois minutes de rédaction : on ne l'efface qu'après
  // confirmation explicite. La zone de dépôt se recale seule sur `pieces`.
  function vider() {
    confirmation.close();
    clear();
  }

  // Export PDF du projet édité — même mécanique que la page d'analyse d'audition : pdfmake
  // chargé à la demande, texte vectoriel sélectionnable, à partir du HTML de l'éditeur.
  async function exporterPdf() {
    if (!resultat) return;
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
        info: { title: "Projet de PV de transport" },
        pageMargins: [40, 48, 40, 56],
        content: htmlVersContenu(resultat),
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
            { text: "Projet de procès-verbal — ne se substitue pas au PV relu et signé.", fontSize: 7, color: "#5b5b6b" },
            { text: `${page} / ${total}`, fontSize: 7, color: "#5b5b6b", alignment: "right" },
          ],
          margin: [40, 12, 40, 0],
        }),
      })
      .download("pv-transport.pdf");
  }

  // Copie en conservant la mise en forme (text/html), avec repli text/plain.
  async function copier() {
    if (!resultat) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([resultat], { type: "text/html" }),
          "text/plain": new Blob([htmlToText(resultat)], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(htmlToText(resultat));
    }
  }

  const hasResult = Boolean(resultat);

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "2rem", boxSizing: "border-box" }}>
      <h1 style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 24, color: "#000091", marginTop: 0, marginBottom: 6 }}>
        <span className="material-icons" aria-hidden style={{ color: "#000091" }}>
          description
        </span>
        PV de transport — constatations — mesures prises
      </h1>
      <p style={{ margin: "0 0 0.75rem", color: "#5b5b6b", lineHeight: 1.5 }}>
        Déposez vos notes de terrain : l'outil en rédige un projet de procès-verbal, éditable à l'écran. Ce n'est pas un acte de procédure et ça ne remplace jamais le PV relu et signé.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "0 0 2rem", padding: "12px 14px", borderLeft: "4px solid #000091", background: "#F5F5FE", borderRadius: "0 8px 8px 0" }}>
        <span className="material-icons" aria-hidden style={{ color: "#000091", fontSize: 20, flexShrink: 0 }}>info</span>
        <p style={{ margin: 0, color: "#3a3a3a", fontSize: 14, lineHeight: 1.5 }}>
          Le projet reprend uniquement ce qui figure dans vos notes, classé par rubriques (saisine, constatations, mesures, clôture…). Les points marqués <mark style={{ background: "#ffe2b0", padding: "0 3px", borderRadius: 3 }}>[À VÉRIFIER]</mark> ou <mark style={{ background: "#ffe2b0", padding: "0 3px", borderRadius: 3 }}>[À COMPLÉTER PAR L'OPJ]</mark> doivent être contrôlés avant signature.
        </p>
      </div>

      <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>Ajouter vos notes de terrain</h2>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "#5b5b6b" }}>
        Taille maximale : 5 Mo. Formats supportés : md, txt.
      </p>

      <div style={{ marginBottom: 12 }}>
        <DropZone onFiles={onFiles} files={pieces} onRemove={retirer} disabled={loading}
          accept={ACCEPT_ATTR} maxBytes={TAILLE_MAX_OCTETS}
          quoi="vos notes de terrain" hint="md, txt · 5 Mo max" />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, marginBottom: 20 }}>
        <Button
          type="button"
          onClick={run}
          disabled={!pieces.length || loading}
          icon={
            <span className="material-icons" aria-hidden>
              auto_awesome
            </span>
          }
        >
          {loading ? "Génération en cours…" : "Générer le PV"}
        </Button>
      </div>

      {loading && (
        <>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "#5b5b6b" }}>
            La rédaction peut prendre deux à trois minutes. Vous pouvez naviguer ailleurs, le résultat sera là au retour.
          </p>
          <BarreProgression debut={startedAt ?? undefined} />
        </>
      )}

      {error && (
        <p role="alert" style={{ color: "#e1000f", margin: "0 0 16px" }}>
          {error}
        </p>
      )}

      {/* Le cadre n'a rien à montrer tant que la génération n'a pas rendu son PV : on ne
          réserve pas la place d'un résultat qui n'existe pas encore. */}
      {hasResult && (
        <div style={{ border: "1px solid var(--c--globals--colors--gray-300, #ccc)", borderRadius: 4 }}>
          <div
            style={{
              padding: "10px 12px",
              borderBottom: "1px solid var(--c--globals--colors--gray-300, #ddd)",
              background: "var(--c--globals--colors--gray-050, #f6f6f6)",
              textAlign: "center",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            Projet de PV
          </div>
          <PropositionEditor html={resultat!} onChange={setPv} />
        </div>
      )}

      {hasResult && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
          <Button
            type="button"
            onClick={exporterPdf}
            icon={
              <span className="material-icons" aria-hidden>
                picture_as_pdf
              </span>
            }
          >
            Exporter en PDF
          </Button>
          <button type="button" onClick={copier} style={btnStyle(true)}>
            <span className="material-icons" aria-hidden style={{ fontSize: 18 }}>
              content_copy
            </span>
            Copier dans le presse-papier
          </button>
          <button type="button" onClick={confirmation.open} style={btnStyle(true)}>
            <span className="material-icons" aria-hidden style={{ fontSize: 18 }}>
              delete_outline
            </span>
            Vider
          </button>
        </div>
      )}

      <ModaleConfirmation
        ouverte={confirmation.isOpen}
        titre="Vider le projet de PV ?"
        libelleConfirmer="Vider le projet"
        onConfirmer={vider}
        onAnnuler={confirmation.close}
      >
        Vider efface le projet de procès-verbal affiché, les corrections que vous y avez
        apportées et les notes de terrain déposées. La rédaction a demandé deux à trois
        minutes : la retrouver suppose de redéposer vos notes et de relancer l'outil. Rien
        n'est supprimé côté serveur.
      </ModaleConfirmation>
    </div>
  );
}
