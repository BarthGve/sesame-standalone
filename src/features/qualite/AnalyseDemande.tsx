import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "@gouvfr-lasuite/cunningham-react";
import { fetchFiches, fetchReferentielListes, type Fiche, type GgdRef } from "../rens/rensApi";
import { FicheCarte } from "../rens/FicheList";
import { PAGE_SIZE } from "../rens/rensStore";
import { lancerAnalyse, MAX_SELECTION, type RapportAnalyse } from "./analyseApi";
import { FicheRapport } from "./FicheRapport";
import { C, Chiffre, Encart, Icone, TitreSection, champ } from "./ui";

const MESSAGES: Record<string, string> = {
  SORTIE_ILLISIBLE: "Les agents n'ont pas rendu de résultat exploitable. Relancer l'analyse.",
  IAKA_TIMEOUT: "Le contrôle n'a pas abouti dans le temps imparti. Réduire la sélection ou réessayer.",
  IAKA_UPSTREAM: "La plateforme d'analyse n'a pas répondu.",
  LOT_INTROUVABLE: "Les fiches sélectionnées sont introuvables.",
  SELECTION_INVALIDE: `La sélection doit compter de 1 à ${MAX_SELECTION} fiches.`,
};

const btnPage: CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  padding: "6px 12px", minWidth: 36, borderRadius: 8,
  border: `1px solid ${C.bord}`, background: C.fond, cursor: "pointer",
  fontFamily: "inherit",
};

// `lancer` est injectable : les tests de ce composant n'ont pas à repasser par le job
// asynchrone réel (poll toutes les 3 s), déjà couvert par analyseApi.test.ts.
export function AnalyseDemande({ lancer = lancerAnalyse }: { lancer?: (ids: number[]) => Promise<RapportAnalyse> } = {}) {
  const [fiches, setFiches] = useState<Fiche[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [ggds, setGgds] = useState<GgdRef[]>([]);
  const [jour, setJour] = useState("");
  const [ggd, setGgd] = useState("");
  const [q, setQ] = useState("");
  const [choix, setChoix] = useState<number[]>([]);
  const [plein, setPlein] = useState(false);
  const [encours, setEncours] = useState(false);
  const [rapport, setRapport] = useState<RapportAnalyse | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    let vivant = true;
    fetchReferentielListes()
      .then((r) => vivant && setGgds(r.ggd))
      .catch(() => vivant && setGgds([]));
    return () => { vivant = false; };
  }, []);

  // Changer de filtre revient à la 1re page (comme le flux).
  useEffect(() => { setPage(0); }, [jour, ggd, q]);

  useEffect(() => {
    let vivant = true;
    setChargement(true);
    fetchFiches({
      date: jour || undefined,
      ggd: ggd || undefined,
      q: q || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    })
      .then((p) => {
        if (!vivant) return;
        setFiches(p.fiches);
        setTotal(p.total);
        setChargement(false);
      })
      .catch(() => {
        if (!vivant) return;
        setFiches([]);
        setTotal(0);
        setChargement(false);
      });
    return () => { vivant = false; };
  }, [jour, ggd, q, page]);

  function basculer(id: number) {
    setChoix((prev) => {
      if (prev.includes(id)) { setPlein(false); return prev.filter((x) => x !== id); }
      if (prev.length >= MAX_SELECTION) { setPlein(true); return prev; }
      return [...prev, id];
    });
  }

  async function analyser() {
    setEncours(true);
    setErreur(null);
    setRapport(null);
    try {
      setRapport(await lancer(choix));
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEncours(false);
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <Encart>
        Contrôle immédiat d'une sélection de {MAX_SELECTION} fiches au plus, utile pour vérifier
        une unité ou une journée précise. Le résultat n'est pas conservé : le contrôle qui fait
        foi reste le batch de la nuit. La liste est le même flux journalier paginé que l'onglet Flux.
      </Encart>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <input type="date" aria-label="Journée" value={jour} onChange={(e) => setJour(e.target.value)} style={champ} />
        <select aria-label="Groupement" value={ggd} onChange={(e) => setGgd(e.target.value)} style={{ ...champ, minWidth: 180 }}>
          <option value="">Tous les GGD</option>
          {ggds.map((g) => (
            <option key={g.code} value={g.code}>{g.code} — {g.nom_departement}</option>
          ))}
        </select>
        <input type="search" aria-label="Recherche" placeholder="Titre, texte, mot-clé" value={q}
          onChange={(e) => setQ(e.target.value)} style={{ ...champ, flex: 1, minWidth: 160 }} />
      </div>

      {plein && (
        <Encart ton="alerte">
          Sélection limitée à {MAX_SELECTION} fiches : au-delà, le contrôle n'est plus immédiat.
          Pour un contrôle exhaustif, c'est le batch nocturne.
        </Encart>
      )}

      {chargement ? (
        <p style={{ fontSize: 13, color: C.gris, margin: 0 }}>Chargement des fiches…</p>
      ) : fiches.length === 0 ? (
        <p style={{ fontSize: 13, color: C.gris, margin: 0 }}>Aucune fiche pour ces filtres.</p>
      ) : (
        <>
          <div
            role="list"
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            {fiches.map((f) => (
              <div key={f.id} role="listitem">
                <FicheCarte
                  f={f}
                  selectable
                  selected={choix.includes(f.id)}
                  onToggle={(fiche) => basculer(fiche.id)}
                />
              </div>
            ))}
          </div>

          {/* Pagination — même modèle que l'onglet Flux */}
          {total > 0 && (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 12, flexWrap: "wrap", paddingTop: 4,
              borderTop: `1px solid ${C.bord}`,
            }}>
              <span style={{ fontSize: 13, color: C.gris, fontVariantNumeric: "tabular-nums" }}>
                {from}–{to} sur {total}
              </span>
              {total > PAGE_SIZE && (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    aria-label="Page précédente"
                    style={{
                      ...btnPage,
                      opacity: page === 0 ? 0.4 : 1,
                      cursor: page === 0 ? "default" : "pointer",
                    }}
                  >
                    <Icone nom="chevron_left" taille={18} couleur={C.texte} />
                  </button>
                  <span style={{
                    fontSize: 13, color: C.gris, minWidth: 48, textAlign: "center",
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {page + 1} / {pages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page + 1 >= pages}
                    aria-label="Page suivante"
                    style={{
                      ...btnPage,
                      opacity: page + 1 >= pages ? 0.4 : 1,
                      cursor: page + 1 >= pages ? "default" : "pointer",
                    }}
                  >
                    <Icone nom="chevron_right" taille={18} couleur={C.texte} />
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Barre d'action collante : la sélection se fait en haut, l'action reste sous la main. */}
      <div style={{
        position: "sticky", bottom: 0, display: "flex", alignItems: "center", gap: 12,
        background: C.fond, borderTop: `1px solid ${C.bord}`, padding: "10px 0",
      }}>
        <span role="status" aria-label={`${choix.length} sur ${MAX_SELECTION} fiches sélectionnées`}
          style={{ fontSize: 13, color: C.gris, fontVariantNumeric: "tabular-nums" }}>
          <strong style={{ color: choix.length ? C.bleu : C.gris, fontSize: 15 }}>{choix.length}</strong> / {MAX_SELECTION} sélectionnées
        </span>
        {choix.length > 0 && !encours && (
          <Button variant="tertiary" color="neutral" size="small" onClick={() => { setChoix([]); setPlein(false); }}>
            Tout décocher
          </Button>
        )}
        <span style={{ marginLeft: "auto" }}>
          <Button type="button" onClick={analyser} disabled={choix.length === 0 || encours}
            icon={<Icone nom={encours ? "hourglass_top" : "fact_check"} />}>
            {encours ? "Analyse en cours…" : "Analyser"}
          </Button>
        </span>
      </div>

      {encours && (
        <Encart>
          Les trois agents examinent la sélection, chacun sur son corpus normatif : légalité,
          données, rédaction. Compter environ une minute pour vingt fiches.
        </Encart>
      )}

      {erreur && <Encart ton="alerte">{MESSAGES[erreur] || "L'analyse n'a pas abouti."}</Encart>}

      {rapport && (
        <div>
          <TitreSection icone="assignment_turned_in">Rapport de conformité</TitreSection>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 14px" }}>
            <Chiffre valeur={rapport.resume.total} libelle="fiches contrôlées" />
            <Chiffre valeur={rapport.resume.conformes} libelle={rapport.resume.conformes > 1 ? "conformes" : "conforme"} couleur={C.succes} fond={C.succesFond} />
            <Chiffre valeur={rapport.resume.non_conformes} libelle={rapport.resume.non_conformes > 1 ? "non conformes" : "non conforme"} couleur={C.majeur} fond={C.majeurFond} />
            <Chiffre valeur={rapport.resume.ecarts} libelle={rapport.resume.ecarts > 1 ? "écarts relevés" : "écart relevé"} />
          </div>
          {(rapport.resume.hors_perimetre ?? 0) > 0 && (
            <Encart>
              {rapport.resume.hors_perimetre} fiche(s) hors du champ du décret : aucune donnée à
              caractère personnel, donc aucune limite à leur opposer.
            </Encart>
          )}
          {(rapport.resume.ecarts_ecartes ?? 0) > 0 && (
            <Encart>
              {rapport.resume.ecarts_ecartes} signalement(s) retiré(s) par une règle du décret :
              un critère de datation sur une fiche pourtant datée, un grief visant une donnée
              expressément admise, ou deux agents ayant relevé le même passage.
            </Encart>
          )}
          {rapport.resume.rejets > 0 && (
            <Encart ton="alerte">
              {rapport.resume.rejets} signalement(s) écarté(s) faute de fondement citable : un constat
              sans article du code n'est pas opposable, il n'est donc pas retenu.
            </Encart>
          )}
          {rapport.fiches.map((f) => <FicheRapport key={f.frs_id} fiche={f} />)}
        </div>
      )}
    </section>
  );
}
