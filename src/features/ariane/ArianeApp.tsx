import { useCallback, useState, useEffect } from "react";
import { Button, useModal } from "@gouvfr-lasuite/cunningham-react";
import ModaleConfirmation from "../../lib/ModaleConfirmation";
import { TAILLE_MAX_OCTETS } from "./arianeApi";
import { useAriane, setPieces, run, viderTout, setView, selectCote, ask, type ViewKey } from "./arianeStore";
import { evenementsToEntries, actesToEntries } from "./graph";
import DropZone from "../../lib/DropZone";
import SyntheseView from "./SyntheseView";
import PartiesView from "./PartiesView";
import Timeline from "./Timeline";
import Reseau from "./Reseau";
import ChatView from "./ChatView";

const TABS: { key: ViewKey; label: string; icon: string }[] = [
  { key: "synthese", label: "Synthèse", icon: "summarize" },
  { key: "parties", label: "Parties", icon: "groups" },
  { key: "faits", label: "Faits", icon: "event" },
  { key: "actes", label: "Actes", icon: "gavel" },
  { key: "reseau", label: "Réseau", icon: "hub" },
  { key: "questions", label: "Questions", icon: "forum" },
];

export default function ArianeApp() {
  const { pieces, running, statusLabel, progress, dossier, piecesIgnorees, avertissements, error, view, selectedCote, rag, messages, streaming } = useAriane();
  const confirmation = useModal();

  // Le dossier analysé s'ouvre sur une vue dédiée plein écran (comme la synthèse RENS ou
  // l'évaluation des avoirs). On y bascule dès que l'analyse rend son dossier ; le dépôt
  // garde un bouton « Voir le résultat » pour y revenir sans relancer.
  const [page, setPage] = useState<"depot" | "resultat">(dossier ? "resultat" : "depot");
  useEffect(() => { if (dossier) setPage("resultat"); }, [dossier]);

  // Cumul : les nouvelles pièces s'ajoutent aux précédentes, en écartant les doublons
  // (même nom ET même taille). Les fichiers > 20 Mo ou non-PDF sont déjà filtrés par DropZone.
  function ajouter(nouveaux: File[]) {
    const cle = (f: File) => `${f.name}::${f.size}`;
    const vus = new Set(pieces.map(cle));
    setPieces([...pieces, ...nouveaux.filter((f) => !vus.has(cle(f)))]);
  }
  function retirer(index: number) {
    setPieces(pieces.filter((_, i) => i !== index));
  }

  const handleCotes = useCallback((cotes: string[]) => selectCote(cotes[0]), []);

  // La purge du corpus RAG passe AVANT la réinitialisation : si elle échoue, viderTout
  // laisse l'écran en l'état et renseigne `error`. La zone de dépôt se recale seule sur
  // `pieces` (vidé par viderTout en cas de succès).
  async function vider() {
    confirmation.close();
    // viderTout ne renvoie true que si la purge a réussi et le dossier a disparu. En cas
    // d'échec, on RESTE sur la vue résultat (dossier intact) avec l'erreur affichée.
    if (await viderTout()) setPage("depot");
  }

  // Le bandeau d'avertissements (pièces écartées, remarques) accompagne le dossier.
  const avertissementsBloc = dossier && (piecesIgnorees.length > 0 || avertissements.length > 0) && (
    <div role="alert" style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "0 0 16px", padding: "12px 14px", border: "1px solid #ffca00", borderLeft: "4px solid #ffca00", background: "#fff8e5", borderRadius: 4 }}>
      <span className="material-icons" aria-hidden style={{ color: "#b34000", fontSize: 20 }}>warning</span>
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>
        {piecesIgnorees.length > 0 && (
          <>
            <strong>Analyse incomplète.</strong>{" "}
            {piecesIgnorees.length} pièce(s) n'ont pas pu être exploitées : le dossier ne porte que sur{" "}
            {progress.total - piecesIgnorees.length} pièce sur {progress.total}. Relancez l'analyse pour les intégrer.
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {piecesIgnorees.map((p) => (<li key={p.cote}>{p.cote} — {p.raison}</li>))}
            </ul>
          </>
        )}
        {avertissements.length > 0 && (
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {avertissements.map((a) => (<li key={a}>{a}</li>))}
          </ul>
        )}
      </div>
    </div>
  );

  const modale = (
    <ModaleConfirmation
      ouverte={confirmation.isOpen}
      titre="Vider le dossier et purger le corpus ?"
      libelleConfirmer="Vider et purger"
      onConfirmer={vider}
      onAnnuler={confirmation.close}
    >
      Vider efface le dossier analysé — synthèse, parties, lignes de temps,
      réseau — et supprime les pièces indexées du corpus RAG, sur le serveur.
      Cette suppression est irréversible : l'onglet Questions ne répondra plus,
      et reconstituer le dossier suppose de redéposer toutes les pièces et de
      relancer l'analyse complète.
    </ModaleConfirmation>
  );

  // Vue RÉSULTAT plein écran : bouton retour au dépôt (haut gauche), Vider (haut droite),
  // puis les onglets d'exploration du dossier.
  if (page === "resultat" && dossier) {
    return (
      <div style={{ height: "100%", overflowY: "auto", padding: "1.5rem 2rem 2rem", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          <Button variant="tertiary" color="neutral" size="small" onClick={() => setPage("depot")}
            icon={<span className="material-icons" aria-hidden>arrow_back</span>}>
            Retour au dépôt
          </Button>
          <button type="button" onClick={confirmation.open}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontSize: 14 }}>
            <span className="material-icons" aria-hidden style={{ fontSize: 18 }}>delete_outline</span>
            Vider
          </button>
        </div>

        {error && view !== "questions" && (
          <p role="alert" style={{ color: "#e1000f", margin: "0 0 16px" }}>{error}</p>
        )}
        {avertissementsBloc}

        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #e5e5e5", margin: "0 0 16px", flexWrap: "wrap" }}>
          {TABS.map((t) => {
            // Un seul comportement, quelle que soit la cause (RAG non configuré, purge en échec,
            // ingestions toutes en erreur) : rien d'indexé, onglet grisé.
            const inactif = t.key === "questions" && rag.indexees === 0;
            return (
              <button key={t.key} type="button" onClick={() => setView(t.key)}
                disabled={inactif}
                title={inactif ? "Aucune pièce indexée" : undefined}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: 14,
                  cursor: inactif ? "not-allowed" : "pointer", opacity: inactif ? 0.4 : 1,
                  border: "none", background: "none", borderBottom: "2px solid " + (view === t.key ? "#000091" : "transparent"),
                  color: view === t.key ? "#000091" : "#5b5b6b", fontWeight: view === t.key ? 700 : 500,
                }}>
                <span className="material-icons" aria-hidden style={{ fontSize: 18 }}>{t.icon}</span> {t.label}
              </button>
            );
          })}
        </div>

        {selectedCote && (
          <p style={{ fontSize: 13, margin: "0 0 12px", color: "#000091" }}>
            Cote sélectionnée : <strong>{selectedCote}</strong>{" "}
            <button type="button" onClick={() => selectCote(undefined)} style={{ border: "none", background: "none", color: "#5b5b6b", cursor: "pointer", textDecoration: "underline", fontSize: 12 }}>désélectionner</button>
          </p>
        )}

        <div style={{ minHeight: 420 }}>
          {view === "synthese" && <SyntheseView dossier={dossier} />}
          {view === "parties" && <PartiesView dossier={dossier} />}
          {view === "faits" && <Timeline entries={evenementsToEntries(dossier)} onSelectCote={selectCote} selectedCote={selectedCote} />}
          {view === "actes" && <Timeline entries={actesToEntries(dossier)} onSelectCote={selectCote} selectedCote={selectedCote} />}
          {view === "reseau" && <Reseau dossier={dossier} onSelectCotes={handleCotes} />}
          {view === "questions" && <ChatView messages={messages} streaming={streaming} rag={rag} erreur={error} onAsk={ask} />}
        </div>

        {modale}
      </div>
    );
  }

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "2rem", boxSizing: "border-box" }}>
      <h1 style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 24, color: "#000091", marginTop: 0, marginBottom: 6 }}>
        <span className="material-icons" aria-hidden style={{ color: "#000091" }}>account_tree</span>
        Analyse de procédure — Ariane
      </h1>
      <p style={{ margin: "0 0 1rem", color: "#5b5b6b", lineHeight: 1.5 }}>
        Déposez les pièces d'une procédure (PDF). L'outil en extrait une synthèse, les parties prenantes, deux lignes de temps (faits et actes) et le réseau relationnel. Aide à la lecture — ne remplace pas le dossier.
      </p>

      <div style={{ marginBottom: 12 }}>
        <DropZone onFiles={ajouter} files={pieces} onRemove={retirer} disabled={running}
          accept=".pdf" maxBytes={TAILLE_MAX_OCTETS} multiple
          quoi="les pièces PDF de la procédure" hint="PDF uniquement · 20 Mo max par pièce" />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, marginBottom: 12 }}>
        {pieces.length > 0 && !running && !dossier && (
          <span style={{ fontSize: 13, color: "#5b5b6b", marginRight: "auto" }}>{pieces.length} pièce(s) prête(s).</span>
        )}
        {/* Le dossier existe déjà : on peut le rouvrir (vue plein écran) sans relancer. */}
        {dossier && !running && (
          <Button type="button" variant="secondary" onClick={() => setPage("resultat")}
            icon={<span className="material-icons" aria-hidden>visibility</span>}>
            Voir le résultat
          </Button>
        )}
        <Button type="button" onClick={() => run()} disabled={!pieces.length || running}
          icon={<span className="material-icons" aria-hidden>auto_awesome</span>}>
          {running ? "Analyse en cours…" : "Analyser"}
        </Button>
      </div>

      {running && (
        <div role="status" style={{ margin: "0 0 16px" }}>
          <p style={{ fontSize: 14, color: "#000091", margin: "0 0 6px" }}>{statusLabel} {progress.total > 0 ? `(${progress.done}/${progress.total})` : ""}</p>
          <div style={{ height: 6, background: "#ececff", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: progress.total ? `${Math.round((progress.done / progress.total) * 100)}%` : "0%", background: "#000091", transition: "width .3s" }} />
          </div>
        </div>
      )}

      {/* Sur l'onglet Questions, l'erreur est rendue par ChatView sous la conversation :
          on évite de l'afficher deux fois. Partout ailleurs, bandeau habituel. */}
      {error && !(dossier && view === "questions") && (
        <p role="alert" style={{ color: "#e1000f", margin: "0 0 16px" }}>{error}</p>
      )}

    </div>
  );
}
