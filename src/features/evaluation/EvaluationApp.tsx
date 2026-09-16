import { useEffect, useState } from "react";
import { Button, useModal } from "@gouvfr-lasuite/cunningham-react";
import ModaleConfirmation from "../../lib/ModaleConfirmation";
import ObjetsSelection from "./ObjetsSelection";
import UnasListe from "./UnasListe";
import EvaluationResultat from "./EvaluationResultat";
import { htmlVersContenu } from "../../lib/pdfDoc";
import {
  useEvaluation,
  setUna,
  charger,
  basculer,
  chargerUnas,
  evaluer,
  setPv,
  clear,
  lireEtat,
  MAX_SELECTION,
} from "./evaluationStore";
import { colors } from "../../lib/uiTokens";

// Écran d'évaluation des avoirs : on part d'une procédure (UNA), on liste les
// objets saisis lors de ses perquisitions, et on choisit les véhicules à faire
// évaluer. Le lancement de l'évaluation elle-même arrive au lot suivant.

export default function EvaluationApp() {
  const { una, erreur, donnees, selection, unas, chargementUnas, resultat, evaluationEnCours } =
    useEvaluation();

  // La liste des procédures exploitables se charge à l'ouverture : l'enquêteur
  // choisit dans ce qui existe plutôt que de saisir un numéro à l'aveugle.
  useEffect(() => {
    if (!unas.length) chargerUnas();
  }, [unas.length]);

  // Le résultat s'affiche en plein écran (même parti pris que la synthèse RENS). On y bascule
  // dès qu'une évaluation démarre — clic « Évaluer » ou reprise d'un job en vol après un F5.
  // Après un F5, on rouvre directement sur le résultat (persisté) ou sur le job en vol repris,
  // plutôt que de laisser l'écran de sélection masquer une évaluation déjà là.
  const [vue, setVue] = useState<"selection" | "resultat">(() => {
    const s = lireEtat();
    return s.resultat || s.evaluationEnCours || s.enVol ? "resultat" : "selection";
  });
  useEffect(() => { if (evaluationEnCours) setVue("resultat"); }, [evaluationEnCours]);
  function lancerEvaluation() { setVue("resultat"); evaluer(); }

  // « Vider » (comme les autres pages) : réinitialise l'écran après confirmation — l'évaluation
  // a coûté plusieurs minutes, on ne l'efface pas par accident. Retour à la sélection.
  const confirmation = useModal();
  function vider() {
    confirmation.close();
    clear();
    setVue("selection");
  }

  // Export PDF : même mécanique que la page Analyse — pdfmake chargé à la
  // demande, texte vectoriel sélectionnable. Le nom du fichier reprend le
  // numéro de procédure, assaini des caractères interdits.
  async function exporterPdf() {
    if (!resultat) return;
    const [{ default: pdfMake }, { default: polices }] = await Promise.all([
      import("pdfmake/build/pdfmake"),
      import("pdfmake/build/vfs_fonts"),
    ]);
    pdfMake.addVirtualFileSystem(polices);
    pdfMake.fonts = {
      Roboto: {
        normal: "Roboto-Regular.ttf",
        bold: "Roboto-Medium.ttf",
        italics: "Roboto-Italic.ttf",
        bolditalics: "Roboto-MediumItalic.ttf",
      },
    };
    const nomFichier = `pv-evaluation-${una.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "")}.pdf`;
    pdfMake
      .createPdf({
        info: { title: "PV d'évaluation des avoirs" },
        pageMargins: [40, 48, 40, 56],
        content: htmlVersContenu(resultat.pv),
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
            {
              text: "Estimation indicative issue d'une source simulée — ne vaut pas expertise.",
              fontSize: 7,
              color: "#5b5b6b",
            },
            { text: `${page} / ${total}`, fontSize: 7, color: "#5b5b6b", alignment: "right" },
          ],
          margin: [40, 12, 40, 0],
        }),
      })
      .download(nomFichier);
  }

  // Vue plein écran : engrenages pendant l'évaluation, puis résultat + PV éditable.
  if (vue === "resultat") {
    return (
      <>
        <EvaluationResultat
          evaluationEnCours={evaluationEnCours}
          resultat={resultat}
          erreur={erreur}
          vehicules={donnees?.vehicules ?? []}
          onBack={() => setVue("selection")}
          onExportPdf={exporterPdf}
          onPvChange={setPv}
          onVider={confirmation.open}
        />
        <ModaleConfirmation
          ouverte={confirmation.isOpen}
          titre="Vider l'évaluation ?"
          libelleConfirmer="Vider l'évaluation"
          onConfirmer={vider}
          onAnnuler={confirmation.close}
        >
          Vider efface l'évaluation affichée, le PV et les corrections apportées, et
          réinitialise l'écran. L'évaluation a demandé plusieurs minutes : la retrouver
          suppose de resélectionner les véhicules et de relancer l'outil. Rien n'est
          supprimé côté serveur.
        </ModaleConfirmation>
      </>
    );
  }

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "2rem", boxSizing: "border-box" }}>
      <h1 style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 24, color: colors.brand, marginTop: 0, marginBottom: 6 }}>
        <span className="material-icons" aria-hidden style={{ color: colors.brand }}>
          savings
        </span>
        Évaluation des avoirs
      </h1>
      <p style={{ margin: "0 0 0.75rem", color: colors.muted, lineHeight: 1.5 }}>
        Indiquez une procédure : l'outil réunit les objets saisis lors de ses perquisitions et
        vous laisse choisir ceux à faire évaluer.
      </p>
      <p style={{ margin: "0 0 2rem", color: colors.muted, lineHeight: 1.5 }}>
        Seuls les véhicules terrestres sont évaluables pour l'instant. L'estimation est
        indicative, issue d'une source de démonstration : elle ne vaut pas expertise.
      </p>

      <div style={{ border: "1px solid var(--c--globals--colors--gray-300, #ccc)", borderRadius: 4, marginBottom: 16 }}>
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid var(--c--globals--colors--gray-300, #ddd)",
            background: "var(--c--globals--colors--gray-050, #f6f6f6)",
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          {chargementUnas ? "Chargement des procédures…" : "Procédures comportant des objets saisis"}
        </div>
        <UnasListe
          unas={unas}
          unaChoisi={una}
          onChoisir={(u) => { setUna(u); charger(); }}
          // Changer de procédure pendant une exécution basculerait l'écran sur un
          // autre dossier en plein run : la sélection est verrouillée.
          desactive={evaluationEnCours}
        />
      </div>

      {erreur && (
        <p role="alert" style={{ color: "#e1000f", margin: "0 0 16px" }}>
          {erreur}
        </p>
      )}

      {/* Une procédure sans aucune perquisition n'est pas une procédure sans
          véhicule : le diagnostic doit être exact, sinon l'enquêteur cherche des
          objets là où il n'y a jamais eu d'opération. */}
      {donnees && donnees.perquisitions.length === 0 && (
        <p style={{ margin: "0 0 16px", fontSize: 14, color: "#5b5b6b" }}>
          Aucune perquisition dans cette procédure.
        </p>
      )}

      {donnees && donnees.perquisitions.length > 0 && (
        <>
          <div style={{ border: "1px solid var(--c--globals--colors--gray-300, #ccc)", borderRadius: 4, marginBottom: 16 }}>
            <div
              style={{
                padding: "10px 12px",
                borderBottom: "1px solid var(--c--globals--colors--gray-300, #ddd)",
                background: "var(--c--globals--colors--gray-050, #f6f6f6)",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              {donnees.perquisitions.length} perquisition(s) — {donnees.vehicules.length} véhicule(s) évaluable(s)
            </div>
            <ObjetsSelection
              vehicules={donnees.vehicules}
              nonEligibles={donnees.nonEligibles}
              selection={selection}
              onBasculer={basculer}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12 }}>
            <span style={{ fontSize: 13, color: "#5b5b6b", marginRight: "auto" }}>
              {selection.length} sélectionné(s) sur {MAX_SELECTION} au maximum
            </span>
            {resultat && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setVue("resultat")}
                icon={<span className="material-icons" aria-hidden>visibility</span>}
              >
                Voir le résultat
              </Button>
            )}
            <Button
              type="button"
              onClick={lancerEvaluation}
              disabled={selection.length === 0 || evaluationEnCours}
              icon={
                <span className="material-icons" aria-hidden>
                  auto_awesome
                </span>
              }
            >
              {evaluationEnCours ? "Évaluation en cours…" : "Évaluer la sélection"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
