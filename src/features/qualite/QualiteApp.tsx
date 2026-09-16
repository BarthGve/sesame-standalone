import { useEffect, useState, type CSSProperties } from "react";
import { fetchRapport, fetchFicheAudit, type Rapport, type FicheDetail } from "./qualiteApi";
import { filtrerParFile, LIBELLE_FILE, nombrePages, page as pageDe, PAR_PAGE, type File } from "./qualiteStore";
import { RapportEntete } from "./RapportEntete";
import { FicheDetailVue } from "./FicheDetailVue";
import { VueUnite } from "./VueUnite";
import { EncartMethode } from "./EncartMethode";
import { AnalyseDemande } from "./AnalyseDemande";
import { RedactionFrs } from "./RedactionFrs";
import { fetchReferentielListes, type GgdRef } from "../rens/rensApi";
import { useFrsUi, setContexte, setFocusFrs } from "../frs/frsUiStore";
import { C, Encart, Icone, Onglets, Puce, champ, page } from "./ui";

const MESSAGES: Record<string, string> = {
  no_run: "Aucun audit n'a encore été produit pour cette journée. Le contrôle nocturne n'est peut-être pas passé.",
  db_error: "Le rapport n'a pas pu être chargé (erreur base de données).",
};

// Chaque file appelle un geste différent : supprimer, corriger, surveiller. La couleur suit
// la gravité, elle n'est pas décorative.
const TEINTE_FILE: Record<File, { texte: string; fond: string; icone: string }> = {
  toutes: { texte: C.bleu, fond: C.bleuBadge, icone: "list" },
  supprimer: { texte: C.bloquant, fond: C.bloquantFond, icone: "delete_forever" },
  corriger: { texte: C.majeur, fond: C.majeurFond, icone: "edit_note" },
  surveiller: { texte: C.mineur, fond: C.mineurFond, icone: "visibility" },
};

export type QualiteMode = "full" | "controle" | "analyse" | "rediger";

/**
 * @param embed  Sans en-tête page (monté dans FrsApp).
 * @param mode   full = comportement historique ; controle / analyse / rediger = panneaux isolés.
 */
export function QualiteApp({
  embed = false,
  mode = "full",
}: {
  embed?: boolean;
  mode?: QualiteMode;
} = {}) {
  const frsUi = useFrsUi();
  const [rapport, setRapport] = useState<Rapport | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [file, setFile] = useState<File>("toutes");
  const [rang, setRang] = useState(0);
  // En embed : initialisé depuis le contexte partagé Flux ↔ Contrôle.
  const [jour, setJour] = useState<string | null>(() => (embed ? frsUi.jour : null));
  const [ggd, setGgd] = useState(() => (embed ? frsUi.ggd : ""));
  const [ggds, setGgds] = useState<GgdRef[]>([]);
  const [vue, setVue] = useState<"fiches" | "unites" | "analyse" | "rediger">(
    mode === "analyse" ? "analyse" : mode === "rediger" ? "rediger" : "fiches",
  );
  const [ouverte, setOuverte] = useState<number | null>(null);
  const [detail, setDetail] = useState<FicheDetail | null>(null);

  // Mode isolé (FrsApp) : force la vue du panneau.
  useEffect(() => {
    if (mode === "analyse") setVue("analyse");
    else if (mode === "rediger") setVue("rediger");
    else if (mode === "controle") setVue((v) => (v === "analyse" || v === "rediger" ? "fiches" : v));
  }, [mode]);

  // Contexte partagé : le Flux peut avoir changé jour/GGD pendant qu'on était ailleurs.
  useEffect(() => {
    if (!embed || mode !== "controle") return;
    if (frsUi.jour !== jour) setJour(frsUi.jour);
    if (frsUi.ggd !== ggd) setGgd(frsUi.ggd);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync depuis frsUi uniquement
  }, [embed, mode, frsUi.jour, frsUi.ggd]);

  // Select GGD depuis ref_ggd (même source que le Flux).
  useEffect(() => {
    if (!embed || mode !== "controle") return;
    let vivant = true;
    fetchReferentielListes()
      .then((r) => vivant && setGgds(r.ggd))
      .catch(() => vivant && setGgds([]));
    return () => { vivant = false; };
  }, [embed, mode]);

  useEffect(() => {
    let vivant = true;
    fetchRapport(jour, ggd)
      .then((r) => vivant && (setRapport(r), setErreur(null)))
      .catch((e) => vivant && (setErreur(e.message), setRapport(null)));
    return () => { vivant = false; };
  }, [jour, ggd]);

  useEffect(() => {
    if (ouverte == null || !rapport) return setDetail(null);
    let vivant = true;
    fetchFicheAudit(rapport.run.jour, ouverte).then((f) => vivant && setDetail(f)).catch(() => vivant && setDetail(null));
    return () => { vivant = false; };
  }, [ouverte, rapport]);

  // Navigation croisée Flux → Contrôle : ouvrir la fiche ciblée dans le rapport.
  useEffect(() => {
    if (!embed || mode !== "controle" || !rapport || frsUi.focusFrsId == null) return;
    const id = frsUi.focusFrsId;
    const toutes = filtrerParFile(rapport.fiches, "toutes");
    const idx = toutes.findIndex((f) => f.frs_id === id);
    if (idx >= 0) {
      setVue("fiches");
      setFile("toutes");
      setRang(Math.floor(idx / PAR_PAGE));
      setOuverte(id);
    }
    setFocusFrs(null);
  }, [embed, mode, rapport, frsUi.focusFrsId]);

  const lignes = rapport ? filtrerParFile(rapport.fiches, file) : [];
  const pages = nombrePages(lignes.length);
  const rangSur = Math.min(rang, pages - 1);
  const visibles = pageDe(lignes, rangSur);
  const premier = lignes.length === 0 ? 0 : rangSur * PAR_PAGE + 1;
  const dernier = Math.min((rangSur + 1) * PAR_PAGE, lignes.length);

  // Changer de file remet au premier rang : rester en page 3 d'une file qui n'en a qu'une
  // afficherait un écran vide sans dire pourquoi.
  const choisirFile = (f: File) => { setFile(f); setRang(0); setOuverte(null); };

  // Onglets internes : en mode full (page historique) les 4 ; en mode controle seulement
  // fiches / unités. En analyse|rediger isolés, pas d'onglets.
  const itemsOnglets = mode === "controle"
    ? [
        { cle: "fiches" as const, libelle: "Fiches à traiter", icone: "assignment" },
        { cle: "unites" as const, libelle: "Par unité", icone: "groups" },
      ]
    : [
        { cle: "fiches" as const, libelle: "Fiches à traiter", icone: "assignment" },
        { cle: "unites" as const, libelle: "Par unité", icone: "groups" },
        { cle: "analyse" as const, libelle: "Analyse à la demande", icone: "playlist_add_check" },
        { cle: "rediger" as const, libelle: "Rédiger", icone: "edit_note" },
      ];

  const onglets = (mode === "full" || mode === "controle") ? (
    <Onglets
      valeur={vue === "analyse" || vue === "rediger" ? "fiches" : vue}
      onChange={setVue}
      items={itemsOnglets}
    />
  ) : null;

  const shell: CSSProperties = embed
    ? { minWidth: 0 }
    : page;

  // Panneaux isolés (FrsApp) : pas besoin du rapport d'audit.
  if (mode === "analyse") {
    return <div style={shell}><AnalyseDemande /></div>;
  }
  if (mode === "rediger") {
    return <div style={shell}><RedactionFrs /></div>;
  }

  // Une erreur ne doit jamais ressembler à « tout est conforme » : hors analyse à la
  // demande, on n'affiche RIEN d'autre que le message.
  if (erreur || !rapport) {
    return (
      <div style={shell}>
        {!embed && (
          <h1 style={{ fontSize: 20, color: C.bleu, margin: "0 0 16px", display: "flex", alignItems: "center", gap: 8 }}>
            <Icone nom="fact_check" taille={22} couleur={C.bleu} />
            Qualité des FRS
          </h1>
        )}
        {erreur ? (
          <div style={{ margin: "0 0 16px" }}>
            <Encart ton="alerte">{MESSAGES[erreur] || "Le rapport n'a pas pu être chargé."}</Encart>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: C.gris, margin: "0 0 16px" }}>Chargement du rapport…</p>
        )}
        {mode === "full" && onglets}
        {mode === "full" && vue === "analyse" && <AnalyseDemande />}
        {mode === "full" && vue === "rediger" && <RedactionFrs />}
      </div>
    );
  }

  return (
    <div style={shell}>
      <RapportEntete rapport={rapport} />

      {/* <input type="date"> natif : localisé, accessible au clavier et validé par le
          navigateur, sans dépendance de sélecteur de dates à embarquer. */}
      <form
        style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "0 0 16px" }}
        onSubmit={(e) => e.preventDefault()}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.gris }}>
          Journée
          <input
            type="date"
            value={jour ?? rapport.run.jour}
            onChange={(e) => {
              const v = e.target.value;
              setJour(v);
              if (embed) setContexte({ jour: v || null });
            }}
            style={champ}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.gris }}>
          Groupement
          {embed && ggds.length > 0 ? (
            <select
              aria-label="Groupement"
              value={ggd}
              onChange={(e) => {
                setGgd(e.target.value);
                setContexte({ ggd: e.target.value });
              }}
              style={{ ...champ, minWidth: 200 }}
            >
              <option value="">Tous les GGD</option>
              {ggds.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.code} — {g.nom_departement}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              placeholder="Tous les GGD"
              value={ggd}
              onChange={(e) => {
                setGgd(e.target.value);
                if (embed) setContexte({ ggd: e.target.value });
              }}
              style={champ}
            />
          )}
        </label>
      </form>

      {onglets}

      {vue === "analyse" ? (
        <AnalyseDemande />
      ) : vue === "rediger" ? (
        <RedactionFrs />
      ) : vue === "unites" ? (
        <VueUnite unites={rapport.synthese.par_unite} />
      ) : rapport.synthese.fiches_non_conformes === 0 ? (
        <Encart>Aucune non-conformité relevée sur cette journée.</Encart>
      ) : (
        <>
          <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 14px" }}>
            {(Object.keys(LIBELLE_FILE) as File[]).map((f) => {
              const t = TEINTE_FILE[f];
              const actif = file === f;
              const n = filtrerParFile(rapport.fiches, f).length;
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={actif}
                  onClick={() => choisirFile(f)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 999,
                    border: `1px solid ${actif ? t.texte : C.bord}`,
                    background: actif ? t.fond : C.fond,
                    color: actif ? t.texte : C.gris,
                    fontWeight: actif ? 700 : 500, fontSize: 13, cursor: "pointer",
                  }}
                >
                  <Icone nom={t.icone} taille={16} couleur={actif ? t.texte : C.gris} />
                  {LIBELLE_FILE[f]}
                  <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.9 }}>({n})</span>
                </button>
              );
            })}
          </nav>

          {lignes.length === 0 ? (
            <Encart>Aucune fiche dans cette file.</Encart>
          ) : (
            <>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {visibles.map((f) => {
                const t = TEINTE_FILE[file];
                const ouvert = ouverte === f.frs_id;
                return (
                  <li key={f.frs_id}>
                    <button
                      type="button"
                      onClick={() => setOuverte(ouvert ? null : f.frs_id)}
                      aria-expanded={ouvert}
                      style={{
                        width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, color: C.texte,
                        border: `1px solid ${ouvert ? t.texte : C.bord}`,
                        borderLeft: `4px solid ${t.texte}`,
                        background: ouvert ? t.fond : C.fond,
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        {f.titre} — {f.unite} · {f.n_ecarts} écart{f.n_ecarts > 1 ? "s" : ""} · {f.criteres.join(", ")}
                      </span>
                      <Puce couleur={t.texte} fond={t.fond}>{f.gravite_max}</Puce>
                      <Icone nom={ouvert ? "expand_less" : "expand_more"} couleur={C.gris} />
                    </button>
                    {ouvert && detail && <FicheDetailVue fiche={detail} lienFlux={embed} />}
                  </li>
                );
              })}
            </ul>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 12, fontSize: 13, color: C.gris }}>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{premier} – {dernier} sur {lignes.length}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button type="button" onClick={() => { setRang(rangSur - 1); setOuverte(null); }} disabled={rangSur === 0}
                  style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${C.bord}`, background: C.fond,
                           cursor: rangSur === 0 ? "default" : "pointer", color: rangSur === 0 ? "#bbb" : C.texte, fontSize: 13 }}>
                  Précédent
                </button>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{rangSur + 1} / {pages}</span>
                <button type="button" onClick={() => { setRang(rangSur + 1); setOuverte(null); }} disabled={rangSur + 1 >= pages}
                  style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${C.bord}`, background: C.fond,
                           cursor: rangSur + 1 >= pages ? "default" : "pointer", color: rangSur + 1 >= pages ? "#bbb" : C.texte, fontSize: 13 }}>
                  Suivant
                </button>
              </div>
            </div>
            </>
          )}
        </>
      )}

      {/* rens-api se déploie séparément du front : un rens-api antérieur à T15 renvoie un
          rapport SANS bloc `methode`. La garde évite l'écran blanc le temps du décalage. */}
      {rapport.methode && <EncartMethode methode={rapport.methode} />}

      <p style={{ fontSize: 11, color: C.gris, marginTop: 20, borderTop: `1px solid ${C.bord}`, paddingTop: 10 }}>
        Diagnostic d'aide au contrôle. Ne vaut pas décision. Données et identités fictives.
      </p>
    </div>
  );
}
