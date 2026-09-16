import { useEffect, useRef, useState } from "react";
import { colors } from "../lib/uiTokens";

// Barre d'attente pendant l'analyse. La durée réelle est inconnue (le BFF
// interroge le workflow jusqu'à plusieurs minutes) : l'avancement est donc
// SIMULÉ, et volontairement asymptotique — il ralentit en approchant du
// plafond et n'atteint jamais 100 %, pour ne pas annoncer une fin qui
// n'est pas décidée ici. Le composant disparaît quand l'analyse rend son
// texte, ce qui vaut fin de course.

const PERIODE_MS = 300;
const PLAFOND = 95;
// Part du chemin restant parcourue à chaque intervalle : donne une montée
// rapide au début, de plus en plus lente ensuite.
const AVANCE = 0.04;

const conteneur: React.CSSProperties = { margin: "0 0 16px" };

const piste: React.CSSProperties = {
  height: 6,
  borderRadius: 3,
  background: "var(--c--globals--colors--gray-200, #e5e5e5)",
  overflow: "hidden",
};

const remplissage = (valeur: number): React.CSSProperties => ({
  height: "100%",
  width: `${valeur}%`,
  background: colors.brand,
  borderRadius: 3,
  transition: `width ${PERIODE_MS}ms linear`,
});

const legende: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  margin: "0 0 6px",
  fontSize: 13,
  color: colors.muted,
};

// Avancement DÉTERMINISTE à partir du temps écoulé : forme fermée de l'itération
// `v += (PLAFOND - v) * AVANCE` toutes les PERIODE_MS. Piloter par le temps réel
// (et non par l'état accumulé au montage) permet de retrouver la bonne position
// au retour sur la page : la barre ne repart pas de zéro.
const valeurA = (elapsedMs: number) => PLAFOND * (1 - Math.pow(1 - AVANCE, elapsedMs / PERIODE_MS));

// `debut` : horodatage (ms) du lancement réel, fourni par le store pour survivre à
// la navigation. Absent → repli sur l'instant de montage (comportement historique).
export default function BarreProgression({ debut }: { debut?: number }) {
  const debutRef = useRef(debut ?? Date.now());
  if (debut != null) debutRef.current = debut;
  const [, tick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => tick((t) => t + 1), PERIODE_MS);
    return () => clearInterval(timer);
  }, []);

  const elapsed = Date.now() - debutRef.current;
  const valeur = valeurA(elapsed);
  const secondes = Math.floor(elapsed / 1000);
  const arrondi = Math.round(valeur);

  return (
    <div style={conteneur}>
      <p style={legende}>
        <span className="material-icons" aria-hidden style={{ fontSize: 16, color: colors.brand }}>
          hourglass_top
        </span>
        Analyse en cours… {secondes} s
      </p>
      <div
        role="progressbar"
        aria-label="Progression de l'analyse"
        aria-valuenow={arrondi}
        aria-valuemin={0}
        aria-valuemax={100}
        style={piste}
      >
        <div style={remplissage(valeur)} />
      </div>
    </div>
  );
}
