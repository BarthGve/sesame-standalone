// Page Accueil — contenu importé du design Claude
// « IAka DGGN - Enjeu et objectifs.dc.html », mais posé dans la même mise en
// page que les autres écrans (fond blanc, padding 2rem, pleine largeur), sans
// carte centrée ni fond gris.

const SERIF = "'Spectral', Georgia, 'Times New Roman', serif";

const objectifs = [
  {
    num: "01",
    texte: (
      <>
        Évaluer la <strong style={{ color: "#161616" }}>pertinence de solutions à base d'IA générative</strong> dans le contexte de la rédaction de la procédure judiciaire.
      </>
    ),
  },
  {
    num: "02",
    texte: (
      <>
        Évaluer le <strong style={{ color: "#161616" }}>processus de conception d'automatisations intelligentes</strong> — les «&nbsp;Apps&nbsp;» de IAka.
      </>
    ),
  },
];

const perimetre = [
  {
    picto: "/pictograms/search.svg",
    titre: "Compréhension rapide d'une procédure",
    texte: "Synthétiser et naviguer efficacement dans un dossier.",
  },
  {
    picto: "/pictograms/document.svg",
    titre: "Rédaction du PV de transport",
    texte: "Constatations et mesures prises sur les lieux.",
  },
  {
    picto: "/pictograms/data-visualization.svg",
    titre: "Valorisation des avoirs criminels",
    texte: "Identifier et tracer les avoirs à saisir.",
  },
];

export default function AccueilPage() {
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "2rem", boxSizing: "border-box", color: "#161616" }}>
      <h1 style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 24, color: "#000091", marginTop: 0, marginBottom: 6 }}>
        <span className="material-icons" aria-hidden style={{ color: "#000091" }}>
          flag
        </span>
        Enjeu et objectifs de l'expérimentation IAka
      </h1>
      <p style={{ fontFamily: SERIF, fontSize: 20, lineHeight: 1.45, color: "#3a3a3a", margin: "0 0 2rem", maxWidth: "60ch" }}>
        L'intelligence artificielle générative au service des enquêteurs.
      </p>

      {/* Enjeu */}
      <div style={{ borderLeft: "4px solid #000091", background: "#F5F5FE", padding: "20px 24px", marginBottom: 40 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#000091", marginBottom: 8 }}>
          L'enjeu
        </div>
        <p style={{ margin: 0, fontSize: 18, lineHeight: 1.5, color: "#161616" }}>
          Assister les enquêteurs dans les tâches d'<strong>analyse</strong> et de <strong>rédaction</strong> des pièces de procédure.
        </p>
      </div>

      {/* Objectifs */}
      <h2 style={{ fontWeight: 700, fontSize: 20, margin: "0 0 16px", color: "#161616" }}>Objectifs</h2>
      <div style={{ display: "flex", flexDirection: "column", marginBottom: 40 }}>
        {objectifs.map((o, i) => (
          <div
            key={o.num}
            style={{
              display: "flex",
              gap: 24,
              padding: "20px 0",
              borderTop: "1px solid #e5e5e5",
              borderBottom: i === objectifs.length - 1 ? "1px solid #e5e5e5" : undefined,
            }}
          >
            <span style={{ fontFamily: SERIF, fontWeight: 800, fontSize: 32, color: "#000091", lineHeight: 1, flex: "0 0 auto", minWidth: 44 }}>
              {o.num}
            </span>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: "#3a3a3a" }}>{o.texte}</p>
          </div>
        ))}
      </div>

      {/* Périmètre */}
      <h2 style={{ fontWeight: 700, fontSize: 20, margin: "0 0 6px", color: "#161616" }}>Périmètre identifié</h2>
      <p style={{ margin: "0 0 20px", fontSize: 14, color: "#666" }}>Cas d'usage retenus en amont de l'expérimentation.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}>
        {perimetre.map((c) => (
          <div key={c.titre} style={{ background: "#fff", border: "1px solid #dddddd", padding: "24px 22px" }}>
            <img src={c.picto} alt="" style={{ height: 52, width: "auto", marginBottom: 16, display: "block" }} />
            <h3 style={{ fontWeight: 700, fontSize: 17, margin: "0 0 8px", color: "#161616" }}>{c.titre}</h3>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "#666" }}>{c.texte}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
