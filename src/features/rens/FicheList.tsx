import type { CSSProperties } from "react";
import type { Fiche } from "./rensApi";
import { R, Icone, Puce } from "./ui";

// Mots-clés techniques masqués de l'UI (usage interne aux trames signaux faibles).
const motVisible = (m: string) => !m.startsWith("signal-faible:") && !m.startsWith("defaut:");
// Date API 'YYYY-MM-DD' → affichage 'JJ-MM-AAAA'.
export const frDate = (d: string | null | undefined) => (d ? d.split("-").reverse().join("-") : "");

const meta: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 12,
  color: R.muted,
  minWidth: 0,
};

/**
 * Carte de fiche unifiée (Flux journalier + sélection À la demande).
 * - mode lecture : cliquable via onSelect
 * - mode sélection : case à cocher + bascule via onToggle
 */
export function FicheCarte({
  f,
  onSelect,
  selectable = false,
  selected = false,
  onToggle,
}: {
  f: Fiche;
  onSelect?: (f: Fiche) => void;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: (f: Fiche) => void;
}) {
  const mots = f.mots_cles.filter(motVisible);
  const actif = selectable ? selected : false;

  function activer() {
    if (selectable) onToggle?.(f);
    else onSelect?.(f);
  }

  return (
    <article
      onClick={activer}
      role={selectable ? undefined : "button"}
      tabIndex={selectable ? undefined : 0}
      onKeyDown={selectable ? undefined : (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activer();
        }
      }}
      style={{
        display: "flex",
        gap: 0,
        border: `1px solid ${actif ? R.brand : R.border}`,
        borderRadius: R.radiusSm,
        background: actif ? R.brandSoft : R.surface,
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color 120ms ease, box-shadow 120ms ease, background 120ms ease",
      }}
      onMouseEnter={(e) => {
        if (actif) return;
        e.currentTarget.style.borderColor = R.brand;
        e.currentTarget.style.boxShadow = `0 0 0 1px ${R.brand}, ${R.shadow}`;
      }}
      onMouseLeave={(e) => {
        if (actif) return;
        e.currentTarget.style.borderColor = R.border;
        e.currentTarget.style.boxShadow = "none";
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = R.brand;
        e.currentTarget.style.boxShadow = `0 0 0 3px ${R.brandSoft}`;
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = actif ? R.brand : R.border;
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div
        style={{ width: 4, flexShrink: 0, background: actif ? R.brand : R.brand }}
        aria-hidden
      />
      {selectable && (
        <div
          style={{
            display: "flex", alignItems: "center", paddingLeft: 12,
            flexShrink: 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle?.(f)}
            // Libellé stable pour les tests et lecteurs d'écran (même format qu'avant).
            aria-label={`${f.titre} — ${f.unite} · ${f.date_redaction}`}
            style={{ accentColor: R.brand, width: 16, height: 16, cursor: "pointer" }}
          />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, padding: "12px 14px" }}>
        {/* Titre à gauche · date / GGD / unité / commune à droite, même ligne */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
        }}>
          <h3 style={{
            fontSize: 15, fontWeight: 650, margin: 0, color: R.text,
            flex: "1 1 auto", minWidth: 0, lineHeight: 1.35, letterSpacing: -0.1,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {f.titre}
          </h3>
          <div style={{
            display: "flex", flexWrap: "wrap", justifyContent: "flex-end",
            gap: "4px 12px", flex: "0 1 auto", maxWidth: "55%",
          }}>
            <span style={meta}>
              <Icone nom="event" taille={14} couleur={R.muted} />
              {frDate(f.date_redaction)}
            </span>
            <span style={meta}>
              <Icone nom="shield" taille={14} couleur={R.muted} />
              {f.code_ggd}
            </span>
            <span style={{ ...meta, maxWidth: 160 }}>
              <Icone nom="apartment" taille={14} couleur={R.muted} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.unite}</span>
            </span>
            {f.commune && (
              <span style={{ ...meta, maxWidth: 140 }}>
                <Icone nom="place" taille={14} couleur={R.muted} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.commune}</span>
              </span>
            )}
          </div>
        </div>
        {mots.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {mots.map((m) => <Puce key={m}>{m}</Puce>)}
          </div>
        )}
      </div>
    </article>
  );
}

export default function FicheList({
  fiches, loading, error, onSelect,
}: {
  fiches: Fiche[];
  loading: boolean;
  error?: string;
  onSelect: (f: Fiche) => void;
}) {
  if (loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "28px 16px",
        color: R.muted, fontSize: 14, justifyContent: "center",
      }}>
        <span className="material-icons" aria-hidden style={{ fontSize: 20, animation: "spin 1s linear infinite" }}>
          progress_activity
        </span>
        Chargement des fiches…
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" style={{
        margin: 0, padding: "14px 16px", borderRadius: R.radiusSm,
        background: "#FFE9E9", color: R.error, fontSize: 14,
      }}>
        {error}
      </p>
    );
  }
  if (fiches.length === 0) {
    return (
      <div style={{
        textAlign: "center", padding: "36px 20px",
        border: `1px dashed ${R.border}`, borderRadius: R.radiusSm,
        background: R.surfaceInset,
      }}>
        <Icone nom="search_off" taille={28} couleur={R.muted} />
        <p style={{ margin: "10px 0 4px", fontSize: 14, fontWeight: 600, color: R.text }}>
          Aucune fiche pour ces critères
        </p>
        <p style={{ margin: 0, fontSize: 13, color: R.muted }}>
          Modifiez la date, le GGD, la commune ou les mots-clés.
        </p>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }} role="list">
      {fiches.map((f) => (
        <div key={f.id} role="listitem">
          <FicheCarte f={f} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
}
