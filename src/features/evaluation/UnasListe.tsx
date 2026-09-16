import type { UnaEvaluable } from "./evaluationApi";

// Liste des procédures exploitables. Composant pur : le chargement et la
// sélection sont gérés par le store.

const ligne = (choisie: boolean, desactive: boolean): React.CSSProperties => ({
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  border: "none",
  borderBottom: "1px solid var(--c--globals--colors--gray-200, #e5e5e5)",
  background: choisie ? "#e3e3fd" : "#fff",
  cursor: desactive ? "not-allowed" : "pointer",
  opacity: desactive ? 0.6 : 1,
  font: "inherit",
});

const titre: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: 0, color: "#000091" };
const detail: React.CSSProperties = { fontSize: 13, color: "#5b5b6b", margin: "2px 0 0" };

const marqueur = (fond: string, texte: string): React.CSSProperties => ({
  display: "inline-block",
  padding: "1px 6px",
  marginLeft: 6,
  borderRadius: 3,
  background: fond,
  color: texte,
  fontSize: 12,
  fontWeight: 700,
});

// Assemble les fragments non vides : un champ absent ne laisse pas de séparateur.
function joindre(...parts: (string | false | null)[]): string {
  return parts.filter(Boolean).join(" — ");
}

export default function UnasListe({
  unas,
  unaChoisi,
  onChoisir,
  desactive = false,
}: {
  unas: UnaEvaluable[];
  unaChoisi: string;
  onChoisir: (una: string) => void;
  /** Choisir une autre procédure PENDANT une évaluation basculerait l'écran sur
   *  un autre dossier en plein run : la liste est verrouillée le temps de
   *  l'évaluation. */
  desactive?: boolean;
}) {
  if (!unas.length) {
    return (
      <p style={{ padding: "12px", margin: 0, fontSize: 14, color: "#5b5b6b" }}>
        Aucune procédure ne comporte d'objet saisi.
      </p>
    );
  }

  return (
    <div>
      {unas.map((u) => {
        const compteurs = joindre(
          `${u.nbPerquisitions} perquisition${u.nbPerquisitions > 1 ? "s" : ""}`,
          `${u.nbObjets} objet${u.nbObjets > 1 ? "s" : ""} saisi${u.nbObjets > 1 ? "s" : ""}`,
          u.groupe
        );
        return (
          <button
            key={u.una}
            type="button"
            onClick={() => onChoisir(u.una)}
            disabled={desactive}
            aria-pressed={u.una === unaChoisi}
            style={ligne(u.una === unaChoisi, desactive)}
          >
            <p style={titre}>
              {u.una}
              {u.urgent && <span style={marqueur("#ffe9e6", "#b34000")}>Urgent</span>}
              {u.sensible && <span style={marqueur("#fef7da", "#716043")}>Sensible</span>}
            </p>
            {u.synthese && <p style={detail}>{u.synthese}</p>}
            {compteurs && <p style={detail}>{compteurs}</p>}
          </button>
        );
      })}
    </div>
  );
}
