import { useState } from "react";
import { Bulle, Indicateur } from "../../lib/chat/Bulle";
import type { ChatMessage } from "./arianeChatApi";
import type { RagEtat } from "./arianeApi";
import Markdown from "../../lib/chat/Markdown";

// Onglet Questions : conversation RAG sur le texte intégral des pièces indexées.
// Aucun contenu de message n'est journalisé — ce sont des pièces de procédure.

type Props = {
  messages: ChatMessage[];
  streaming: boolean;
  rag: RagEtat;
  // Coupure de flux ou purge en échec : affichée sous la conversation, sans rien jeter.
  erreur?: string;
  onAsk: (question: string) => void;
};

export default function ChatView({ messages, streaming, rag, erreur, onAsk }: Props) {
  const [saisie, setSaisie] = useState("");

  function envoyer(e: React.FormEvent) {
    e.preventDefault();
    if (!saisie.trim() || streaming) return;
    onAsk(saisie);
    setSaisie("");
  }

  const vide = messages.length === 0;

  const hint = (
    <p style={{ fontSize: 13, color: "#5b5b6b", margin: 0 }}>
      Questions sur le texte intégral des pièces indexées.
      {rag.indexees < rag.total && ` ${rag.indexees}/${rag.total} pièces indexées.`}
    </p>
  );

  // Zone de saisie, partagée entre l'état initial (centrée) et l'état conversation (en bas).
  const composer = (
    <form onSubmit={envoyer} style={{ display: "flex", gap: 10, width: "100%" }}>
      <input
        type="text"
        value={saisie}
        onChange={(e) => setSaisie(e.target.value)}
        placeholder="Poser une question sur la procédure"
        aria-label="Question"
        style={{ flex: 1, padding: "9px 16px", fontSize: 14, borderRadius: 22, border: "1px solid #ddd" }}
      />
      {/* Bouton rond, icone seule : l'action est evidente. Le nom accessible reste explicite. */}
      <button type="submit" disabled={streaming} aria-label="Envoyer"
        title="Envoyer" style={{
          flex: "0 0 auto", width: 40, height: 40, borderRadius: "50%", border: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: streaming ? "#c8c8d4" : "var(--c--contextuals--background--semantic--brand--primary, #000091)",
          color: "#fff", cursor: streaming ? "default" : "pointer",
        }}>
        <span className="material-icons" aria-hidden style={{ fontSize: 20 }}>send</span>
      </button>
    </form>
  );

  // Conversation vide (façon Claude / ChatGPT) : accueil + saisie centrés dans l'onglet.
  if (vide) {
    return (
      <div style={{ minHeight: 440, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: "0 1rem" }}>
        <div style={{ textAlign: "center" }}>
          <span className="material-icons" aria-hidden style={{ fontSize: 42, color: "#000091" }}>forum</span>
          <h3 style={{ margin: "8px 0 4px", fontSize: 20, color: "#161616" }}>Une question sur la procédure ?</h3>
          {hint}
        </div>
        <div style={{ width: "min(680px, 100%)" }}>{composer}</div>
      </div>
    );
  }

  // Conversation lancée : le fil remonte, la saisie passe dessous, sur toute la largeur.
  return (
    <div style={{ width: "100%" }}>
      <div style={{ marginBottom: 12 }}>{hint}</div>

      {/* Le fil est borné à la hauteur de la page et défile à l'intérieur : la saisie reste
          visible en bas sans que l'onglet ne s'allonge indéfiniment. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 280, maxHeight: "60vh", overflowY: "auto", marginBottom: 12 }}>
        {messages.map((m, i) => {
          if (m.role === "user") {
            return <Bulle key={i} from="user" copyText={m.content} preserverLignes>{m.content}</Bulle>;
          }
          // Le store insère une bulle assistant vide dès l'envoi, puis la remplit au fil
          // du flux : tant qu'aucun caractère n'est arrivé on montre l'indicateur, ensuite
          // c'est le texte qui parle. Une bulle restée vide (flux coupé d'emblée) ne
          // s'affiche pas : l'erreur sous la conversation dit déjà ce qui s'est passé.
          const enCours = streaming && i === messages.length - 1;
          if (!m.content) return enCours ? <Indicateur key={i} /> : null;
          // Copier n'a de sens que sur un message terminé.
          return (
            <Bulle key={i} from="bot" copyText={enCours ? undefined : m.content}>
              <Markdown>{m.content}</Markdown>
            </Bulle>
          );
        })}
        {erreur && (
          <p role="alert" style={{ display: "flex", alignItems: "center", gap: 6, color: "#e1000f", fontSize: 14, margin: 0 }}>
            <span className="material-icons" aria-hidden style={{ fontSize: 18 }}>error_outline</span>
            {erreur}
          </p>
        )}
      </div>

      {composer}
    </div>
  );
}
