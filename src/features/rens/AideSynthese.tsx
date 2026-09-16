import { useEffect } from "react";

// Modale d'aide : explique, sans jargon technique, comment la synthèse RENS est
// construite. Contenu volontairement vulgarisé — l'utilisateur veut comprendre la
// démarche, pas l'implémentation.

const ETAPES: { titre: string; texte: string }[] = [
  {
    titre: "1. Mesurer les tendances et repérer les signaux faibles",
    texte:
      "À partir du renseignement de la veille, deux lectures d'ensemble sont faites : un panorama " +
      "chiffré (nombre de fiches, mots-clés qui reviennent, zones les plus citées) et une détection " +
      "des signaux faibles — des sujets peu nombreux mais qui se répètent dans plusieurs " +
      "départements et communes, et passent donc inaperçus dans la masse.",
  },
  {
    titre: "2. Rédiger la synthèse",
    texte:
      "Une première intelligence artificielle met ces éléments en forme : un panorama du jour " +
      "(volume et évolution par rapport à la veille, tendances dominantes, géographie marquante), " +
      "puis la liste des signaux faibles repérés, avec pour chacun ce qui le rend notable — ampleur, " +
      "période, caractère émergent — et des pistes à approfondir.",
  },
  {
    titre: "3. Approfondir le signal le plus marquant",
    texte:
      "Une seconde intelligence artificielle choisit le signal faible le plus saillant (en priorité " +
      "ceux qui émergent ou touchent le plus de zones), puis va RELIRE les fiches concernées pour en " +
      "tirer un zoom : ce qui se passe concrètement (mode opératoire, cibles, zones, période) — en " +
      "s'appuyant uniquement sur les textes, sans rien inventer — et des recommandations " +
      "(surveillance, recoupement, unités à alerter).",
  },
  {
    titre: "4. Assembler le document",
    texte:
      "Le document final réunit la synthèse du jour et ce zoom. Comme le zoom repart de la synthèse " +
      "et suit l'actualité du renseignement, le signal mis en avant change au fil des jours.",
  },
];

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,18,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 1000,
};
const carte: React.CSSProperties = {
  background: "#fff", borderRadius: 12, maxWidth: 560, width: "100%", maxHeight: "85vh",
  overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.25)",
};
const entete: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
  padding: "16px 20px", borderBottom: "1px solid var(--c--globals--colors--gray-200, #eee)",
};
const titreH: React.CSSProperties = { margin: 0, fontSize: 18, fontWeight: 700, color: "#000091" };
const fermer: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32,
  borderRadius: 8, border: "1px solid var(--c--globals--colors--gray-300, #ddd)", background: "#fff", cursor: "pointer",
};
const etapeTitre: React.CSSProperties = { margin: "0 0 4px", fontSize: 14, fontWeight: 700, color: "#000091" };
const etapeTexte: React.CSSProperties = { margin: 0, fontSize: 14, color: "#3a3a44", lineHeight: 1.5 };

export default function AideSynthese({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={overlay} onClick={onClose} role="presentation">
      <div
        style={carte}
        role="dialog"
        aria-modal="true"
        aria-label="Comment cette synthèse est construite"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={entete}>
          <h2 style={titreH}>Comment cette synthèse est construite</h2>
          <button type="button" style={fermer} aria-label="Fermer l'aide" onClick={onClose}>
            <span className="material-icons" aria-hidden style={{ fontSize: 20 }}>close</span>
          </button>
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ ...etapeTexte, marginBottom: 4 }}>
            Ce document est produit automatiquement à partir du renseignement de la veille,
            en quatre temps :
          </p>
          {ETAPES.map((e) => (
            <div key={e.titre}>
              <p style={etapeTitre}>{e.titre}</p>
              <p style={etapeTexte}>{e.texte}</p>
            </div>
          ))}
          <p style={{ ...etapeTexte, color: "#5b5b6b", fontSize: 13, borderTop: "1px solid var(--c--globals--colors--gray-200, #eee)", paddingTop: 12 }}>
            Cette synthèse est une aide à l'analyse : elle oriente le regard, mais ne remplace pas
            la lecture des fiches ni le jugement de l'analyste. Les éléments sont à recouper.
          </p>
        </div>
      </div>
    </div>
  );
}
