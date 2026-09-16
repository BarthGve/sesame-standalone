import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Button, useModal } from "@gouvfr-lasuite/cunningham-react";
import ModaleConfirmation from "../../lib/ModaleConfirmation";
import FicheList, { frDate } from "./FicheList";
import SyntheseView from "./SyntheseView";
import AideSynthese from "./AideSynthese";
import {
  fetchReferentielListes, fetchCommunes, fetchFicheById,
  type GgdRef, type CommuneRef, type Fiche,
} from "./rensApi";
import {
  useRens, setFilters, loadFiches, ensureDay, runSynthese, clearSynthese,
  setPage, select, PAGE_SIZE, type RensState,
} from "./rensStore";
import { useFrsUi, setContexte, setFocusFrs, naviguerVersFiche } from "../frs/frsUiStore";
import { fetchFicheAudit } from "../qualite/qualiteApi";
import { R, Icone, Puce, Champ, page, panel, panelHead, panelBody, field, fieldFocus, chip } from "./ui";

const MAX_MOTS_FILTRE = 5;

function useFocusStyle() {
  const [focus, setFocus] = useState(false);
  return {
    style: focus ? { ...field, ...fieldFocus } : field,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
  };
}

// Autocomplete communes depuis ref_commune : jamais les 35k d'un coup.
function CommuneAutocomplete({
  value, codeDept, onChange,
}: {
  value: string;
  codeDept: string;
  onChange: (nom: string) => void;
}) {
  const uid = useId();
  const listId = `${uid}-communes`;
  const wrap = useRef<HTMLDivElement>(null);
  const [saisie, setSaisie] = useState(value);
  const [suggestions, setSuggestions] = useState<CommuneRef[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const foc = useFocusStyle();

  useEffect(() => { setSaisie(value); }, [value]);

  useEffect(() => {
    const q = saisie.trim();
    const pret = codeDept ? q.length >= 1 : q.length >= 2;
    if (!pret) { setSuggestions([]); return; }
    let vivant = true;
    const t = window.setTimeout(() => {
      fetchCommunes({ codeDept: codeDept || undefined, q, limit: 20 })
        .then((rows) => { if (vivant) setSuggestions(rows); })
        .catch(() => { if (vivant) setSuggestions([]); });
    }, 220);
    return () => { vivant = false; window.clearTimeout(t); };
  }, [saisie, codeDept]);

  useEffect(() => {
    function dehors(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOuvert(false);
    }
    document.addEventListener("mousedown", dehors);
    return () => document.removeEventListener("mousedown", dehors);
  }, []);

  function choisir(nom: string) {
    setSaisie(nom);
    onChange(nom);
    setOuvert(false);
  }

  return (
    <div ref={wrap} style={{ position: "relative", width: "100%" }}>
      <div style={{ position: "relative" }}>
        <span style={{
          position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
          pointerEvents: "none", display: "flex",
        }}>
          <Icone nom="place" taille={16} couleur={R.muted} />
        </span>
        <input
          type="text"
          aria-label="Commune"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={ouvert && suggestions.length > 0}
          placeholder={codeDept ? "Commune du GGD…" : "≥ 2 lettres…"}
          value={saisie}
          onChange={(e) => {
            setSaisie(e.target.value);
            onChange(e.target.value);
            setOuvert(true);
          }}
          onFocus={() => { foc.onFocus(); setOuvert(true); }}
          onBlur={foc.onBlur}
          style={{ ...foc.style, width: "100%", paddingLeft: 32 }}
        />
      </div>
      {ouvert && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Suggestions de communes"
          style={{
            position: "absolute", zIndex: 30, left: 0, right: 0, top: "calc(100% + 4px)",
            margin: 0, padding: 4, listStyle: "none",
            maxHeight: 240, overflowY: "auto",
            background: R.surface, border: `1px solid ${R.border}`, borderRadius: R.radiusSm,
            boxShadow: R.shadow,
          }}
        >
          {suggestions.map((c) => (
            <li key={c.code_insee} role="option">
              <button
                type="button"
                onClick={() => choisir(c.nom)}
                style={{
                  display: "flex", width: "100%", textAlign: "left", alignItems: "baseline", gap: 8,
                  border: "none", background: "none", cursor: "pointer",
                  padding: "8px 10px", fontSize: 13, color: R.text, borderRadius: 6,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = R.brandWash; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
              >
                <span style={{ flex: 1 }}>{c.nom}</span>
                {!codeDept && (
                  <span style={{ color: R.muted, fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
                    {c.code_dept}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FicheDetail({
  f, onClose, lienControle = false,
}: {
  f: NonNullable<RensState["selected"]>;
  onClose: () => void;
  /** Affiche le lien vers l'onglet Contrôle si un audit existe pour cette fiche. */
  lienControle?: boolean;
}) {
  const motVisible = (m: string) => !m.startsWith("signal-faible:") && !m.startsWith("defaut:");
  const [auditDispo, setAuditDispo] = useState<boolean | null>(null);

  useEffect(() => {
    function esc(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  useEffect(() => {
    if (!lienControle) return;
    let vivant = true;
    setAuditDispo(null);
    fetchFicheAudit(f.date_redaction, f.id)
      .then(() => { if (vivant) setAuditDispo(true); })
      .catch(() => { if (vivant) setAuditDispo(false); });
    return () => { vivant = false; };
  }, [lienControle, f.id, f.date_redaction]);

  function allerAuControle() {
    naviguerVersFiche({
      onglet: "controle",
      frsId: f.id,
      jour: f.date_redaction,
      ggd: f.code_ggd,
    });
    onClose();
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(22,22,29,.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, zIndex: 50, backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Détail de la fiche"
        aria-modal
        style={{
          background: R.surface, borderRadius: R.radius, maxWidth: 680, width: "100%",
          maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column",
          boxShadow: "0 24px 64px rgba(22,22,29,.28)",
          borderTop: `3px solid ${R.brand}`,
        }}
      >
        <header style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12,
          padding: "16px 20px", borderBottom: `1px solid ${R.border}`,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", fontSize: 12, color: R.muted, marginBottom: 8 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icone nom="event" taille={14} couleur={R.muted} />{frDate(f.date_redaction)}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icone nom="shield" taille={14} couleur={R.muted} />{f.code_ggd}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icone nom="apartment" taille={14} couleur={R.muted} />{f.unite}
              </span>
              {f.commune && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Icone nom="place" taille={14} couleur={R.muted} />{f.commune}
                </span>
              )}
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: R.text, margin: 0, lineHeight: 1.3, letterSpacing: -0.2 }}>
              {f.titre}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            style={{
              border: `1px solid ${R.border}`, background: R.surfaceInset, cursor: "pointer",
              color: R.muted, borderRadius: 8, width: 36, height: 36,
              display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}
          >
            <Icone nom="close" taille={20} couleur={R.muted} />
          </button>
        </header>
        <div style={{ padding: "18px 20px", overflowY: "auto", flex: 1 }}>
          <p style={{
            fontSize: 14.5, lineHeight: 1.65, color: R.text, whiteSpace: "pre-wrap", margin: "0 0 16px",
          }}>
            {f.texte}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: lienControle ? 16 : 0 }}>
            {f.mots_cles.filter(motVisible).map((m) => <Puce key={m}>{m}</Puce>)}
          </div>
          {lienControle && auditDispo === true && (
            <button
              type="button"
              onClick={allerAuControle}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "8px 14px", borderRadius: R.radiusSm,
                border: `1px solid ${R.brand}`, background: R.brandSoft, color: R.brand,
                fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <Icone nom="fact_check" taille={18} couleur={R.brand} />
              Voir le contrôle de cette fiche
            </button>
          )}
          {lienControle && auditDispo === false && (
            <p style={{ margin: 0, fontSize: 12, color: R.muted }}>
              Aucun écart d&apos;audit pour cette fiche sur sa journée de rédaction.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SelectAvecIcone({
  value, onChange, ariaLabel, children, minWidth = 160,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  children: React.ReactNode;
  minWidth?: number;
}) {
  const foc = useFocusStyle();
  return (
    <div style={{ position: "relative", width: "100%", minWidth }}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={foc.onFocus}
        onBlur={foc.onBlur}
        style={{
          ...foc.style, width: "100%", appearance: "none", WebkitAppearance: "none",
          paddingRight: 32, cursor: "pointer",
        }}
      >
        {children}
      </select>
      <span style={{
        position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
        pointerEvents: "none", display: "flex",
      }}>
        <Icone nom="expand_more" taille={18} couleur={R.muted} />
      </span>
    </div>
  );
}

const btnGhost: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "8px 12px", borderRadius: R.radiusSm,
  border: `1px solid ${R.borderStrong}`, background: R.surface,
  cursor: "pointer", fontSize: 13, color: R.text, fontFamily: "inherit",
};

const btnPage: CSSProperties = {
  ...btnGhost,
  padding: "6px 12px",
  minWidth: 36,
  justifyContent: "center",
};

/**
 * @param embed    Sans en-tête page (monté dans FrsApp).
 * @param section  all = historique ; flux | synthese = panneau isolé pour FrsApp.
 */
export default function RensApp({
  embed = false,
  section = "all",
}: {
  embed?: boolean;
  section?: "all" | "flux" | "synthese";
} = {}) {
  const s = useRens();
  const [fluxOpen, setFluxOpen] = useState(true);
  const [view, setView] = useState<"flux" | "synthese">(section === "synthese" ? "synthese" : "flux");
  const [aideOuverte, setAideOuverte] = useState(false);
  const [ggds, setGgds] = useState<GgdRef[]>([]);
  const [catalogueMots, setCatalogueMots] = useState<string[]>([]);
  const confirmation = useModal();
  const idDate = useId();
  const idRecherche = useId();
  const focDate = useFocusStyle();
  const focQ = useFocusStyle();

  const frsUi = useFrsUi();

  useEffect(() => { ensureDay(); }, []);
  useEffect(() => {
    if (section === "synthese") setView("synthese");
    else if (section === "flux") setView("flux");
  }, [section]);

  // Contexte partagé FrsApp : appliquer jour/GGD venant du Contrôle (ou d'une session précédente).
  useEffect(() => {
    if (!embed) return;
    const patch: { date?: string; ggd?: string; commune?: string } = {};
    if (frsUi.jour && frsUi.jour !== s.filters.date) patch.date = frsUi.jour;
    if ((frsUi.ggd || "") !== (s.filters.ggd || "")) {
      patch.ggd = frsUi.ggd;
      // GGD changé depuis l'extérieur → la commune n'est plus valide.
      if (frsUi.ggd !== (s.filters.ggd || "")) patch.commune = "";
    }
    if (Object.keys(patch).length) setFilters(patch);
    // Si le flux a une date et le contexte n'en a pas, on pousse vers le store partagé.
    if (!frsUi.jour && s.filters.date) setContexte({ jour: s.filters.date });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync depuis frsUi uniquement
  }, [embed, frsUi.jour, frsUi.ggd]);

  // Navigation croisée Contrôle → Flux : ouvrir la fiche ciblée.
  useEffect(() => {
    if (!embed || section !== "flux" || frsUi.focusFrsId == null) return;
    const id = frsUi.focusFrsId;
    let vivant = true;
    fetchFicheById(id)
      .then((fiche: Fiche) => {
        if (!vivant) return;
        select(fiche);
        setFocusFrs(null);
      })
      .catch(() => {
        if (vivant) setFocusFrs(null);
      });
    return () => { vivant = false; };
  }, [embed, section, frsUi.focusFrsId]);

  useEffect(() => {
    let vivant = true;
    fetchReferentielListes()
      .then((r) => {
        if (!vivant) return;
        setGgds(r.ggd);
        setCatalogueMots(r.mots_cles);
      })
      .catch(() => {
        if (!vivant) return;
        setGgds([]);
        setCatalogueMots([]);
      });
    return () => { vivant = false; };
  }, []);

  const motsKey = (s.filters.mots ?? []).join("|");
  useEffect(() => { loadFiches(); }, [s.filters.date, s.filters.ggd, s.filters.commune, s.filters.q, motsKey, s.page]);

  const codeDeptGgd = ggds.find((g) => g.code === s.filters.ggd)?.code_dept ?? "";
  const motsSelectionnes = s.filters.mots ?? [];
  const filtresActifs = !!(s.filters.ggd || s.filters.commune || s.filters.q || motsSelectionnes.length);

  function choisirGgd(code: string) {
    setFilters({ ggd: code, commune: "" });
    if (embed) setContexte({ ggd: code });
  }

  function ajouterMot(mot: string) {
    if (!mot || motsSelectionnes.includes(mot)) return;
    if (motsSelectionnes.length >= MAX_MOTS_FILTRE) return;
    setFilters({ mots: [...motsSelectionnes, mot] });
  }

  function retirerMot(mot: string) {
    setFilters({ mots: motsSelectionnes.filter((m) => m !== mot) });
  }

  function aujourdhui() {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    const iso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    setFilters({ date: iso });
    if (embed) setContexte({ jour: iso });
  }

  function changerDate(date: string) {
    setFilters({ date });
    if (embed) setContexte({ jour: date || null });
  }

  function openSynthese() {
    if (section === "all") setView("synthese");
    if (!s.markdown && !s.pending) runSynthese();
  }

  const pages = Math.max(1, Math.ceil(s.total / PAGE_SIZE));
  const from = s.total === 0 ? 0 : s.page * PAGE_SIZE + 1;
  const to = Math.min((s.page + 1) * PAGE_SIZE, s.total);

  const montreFlux = section === "all" || section === "flux";
  const montreSynthesePanel = section === "all" || section === "synthese";

  // Vue plein écran synthèse (historique RensApp, ou panneau FrsApp).
  if (view === "synthese" && (section === "all" || section === "synthese")) {
    // En panneau FrsApp « synthese », on affiche d'abord le panneau d'actions ;
    // la vue plein écran s'ouvre une fois une synthèse lancée ou déjà présente.
    if (section === "all" || s.markdown || s.pending || s.synthError) {
      return (
        <div style={embed ? { minWidth: 0 } : page}>
          <SyntheseView
            pending={s.pending}
            synthError={s.synthError}
            markdown={s.markdown}
            onBack={() => {
              if (section === "all") setView("flux");
              else setView("flux"); // no-op path if only synthese — keep panel
            }}
            onRetry={() => runSynthese()}
          />
        </div>
      );
    }
  }

  return (
    <div style={embed ? { minWidth: 0 } : page}>
      {/* En-tête de page (hors embed FrsApp) */}
      {!embed && (
        <header style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          gap: 16, marginBottom: 20, flexWrap: "wrap",
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span style={{
                width: 36, height: 36, borderRadius: 10, background: R.brandWash,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icone nom="policy" taille={22} />
              </span>
              <h1 style={{ fontSize: 22, fontWeight: 750, color: R.brand, margin: 0, letterSpacing: -0.3 }}>
                Analyste RENS
              </h1>
            </div>
            <p style={{ margin: "0 0 0 46px", fontSize: 13, color: R.muted, maxWidth: 480, lineHeight: 1.45 }}>
              Flux des fiches de renseignement, filtres sur les référentiels, synthèse et signaux faibles.
            </p>
          </div>
          <Button
            variant="tertiary"
            color="neutral"
            size="small"
            onClick={() => setAideOuverte(true)}
            icon={<span className="material-icons" aria-hidden>help_outline</span>}
          >
            Aide
          </Button>
        </header>
      )}

      {aideOuverte && <AideSynthese onClose={() => setAideOuverte(false)} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
        {/* Flux journalier */}
        {montreFlux && (fluxOpen || section === "flux") && (
          <section style={panel} aria-labelledby="rens-flux-titre">
            <div style={panelHead}>
              <Icone nom="feed" taille={22} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 id="rens-flux-titre" style={{ fontSize: 15, fontWeight: 700, color: R.text, margin: 0 }}>
                  Flux journalier
                </h2>
                <p style={{ margin: "2px 0 0", fontSize: 12.5, color: R.muted }}>
                  {filtresActifs
                    ? `${s.total} fiche${s.total > 1 ? "s" : ""} correspondant aux filtres`
                    : `Fiches du ${s.filters.date ? frDate(s.filters.date) : "jour"} — ${s.total} fiche${s.total > 1 ? "s" : ""}`}
                </p>
              </div>
              <span style={{
                ...chip, border: `1px solid ${R.border}`, background: R.surfaceInset, color: R.muted,
                fontVariantNumeric: "tabular-nums",
              }}>
                {s.total}
              </span>
              {section === "all" && (
                <Button
                  variant="tertiary"
                  color="neutral"
                  size="small"
                  onClick={() => setFluxOpen(false)}
                  aria-label="Réduire le flux journalier"
                  icon={<span className="material-icons" aria-hidden>expand_less</span>}
                />
              )}
            </div>

            <div style={panelBody}>
              {/* Barre de filtres structurée */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: 12,
                alignItems: "end",
                padding: 14,
                background: R.brandWash,
                borderRadius: R.radiusSm,
                border: `1px solid ${R.border}`,
              }}>
                <Champ label="Date" htmlFor={idDate} largeur="auto">
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      id={idDate}
                      type="date"
                      aria-label="Date de rédaction"
                      value={s.filters.date ?? ""}
                      onChange={(e) => changerDate(e.target.value)}
                      onFocus={focDate.onFocus}
                      onBlur={focDate.onBlur}
                      style={{ ...focDate.style, flex: 1, minWidth: 0 }}
                    />
                    <button type="button" onClick={aujourdhui} title="Aujourd'hui" style={{ ...btnGhost, flexShrink: 0 }}>
                      <Icone nom="today" taille={16} couleur={R.brand} />
                    </button>
                  </div>
                </Champ>

                <Champ label="GGD">
                  <SelectAvecIcone
                    ariaLabel="Groupement"
                    value={s.filters.ggd ?? ""}
                    onChange={choisirGgd}
                    minWidth={0}
                  >
                    <option value="">Tous les GGD</option>
                    {ggds.map((g) => (
                      <option key={g.code} value={g.code}>
                        {g.code} — {g.nom_departement}
                      </option>
                    ))}
                  </SelectAvecIcone>
                </Champ>

                <Champ label="Commune">
                  <CommuneAutocomplete
                    value={s.filters.commune ?? ""}
                    codeDept={codeDeptGgd}
                    onChange={(nom) => setFilters({ commune: nom })}
                  />
                </Champ>

                <Champ label="Mot-clé">
                  <SelectAvecIcone
                    ariaLabel="Ajouter un mot-clé"
                    value=""
                    onChange={(v) => { if (v) ajouterMot(v); }}
                    minWidth={0}
                  >
                    <option value="">
                      {motsSelectionnes.length >= MAX_MOTS_FILTRE
                        ? `Max. ${MAX_MOTS_FILTRE} atteints`
                        : "Choisir…"}
                    </option>
                    {catalogueMots
                      .filter((m) => !motsSelectionnes.includes(m))
                      .map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                  </SelectAvecIcone>
                </Champ>

                <Champ label="Recherche libre" htmlFor={idRecherche} largeur="auto">
                  <div style={{ position: "relative" }}>
                    <span style={{
                      position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
                      pointerEvents: "none", display: "flex",
                    }}>
                      <Icone nom="search" taille={16} couleur={R.muted} />
                    </span>
                    <input
                      id={idRecherche}
                      type="search"
                      aria-label="Recherche"
                      placeholder="Unité, texte, GGD…"
                      value={s.filters.q ?? ""}
                      onChange={(e) => setFilters({ q: e.target.value })}
                      onFocus={focQ.onFocus}
                      onBlur={focQ.onBlur}
                      style={{ ...focQ.style, width: "100%", paddingLeft: 32, minWidth: 160 }}
                    />
                  </div>
                </Champ>

                {filtresActifs && (
                  <div style={{ display: "flex", alignItems: "end" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setFilters({ ggd: "", commune: "", q: "", mots: [] });
                        if (embed) setContexte({ ggd: "" });
                      }}
                      style={{ ...btnGhost, width: "100%", justifyContent: "center", color: R.brand }}
                    >
                      <Icone nom="filter_alt_off" taille={16} couleur={R.brand} />
                      Effacer
                    </button>
                  </div>
                )}
              </div>

              {motsSelectionnes.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }} aria-label="Mots-clés sélectionnés">
                  <span style={{ fontSize: 12, color: R.muted, fontWeight: 600 }}>Mots-clés :</span>
                  {motsSelectionnes.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => retirerMot(m)}
                      title="Retirer ce mot-clé"
                      style={{ ...chip, cursor: "pointer", fontFamily: "inherit" }}
                    >
                      {m}
                      <Icone nom="close" taille={14} couleur={R.brand} />
                    </button>
                  ))}
                </div>
              )}

              <FicheList
                fiches={s.fiches}
                loading={s.loadingList}
                error={s.listError}
                onSelect={select}
              />

              {s.total > 0 && (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 12, flexWrap: "wrap", paddingTop: 4,
                  borderTop: `1px solid ${R.border}`,
                }}>
                  <span style={{ fontSize: 13, color: R.muted, fontVariantNumeric: "tabular-nums" }}>
                    {from}–{to} sur {s.total}
                  </span>
                  {s.total > PAGE_SIZE && (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <button
                        type="button"
                        onClick={() => setPage(s.page - 1)}
                        disabled={s.page === 0}
                        aria-label="Page précédente"
                        style={{
                          ...btnPage,
                          opacity: s.page === 0 ? 0.4 : 1,
                          cursor: s.page === 0 ? "default" : "pointer",
                        }}
                      >
                        <Icone nom="chevron_left" taille={18} couleur={R.text} />
                      </button>
                      <span style={{
                        fontSize: 13, color: R.muted, minWidth: 48, textAlign: "center",
                        fontVariantNumeric: "tabular-nums",
                      }}>
                        {s.page + 1} / {pages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPage(s.page + 1)}
                        disabled={s.page + 1 >= pages}
                        aria-label="Page suivante"
                        style={{
                          ...btnPage,
                          opacity: s.page + 1 >= pages ? 0.4 : 1,
                          cursor: s.page + 1 >= pages ? "default" : "pointer",
                        }}
                      >
                        <Icone nom="chevron_right" taille={18} couleur={R.text} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Synthèse */}
        {montreSynthesePanel && (
          <section style={panel} aria-labelledby="rens-synth-titre">
            <div style={panelHead}>
              {section === "all" && !fluxOpen && (
                <Button
                  variant="tertiary"
                  color="neutral"
                  size="small"
                  onClick={() => setFluxOpen(true)}
                  aria-label="Afficher le flux journalier"
                  icon={<span className="material-icons" aria-hidden>feed</span>}
                />
              )}
              <Icone nom="auto_awesome" taille={22} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 id="rens-synth-titre" style={{ fontSize: 15, fontWeight: 700, color: R.text, margin: 0 }}>
                  Synthèse & signaux faibles
                </h2>
                <p style={{ margin: "2px 0 0", fontSize: 12.5, color: R.muted }}>
                  Panorama de la veille et phénomènes discrets émergents
                </p>
              </div>
            </div>
            <div style={panelBody}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}>
                <div style={{
                  padding: "12px 14px", borderRadius: R.radiusSm,
                  background: R.brandWash, border: `1px solid ${R.border}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <Icone nom="insights" taille={18} />
                    <strong style={{ fontSize: 13, color: R.text }}>Synthèse</strong>
                  </div>
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: R.muted }}>
                    Volume, sujets dominants, zones et unités les plus concernées, évolution
                    par rapport à l&apos;avant-veille.
                  </p>
                </div>
                <div style={{
                  padding: "12px 14px", borderRadius: R.radiusSm,
                  background: R.surfaceInset, border: `1px solid ${R.border}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <Icone nom="radar" taille={18} couleur={R.muted} />
                    <strong style={{ fontSize: 13, color: R.text }}>Signaux faibles</strong>
                  </div>
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: R.muted }}>
                    Phénomènes discrets mais récurrents sur plusieurs départements — invisibles
                    fiche par fiche, reliés par l&apos;outil.
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                {s.markdown && (
                  <button type="button" onClick={confirmation.open} style={btnGhost}>
                    <Icone nom="delete_outline" taille={18} couleur={R.muted} />
                    Vider
                  </button>
                )}
                <Button
                  type="button"
                  onClick={() => {
                    if (section === "synthese") {
                      // Ouvre la vue résultat / lance l'analyse.
                      setView("synthese");
                      if (!s.markdown && !s.pending) runSynthese();
                    } else {
                      openSynthese();
                    }
                  }}
                  disabled={s.pending}
                  icon={
                    <span className="material-icons" aria-hidden>
                      {s.markdown ? "visibility" : "auto_awesome"}
                    </span>
                  }
                >
                  {s.pending ? "Analyse…" : s.markdown ? "Voir la synthèse" : "Générer la synthèse"}
                </Button>
              </div>
            </div>
          </section>
        )}
      </div>

      {s.selected && (
        <FicheDetail
          f={s.selected}
          onClose={() => select(null)}
          lienControle={embed}
        />
      )}

      <ModaleConfirmation
        ouverte={confirmation.isOpen}
        titre="Vider la synthèse ?"
        libelleConfirmer="Vider la synthèse"
        onConfirmer={() => { confirmation.close(); clearSynthese(); }}
        onAnnuler={confirmation.close}
      >
        Vider efface la synthèse et les signaux faibles affichés. Les fiches ne sont pas touchées.
      </ModaleConfirmation>
    </div>
  );
}
