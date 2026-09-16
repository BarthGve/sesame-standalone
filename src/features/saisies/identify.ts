// Client d'identification : envoie la photo au proxy (/api/identify),
// qui la transmet en pièce jointe au workflow IAka, et normalise la réponse.

import { runJobAsync } from "../../lib/runJobAsync";
import { champsCategorie } from "./catalogue";
import type {
  CategorieCode,
  Champ,
  EstimationPrix,
  IdentificationResult,
  SousTypeTransport,
} from "./types";

function fileToBase64(file: File): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string; // "data:<mime>;base64,<data>"
      const comma = res.indexOf(",");
      resolve({ base64: res.slice(comma + 1), mime: file.type || "image/jpeg" });
    };
    reader.onerror = () => reject(new Error("LECTURE_FICHIER"));
    reader.readAsDataURL(file);
  });
}

/* ---- normalisation de la sortie IAka (snake_case, champs optionnels) ---- */
interface RawChamp {
  cle: string;
  libelle?: string;
  valeur?: string | null;
  source?: string;
  obligatoire?: boolean;
}
interface RawObjet {
  categorie: string;
  sous_type?: string;
  sousType?: string;
  confiance?: number;
  categories_alternatives?: { categorie: string; confiance: number }[];
  champs?: RawChamp[];
  estimation_prix?: RawEstimation;
}
interface RawEstimation {
  prix_bas?: number | null;
  prix_moyen?: number | null;
  prix_haut?: number | null;
  devise?: string;
  hypotheses?: string[];
  sources?: { site?: string; url?: string; prix?: number | null }[];
  confiance?: number;
  avertissement?: string;
}

export function normEstimation(e?: RawEstimation): EstimationPrix | undefined {
  if (!e) return undefined;
  return {
    prixBas: e.prix_bas ?? null,
    prixMoyen: e.prix_moyen ?? null,
    prixHaut: e.prix_haut ?? null,
    devise: e.devise ?? "EUR",
    hypotheses: e.hypotheses ?? [],
    sources: (e.sources ?? []).map((s) => ({ site: s.site ?? "", url: s.url ?? "#", prix: s.prix ?? null })),
    confiance: e.confiance ?? 0,
    avertissement: e.avertissement ?? "Estimation indicative non contractuelle, à valider par un expert.",
  };
}

function normalize(raw: RawObjet): IdentificationResult {
  const categorie = raw.categorie as CategorieCode;
  const sousType = (raw.sous_type ?? raw.sousType) as SousTypeTransport | undefined;

  let champs: Champ[] = (raw.champs ?? []).map((c) => {
    const valeur = c.valeur != null ? String(c.valeur) : null;
    const source = c.source === "deduit" || c.source === "a_completer"
      ? c.source
      : valeur != null ? "deduit" : "a_completer";
    return { cle: c.cle, libelle: c.libelle ?? c.cle, valeur, source, obligatoire: !!c.obligatoire };
  });

  // Le workflow n'a renvoyé que la catégorie (sortie routeur) : on reconstruit
  // la fiche vide depuis le catalogue, tous les champs « à compléter ».
  if (champs.length === 0) {
    champs = champsCategorie(categorie, sousType).map((def) => ({
      cle: def.cle,
      libelle: def.libelle,
      valeur: null,
      source: "a_completer",
      obligatoire: def.obligatoire ?? false,
    }));
  }

  return {
    categorie,
    sousType,
    confiance: raw.confiance ?? 0,
    categoriesAlternatives: (raw.categories_alternatives ?? []).map((a) => ({
      categorie: a.categorie as CategorieCode,
      confiance: a.confiance,
    })),
    champs,
    estimationPrix: normEstimation(raw.estimation_prix),
  };
}

export async function identifyObject(
  file: File,
  fetchImpl: typeof fetch = fetch
): Promise<IdentificationResult> {
  const { base64, mime } = await fileToBase64(file);
  const raw = await runJobAsync<RawObjet>(
    "/api/identify",
    { imageBase64: base64, mime, filename: file.name },
    { fetchImpl }
  );
  return normalize(raw);
}
