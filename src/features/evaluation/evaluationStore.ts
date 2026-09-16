// État de l'écran d'évaluation, hors React : il survit aux changements de vue,
// comme les autres features. Persistés : l'UNA saisi et le job en vol (`enVol`,
// pour reprendre le polling après un F5) — les objets, eux, se rechargent, et
// une sélection restaurée sans ses objets n'aurait aucun sens.
//
// Dans ce démonstrateur, l'évaluation n'écrit plus rien en base : le résultat
// s'affiche à titre indicatif, pour l'information de l'enquêteur. Il n'est donc
// plus confronté à la procédure (plus de relecture) — l'écran montre les montants
// ANNONCÉS par l'analyse, tels quels.

import { createPersistedStore } from "../../lib/createPersistedStore";
import { markdownToHtml } from "../../lib/markdownToHtml";
import {
  chargerUna,
  listerUnasEvaluables,
  lancerEvaluation,
  resumeEvaluation,
  type ChargementUna,
  type UnaEvaluable,
  type ResultatEvaluation,
} from "./evaluationApi";

/** Limite imposée par la boucle du workflow d'évaluation (max 20 itérations). */
export const MAX_SELECTION = 20;

// Les codes d'erreur du BFF et du client de job ne sont pas des messages : un
// enquêteur ne doit jamais lire « EVALUATION_UPSTREAM » à l'écran. Même table
// que les autres features (voir syntheseStore).
const MESSAGES: Record<string, string> = {
  EVALUATION_TIMEOUT: "Délai dépassé. Réessayez.",
  EVALUATION_UPSTREAM: "Service d'évaluation indisponible. Réessayez.",
  EVALUATION_INVALIDE: "Réponse IAka non conforme (évaluations attendues).",
  OBJETS_REQUIS: "Sélectionnez au moins un véhicule à évaluer.",
  UNA_REQUIS: "Indiquez un numéro de procédure.",
  JOB_INCONNU: "Évaluation introuvable (service redémarré). Relancez-la.",
  START_FAILED: "L'évaluation n'a pas pu être lancée. Réessayez.",
  UPSTREAM: "Service d'évaluation indisponible. Réessayez.",
  TIMEOUT: "Délai dépassé. Réessayez.",
  ABORTED: "Évaluation interrompue.",
  INTERNAL_ERROR: "Erreur interne du service d'évaluation.",
  ERREUR_INCONNUE: "Erreur inconnue.",
};

/** Message affichable de l'échec d'une évaluation. Toute erreur remontée par ce
 *  chemin est un code : un code inconnu tombe sur le message générique plutôt
 *  que de s'afficher tel quel. */
function messageEvaluation(code: string): string {
  return MESSAGES[code] ?? MESSAGES.ERREUR_INCONNUE;
}

/** Job d'évaluation en vol, persisté pour reprendre le polling après un F5.
 *  `objetIds` fige le périmètre pour reconstruire le résultat à l'identique. */
export type EvaluationEnVol = {
  jobId: string;
  objetIds: number[];
  startedAt: number;
};

export type EvaluationState = {
  una: string;
  chargement: boolean;
  erreur: string | null;
  donnees: ChargementUna | null;
  selection: number[];
  /** Procédures exploitables, proposées au choix. */
  unas: UnaEvaluable[];
  chargementUnas: boolean;
  resultat: ResultatEvaluation | null;
  evaluationEnCours: boolean;
  /** Job en cours (jobId + contexte de reprise), persisté à travers un F5. */
  enVol: EvaluationEnVol | null;
};

const store = createPersistedStore<EvaluationState>(
  {
    una: "",
    chargement: false,
    erreur: null,
    donnees: null,
    selection: [],
    unas: [],
    chargementUnas: false,
    resultat: null,
    evaluationEnCours: false,
    enVol: null,
  },
  {
    key: "evaluation:una",
    // Résister au F5 : outre l'UNA et le job en vol, on persiste le RÉSULTAT terminé
    // (+ `donnees` pour renommer les véhicules et `selection` pour l'écran de choix),
    // sinon une évaluation aboutie disparaîtrait au rechargement.
    keys: ["una", "enVol", "resultat", "donnees", "selection"],
    // Format historique : la valeur stockée était le seul UNA (chaîne nue). On accepte
    // les deux : l'enveloppe JSON et l'ancienne chaîne.
    read: (raw) => {
      try {
        const o = JSON.parse(raw);
        if (o && typeof o === "object" && ("una" in o || "enVol" in o || "resultat" in o)) {
          return {
            una: typeof o.una === "string" ? o.una : "",
            enVol: o.enVol ?? null,
            resultat: o.resultat ?? null,
            donnees: o.donnees ?? null,
            selection: Array.isArray(o.selection) ? o.selection : [],
          };
        }
      } catch {
        /* pas du JSON → ancien format « chaîne nue » */
      }
      return { una: raw };
    },
    write: (s) => {
      const vide = !s.una && !s.enVol && !s.resultat && !s.donnees && s.selection.length === 0;
      return vide ? null : JSON.stringify({ una: s.una, enVol: s.enVol, resultat: s.resultat, donnees: s.donnees, selection: s.selection });
    },
  }
);

export function setUna(una: string) {
  // Changer d'UNA invalide tout ce qui en découlait.
  store.set({ una, donnees: null, selection: [], erreur: null });
}

/** Charge les objets (véhicules) de l'UNA courant, pour l'écran de sélection. */
export async function charger(fetchImpl: typeof fetch = fetch) {
  const una = store.get().una.trim();
  if (!una || store.get().chargement) return;
  // Un rechargement manuel PENDANT une exécution rechargerait `donnees` sur un
  // état de mi-parcours et viderait la sélection : on le refuse.
  if (store.get().evaluationEnCours) return;
  // `donnees` n'est PAS remis à null ici : un échec de chargement ne doit pas
  // faire disparaître ce qui est affiché. Changer d'UNA, lui, invalide bien les
  // données (voir setUna).
  store.set({ chargement: true, erreur: null, selection: [] });
  try {
    const donnees = await chargerUna(una, fetchImpl);
    // L'UNA a pu changer (ou être vidé) pendant l'attente réseau : un résultat
    // périmé ne doit jamais s'afficher sous un autre dossier, on l'ignore
    // silencieusement. `chargement` doit quand même repasser à false : plus
    // aucun appel n'est en vol pour l'UNA affiché (charger() refuse de se
    // relancer tant que chargement est vrai, et setUna() ne le remet pas
    // lui-même à false), donc le laisser à true bloquerait l'écran indéfiniment.
    if (store.get().una.trim() !== una) {
      store.set({ chargement: false });
      return;
    }
    store.set({ donnees, chargement: false });
  } catch (e) {
    if (store.get().una.trim() !== una) {
      store.set({ chargement: false });
      return;
    }
    store.set({ erreur: (e as Error).message, chargement: false });
  }
}

export async function chargerUnas(fetchImpl: typeof fetch = fetch) {
  if (store.get().chargementUnas) return;
  store.set({ chargementUnas: true });
  try {
    store.set({ unas: await listerUnasEvaluables(fetchImpl), chargementUnas: false });
  } catch (e) {
    // La liste n'est qu'une aide au choix : son échec laisse la saisie manuelle
    // utilisable, on ne bloque pas l'écran.
    store.set({ erreur: (e as Error).message, chargementUnas: false });
  }
}

export function basculer(objetId: number) {
  const { selection } = store.get();
  if (selection.includes(objetId)) {
    store.set({ selection: selection.filter((id) => id !== objetId), erreur: null });
    return;
  }
  if (selection.length >= MAX_SELECTION) {
    // Le workflow ne traite que MAX_SELECTION véhicules par exécution : mieux vaut
    // le refuser ici que laisser la boucle tronquer sans le dire.
    store.set({ erreur: `Sélection limitée à ${MAX_SELECTION} véhicules par évaluation.` });
    return;
  }
  store.set({ selection: [...selection, objetId], erreur: null });
}

export function viderSelection() {
  store.set({ selection: [], erreur: null });
}

export async function evaluer(fetchImpl: typeof fetch = fetch) {
  const { una, selection, evaluationEnCours } = store.get();
  if (!una.trim() || !selection.length || evaluationEnCours) return;
  const objetIds = selection;
  store.set({ evaluationEnCours: true, erreur: null, resultat: null });
  let resultat: ResultatEvaluation;
  try {
    // `onJobId` fige le job en vol (jobId + périmètre) dès le 202 : un F5 pourra
    // reprendre le polling (le job tourne côté serveur, détaché).
    resultat = await lancerEvaluation(una, objetIds, fetchImpl, (jobId) =>
      store.set({ enVol: { jobId, objetIds, startedAt: Date.now() } })
    );
  } catch (e) {
    store.set({ erreur: messageEvaluation((e as Error).message), evaluationEnCours: false, enVol: null });
    return;
  }
  finaliser(resultat);
}

/** Fin de parcours commune au lancement et à la reprise : pose le résultat
 *  (montants annoncés, affichés à titre indicatif) et retire le job en vol. Plus
 *  de relecture de base : dans ce démonstrateur, l'évaluation n'écrit rien.
 *
 *  Le PV arrive en Markdown (l'agent de rédaction produit `##`, `-`, `**`) ; on
 *  le convertit en HTML ici, à l'entrée unique du résultat, car l'éditeur
 *  (`PropositionEditor`) et l'export PDF attendent du HTML — sinon le Markdown
 *  s'afficherait littéralement. Les éditions ultérieures (`setPv`) arrivent déjà
 *  en HTML depuis l'éditeur. */
function finaliser(resultat: ResultatEvaluation) {
  store.set({
    resultat: { ...resultat, pv: markdownToHtml(resultat.pv) },
    evaluationEnCours: false,
    enVol: null,
  });
}

/** Reprise après un F5 : un job en vol persisté sans résultat → on re-poll (le
 *  job tourne côté serveur, détaché) sans le relancer. Job inconnu (BFF
 *  redémarré) → nettoyage silencieux. */
export async function resumeIfPending(fetchImpl: typeof fetch = fetch) {
  const { enVol, resultat, evaluationEnCours } = store.get();
  if (!enVol || resultat || evaluationEnCours) return;
  store.set({ evaluationEnCours: true, erreur: null });
  let resultat2: ResultatEvaluation;
  try {
    resultat2 = await resumeEvaluation(enVol.jobId, enVol.objetIds, fetchImpl);
  } catch (e) {
    const code = (e as Error).message;
    if (code === "JOB_INCONNU") store.set({ evaluationEnCours: false, enVol: null });
    else store.set({ erreur: messageEvaluation(code), evaluationEnCours: false, enVol: null });
    return;
  }
  finaliser(resultat2);
}
resumeIfPending();

/** Édition manuelle du PV par l'enquêteur. */
export function setPv(pv: string) {
  const { resultat } = store.get();
  if (!resultat || resultat.pv === pv) return;
  store.set({ resultat: { ...resultat, pv } });
}

export function clear() {
  store.set({
    una: "",
    chargement: false,
    erreur: null,
    donnees: null,
    selection: [],
    unas: [],
    chargementUnas: false,
    resultat: null,
    evaluationEnCours: false,
    enVol: null,
  });
}

export const useEvaluation = store.use;
export const lireEtat = store.get;
