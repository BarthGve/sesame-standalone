import type { Rapport } from "./qualiteApi";
import { C, Chiffre, Encart, Icone } from "./ui";

const nombre = (n: number) => n.toLocaleString("fr-FR");

// La couverture passe AVANT le résultat : un rapport qui laisse croire à une couverture
// totale qu'il n'a pas est pire que pas de rapport.
export function RapportEntete({ rapport }: { rapport: Rapport }) {
  // Le total d'écarts n'est pas le nombre de fiches : une fiche peut en porter plusieurs.
  const ecarts = rapport.fiches.reduce((n, f) => n + f.n_ecarts, 0);
  const { run, synthese } = rapport;
  const g = synthese.par_gravite;
  const taux = synthese.taux_conformite;
  const manquants = run.fragments_total > 0
    ? (run.fragments_total - run.fragments_ok) * run.taille_fragment
    : 0;
  const complet = run.statut !== "partiel";

  return (
    <header style={{ margin: "0 0 20px" }}>
      <h1 style={{ fontSize: 20, color: C.bleu, margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8 }}>
        <Icone nom="fact_check" taille={22} couleur={C.bleu} />
        Audit du {new Date(run.jour).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
      </h1>

      {/* Ce que l'audit a couvert, avant ce qu'il a trouvé. */}
      <p style={{ margin: "0 0 12px", fontSize: 12, color: C.gris, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Icone nom={complet ? "check_circle" : "error_outline"} taille={14} couleur={complet ? C.succes : C.majeur} />
        {nombre(run.total_fiches)} fiches contrôlées, {run.fragments_ok}/{run.fragments_total} fragments
        {run.termine_a ? ` · terminé à ${new Date(run.termine_a).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}
      </p>

      {run.statut === "partiel" && (
        <div style={{ margin: "0 0 12px" }}>
          <Encart ton="alerte">
            Audit incomplet : {run.fragments_ok}/{run.fragments_total} fragments traités,
            soit environ {nombre(manquants)} fiches non contrôlées. Les fiches manquantes ne sont
            pas réputées conformes, elles n'ont pas été vues.
          </Encart>
        </div>
      )}

      {/* Macro d'abord : le volume traité, ce qui ressort, et le détail par gravité. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 8px" }}>
        <Chiffre valeur={nombre(run.total_fiches)} libelle="fiches analysées" />
        <Chiffre valeur={nombre(synthese.fiches_non_conformes)} libelle="fiches en écart" couleur={C.majeur} fond={C.majeurFond} />
        <Chiffre valeur={nombre(ecarts)} libelle="écarts relevés" couleur={C.majeur} fond={C.majeurFond} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Chiffre
          valeur={taux != null ? `${(taux * 100).toFixed(1).replace(".", ",")} %` : "—"}
          libelle={taux != null ? "conformes" : "Taux indisponible"}
          couleur={C.succes}
          fond={C.succesFond}
        />
        <Chiffre valeur={g.bloquant ?? 0} libelle="bloquants" couleur={C.bloquant} fond={C.bloquantFond} />
        <Chiffre valeur={g.majeur ?? 0} libelle="majeurs" couleur={C.majeur} fond={C.majeurFond} />
        <Chiffre valeur={g.mineur ?? 0} libelle="mineurs" couleur={C.mineur} fond={C.mineurFond} />
      </div>
    </header>
  );
}
