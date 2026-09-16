import { useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@gouvfr-lasuite/cunningham-react";
import type { RapportAnalyse } from "./analyseApi";
import {
  analyserTexte, enregistrerFiche, fetchReferentiel, fetchCommunes,
  MAX_TEXTE, MAX_TITRE, MAX_MOTS_CLES,
  type Brouillon, type Referentiel, type CommuneRef, type GgdRef,
} from "./redactionApi";
import { useBrouillon, modifierBrouillon, reinitialiserBrouillon } from "./redactionStore";
import { FicheRapport } from "./FicheRapport";
import { C, Encart, Icone, Puce } from "./ui";

const MESSAGES: Record<string, string> = {
  SORTIE_ILLISIBLE: "Les agents n'ont pas rendu de résultat exploitable. Relancer l'analyse.",
  IAKA_TIMEOUT: "Le contrôle n'a pas abouti dans le temps imparti. Réessayer.",
  IAKA_UPSTREAM: "La plateforme d'analyse n'a pas répondu.",
  BROUILLON_INVALIDE: `Un titre et un texte d'au plus ${MAX_TEXTE} caractères sont requis.`,
  JOB_INCONNU: "Le contrôle a été interrompu côté serveur. Relancer l'analyse.",
};

const REF_VIDE: Referentiel = { ggd: [], unites: [], mots_cles: [] };

const feuille: CSSProperties = {
  background: C.fond,
  border: `1px solid ${C.bord}`,
  borderRadius: 12,
  borderTop: `3px solid ${C.bleu}`,
  boxShadow: "0 1px 2px rgba(22,22,29,.04), 0 8px 24px rgba(0,0,145,.04)",
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  overflow: "hidden",
};

const panneau: CSSProperties = {
  background: C.bleuClair,
  border: `1px solid ${C.bord}`,
  borderRadius: 12,
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 420,
  overflow: "hidden",
};

const champBase: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
  fontSize: 14,
  color: C.texte,
  background: "#F6F6F9",
  border: `1px solid ${C.bord}`,
  borderRadius: 8,
  padding: "10px 12px",
  outline: "none",
  transition: "border-color 120ms ease, box-shadow 120ms ease, background 120ms ease",
};

const champFocus: CSSProperties = {
  borderColor: C.bleu,
  background: C.fond,
  boxShadow: `0 0 0 3px ${C.bleuBadge}`,
};

function Champ({
  id, label, obligatoire, aide, children,
}: {
  id: string; label: string; obligatoire?: boolean; aide?: string; children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <label htmlFor={id} style={{ fontSize: 12.5, fontWeight: 700, color: C.texte, letterSpacing: 0.1 }}>
        {label}
        {obligatoire && <span style={{ color: C.bloquant, marginLeft: 4 }} aria-hidden>*</span>}
      </label>
      {children}
      {aide && <p style={{ margin: 0, fontSize: 12, color: C.gris, lineHeight: 1.4 }}>{aide}</p>}
    </div>
  );
}

function SelectFleche({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: "relative" }}>
      {children}
      <span style={{
        position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
        pointerEvents: "none", display: "flex",
      }}>
        <Icone nom="expand_more" taille={20} couleur={C.gris} />
      </span>
    </div>
  );
}

// Les appels sont injectables : les tests n'ont pas à repasser par le job asynchrone réel.
export function RedactionFrs({
  analyser = analyserTexte,
  enregistrer = enregistrerFiche,
  referentiel = fetchReferentiel,
  communes = fetchCommunes,
}: {
  analyser?: (b: Brouillon) => Promise<RapportAnalyse>;
  enregistrer?: (b: Brouillon) => Promise<number>;
  referentiel?: () => Promise<Referentiel>;
  communes?: (codeDept: string) => Promise<CommuneRef[]>;
} = {}) {
  const uid = useId();
  const idTitre = `${uid}-titre`;
  const idGgd = `${uid}-ggd`;
  const idUnite = `${uid}-unite`;
  const idCommune = `${uid}-commune`;
  const idTexte = `${uid}-texte`;
  const idMots = `${uid}-mots`;

  const [refs, setRefs] = useState<Referentiel>(REF_VIDE);
  const [listeCommunes, setListeCommunes] = useState<CommuneRef[]>([]);
  // Brouillon hors-composant + sessionStorage : survit aux changements d'onglet et au rechargement.
  const brouillon = useBrouillon();
  const [rapport, setRapport] = useState<RapportAnalyse | null>(null);
  const [perime, setPerime] = useState(false);
  const [encours, setEncours] = useState(false);
  const [enregEncours, setEnregEncours] = useState(false);
  const [erreurAnalyse, setErreurAnalyse] = useState<string | null>(null);
  const [erreurEnregistrement, setErreurEnregistrement] = useState<string | null>(null);
  const [idCree, setIdCree] = useState<number | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [filtreMot, setFiltreMot] = useState("");

  useEffect(() => {
    let vivant = true;
    referentiel()
      .then((r) => vivant && setRefs(r))
      .catch(() => vivant && setRefs(REF_VIDE));
    return () => { vivant = false; };
  }, [referentiel]);

  // Communes du département courant (filtrées côté API par code_dept du GGD).
  useEffect(() => {
    const ggd = refs.ggd.find((g) => g.code === brouillon.code_ggd);
    if (!ggd) { setListeCommunes([]); return; }
    let vivant = true;
    communes(ggd.code_dept)
      .then((c) => vivant && setListeCommunes(c))
      .catch(() => vivant && setListeCommunes([]));
    return () => { vivant = false; };
  }, [brouillon.code_ggd, refs.ggd, communes]);

  function modifier(champs: Partial<Brouillon>) {
    modifierBrouillon(champs);
    if (rapport) setPerime(true);
    setIdCree(null);
  }

  function choisirGgd(code: string) {
    const g: GgdRef | undefined = refs.ggd.find((x) => x.code === code);
    modifier({
      code_ggd: g?.code ?? "",
      departement: g?.nom_departement ?? "",
      // Changer de GGD invalide unité et commune.
      unite: "",
      commune: "",
    });
  }

  function basculerMot(mot: string) {
    const a = brouillon.mots_cles;
    if (a.includes(mot)) {
      modifier({ mots_cles: a.filter((m) => m !== mot) });
      return;
    }
    if (a.length >= MAX_MOTS_CLES) return;
    modifier({ mots_cles: [...a, mot] });
  }

  const unitesFiltrees = useMemo(
    () => refs.unites.filter((u) => u.code_ggd === brouillon.code_ggd),
    [refs.unites, brouillon.code_ggd],
  );

  const motsFiltres = useMemo(() => {
    const q = filtreMot.trim().toLowerCase();
    const base = q
      ? refs.mots_cles.filter((m) => m.toLowerCase().includes(q))
      : refs.mots_cles;
    return base.slice(0, 80);
  }, [refs.mots_cles, filtreMot]);

  const complet = brouillon.titre.trim() !== "" && brouillon.texte.trim() !== "";
  const rattache = brouillon.code_ggd && brouillon.unite && brouillon.commune;

  async function lancerAnalyse() {
    setEncours(true);
    setErreurAnalyse(null);
    setErreurEnregistrement(null);
    setRapport(null);
    setPerime(false);
    try {
      setRapport(await analyser(brouillon));
    } catch (e) {
      setErreurAnalyse((e as Error).message);
    } finally {
      setEncours(false);
    }
  }

  async function lancerEnregistrement() {
    setErreurEnregistrement(null);
    setEnregEncours(true);
    try {
      const id = await enregistrer(brouillon);
      setIdCree(id);
      reinitialiserBrouillon();
      setRapport(null);
      setPerime(false);
      setFiltreMot("");
    } catch (e) {
      setErreurEnregistrement((e as Error).message);
    } finally {
      setEnregEncours(false);
    }
  }

  const peutEnregistrer = rapport !== null || erreurAnalyse !== null;
  const fiche = rapport?.fiches[0] ?? null;
  const procheLimite = MAX_TEXTE - brouillon.texte.length < 400;

  const styleChamp = (cle: string, extra?: CSSProperties): CSSProperties => ({
    ...champBase,
    ...(focus === cle ? champFocus : null),
    ...extra,
  });

  const selectStyle = (cle: string, vide: boolean): CSSProperties => styleChamp(cle, {
    appearance: "none",
    WebkitAppearance: "none",
    paddingRight: 36,
    cursor: "pointer",
    color: vide ? C.gris : C.texte,
  });

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      {idCree !== null && (
        <div
          role="status"
          style={{
            display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
            background: C.succesFond, border: `1px solid ${C.succes}`, borderRadius: 10,
          }}
        >
          <span style={{
            width: 36, height: 36, borderRadius: 18, background: C.fond,
            display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Icone nom="check_circle" taille={22} couleur={C.succes} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.succes }}>
              Fiche enregistrée sous le numéro {idCree}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 13, color: C.texte }}>
              Elle sera contrôlée à nouveau lors de l'audit de la nuit.
            </p>
          </div>
        </div>
      )}

      <div
        className="redaction-frs-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 0.85fr)",
          gap: 16,
          alignItems: "start",
        }}
      >
        <article style={feuille} aria-label="Brouillon de FRS">
          <header style={{
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            padding: "14px 18px", borderBottom: `1px solid ${C.bord}`, background: C.fond,
          }}>
            <Icone nom="description" taille={22} couleur={C.bleu} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.texte }}>Brouillon de FRS</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: C.gris }}>
                GGD · unité · commune · mots-clés — même grille que l'audit nocturne
              </p>
            </div>
            <Puce couleur={C.bleu} fond={C.bleuBadge}>non enregistré</Puce>
          </header>

          <div style={{ padding: "18px 18px 8px", display: "flex", flexDirection: "column", gap: 16 }}>
            <Champ id={idTitre} label="Titre" obligatoire>
              <input
                id={idTitre}
                aria-label="Titre"
                placeholder="Objet de la fiche (faits, lieu, nature)"
                maxLength={MAX_TITRE}
                value={brouillon.titre}
                onChange={(e) => modifier({ titre: e.target.value })}
                onFocus={() => setFocus("titre")}
                onBlur={() => setFocus(null)}
                style={styleChamp("titre", { fontSize: 16, fontWeight: 600, padding: "12px 14px" })}
              />
            </Champ>

            {/* Cascade : GGD → unité → commune */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
            }}>
              <Champ id={idGgd} label="GGD" obligatoire aide="Groupement de gendarmerie départementale">
                <SelectFleche>
                  <select
                    id={idGgd}
                    aria-label="GGD"
                    value={brouillon.code_ggd}
                    onChange={(e) => choisirGgd(e.target.value)}
                    onFocus={() => setFocus("ggd")}
                    onBlur={() => setFocus(null)}
                    style={selectStyle("ggd", !brouillon.code_ggd)}
                  >
                    <option value="">Choisir un GGD…</option>
                    {refs.ggd.map((g) => (
                      <option key={g.code} value={g.code}>
                        {g.code} — {g.nom_departement}
                      </option>
                    ))}
                  </select>
                </SelectFleche>
              </Champ>

              <Champ id={idUnite} label="Unité" obligatoire>
                <SelectFleche>
                  <select
                    id={idUnite}
                    aria-label="Unité"
                    value={brouillon.unite}
                    disabled={!brouillon.code_ggd}
                    onChange={(e) => modifier({ unite: e.target.value })}
                    onFocus={() => setFocus("unite")}
                    onBlur={() => setFocus(null)}
                    style={selectStyle("unite", !brouillon.unite)}
                  >
                    <option value="">
                      {brouillon.code_ggd ? "Choisir une unité…" : "Choisir d'abord un GGD"}
                    </option>
                    {unitesFiltrees.map((u) => (
                      <option key={u.nom} value={u.nom}>{u.nom}</option>
                    ))}
                  </select>
                </SelectFleche>
              </Champ>

              <Champ id={idCommune} label="Commune" obligatoire>
                <SelectFleche>
                  <select
                    id={idCommune}
                    aria-label="Commune"
                    value={brouillon.commune}
                    disabled={!brouillon.code_ggd}
                    onChange={(e) => modifier({ commune: e.target.value })}
                    onFocus={() => setFocus("commune")}
                    onBlur={() => setFocus(null)}
                    style={selectStyle("commune", !brouillon.commune)}
                  >
                    <option value="">
                      {brouillon.code_ggd
                        ? (listeCommunes.length ? "Choisir une commune…" : "Chargement des communes…")
                        : "Choisir d'abord un GGD"}
                    </option>
                    {listeCommunes.map((c) => (
                      <option key={c.code_insee} value={c.nom}>{c.nom}</option>
                    ))}
                  </select>
                </SelectFleche>
              </Champ>
            </div>

            {rattache && (
              <div style={{
                display: "flex", flexWrap: "wrap", gap: 6,
                padding: "10px 12px", background: C.bleuClair, borderRadius: 8,
              }}>
                <MetaEtiquette icone="shield" libelle="GGD" valeur={brouillon.code_ggd} />
                <MetaEtiquette icone="map" libelle="Département" valeur={brouillon.departement} />
                <MetaEtiquette icone="apartment" libelle="Unité" valeur={brouillon.unite} />
                <MetaEtiquette icone="place" libelle="Commune" valeur={brouillon.commune} />
              </div>
            )}

            <Champ
              id={idMots}
              label="Mots-clés"
              aide={`Jusqu'à ${MAX_MOTS_CLES} termes du référentiel. Les marqueurs techniques (defaut:, signal-faible:) sont exclus.`}
            >
              {brouillon.mots_cles.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {brouillon.mots_cles.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => basculerMot(m)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        border: `1px solid ${C.bleu}`, background: C.bleuBadge, color: C.bleu,
                        borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {m}
                      <Icone nom="close" taille={14} couleur={C.bleu} />
                    </button>
                  ))}
                </div>
              )}
              <input
                id={idMots}
                aria-label="Rechercher un mot-clé"
                placeholder={
                  brouillon.mots_cles.length >= MAX_MOTS_CLES
                    ? `Maximum ${MAX_MOTS_CLES} mots-clés atteint`
                    : "Rechercher dans le référentiel…"
                }
                value={filtreMot}
                disabled={brouillon.mots_cles.length >= MAX_MOTS_CLES}
                onChange={(e) => setFiltreMot(e.target.value)}
                style={styleChamp("mots")}
              />
              <ul
                aria-label="Mots-clés"
                style={{
                  listStyle: "none", margin: "8px 0 0", padding: 0,
                  maxHeight: 140, overflowY: "auto",
                  display: "flex", flexWrap: "wrap", gap: 6,
                }}
              >
                {motsFiltres.map((m) => {
                  const pris = brouillon.mots_cles.includes(m);
                  return (
                    <li key={m}>
                      <button
                        type="button"
                        aria-pressed={pris}
                        disabled={!pris && brouillon.mots_cles.length >= MAX_MOTS_CLES}
                        onClick={() => basculerMot(m)}
                        style={{
                          border: `1px solid ${pris ? C.bleu : C.bord}`,
                          background: pris ? C.bleuBadge : C.fond,
                          color: pris ? C.bleu : C.texte,
                          borderRadius: 8, padding: "5px 10px", fontSize: 12,
                          cursor: "pointer", fontWeight: pris ? 700 : 500,
                        }}
                      >
                        {m}
                      </button>
                    </li>
                  );
                })}
                {refs.mots_cles.length === 0 && (
                  <li style={{ fontSize: 12, color: C.gris }}>Référentiel de mots-clés vide.</li>
                )}
              </ul>
              <p style={{ margin: "6px 0 0", fontSize: 11, color: C.gris, fontVariantNumeric: "tabular-nums" }}>
                {brouillon.mots_cles.length} / {MAX_MOTS_CLES} sélectionnés
              </p>
            </Champ>

            <Champ id={idTexte} label="Texte de la fiche" obligatoire>
              <textarea
                id={idTexte}
                aria-label="Texte"
                placeholder={"Rédiger les faits de façon factuelle et datée.\nÉviter les données sensibles non justifiées (croyances, santé, opinions…)."}
                maxLength={MAX_TEXTE}
                rows={14}
                value={brouillon.texte}
                onChange={(e) => modifier({ texte: e.target.value })}
                onFocus={() => setFocus("texte")}
                onBlur={() => setFocus(null)}
                style={styleChamp("texte", {
                  minHeight: 280,
                  resize: "vertical",
                  lineHeight: 1.65,
                  fontSize: 14.5,
                  background: focus === "texte" ? C.fond : "#FBFBFD",
                })}
              />
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                gap: 8, marginTop: 4, fontSize: 12, color: procheLimite ? C.majeur : C.gris,
                fontVariantNumeric: "tabular-nums",
              }}>
                <span>
                  {brouillon.texte.trim()
                    ? `${brouillon.texte.trim().split(/\s+/).length} mot${brouillon.texte.trim().split(/\s+/).length > 1 ? "s" : ""}`
                    : "Aucun mot"}
                </span>
                <span>{brouillon.texte.length} / {MAX_TEXTE} caractères</span>
              </div>
            </Champ>
          </div>

          <footer style={{
            marginTop: "auto",
            borderTop: `1px solid ${C.bord}`,
            background: C.fond,
            padding: "12px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            position: "sticky",
            bottom: 0,
          }}>
            {!peutEnregistrer && (
              <p style={{ margin: 0, fontSize: 12.5, color: C.gris, lineHeight: 1.4 }}>
                L'enregistrement n'est proposé qu'après un contrôle (ou sa panne). Le contrôle
                conseille : il n'empêche jamais d'enregistrer.
              </p>
            )}
            {erreurEnregistrement && <Encart ton="alerte">{erreurEnregistrement}</Encart>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <Button
                color={perime || !rapport ? "brand" : "neutral"}
                disabled={!complet || encours || enregEncours}
                onClick={lancerAnalyse}
                icon={<Icone nom={encours ? "hourglass_top" : "fact_check"} taille={18} />}
              >
                {encours ? "Analyse en cours…" : rapport ? "Réanalyser" : "Analyser"}
              </Button>
              {peutEnregistrer && (
                <Button
                  color={perime ? "neutral" : "brand"}
                  disabled={!complet || encours || enregEncours}
                  onClick={lancerEnregistrement}
                  icon={<Icone nom={enregEncours ? "hourglass_top" : "save"} taille={18} />}
                >
                  {enregEncours ? "Enregistrement…" : "Enregistrer"}
                </Button>
              )}
              {!complet && (
                <span style={{ fontSize: 12, color: C.gris, marginLeft: 4 }}>
                  Titre et texte obligatoires
                </span>
              )}
            </div>
          </footer>
        </article>

        <aside style={panneau} aria-label="Contrôle de conformité">
          <header style={{
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            padding: "14px 16px", borderBottom: `1px solid ${C.bord}`, background: C.fond,
          }}>
            <Icone nom="policy" taille={22} couleur={C.bleu} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.texte }}>Contrôle GIPASP</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: C.gris }}>
                Trois agents · légalité, données, rédaction
              </p>
            </div>
            {fiche && !perime && (
              fiche.conforme
                ? <Puce couleur={C.succes} fond={C.succesFond}>conforme</Puce>
                : <Puce couleur={C.bloquant} fond={C.bloquantFond}>à revoir</Puce>
            )}
            {perime && <Puce couleur={C.majeur} fond={C.majeurFond}>périmé</Puce>}
          </header>

          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
            {encours && (
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: 12, padding: "48px 20px", textAlign: "center", flex: 1,
              }}>
                <span style={{
                  width: 48, height: 48, borderRadius: 24, background: C.fond,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  border: `1px solid ${C.bord}`,
                }}>
                  <Icone nom="hourglass_top" taille={26} couleur={C.bleu} />
                </span>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: C.texte }}>Analyse en cours</p>
                <p style={{ margin: 0, fontSize: 13, color: C.gris, lineHeight: 1.5, maxWidth: 280 }}>
                  Les trois agents examinent la fiche. Comptez environ 45 secondes.
                </p>
              </div>
            )}

            {!encours && erreurAnalyse && (
              <Encart ton="alerte">
                {MESSAGES[erreurAnalyse] || "Le contrôle n'a pas abouti."} L'enregistrement
                reste possible : un contrôle en panne ne doit pas retenir une fiche.
              </Encart>
            )}

            {!encours && perime && fiche && (
              <Encart ton="alerte">
                Ce verdict porte sur une version antérieure du texte. Relancer l'analyse avant
                d'enregistrer.
              </Encart>
            )}

            {!encours && fiche && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ opacity: perime ? 0.72 : 1, transition: "opacity 120ms ease" }}>
                  <FicheRapport fiche={fiche} montrerIdentite={false} />
                </div>
                <p style={{
                  fontSize: 12, color: C.gris, margin: 0, lineHeight: 1.45,
                  padding: "8px 10px", background: C.fond, borderRadius: 8, border: `1px solid ${C.bord}`,
                }}>
                  <Icone nom="info" taille={14} couleur={C.gris} />{" "}
                  C10 (ancienneté) : sans objet à la rédaction — ce contrôle porte sur la date de
                  création, et cette fiche est du jour.
                </p>
              </div>
            )}

            {!encours && !fiche && !erreurAnalyse && (
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: 14, padding: "40px 24px", textAlign: "center", flex: 1,
              }}>
                <span style={{
                  width: 56, height: 56, borderRadius: 28, background: C.fond,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  border: `1px solid ${C.bord}`,
                }}>
                  <Icone nom="fact_check" taille={28} couleur={C.bleu} />
                </span>
                <div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.texte }}>
                    Le verdict s'affichera ici
                  </p>
                  <p style={{ margin: "8px 0 0", fontSize: 13, color: C.gris, lineHeight: 1.55, maxWidth: 300 }}>
                    Choisissez le GGD, l'unité et la commune, rédigez, ajoutez des mots-clés,
                    puis lancez l'analyse.
                  </p>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .redaction-frs-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}

function MetaEtiquette({ icone, libelle, valeur }: { icone: string; libelle: string; valeur: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: C.fond, border: `1px solid ${C.bord}`, borderRadius: 8,
      padding: "5px 10px", fontSize: 12, color: C.texte, maxWidth: "100%",
    }}>
      <Icone nom={icone} taille={14} couleur={C.bleu} />
      <span style={{ color: C.gris, fontWeight: 600 }}>{libelle}</span>
      <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{valeur}</span>
    </span>
  );
}
