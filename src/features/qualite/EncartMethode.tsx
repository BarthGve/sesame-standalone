import type { Rapport } from "./qualiteApi";
import { C, Icone } from "./ui";

export function EncartMethode({ methode }: { methode: Rapport["methode"] }) {
  const { taille_fragment, defauts_plantes, defauts_detectes } = methode;
  const taux = defauts_plantes > 0 ? Math.round((defauts_detectes / defauts_plantes) * 100) : null;
  return (
    <details style={{ marginTop: 24, background: "#FAFAFA", border: `1px solid ${C.bord}`, borderRadius: 10, padding: "10px 14px" }}>
      <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: C.bleu, display: "flex", alignItems: "center", gap: 6 }}>
        <Icone nom="science" taille={16} couleur={C.bleu} />
        Méthode et limites
      </summary>
      <div style={{ fontSize: 13, color: "#3a3a3a", lineHeight: 1.6, marginTop: 8 }}>
        <p style={{ margin: "0 0 6px" }}>Fiches examinées par lot de {taille_fragment} par agent.</p>
        {taux != null ? (
          <p style={{ margin: "0 0 6px" }}>
            Taux de détection mesuré sur les défauts plantés :{" "}
            <strong style={{ color: taux >= 80 ? C.succes : C.majeur }}>{defauts_detectes} / {defauts_plantes} ({taux} %)</strong>.
            {" "}Mesuré, pas estimé : des défauts connus sont introduits chaque nuit dans le flux.
          </p>
        ) : (
          <p style={{ margin: "0 0 6px" }}>Aucun défaut planté sur cette journée : le taux de détection n'est pas mesurable.</p>
        )}
        <p style={{ margin: 0 }}>
          Le critère C10 (conservation au-delà de dix ans, CSI R. 236-24) ne peut pas se déclencher : la base
          applique une purge glissante à 90 jours. Son absence d'écart ne vaut pas conformité vérifiée.
        </p>
      </div>
    </details>
  );
}
