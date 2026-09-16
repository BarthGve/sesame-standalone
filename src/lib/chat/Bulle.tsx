import { useState } from "react";

// Présentation commune des conversations (RGP, Ariane) : bulle, bouton copier et
// indicateur « en train d'écrire ». Volontairement sans état métier — ce module ne
// connaît ni store ni client d'API, chaque page compose ses propres messages.
//
// Les classes CSS restent préfixées `rgp-` (cf. index.css) : elles servent aussi à
// la page RENS, hors du périmètre de cette factorisation.
//
// Aucun contenu de message n'est journalisé ici : ce sont des pièces de procédure.

// Bouton « copier » discret, affiché sous la bulle et révélé au survol.
export function BoutonCopier({ text }: { text: string }) {
  const [copie, setCopie] = useState(false);
  async function copier() {
    try {
      await navigator.clipboard.writeText(text);
      setCopie(true);
      setTimeout(() => setCopie(false), 1500);
    } catch {
      /* presse-papiers indisponible : on ignore */
    }
  }
  return (
    <button
      type="button"
      onClick={copier}
      title={copie ? "Copié" : "Copier le contenu"}
      aria-label={copie ? "Copié" : "Copier le contenu"}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 3, border: "none", background: "transparent",
        color: "var(--c--globals--colors--gray-500, #7a7a88)",
        cursor: "pointer", lineHeight: 1, borderRadius: 4,
      }}
    >
      <span className="material-icons" aria-hidden style={{ fontSize: 16 }}>
        {copie ? "check" : "content_copy"}
      </span>
    </button>
  );
}

type BulleProps = {
  from: "user" | "bot";
  children: React.ReactNode;
  alert?: boolean;
  // Renseigné uniquement sur un message terminé : copier une réponse en cours
  // d'écriture n'aurait pas de sens.
  copyText?: string;
  // Texte brut (Ariane) : les retours à la ligne doivent rester visibles. Les
  // réponses riches (RGP) gèrent leur propre mise en forme et n'en veulent pas.
  preserverLignes?: boolean;
};

// Bulle de conversation : l'expéditeur détermine l'alignement, la couleur, la
// largeur maximale et le coin aplati. La barre d'actions (copier) s'affiche sous
// la bulle, au survol du message.
export function Bulle({ from, children, alert, copyText, preserverLignes }: BulleProps) {
  const user = from === "user";
  return (
    <div className="rgp-msg" style={{ display: "flex", flexDirection: "column", alignItems: user ? "flex-end" : "flex-start" }}>
      <div
        role={alert ? "alert" : undefined}
        style={{
          maxWidth: user ? "78%" : "88%",
          padding: "8px 14px",
          borderRadius: 18,
          borderBottomRightRadius: user ? 5 : 18,
          borderBottomLeftRadius: user ? 18 : 5,
          background: user
            ? "var(--c--contextuals--background--semantic--brand--primary, #3E5DE7)"
            : alert ? "#ffe9e9" : "#f1f1f6",
          color: user ? "#fff" : alert ? "#b00020" : "#1a1a1a",
          fontSize: 14,
          lineHeight: 1.5,
          overflowWrap: "anywhere",
          ...(preserverLignes ? { whiteSpace: "pre-wrap" as const } : {}),
        }}
      >
        {children}
      </div>
      {copyText && (
        <div className="rgp-msg-actions" style={{ display: "flex", padding: "2px 4px" }}>
          <BoutonCopier text={copyText} />
        </div>
      )}
    </div>
  );
}

// Indicateur « en train d'écrire » (trois points animés, cf. index.css .rgp-typing).
export function Indicateur() {
  return (
    <Bulle from="bot">
      <span className="rgp-typing" aria-label="L'assistant rédige une réponse">
        <span /><span /><span />
      </span>
    </Bulle>
  );
}
