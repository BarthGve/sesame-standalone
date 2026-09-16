// Tokens et briques visuelles de la page Analyste RENS.
// Aligné sur src/lib/uiTokens + convention Qualité (styles inline, Material Icons).
import type { CSSProperties, ReactNode } from "react";
import { colors, cardStyle, fieldStyle } from "../../lib/uiTokens";

export const R = {
  brand: colors.brand,
  brandSoft: colors.brand050,
  brandWash: "#F5F5FE",
  text: colors.text,
  muted: colors.muted,
  border: colors.border,
  borderStrong: "var(--c--globals--colors--gray-300, #ddd)",
  surface: colors.white,
  surfaceInset: "#F6F6F9",
  error: colors.error,
  ok: colors.ok,
  shadow: "0 1px 2px rgba(22,22,29,.04), 0 8px 24px rgba(0,0,145,.04)",
  radius: 12,
  radiusSm: 8,
} as const;

export const page: CSSProperties = {
  height: "100%",
  overflowY: "auto",
  padding: "1.25rem 1.5rem 2rem",
  boxSizing: "border-box",
  minWidth: 0,
};

export const panel: CSSProperties = {
  ...cardStyle,
  borderRadius: R.radius,
  boxShadow: R.shadow,
  borderTop: `3px solid ${R.brand}`,
  overflow: "hidden",
};

export const panelHead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  padding: "14px 18px",
  borderBottom: `1px solid ${R.border}`,
  background: R.surface,
};

export const panelBody: CSSProperties = {
  padding: "16px 18px 18px",
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

export const field: CSSProperties = {
  ...fieldStyle,
  padding: "9px 12px",
  borderRadius: R.radiusSm,
  border: `1px solid ${R.borderStrong}`,
  background: R.surfaceInset,
  fontSize: 13.5,
  transition: "border-color 120ms ease, box-shadow 120ms ease, background 120ms ease",
};

export const fieldFocus: CSSProperties = {
  borderColor: R.brand,
  background: R.surface,
  boxShadow: `0 0 0 3px ${R.brandSoft}`,
  outline: "none",
};

export const label: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: R.muted,
  marginBottom: 5,
  display: "block",
};

export const chip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  border: `1px solid ${R.brand}`,
  background: R.brandSoft,
  color: R.brand,
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.2,
};

export function Icone({
  nom, taille = 18, couleur = R.brand,
}: {
  nom: string; taille?: number; couleur?: string;
}) {
  return (
    <span
      className="material-icons"
      aria-hidden
      style={{ fontSize: taille, lineHeight: 1, color: couleur, flexShrink: 0 }}
    >
      {nom}
    </span>
  );
}

export function Puce({ children }: { children: ReactNode }) {
  return <span style={chip}>{children}</span>;
}

export function Champ({
  label: libelle, htmlFor, children, largeur,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  largeur?: number | string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, width: largeur, flex: largeur ? undefined : "1 1 140px" }}>
      <label htmlFor={htmlFor} style={label}>{libelle}</label>
      {children}
    </div>
  );
}
