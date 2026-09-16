// Tokens de couleur / typo partagés entre features.
// Évite de recopier les hex brand DSFR dans chaque écran (dette styles inline).
// Préférer aussi les variables CSS Cunningham quand elles existent
// (`var(--c--globals--colors--brand-…)`).

import type { CSSProperties } from "react";

export const colors = {
  brand: "#000091",
  brand050: "#ececff",
  ok: "#18753c",
  warn: "#b34000",
  error: "#e1000f",
  border: "#e2e2ec",
  muted: "#5b5b6b",
  text: "#16161d",
  white: "#fff",
  running: "#e6a100",
} as const;

export const cardStyle: CSSProperties = {
  background: colors.white,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  boxShadow: "0 1px 2px rgba(22,22,29,.06), 0 4px 16px rgba(22,22,29,.06)",
};

export const fieldStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: `1px solid ${colors.border}`,
  background: colors.white,
  color: colors.text,
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

export const labelStyle: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  display: "flex",
  alignItems: "center",
  gap: 7,
  marginBottom: 6,
};
