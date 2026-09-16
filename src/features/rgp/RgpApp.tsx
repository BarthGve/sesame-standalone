import { useEffect, useRef } from "react";
import { Button, useModal } from "@gouvfr-lasuite/cunningham-react";
import RgpResult from "./RgpResult";
import { Bulle, Indicateur } from "../../lib/chat/Bulle";
import ModaleConfirmation from "../../lib/ModaleConfirmation";
import { useRgp, setDraft, send, clear, type Echange } from "./rgpStore";

// La présentation des bulles est partagée avec la page Ariane : cf. src/lib/chat/Bulle.tsx.
// Ne reste ici que la composition propre à RGP, dont la réponse riche `RgpResult`.
function Message({ x }: { x: Echange }) {
  return (
    <>
      <Bulle from="user" copyText={x.prompt}>{x.prompt}</Bulle>
      {x.reply && <Bulle from="bot" copyText={x.reply.message || x.reply.text}><RgpResult reply={x.reply} animateId={x.id} /></Bulle>}
      {x.error && <Bulle from="bot" alert copyText={x.error}>{x.error}</Bulle>}
      {!x.reply && !x.error && <Indicateur />}
    </>
  );
}

export default function RgpApp() {
  const { echanges, draft, pendingId } = useRgp();
  const loading = pendingId !== null;
  const finRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const confirmation = useModal();

  // Auto-scroll vers le bas à chaque nouveau message / passage en attente.
  useEffect(() => {
    finRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [echanges.length, pendingId]);

  // Auto-grandit la zone de saisie selon le contenu (plafonnée, puis scroll interne).
  // ui-kit peut imposer un min-height élevé aux <textarea> : on le neutralise avant
  // de mesurer scrollHeight, sinon la zone démarre bien plus haute qu'une ligne.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.setProperty("min-height", "0", "important");
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [draft]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    send(draft);
  }

  // Entrée = envoyer ; Maj+Entrée = nouvelle ligne.
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  }

  const peutVider = echanges.length > 0 || loading;

  // La conversation porte le travail en cours : on ne l'efface qu'après
  // confirmation explicite.
  function vider() {
    confirmation.close();
    clear();
  }

  const vide = echanges.length === 0 && !loading;

  // Zone de saisie, partagée entre l'état initial (centrée au milieu) et l'état
  // conversation (ancrée en bas) — même composant, deux emplacements.
  const composer = (
    <form onSubmit={submit} style={{ display: "flex", alignItems: "flex-end", gap: 8, width: "100%" }}>
      <textarea
        ref={inputRef}
        rows={1}
        aria-label="Demande RGP"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ex : je rentre d'un cambriolage, donne-moi un numéro de PV urgent"
        style={{ flex: 1, padding: "7px 14px", borderRadius: 22, border: "1px solid var(--c--globals--colors--gray-300, #ccc)", fontSize: 14, lineHeight: 1.4, resize: "none", overflowY: "auto", minHeight: 0, maxHeight: 160, fontFamily: "inherit", boxSizing: "border-box", display: "block" }}
      />
      <Button
        type="submit"
        disabled={loading}
        aria-label="Envoyer"
        icon={<span className="material-icons" aria-hidden>send</span>}
        style={{ width: 38, height: 38, minWidth: 38, padding: 0, borderRadius: "50%", flexShrink: 0 }}
      />
    </form>
  );

  const aide = (
    <div
      role="note"
      style={{
        display: "flex", gap: 12, alignItems: "flex-start",
        padding: "12px 16px", borderRadius: 10,
        border: "1px solid #cfd7f5", borderLeft: "4px solid #000091",
        background: "#f4f6ff", color: "#2a2a3a", fontSize: 13.5, lineHeight: 1.5,
      }}
    >
      <span className="material-icons" aria-hidden style={{ fontSize: 22, color: "#000091", flexShrink: 0, marginTop: 1 }}>
        lightbulb
      </span>
      <div>
        <strong style={{ display: "block", marginBottom: 4, color: "#000091" }}>
          Ce que l'assistant sait faire
        </strong>
        En langage naturel, sans quitter le tchat :
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
          <li><strong>Numéros de PV</strong> — créer un nouvel UNA, retrouver une procédure existante.</li>
          <li><strong>Suivi et statistiques</strong> — lister ou filtrer les procédures, obtenir une répartition.</li>
        </ul>
      </div>
    </div>
  );

  return (
    <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", padding: "1.5rem 2rem 1.5rem", width: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <h1 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 20, color: "#000091", margin: 0 }}>
          <span className="material-icons" aria-hidden style={{ fontSize: 22, lineHeight: 1 }}>support_agent</span>
          Assistant personnel - RGP
        </h1>
        <button
          type="button"
          onClick={confirmation.open}
          disabled={!peutVider}
          title="Effacer la conversation"
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 6,
            border: "1px solid var(--c--globals--colors--gray-300, #ddd)", background: "#fff",
            color: peutVider ? "inherit" : "var(--c--globals--colors--gray-400, #9a9a9a)",
            cursor: peutVider ? "pointer" : "default", fontSize: 14,
          }}
        >
          <span className="material-icons" aria-hidden style={{ fontSize: 18 }}>delete_outline</span>
          Vider
        </button>
      </div>

      {vide ? (
        // État initial (façon Claude / ChatGPT) : accueil + zone de saisie centrés au milieu.
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22, padding: "0 1rem" }}>
          <div style={{ textAlign: "center" }}>
            <span className="material-icons" aria-hidden style={{ fontSize: 44, color: "#000091" }}>support_agent</span>
            <h2 style={{ margin: "8px 0 0", fontSize: 22, color: "#161616", fontWeight: 700 }}>Comment puis-je vous aider ?</h2>
          </div>
          <div style={{ width: "min(760px, 100%)" }}>{composer}</div>
          <div style={{ width: "min(760px, 100%)" }}>{aide}</div>
        </div>
      ) : (
        // Conversation lancée : le fil de messages remonte, la saisie passe en bas.
        <>
          <div style={{ flex: 1, minHeight: 120, width: "100%", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, padding: "8px 4px" }}>
            {echanges.map((x) => (
              <Message key={x.id} x={x} />
            ))}
            <div ref={finRef} />
          </div>
          <div style={{ width: "100%", margin: "8px 0 0" }}>{composer}</div>
        </>
      )}

      <ModaleConfirmation
        ouverte={confirmation.isOpen}
        titre="Vider la conversation ?"
        libelleConfirmer="Vider la conversation"
        onConfirmer={vider}
        onAnnuler={confirmation.close}
      >
        Vider efface tous les échanges affichés, vos demandes comme les réponses
        de l'assistant, et abandonne le suivi d'une demande en cours. Les
        procédures déjà créées dans RGP ne sont pas touchées : seul l'historique
        de cette conversation disparaît.
      </ModaleConfirmation>
    </div>
  );
}
