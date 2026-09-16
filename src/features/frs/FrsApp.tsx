import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import RensApp from "../rens/RensApp";
import { QualiteApp } from "../qualite/QualiteApp";
import { Onglets, Icone, C, page } from "../qualite/ui";
import {
  useFrsUi, setOnglet, estOngletFrs, type FrsOnglet,
} from "./frsUiStore";

const ITEMS: { cle: FrsOnglet; libelle: string; icone: string }[] = [
  { cle: "flux", libelle: "Flux", icone: "feed" },
  { cle: "synthese", libelle: "Synthèse", icone: "auto_awesome" },
  { cle: "controle", libelle: "Contrôle", icone: "fact_check" },
  { cle: "analyse", libelle: "À la demande", icone: "playlist_add_check" },
  { cle: "rediger", libelle: "Rédiger", icone: "edit_note" },
];

function frDateCourte(iso: string) {
  return iso.split("-").reverse().join("/");
}

/**
 * Page unifiée Fiches de renseignement : flux, synthèse, contrôle qualité,
 * analyse à la demande et rédaction a priori.
 *
 * Deep-link : `/app/frs?onglet=rediger`
 * Contexte partagé : jour + GGD entre Flux et Contrôle.
 * Navigation croisée : naviguerVersFiche() met à jour l'onglet (URL suivie).
 */
export default function FrsApp() {
  const { onglet, jour, ggd } = useFrsUi();
  const [params, setParams] = useSearchParams();
  const urlInit = useRef(false);
  const urlSync = useRef<FrsOnglet | null>(null);

  // Deep-link au premier rendu seulement.
  useEffect(() => {
    if (urlInit.current) return;
    urlInit.current = true;
    const q = params.get("onglet");
    if (estOngletFrs(q)) {
      urlSync.current = q;
      setOnglet(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Store → URL (clic onglet, naviguerVersFiche). Garde anti-reboucle.
  useEffect(() => {
    if (urlSync.current === onglet) return;
    urlSync.current = onglet;
    const next = new URLSearchParams(params);
    if (next.get("onglet") === onglet) return;
    next.set("onglet", onglet);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onglet]);

  return (
    <div style={page}>
      <header style={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        gap: 16, marginBottom: 16, flexWrap: "wrap",
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{
              width: 36, height: 36, borderRadius: 10, background: C.bleuClair,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}>
              <Icone nom="policy" taille={22} couleur={C.bleu} />
            </span>
            <h1 style={{ fontSize: 22, fontWeight: 750, color: C.bleu, margin: 0, letterSpacing: -0.3 }}>
              Fiches de renseignement
            </h1>
          </div>
          <p style={{ margin: "0 0 0 46px", fontSize: 13, color: C.gris, maxWidth: 560, lineHeight: 1.45 }}>
            Flux, synthèse, contrôle qualité GIPASP, analyse à la demande et rédaction.
          </p>
          {(jour || ggd) && (
            <p style={{
              margin: "8px 0 0 46px", fontSize: 12, color: C.gris,
              display: "flex", flexWrap: "wrap", gap: "6px 12px", alignItems: "center",
            }}>
              <span style={{ fontWeight: 600, color: C.texte }}>Contexte :</span>
              {jour && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Icone nom="event" taille={14} couleur={C.gris} />
                  {frDateCourte(jour)}
                </span>
              )}
              {ggd && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Icone nom="shield" taille={14} couleur={C.gris} />
                  {ggd}
                </span>
              )}
              <span style={{ color: C.gris, fontSize: 11 }}>(partagé Flux ↔ Contrôle)</span>
            </p>
          )}
        </div>
      </header>

      <Onglets valeur={onglet} onChange={setOnglet} items={ITEMS} />

      {onglet === "flux" && <RensApp embed section="flux" />}
      {onglet === "synthese" && <RensApp embed section="synthese" />}
      {onglet === "controle" && <QualiteApp embed mode="controle" />}
      {onglet === "analyse" && <QualiteApp embed mode="analyse" />}
      {onglet === "rediger" && <QualiteApp embed mode="rediger" />}
    </div>
  );
}
