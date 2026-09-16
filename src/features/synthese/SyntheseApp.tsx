import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, useModal } from "@gouvfr-lasuite/cunningham-react";
import ModaleConfirmation from "../../lib/ModaleConfirmation";
import { ACCEPT_ATTR, TAILLE_MAX_OCTETS } from "./syntheseApi";
import DropZone from "../../lib/DropZone";
import PropositionEditor from "../../components/PropositionEditor";
import ContexteFiche from "./ContexteFiche";
import BarreProgression from "../../components/BarreProgression";
import { htmlVersContenu, nomFichierPdf } from "../../lib/pdfDoc";
import {
  useSynthese,
  setPieces,
  setHtml,
  clear,
  run,
} from "./syntheseStore";

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

const badgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 8px",
  borderRadius: 12,
  background: "#e3e3fd",
  color: "#000091",
  fontSize: 12,
  fontWeight: 700,
};

// Texte brut extrait du HTML (pour le repli text/plain de la copie).
// `innerText` respecte mieux les sauts de ligne, mais n'existe pas partout
// (jsdom) : `textContent` prend le relais plutôt que de produire « undefined ».
function htmlToText(html: string): string {
  const corps = new DOMParser().parseFromString(html, "text/html").body;
  return corps.innerText ?? corps.textContent ?? "";
}

export default function SyntheseApp() {
  const { pieces, loading, error, html, contexte, startedAt } = useSynthese();
  const confirmation = useModal();

  // Le workflow IAka ne traite qu'une pièce à la fois (timeout interne au-delà) → on ne
  // garde que le premier fichier retenu par la zone de dépôt.
  function onFiles(files: File[]) { setPieces(files.slice(0, 1)); }
  function retirer() { setPieces([]); }

  // L'analyse a coûté plusieurs minutes de traitement : on ne l'efface qu'après
  // confirmation explicite. La zone de dépôt se recale seule sur `pieces`.
  function vider() {
    confirmation.close();
    clear();
  }

  // Contenu à emporter (copie comme export) : le cartouche de contexte précède
  // la proposition, comme à l'écran — les données certaines de la procédure
  // d'abord, le texte rédigé ensuite. Rendu en balisage statique (styles en
  // ligne) pour ne dépendre d'aucune feuille de style à l'arrivée.
  function contenuAEmporter(): string {
    const cartouche =
      contexte && contexteRempli
        ? renderToStaticMarkup(createElement(ContexteFiche, { contexte }))
        : "";
    return cartouche + html;
  }

  // Copie en conservant la mise en forme : text/html pour un collage enrichi
  // (Word, courriel), text/plain en repli.
  async function copier() {
    const contenu = contenuAEmporter();
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([contenu], { type: "text/html" }),
          "text/plain": new Blob([htmlToText(contenu)], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(htmlToText(contenu));
    }
  }

  // Export PDF : le fichier est téléchargé directement, sans passer par la boîte
  // d'impression. pdfmake est chargé à la demande — il pèse plusieurs centaines
  // de kilo-octets (polices comprises) et n'a rien à faire dans le bundle
  // initial d'une page qu'on ouvre pour lire.
  async function exporterPdf() {
    const [{ default: pdfMake }, { default: polices }] = await Promise.all([
      import("pdfmake/build/pdfmake"),
      import("pdfmake/build/vfs_fonts"),
    ]);
    // pdfmake 0.3 n'expose plus `vfs` en écriture : les polices s'enregistrent
    // par addVirtualFileSystem. Une affectation directe est silencieusement
    // ignorée et le rendu échoue sur « Roboto-Regular.ttf not found ».
    pdfMake.addVirtualFileSystem(polices);
    pdfMake.fonts = {
      Roboto: {
        normal: "Roboto-Regular.ttf",
        bold: "Roboto-Medium.ttf",
        italics: "Roboto-Italic.ttf",
        bolditalics: "Roboto-MediumItalic.ttf",
      },
    };

    const personne = contexte?.personnes[0];
    pdfMake
      .createPdf({
        info: { title: "Analyse d'audition" },
        pageMargins: [40, 48, 40, 56],
        content: htmlVersContenu(contenuAEmporter()),
        defaultStyle: { font: "Roboto", fontSize: 10, lineHeight: 1.35 },
        styles: {
          h1: { fontSize: 16, bold: true, color: "#000091", margin: [0, 0, 0, 8] },
          h2: { fontSize: 13, bold: true, color: "#000091", margin: [0, 10, 0, 4] },
          h3: { fontSize: 11, bold: true, margin: [0, 8, 0, 3] },
          p: { margin: [0, 0, 0, 6] },
          liste: { margin: [0, 0, 0, 6] },
        },
        // Rappel de statut sur chaque page : ce document est une aide à la
        // relecture, il ne remplace pas le PV signé.
        footer: (page: number, total: number) => ({
          columns: [
            {
              text: "Analyse de travail — ne se substitue pas au procès-verbal signé.",
              fontSize: 7,
              color: "#5b5b6b",
            },
            { text: `${page} / ${total}`, fontSize: 7, color: "#5b5b6b", alignment: "right" },
          ],
          margin: [40, 12, 40, 0],
        }),
      })
      .download(nomFichierPdf(personne?.nom ?? "", personne?.prenom ?? ""));
  }

  const hasResult = Boolean(html);
  // parseLrpgn peut renvoyer un ContexteProcedure sans aucun contenu exploitable
  // (XML racine <Procedure> vide, ou une entrée présente mais dont tous les
  // champs sont vides) : badge et fiche ne s'affichent que si autre chose
  // qu'une coquille vide a été trouvé — on suit la présence de contenu, pas la
  // longueur des tableaux.
  const rempli = (o: Record<string, string>) => Object.values(o).some(Boolean);
  const contexteRempli = Boolean(
    contexte &&
      (contexte.personnes.some(rempli) ||
        contexte.faits.some(rempli) ||
        contexte.enqueteurs.some(rempli) ||
        rempli(contexte.procedure))
  );

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "2rem", boxSizing: "border-box" }}>
      <h1 style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 24, color: "#000091", marginTop: 0, marginBottom: 6 }}>
        <span className="material-icons" aria-hidden style={{ color: "#000091" }}>
          summarize
        </span>
        Analyse d'audition
      </h1>
      <p style={{ margin: "0 0 0.75rem", color: "#5b5b6b", lineHeight: 1.5 }}>
        Déposez une audition : l'outil en fait une analyse pour vous aider à la relire plus vite. Ce n'est pas un acte de procédure et ça ne remplace jamais le PV signé.
      </p>
      <p style={{ margin: "0 0 0.75rem", color: "#5b5b6b", lineHeight: 1.5 }}>
        Elle ne reprend que ce qui est écrit dans l'audition, sans rien ajouter : les propos sont rapportés (« il déclare que… »), sans juger, avec autant les éléments à charge que les explications et dénégations, et les passages importants (aveux, rétractations) sont cités mot pour mot.
      </p>
      <p style={{ margin: "0 0 2rem", color: "#5b5b6b", lineHeight: 1.5 }}>
        L'analyse est classée par rubriques (personne entendue, droits notifiés, déroulé des déclarations, à charge, à décharge, contradictions, citations) et reste à vérifier face au PV d'origine.
      </p>

      <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>Ajouter votre pièce de procédure</h2>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "#5b5b6b" }}>
        Taille maximale : 20 Mo. Formats supportés : jpg, png, pdf, docx, odt.
      </p>

      <div style={{ marginBottom: 12 }}>
        <DropZone onFiles={onFiles} files={pieces} onRemove={retirer} disabled={loading}
          accept={ACCEPT_ATTR} maxBytes={TAILLE_MAX_OCTETS}
          quoi="votre pièce de procédure" hint="jpg, png, pdf, docx, odt · 20 Mo max" />
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
          {loading ? "Analyse en cours…" : "Analyser"}
        </Button>
      </div>

      {error && (
        <p role="alert" style={{ color: "#e1000f", margin: "0 0 16px" }}>
          {error}
        </p>
      )}

      {contexte && contexteRempli && (
        <>
          <p style={{ margin: "0 0 8px" }}>
            <span style={badgeStyle}>
              <span className="material-icons" aria-hidden style={{ fontSize: 14 }}>
                verified
              </span>
              Données LRPGN détectées
            </span>
          </p>
          <ContexteFiche contexte={contexte} />
        </>
      )}

      {/* Le cadre n'a rien à montrer tant que l'analyse n'a pas rendu son texte :
          on ne réserve pas la place d'un résultat qui n'existe pas encore. */}
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
            Proposition
          </div>
          <PropositionEditor html={html} onChange={setHtml} />
        </div>
      )}

      {loading && <BarreProgression debut={startedAt ?? undefined} />}

      {/* Les actions sur le résultat (export, copie, vider) n'apparaissent qu'une fois
          l'analyse rendue. Avant analyse, retirer une pièce se fait dans la zone de dépôt. */}
      {hasResult && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
          {/* Action principale en tête, en bouton plein — même traitement que
              « Télécharger le PV » sur la page PV de transport. */}
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
        titre="Vider l'analyse d'audition ?"
        libelleConfirmer="Vider l'analyse"
        onConfirmer={vider}
        onAnnuler={confirmation.close}
      >
        Vider efface l'analyse affichée, les corrections que vous y avez apportées
        et la pièce de procédure déposée. L'analyse a demandé plusieurs minutes de
        traitement : la retrouver suppose de redéposer la pièce et de relancer
        l'outil. Rien n'est supprimé côté serveur.
      </ModaleConfirmation>
    </div>
  );
}
