import type { FicheAnalysee } from "./analyseApi";
import { C, Icone, Puce, PuceGravite, TexteAvecExtraits, carte } from "./ui";

// Rendu du verdict d'UNE fiche. Partagé par l'analyse d'une sélection (le contrôleur) et par
// la rédaction (le rédacteur) : ils regardent le même objet, et deux rendus finiraient par
// montrer deux choses.
//
// `montrerIdentite` est faux pour un brouillon : il n'a pas encore d'identifiant, et
// « Fiche 0 » laisserait croire qu'il est déjà en base.
export function FicheRapport({ fiche, montrerIdentite = true }: { fiche: FicheAnalysee; montrerIdentite?: boolean }) {
  const passes = fiche.controles.filter((c) => c.statut === "ok").length;
  const teinte = fiche.conforme ? C.succes : (fiche.gravite_max === "bloquant" ? C.bloquant : C.majeur);
  // Une fiche qui ne vise aucune personne identifiable sort du champ du décret : afficher
  // la grille des contrôles laisserait croire qu'ils ont tranché quelque chose.
  const horsPerimetre = fiche.hors_perimetre;
  return (
    <article style={{ ...carte, borderLeft: `4px solid ${teinte}`, padding: "14px 16px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Icone nom={fiche.conforme ? "check_circle" : "report"} taille={20} couleur={teinte} />
        <h3 style={{ fontSize: 15, color: C.texte, margin: 0, flex: 1, minWidth: 0 }}>
          {fiche.titre} — {fiche.conforme ? "Conforme" : "Non conforme"}
        </h3>
        {fiche.conforme
          ? <Puce couleur={C.succes} fond={C.succesFond}>conforme</Puce>
          : <PuceGravite gravite={fiche.gravite_max ?? "mineur"} />}
      </div>

      {montrerIdentite && (
        <p style={{ fontSize: 12, color: C.gris, margin: "6px 0 0" }}>
          Fiche {fiche.frs_id} · {fiche.unite} · {fiche.code_ggd} · {fiche.commune} · rédigée le {fiche.date_redaction}
        </p>
      )}

      <TexteAvecExtraits texte={fiche.texte} extraits={fiche.ecarts.map((e) => e.extrait)} />

      {horsPerimetre ? (
        <p style={{ margin: "10px 0 0", fontSize: 13, color: C.texte, background: C.succesFond, borderLeft: `3px solid ${C.succes}`, borderRadius: "0 8px 8px 0", padding: "10px 12px", lineHeight: 1.5 }}>
          <Icone nom="verified_user" taille={16} couleur={C.succes} />{" "}
          <strong>Hors du champ du décret : aucune donnée à caractère personnel.</strong> Aucune
          personne physique n'est identifiée ni identifiable, directement ou par recoupement
          (RGPD, art. 4, 1°). Le GIPASP encadre le traitement de données personnelles : il ne
          pose aucune limite à une fiche qui ne vise personne.
        </p>
      ) : null}

      {fiche.ecarts.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "flex", flexDirection: "column", gap: 8 }}>
          {fiche.ecarts.map((e) => (
            <li key={e.critere} style={{ background: "#FAFAFA", borderRadius: 8, padding: "10px 12px", borderLeft: `3px solid ${(e.gravite === "bloquant" ? C.bloquant : e.gravite === "majeur" ? C.majeur : C.mineur)}` }}>
              <p style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 14, color: C.texte }}>
                <Puce couleur={C.bleu} fond={C.bleuBadge}>{e.critere}</Puce>
                <strong style={{ fontWeight: 600 }}>{e.libelle}</strong>
                <PuceGravite gravite={e.gravite} />
              </p>
              <p style={{ margin: "6px 0 0", fontSize: 12, fontWeight: 700, color: C.bleu }}>{e.fondement}</p>
              {e.explication && <p style={{ margin: "4px 0 0", fontSize: 13, color: "#3a3a3a", lineHeight: 1.5 }}>{e.explication}</p>}
              <p style={{ margin: "6px 0 0", fontSize: 11, color: C.gris, display: "flex", alignItems: "center", gap: 5 }}>
                <Icone nom={e.source === "sql" ? "rule" : "auto_awesome"} taille={14} />
                {e.source === "sql"
                  ? "Relevé par contrôle automatique sur la donnée, sans intervention d'un modèle."
                  : `Relevé par analyse du texte${e.confiance === "moyenne" ? " — confiance moyenne, appelle une relecture humaine" : ""}.`}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* La grille intégrale, y compris ce qui passe : sans elle, « conforme » ne dit pas
          sur quoi la fiche a été contrôlée, et l'absence d'écart se confond avec l'absence
          de contrôle. Hors périmètre, elle n'a rien tranché : on ne l'affiche pas. */}
      {!horsPerimetre && (
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, color: C.bleu, fontWeight: 600 }}>
          {passes} contrôles passés sur {fiche.controles.length} contrôles
        </summary>
        <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 4 }}>
          {fiche.controles.map((c) => {
            const ok = c.statut === "ok";
            return (
              <li key={c.critere} style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 12, color: ok ? C.gris : C.texte, padding: "3px 0" }}>
                <Icone nom={ok ? "check" : "close"} taille={14} couleur={ok ? C.succes : C.bloquant} />
                <span style={{ fontWeight: 700, color: ok ? C.gris : C.bleu, minWidth: 28 }}>{c.critere}</span>
                <span style={{ flex: 1, minWidth: 0 }}>{c.libelle}</span>
                <span style={{ color: C.gris, whiteSpace: "nowrap" }}>{c.fondement}</span>
                <span style={{ color: "#9a9a9a", whiteSpace: "nowrap" }}>{c.source === "sql" ? "contrôle automatique" : "analyse du texte"}</span>
              </li>
            );
          })}
        </ul>
      </details>
      )}
    </article>
  );
}
