import { champ, type ObjetEvaluable } from "./evaluationApi";

// Liste des véhicules d'une procédure, à cocher pour évaluation. Composant pur :
// la sélection et son plafond sont gérés par le store.

const ligne: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "10px 12px",
  borderBottom: "1px solid var(--c--globals--colors--gray-200, #e5e5e5)",
};

const titre: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: 0 };
const detail: React.CSSProperties = { fontSize: 13, color: "#5b5b6b", margin: "2px 0 0" };
const avertissement: React.CSSProperties = { fontSize: 13, color: "#b34000", margin: "2px 0 0" };

// Assemble les fragments non vides : un champ absent ne laisse pas de séparateur.
function joindre(...parts: (string | false)[]): string {
  return parts.filter(Boolean).join(" — ");
}

export default function ObjetsSelection({
  vehicules,
  nonEligibles,
  selection,
  onBasculer,
}: {
  vehicules: ObjetEvaluable[];
  nonEligibles: number;
  selection: number[];
  onBasculer: (objetId: number) => void;
}) {
  if (!vehicules.length) {
    return (
      <div style={{ padding: "12px", fontSize: 14, color: "#5b5b6b" }}>
        <p style={{ margin: 0 }}>Aucun véhicule terrestre dans cette procédure.</p>
        {nonEligibles > 0 && (
          <p style={{ margin: "4px 0 0" }}>
            {nonEligibles} autres objets saisis ne sont pas encore évaluables.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      {vehicules.map(({ objet, adresse }) => {
        const marque = champ(objet, "marque");
        const modele = champ(objet, "modele");
        const mec = champ(objet, "date_mec");
        const km = champ(objet, "kilometrage");
        const coche = selection.includes(objet.id);
        const nomObjet = joindre(marque, modele) || `Objet ${objet.id}`;
        const detailTexte = joindre(
          mec && `1ʳᵉ mise en circulation ${mec}`,
          km && `${km} km`,
          !!objet.numero_scelle && `scellé ${objet.numero_scelle}`
        );
        // Marque, modèle et date de mise en circulation sont exigés par cote-api :
        // sans l'un des trois, l'estimation échouera. On le signale sans décocher
        // — l'objet reste sélectionnable, la spec le fait remonter en non_evalues.
        const cotable = !!marque && !!modele && !!mec;
        return (
          <label key={objet.id} style={ligne}>
            <input
              type="checkbox"
              checked={coche}
              onChange={() => onBasculer(objet.id)}
              aria-label={`Évaluer ${nomObjet}`}
            />
            <span>
              <p style={titre}>{nomObjet}</p>
              {detailTexte && <p style={detail}>{detailTexte}</p>}
              <p style={detail}>{adresse}</p>
              {!cotable && (
                <p style={avertissement}>Données incomplètes — l'estimation pourra échouer.</p>
              )}
            </span>
          </label>
        );
      })}
      {nonEligibles > 0 && (
        <p style={{ ...detail, padding: "10px 12px", margin: 0 }}>
          {nonEligibles} autres objets saisis ne sont pas encore évaluables.
        </p>
      )}
    </div>
  );
}
