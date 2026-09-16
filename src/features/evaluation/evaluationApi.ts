// Chargement des objets d'un UNA en vue de leur évaluation. Réutilise les
// lectures existantes de la perquisition : rien de nouveau côté serveur.

import {
  listPerquisitions,
  getPerquisition,
  type ApiObjet,
  type PerquisitionSummary,
} from "../saisies/perquisitionApi";
import { runJobAsync } from "../../lib/runJobAsync";
import { normEstimation } from "../saisies/identify";
import type { ObjetSaisi } from "../saisies/types";

export type ObjetEvaluable = {
  objet: ApiObjet;
  perquisitionId: number;
  adresse: string;
};

export type ChargementUna = {
  perquisitions: PerquisitionSummary[];
  vehicules: ObjetEvaluable[];
  /** Objets présents dans la procédure mais hors périmètre de ce premier incrément. */
  nonEligibles: number;
};

/** Seuls les véhicules terrestres sont évaluables pour l'instant. */
export function estVehiculeTerrestre(o: ApiObjet): boolean {
  return o.categorie === "TRANSPORT" && o.sous_type === "VEHICULE_TERRESTRE";
}

/** Valeur d'un champ de fiche, chaîne vide si absent — jamais null à l'affichage.
 *  La liste de champs peut manquer sur un objet venu d'une réponse tronquée :
 *  l'écran doit rester affichable plutôt que de lever pendant le rendu. */
export function champ(o: ApiObjet, cle: string): string {
  return (o.champs ?? []).find((c) => c.cle === cle)?.valeur ?? "";
}

export async function chargerUna(
  una: string,
  fetchImpl: typeof fetch = fetch
): Promise<ChargementUna> {
  const perquisitions = await listPerquisitions(una, fetchImpl);
  const vehicules: ObjetEvaluable[] = [];
  let nonEligibles = 0;

  for (const p of perquisitions) {
    const detail = await getPerquisition(p.id, fetchImpl);
    for (const objet of detail.objets ?? []) {
      if (estVehiculeTerrestre(objet)) {
        vehicules.push({ objet, perquisitionId: p.id, adresse: p.adresse });
      } else {
        nonEligibles++;
      }
    }
  }

  return { perquisitions, vehicules, nonEligibles };
}

export type UnaEvaluable = {
  una: string;
  groupe: string | null;
  synthese: string | null;
  urgent: boolean;
  sensible: boolean;
  nbPerquisitions: number;
  nbObjets: number;
};

/** Procédures exploitables : celles dont une perquisition porte au moins un objet. */
export async function listerUnasEvaluables(
  fetchImpl: typeof fetch = fetch
): Promise<UnaEvaluable[]> {
  const res = await fetchImpl("/api/evaluation/unas");
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) {
    throw new Error(body?.error?.message || body?.error || "ERREUR_UNAS");
  }
  return body.data as UnaEvaluable[];
}

type EstimationPrix = NonNullable<ObjetSaisi["estimationPrix"]>;
export type Total = { bas: number; moyen: number; haut: number };

export type ResultatEvaluation = {
  /** Identifiants effectivement soumis à l'évaluation. */
  objetIds: number[];
  /** Estimations telles que l'analyse les ANNONCE. Dans ce démonstrateur, elles
   *  ne sont plus écrites en base : elles s'affichent à titre indicatif, pour
   *  l'information de l'enquêteur, jamais confrontées à la procédure. */
  evaluations: { objetId: number; estimation: EstimationPrix }[];
  nonEvalues: { objetId: number; raison: string }[];
  /** Total tel que le workflow l'annonce — comparatif. */
  totalAnnonce: Total | null;
  /** Total recalculé à partir des chiffres annoncés par l'agent. C'est le
   *  montant affiché à l'écran. `null` quand aucune évaluation annoncée n'a
   *  passé la validation : une somme vide vaut 0 €, et « 0 € à 0 € » se lirait
   *  comme un montant constaté alors que rien n'a été annoncé. */
  totalRecalcule: Total | null;
  /** Objets envoyés mais absents du résultat : la boucle a tronqué, ou l'agent a oublié. */
  manquants: number[];
  /** Objets rendus par l'analyse alors qu'ils n'avaient PAS été sélectionnés.
   *  Écartés de tous les chiffres : les lignes de l'écran se bâtissent sur
   *  `objetIds`, un tel objet pèserait donc sur les totaux sans aucune ligne
   *  pour le nommer. Il est signalé à part — qu'un agent sorte du périmètre
   *  qu'on lui a fixé est en soi une anomalie à connaître. */
  horsSelection: number[];
  pv: string;
};

/** Convertit une borne de prix en nombre fini, ou null si inexploitable.
 *  Les prix viennent d'un modèle : ils arrivent aussi bien en nombre qu'en
 *  chaîne (« 10200 », « 10 200 »), ou en texte libre inutilisable. */
export function nombreFini(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.replace(/[\s ]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Total annoncé par le workflow : accepté seulement s'il a bien la forme
 *  attendue. Un nombre nu ou un objet partiel signalerait un « écart » fantôme
 *  et s'afficherait comme une fourchette vide. */
export function normTotal(v: unknown): Total | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const bas = nombreFini(o.bas);
  const moyen = nombreFini(o.moyen);
  const haut = nombreFini(o.haut);
  if (bas === null || moyen === null || haut === null) return null;
  return { bas, moyen, haut };
}

type EstimationValidee = { estimation: EstimationPrix; bornes: Total };

/** Valide et convertit l'estimation rendue par l'agent.
 *
 *  Les trois bornes sont exigées : une fourchette partielle ne peut pas entrer
 *  dans un total sans le fausser (borne absente comptée pour zéro sous-estimerait
 *  le total affiché), et un objet sans chiffre exploitable doit ressortir en
 *  « non évalué » avec un motif, jamais en estimation à 0 €. */
export function validerEstimation(brut: unknown): EstimationValidee | { raison: string } {
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) {
    return { raison: "estimation absente ou illisible" };
  }
  const e = brut as Record<string, unknown>;
  const bas = nombreFini(e.prix_bas);
  const moyen = nombreFini(e.prix_moyen);
  const haut = nombreFini(e.prix_haut);
  if (bas === null || moyen === null || haut === null) {
    const absentes = [
      bas === null && "prix bas",
      moyen === null && "prix moyen",
      haut === null && "prix haut",
    ].filter(Boolean) as string[];
    return { raison: `fourchette inexploitable (${absentes.join(", ")} non numérique ou absent)` };
  }

  // Le reste (devise, hypothèses, sources, avertissement) suit la normalisation
  // commune ; seules les bornes sont réécrites avec les valeurs converties.
  const norm = normEstimation(e as Parameters<typeof normEstimation>[0])!;
  return {
    estimation: {
      ...norm,
      prixBas: bas,
      prixMoyen: moyen,
      prixHaut: haut,
      sources: norm.sources.map((s) => ({ ...s, prix: nombreFini(s.prix) })),
    },
    bornes: { bas, moyen, haut },
  };
}

function additionner(bornes: Total[]): Total {
  return bornes.reduce(
    (t, b) => ({ bas: t.bas + b.bas, moyen: t.moyen + b.moyen, haut: t.haut + b.haut }),
    { bas: 0, moyen: 0, haut: 0 }
  );
}

type BrutEvaluation = {
  evaluations?: { objet_id: number; estimation_prix: unknown }[];
  non_evalues?: { objet_id: number; raison: string }[];
  // Forme non garantie : validée par normTotal, jamais reprise telle quelle.
  total?: unknown;
  pv_evaluation?: string;
};

// L'évaluation boucle sur les véhicules côté BFF, qui poll IAka jusqu'à
// POLL_TIMEOUT_MS (600s en prod). Le front doit tenir STRICTEMENT plus longtemps
// que ce budget serveur, sinon il abandonne avant que le serveur rende le
// résultat. Même raison — et même marge — que pvApi.ts.
const EVAL_TIMEOUT_MS = 660000;

export async function lancerEvaluation(
  una: string,
  objetIds: number[],
  fetchImpl: typeof fetch = fetch,
  // Appelé dès que le jobId est connu : permet au store de le persister pour
  // reprendre le polling après un F5 (le job tourne côté serveur, détaché).
  onJobId?: (jobId: string) => void
): Promise<ResultatEvaluation> {
  const brut = await runJobAsync<BrutEvaluation>(
    "/api/evaluation",
    { una, objetIds },
    { fetchImpl, timeoutMs: EVAL_TIMEOUT_MS, onStart: onJobId }
  );
  return construireResultat(brut, objetIds);
}

// Reprend un job d'évaluation DÉJÀ lancé (après un F5) : re-poll sans relancer,
// donc sans risque de double évaluation (runJobAsync ignore le POST de départ).
// `objetIds` fige le périmètre pour reconstruire le résultat à l'identique.
export async function resumeEvaluation(
  jobId: string,
  objetIds: number[],
  fetchImpl: typeof fetch = fetch
): Promise<ResultatEvaluation> {
  const brut = await runJobAsync<BrutEvaluation>("/api/evaluation", null, {
    fetchImpl,
    resumeJobId: jobId,
    timeoutMs: EVAL_TIMEOUT_MS,
  });
  return construireResultat(brut, objetIds);
}

// Transforme la réponse brute du workflow en résultat exploitable. Extraite pour
// être partagée par le lancement et la reprise (déterministe à `objetIds` fixé).
function construireResultat(brut: BrutEvaluation, objetIds: number[]): ResultatEvaluation {
  // Périmètre demandé. Tout objet rendu hors de cet ensemble est écarté avant
  // tout calcul : l'écran n'énumère que les objets sélectionnés, un intrus
  // gonflerait les totaux comparatifs — et déplacerait l'écart avec le total
  // annoncé — sans qu'aucune ligne ne vienne l'expliquer.
  const demandes = new Set(objetIds);
  const horsSelection: number[] = [];

  const evaluations: { objetId: number; estimation: EstimationPrix }[] = [];
  const nonEvalues: { objetId: number; raison: string }[] = [];
  for (const n of brut.non_evalues ?? []) {
    if (!demandes.has(n.objet_id)) {
      horsSelection.push(n.objet_id);
      continue;
    }
    nonEvalues.push({ objetId: n.objet_id, raison: n.raison });
  }

  // Un objet dont l'agent n'a pas su produire d'estimation exploitable ne doit
  // pas faire échouer tout le run : on le traite comme un objet non évalué,
  // avec un motif explicite, plutôt que de fabriquer une estimation à zéro qui
  // fausserait silencieusement le total affiché.
  const bornes: Total[] = [];
  for (const e of brut.evaluations ?? []) {
    if (!demandes.has(e.objet_id)) {
      horsSelection.push(e.objet_id);
      continue;
    }
    const valide = validerEstimation(e.estimation_prix);
    if ("raison" in valide) {
      nonEvalues.push({
        objetId: e.objet_id,
        raison: `Estimation de l'objet ${e.objet_id} inexploitable dans la réponse de l'analyse : ${valide.raison}.`,
      });
      continue;
    }
    evaluations.push({ objetId: e.objet_id, estimation: valide.estimation });
    bornes.push(valide.bornes);
  }

  // Le total du workflow est une addition faite par un modèle : on le garde pour
  // le comparer, et on refait la somme de ses propres chiffres. Les deux restent
  // des lectures de ce que l'agent ANNONCE — dans ce démonstrateur, aucune
  // relecture de base ne vient les confronter : le montant affiché est celui-ci.
  //
  // Aucune évaluation exploitable : la somme reste `null`. Additionner une liste
  // vide donnerait 0 €, affiché comme un montant annoncé alors que l'agent n'a
  // rien annoncé d'exploitable.
  const totalRecalcule = bornes.length ? additionner(bornes) : null;

  const rendus = new Set([...evaluations.map((e) => e.objetId), ...nonEvalues.map((n) => n.objetId)]);
  const manquants = objetIds.filter((id) => !rendus.has(id));

  return {
    objetIds,
    evaluations,
    nonEvalues,
    totalAnnonce: normTotal(brut.total),
    totalRecalcule,
    manquants,
    // Un même objet hors périmètre peut être rendu à la fois dans `evaluations`
    // et dans `non_evalues` : on le dédoublonne, sinon l'écran l'annoncerait deux
    // fois et son compteur d'anomalies serait faux.
    horsSelection: [...new Set(horsSelection)],
    pv: brut.pv_evaluation ?? "",
  };
}
