import type { Ecart, FicheDetail } from "./qualiteApi";
import { naviguerVersFiche } from "../frs/frsUiStore";
import { C, Icone, Puce, PuceGravite, TexteAvecExtraits } from "./ui";

function EcartVue({ ecart }: { ecart: Ecart }) {
  const teinte = ecart.gravite === "bloquant" ? C.bloquant : ecart.gravite === "majeur" ? C.majeur : C.mineur;
  return (
    <li style={{ background: "#FAFAFA", borderRadius: 8, padding: "10px 12px", borderLeft: `3px solid ${teinte}` }}>
      <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 14, color: C.texte }}>
        <Puce couleur={C.bleu} fond={C.bleuBadge}>{ecart.critere}</Puce>
        <strong style={{ fontWeight: 600 }}>{ecart.libelle}</strong>
        <PuceGravite gravite={ecart.gravite} />
      </p>
      {ecart.fondement && <p style={{ margin: "6px 0 0", fontSize: 12, fontWeight: 700, color: C.bleu }}>{ecart.fondement}</p>}
      {ecart.explication && <p style={{ margin: "4px 0 0", fontSize: 13, color: "#3a3a3a", lineHeight: 1.5 }}>{ecart.explication}</p>}
      {ecart.confiance === "moyenne" && (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: C.majeur, display: "flex", alignItems: "center", gap: 5 }}>
          <Icone nom="help_outline" taille={14} couleur={C.majeur} />
          Confiance moyenne — appelle une relecture humaine.
        </p>
      )}
    </li>
  );
}

export function FicheDetailVue({
  fiche,
  lienFlux = false,
}: {
  fiche: FicheDetail;
  /** Lien vers l'onglet Flux (page unifiée FrsApp). */
  lienFlux?: boolean;
}) {
  return (
    <section style={{ border: `1px solid ${C.bord}`, borderRadius: 10, background: C.fond, padding: "12px 14px", margin: "8px 0 4px" }}>
      <p style={{ fontSize: 12, color: C.gris, margin: 0 }}>
        {fiche.unite} · {fiche.code_ggd} · {fiche.commune} · rédigée le {fiche.date_redaction}
      </p>
      <TexteAvecExtraits texte={fiche.texte} extraits={fiche.ecarts.map((e) => e.extrait)} />
      <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "flex", flexDirection: "column", gap: 8 }}>
        {fiche.ecarts.map((e) => <EcartVue key={e.critere} ecart={e} />)}
      </ul>
      {lienFlux && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={() => naviguerVersFiche({
              onglet: "flux",
              frsId: fiche.frs_id,
              jour: fiche.date_redaction,
              ggd: fiche.code_ggd,
            })}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "8px 14px", borderRadius: 8,
              border: `1px solid ${C.bleu}`, background: C.bleuBadge, color: C.bleu,
              fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <Icone nom="feed" taille={18} couleur={C.bleu} />
            Voir dans le flux
          </button>
        </div>
      )}
    </section>
  );
}
