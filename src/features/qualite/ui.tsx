// Briques visuelles de la page Qualité. Le dépôt n'a pas de feuille de style par feature :
// on stylise en ligne sur les tokens Cunningham, avec repli DSFR — même convention que
// RensApp et SyntheseApp. Regrouper ici évite de recopier trente objets de style et garde
// une seule définition des couleurs de gravité, qui portent du sens métier.
import type { CSSProperties, ReactNode } from "react";

export const C = {
  bleu: "#000091",
  bleuClair: "#F5F5FE",
  bleuBadge: "#ececff",
  texte: "#161616",
  gris: "#5C5F63",
  bord: "var(--c--globals--colors--gray-300, #ddd)",
  fond: "#fff",
  succes: "#18753c",
  succesFond: "#E3FDEB",
  bloquant: "#ce0500",
  bloquantFond: "#FFE9E9",
  majeur: "#b34000",
  majeurFond: "#FFF4E5",
  mineur: "#0063cb",
  mineurFond: "#E8F1FF",
};

export const COULEUR_GRAVITE: Record<string, { texte: string; fond: string }> = {
  bloquant: { texte: C.bloquant, fond: C.bloquantFond },
  majeur: { texte: C.majeur, fond: C.majeurFond },
  mineur: { texte: C.mineur, fond: C.mineurFond },
};

export const page: CSSProperties = {
  height: "100%", overflowY: "auto", padding: "1.5rem 2rem 2rem", boxSizing: "border-box", minWidth: 0,
};

export const champ: CSSProperties = {
  padding: "8px 10px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13, background: C.fond,
};

export const carte: CSSProperties = {
  border: `1px solid ${C.bord}`, borderRadius: 10, background: C.fond, padding: "14px 16px",
};

export function Icone({ nom, taille = 18, couleur }: { nom: string; taille?: number; couleur?: string }) {
  return (
    <span className="material-icons" aria-hidden style={{ fontSize: taille, lineHeight: 1, color: couleur, flexShrink: 0 }}>
      {nom}
    </span>
  );
}

export function TitreSection({ icone, children, actions }: { icone: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <h2 style={{ fontSize: 16, color: C.texte, margin: "0 0 10px", display: "flex", alignItems: "center", gap: 8 }}>
      <Icone nom={icone} taille={20} couleur={C.bleu} />
      {children}
      {actions && <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>{actions}</span>}
    </h2>
  );
}

// Encart de cadrage : bandeau bleu à filet gauche, comme la notice de la page RENS.
export function Encart({ children, ton = "info" }: { children: ReactNode; ton?: "info" | "alerte" }) {
  const alerte = ton === "alerte";
  return (
    <div
      role={alerte ? "alert" : undefined}
      style={{
        borderLeft: `4px solid ${alerte ? C.majeur : C.bleu}`,
        background: alerte ? C.majeurFond : C.bleuClair,
        borderRadius: "0 8px 8px 0", padding: "10px 14px", fontSize: 13, lineHeight: 1.5, color: C.texte,
        display: "flex", gap: 10, alignItems: "flex-start",
      }}
    >
      <Icone nom={alerte ? "warning" : "info"} couleur={alerte ? C.majeur : C.bleu} />
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function Puce({ couleur, fond, children, titre }: { couleur: string; fond: string; children: ReactNode; titre?: string }) {
  return (
    <span
      title={titre}
      style={{
        fontSize: 11, fontWeight: 700, letterSpacing: 0.2, textTransform: "uppercase",
        color: couleur, background: fond, borderRadius: 10, padding: "2px 8px", whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function PuceGravite({ gravite }: { gravite: string }) {
  const c = COULEUR_GRAVITE[gravite] ?? { texte: C.gris, fond: "#f0f0f0" };
  return <Puce couleur={c.texte} fond={c.fond}>{gravite}</Puce>;
}

// Compteur mis en avant (fiches contrôlées, conformes, écarts…).
export function Chiffre({ valeur, libelle, couleur = C.bleu, fond = C.bleuBadge }: { valeur: ReactNode; libelle: string; couleur?: string; fond?: string }) {
  // aria-label : le chiffre et son libellé sont deux nœuds distincts à l'écran, mais une
  // seule information pour un lecteur d'écran — et pour un test.
  return (
    <div role="status" aria-label={`${valeur} ${libelle}`} style={{ background: fond, borderRadius: 10, padding: "10px 14px", minWidth: 110 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: couleur, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{valeur}</div>
      <div style={{ fontSize: 12, color: C.gris, marginTop: 2 }}>{libelle}</div>
    </div>
  );
}

// Onglets : même mécanique que la bascule flux/synthèse de RENS, en plus compact.
export function Onglets<T extends string>({ valeur, onChange, items }: {
  valeur: T; onChange: (v: T) => void; items: { cle: T; libelle: string; icone: string }[];
}) {
  return (
    <nav style={{ display: "flex", gap: 4, borderBottom: `1px solid ${C.bord}`, margin: "0 0 16px" }}>
      {items.map((it) => {
        const actif = valeur === it.cle;
        return (
          <button
            key={it.cle}
            type="button"
            aria-pressed={actif}
            onClick={() => onChange(it.cle)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "8px 14px",
              border: "none", borderBottom: `2px solid ${actif ? C.bleu : "transparent"}`,
              background: "none", cursor: "pointer", fontSize: 14,
              fontWeight: actif ? 700 : 500, color: actif ? C.bleu : C.gris,
            }}
          >
            <Icone nom={it.icone} couleur={actif ? C.bleu : C.gris} />
            {it.libelle}
          </button>
        );
      })}
    </nav>
  );
}

// Texte intégral avec TOUS les extraits incriminés surlignés. Une fiche porte souvent
// plusieurs écarts ; n'en surligner qu'un laisse croire que les autres n'ont pas de
// support dans le texte. Les extraits sont placés par position, les chevauchements sont
// ignorés (le premier gagne) pour ne jamais découper un mot en deux.
export function TexteAvecExtraits({ texte, extraits }: { texte: string; extraits: (string | null)[] }) {
  const style: CSSProperties = {
    fontSize: 13, lineHeight: 1.6, color: "#3a3a3a", whiteSpace: "pre-wrap",
    background: "#FAFAFA", borderRadius: 8, padding: "10px 12px", margin: "8px 0 0",
  };

  // Recherche insensible à la casse : un agent qui recopie « Un élève… » en « un élève… »
  // reste verbatim au mot près, et le surlignage ne doit pas sauter pour une majuscule.
  const bas = texte.toLowerCase();
  const zones: { debut: number; fin: number }[] = [];
  for (const e of extraits) {
    if (!e) continue;
    const debut = bas.indexOf(e.toLowerCase().trim());
    if (debut === -1) continue;
    const fin = debut + e.trim().length;
    if (zones.some((z) => debut < z.fin && fin > z.debut)) continue;
    zones.push({ debut, fin });
  }
  if (zones.length === 0) return <p style={style}>{texte}</p>;
  zones.sort((a, b) => a.debut - b.debut);

  const morceaux: ReactNode[] = [];
  let curseur = 0;
  zones.forEach((z, i) => {
    if (z.debut > curseur) morceaux.push(texte.slice(curseur, z.debut));
    morceaux.push(
      <mark key={i} style={{ background: C.majeurFond, color: C.texte, borderBottom: `2px solid ${C.majeur}`, padding: "0 2px" }}>
        {texte.slice(z.debut, z.fin)}
      </mark>,
    );
    curseur = z.fin;
  });
  if (curseur < texte.length) morceaux.push(texte.slice(curseur));

  return <p style={style}>{morceaux}</p>;
}
