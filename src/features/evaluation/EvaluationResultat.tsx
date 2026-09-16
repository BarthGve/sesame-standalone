import { Button } from "@gouvfr-lasuite/cunningham-react";
import ResultatEvaluation from "./ResultatEvaluation";
import PropositionEditor from "../../components/PropositionEditor";
import type { ResultatEvaluation as TResultat, ObjetEvaluable } from "./evaluationApi";

// Vue plein écran du résultat d'évaluation (même parti pris que la synthèse RENS) : bouton
// retour en haut à gauche, export PDF à droite, et au centre les engrenages de construction
// pendant l'évaluation, puis le résultat (total remonté, PV éditable) une fois rendu.
const viderBtnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 6,
  border: "1px solid var(--c--globals--colors--gray-300, #ddd)", background: "#fff", cursor: "pointer", fontSize: 14,
};

export default function EvaluationResultat({
  evaluationEnCours, resultat, erreur, vehicules, onBack, onExportPdf, onPvChange, onVider,
}: {
  evaluationEnCours: boolean;
  resultat: TResultat | null;
  erreur?: string | null;
  vehicules: ObjetEvaluable[];
  onBack: () => void;
  onExportPdf: () => void;
  onPvChange: (html: string) => void;
  onVider: () => void;
}) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "1.5rem 2rem 2rem", boxSizing: "border-box", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
        <Button variant="tertiary" color="neutral" size="small" onClick={onBack}
          icon={<span className="material-icons" aria-hidden>arrow_back</span>}>
          Retour à la sélection
        </Button>
        {!evaluationEnCours && resultat && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Button variant="secondary" size="small" onClick={onExportPdf}
              icon={<span className="material-icons" aria-hidden>picture_as_pdf</span>}>
              Exporter le PV en PDF
            </Button>
            <button type="button" onClick={onVider} style={viderBtnStyle}>
              <span className="material-icons" aria-hidden style={{ fontSize: 18 }}>delete_outline</span>
              Vider
            </button>
          </div>
        )}
      </div>

      {/* Évaluation en cours : engrenages de construction centrés (comme la synthèse RENS). */}
      {evaluationEnCours && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, color: "#000091" }}>
          <div className="rens-gears" role="status" aria-label="Évaluation en cours">
            <span className="material-icons gear-a" aria-hidden>settings</span>
            <span className="material-icons gear-b" aria-hidden>settings</span>
          </div>
          <span style={{ fontSize: 15 }}>Évaluation en cours…</span>
        </div>
      )}

      {/* Échec sans résultat exploitable. */}
      {!evaluationEnCours && !resultat && erreur && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p role="alert" style={{ color: "#e1000f", fontSize: 14, margin: 0 }}>{erreur}</p>
        </div>
      )}

      {/* Résultat rendu : montants annoncés par l'analyse, affichés à titre indicatif. */}
      {!evaluationEnCours && resultat && (
        <div style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
          <ResultatEvaluation resultat={resultat} vehicules={vehicules} />

          <div style={{ border: "1px solid var(--c--globals--colors--gray-300, #ccc)", borderRadius: 4, marginTop: 16 }}>
            <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--c--globals--colors--gray-300, #ddd)", background: "var(--c--globals--colors--gray-050, #f6f6f6)", textAlign: "center", fontWeight: 700, fontSize: 14 }}>
              PV d'évaluation
            </div>
            <PropositionEditor html={resultat.pv} onChange={onPvChange} />
          </div>
        </div>
      )}
    </div>
  );
}
