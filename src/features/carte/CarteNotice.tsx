// Notice sous la carte : guide l'utilisateur sur les données INTERROGEABLES —
// les types d'ouvrages et leurs états. Contenu statique : ce sont les
// énumérations de la BD TOPO (table `constructions`), relevées sur la base bdsp
// le 2026-07-29. Pas d'appel réseau — de simples repères pour rédiger la question.

// Les 27 natures de la table `constructions` (couverture Grand Est), affichées en
// français courant. La casse/les accents sont sans importance à la saisie :
// l'agent filtre en `unaccent(...) ILIKE`.
const NATURES = [
  "Éolienne", "Antenne", "Clocher", "Transformateur", "Barrage", "Cheminée",
  "Pont", "Tunnel", "Écluse", "Quai", "Minaret", "Croix", "Calvaire", "Ruines",
  "Mur", "Mur de soutènement", "Mur anti-bruit", "Clôture", "Dalle", "Escalier",
  "Puits d'hydrocarbures", "Portique portuaire", "Torchère",
  "Fronton de pelote basque", "Sport de montagne", "Autre construction élevée",
  "Autre ligne descriptive",
];

const ETATS = ["En service", "En ruine", "En projet", "En construction"];

const bloc: React.CSSProperties = {
  border: "1px solid var(--c--globals--colors--gray-200, #ddd)",
  borderRadius: 8,
  padding: "14px 16px",
  background: "var(--c--globals--colors--gray-050, #f6f6f6)",
};
const titre: React.CSSProperties = { margin: 0, fontSize: 15, fontWeight: 700, color: "#000091" };
const sousTitre: React.CSSProperties = {
  margin: "12px 0 6px", fontSize: 12, fontWeight: 700, textTransform: "uppercase",
  letterSpacing: 0.4, color: "#5b5b6b",
};
const texte: React.CSSProperties = { margin: "4px 0 0", fontSize: 13, color: "#3a3a44" };
const chips: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6 };
const chip: React.CSSProperties = {
  fontSize: 12, padding: "2px 10px", borderRadius: 999,
  border: "1px solid var(--c--globals--colors--gray-300, #ddd)", background: "#fff", color: "#3a3a44",
};
const chipEtat: React.CSSProperties = { ...chip, borderColor: "#000091", color: "#000091" };

export default function CarteNotice() {
  return (
    <section style={bloc} aria-label="À propos des données cartographiables">
      <p style={titre}>À propos des données</p>
      <p style={texte}>
        Ouvrages de la <strong>BD TOPO</strong> (IGN), couverture <strong>Grand Est</strong>.
        Interrogez la carte en langage naturel par <strong>type d'ouvrage</strong> et par{" "}
        <strong>état</strong> — par exemple «&nbsp;affiche les éoliennes&nbsp;», «&nbsp;les
        antennes en service&nbsp;», «&nbsp;les barrages en ruine&nbsp;».
      </p>

      <p style={sousTitre}>Types d'ouvrages (27)</p>
      <div style={chips}>
        {NATURES.map((n) => (
          <span key={n} style={chip}>{n}</span>
        ))}
      </div>

      <p style={sousTitre}>État</p>
      <div style={chips}>
        {ETATS.map((e) => (
          <span key={e} style={chipEtat}>{e}</span>
        ))}
      </div>

      <p style={{ ...texte, marginTop: 12, fontSize: 12, color: "#5b5b6b" }}>
        Les ouvrages ponctuels (éoliennes, antennes, clochers…) et linéaires (barrages,
        ponts, tunnels…) s'affichent tous sur la carte ; cliquez un marqueur pour ses détails.
      </p>
    </section>
  );
}
