import {
  champ,
  type ObjetEvaluable,
  type ResultatEvaluation as TResultat,
} from "./evaluationApi";

// Résultat de l'évaluation : par véhicule, l'estimation ANNONCÉE par l'analyse.
// Composant pur.
//
// Dans ce démonstrateur, l'évaluation n'écrit rien dans la procédure : les
// montants ci-dessous sont affichés à titre indicatif, pour l'information de
// l'enquêteur. Ils ne sont pas confrontés à la base et ne valent pas expertise.

const carte: React.CSSProperties = {
  border: "1px solid var(--c--globals--colors--gray-300, #ddd)",
  borderRadius: 4,
  padding: "12px 14px",
  marginBottom: 12,
  background: "var(--c--globals--colors--gray-050, #f6f6f6)",
};

const titre: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: 0, color: "#000091" };
const detail: React.CSSProperties = { fontSize: 13, color: "#3a3a44", margin: "2px 0 0" };
const alerte: React.CSSProperties = { ...detail, color: "#b34000" };

const euros = (v: number | null) =>
  v == null ? "" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);

function joindre(...parts: (string | false | null)[]): string {
  return parts.filter(Boolean).join(" — ");
}

export default function ResultatEvaluation({
  resultat,
  vehicules,
}: {
  resultat: TResultat;
  vehicules: ObjetEvaluable[];
}) {
  const nom = (objetId: number) => {
    const v = vehicules.find((x) => x.objet.id === objetId);
    if (!v) return `Objet ${objetId}`;
    return joindre(champ(v.objet, "marque"), champ(v.objet, "modele")) || `Objet ${objetId}`;
  };

  // Le montant affiché est la somme des estimations annoncées par l'analyse. Le
  // total que l'analyse annonce elle-même (`totalAnnonce`) n'est gardé que pour
  // signaler un écart avec sa propre addition — il ne fait pas mieux foi.
  const t = resultat.totalRecalcule;
  const a = resultat.totalAnnonce;
  const ecart =
    a != null && t != null && (a.bas !== t.bas || a.moyen !== t.moyen || a.haut !== t.haut);

  return (
    <section aria-label="Résultat de l'évaluation">
      {resultat.evaluations.map(({ objetId, estimation }) => (
        <div key={objetId} style={carte}>
          <p style={titre}>{nom(objetId)}</p>
          <p style={detail}>
            {joindre(
              estimation.prixBas != null && estimation.prixHaut != null
                ? `Fourchette ${euros(estimation.prixBas)} à ${euros(estimation.prixHaut)}`
                : null,
              `estimation ${euros(estimation.prixMoyen)}`
            )}
          </p>
          {estimation.hypotheses.length > 0 && (
            <p style={detail}>{estimation.hypotheses.join(" — ")}</p>
          )}
          {estimation.sources.length > 0 && (
            <p style={detail}>
              Sources :{" "}
              {estimation.sources
                .map((s) => joindre(s.site, s.prix != null && euros(s.prix)))
                .join(" ; ")}
            </p>
          )}
          {estimation.avertissement && <p style={detail}>{estimation.avertissement}</p>}
        </div>
      ))}

      {/* Total estimé, affiché à titre indicatif : ce démonstrateur n'enregistre
          rien dans la procédure. */}
      <div style={{ ...carte, background: "#e3e3fd" }}>
        <p style={titre}>Total estimé des avoirs (à titre indicatif)</p>
        {t ? (
          <p style={detail}>
            {joindre(
              `${euros(t.bas)} à ${euros(t.haut)}`,
              `estimation ${euros(t.moyen)}`
            )}
          </p>
        ) : (
          // Aucune évaluation exploitable : « 0 € à 0 € » se lirait comme un
          // montant, pas comme une absence.
          <p style={alerte}>
            L'analyse n'a annoncé aucun montant exploitable pour ces véhicules.
          </p>
        )}
        <p style={detail}>
          Estimation affichée pour information — non enregistrée dans la procédure, ne vaut pas
          expertise.
        </p>
        {/* L'analyse avance un total alors qu'aucune de ses estimations n'était
            exploitable : rien ne permet de le recouper, mais le taire priverait
            l'enquêteur d'un chiffre que l'analyse a bel et bien produit — et qui
            figure aussi dans le PV. */}
        {!t && a && (
          <p style={alerte}>
            L'analyse annonce un total de {euros(a.bas)} à {euros(a.haut)} (estimation{" "}
            {euros(a.moyen)}), qui n'a pu être recoupé par aucune estimation exploitable de sa part.
          </p>
        )}
        {ecart && (
          <p style={alerte}>
            Écart avec le total annoncé par l'analyse ({euros(a!.moyen)}) : la somme ci-dessus est
            recalculée à partir de ses propres évaluations.
          </p>
        )}
      </div>

      {resultat.nonEvalues.length > 0 && (
        <div style={carte}>
          <p style={titre}>Véhicules non évalués</p>
          {resultat.nonEvalues.map((n) => (
            <p key={n.objetId} style={detail}>
              {joindre(nom(n.objetId), n.raison)}
            </p>
          ))}
        </div>
      )}

      {/* L'analyse est sortie du périmètre qu'on lui avait fixé. Ces objets sont
          écartés de tous les chiffres — ils n'ont pas de ligne, ils ne doivent
          peser sur rien — mais l'anomalie elle-même doit être connue. */}
      {resultat.horsSelection.length > 0 && (
        <div style={carte}>
          <p style={alerte}>
            L'analyse a rendu {resultat.horsSelection.length} objet(s) hors de la sélection
            demandée (identifiant(s) {resultat.horsSelection.join(", ")}). Ils ont été écartés :
            ils n'entrent dans aucun montant affiché.
          </p>
        </div>
      )}

      {resultat.manquants.length > 0 && (
        <div style={carte}>
          <p style={alerte}>
            {resultat.manquants.length} véhicule(s) sélectionné(s) n'ont pas été traités par l'analyse :{" "}
            {resultat.manquants.map(nom).join(", ")}. Relancez l'évaluation sur ces véhicules.
          </p>
        </div>
      )}
    </section>
  );
}
