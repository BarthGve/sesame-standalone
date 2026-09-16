import type { Perquisition, ObjetSaisi, CategorieCode, SousTypeTransport, SituationScelle } from "./types";

export interface ChampPayload { cle: string; libelle: string; valeur: string | null; source: string; obligatoire: boolean; }
export interface ObjetPayload {
  categorie: string;
  sous_type?: string;
  confiance?: number;
  numero_scelle?: string;
  situation?: string;
  lieu?: string;
  photo_url?: string;
  estimation?: ObjetSaisi["estimationPrix"];
  champs: ChampPayload[];
  categoriesAlternatives?: { categorie: string; confiance: number }[];
}
export interface PerquisitionPayload {
  una: string;
  adresse: string;
  code_postal?: string;
  commune?: string;
  latitude?: number | null;
  longitude?: number | null;
  type_lieu?: string;
  perquisitionne?: string;
  opj?: string;
  date_debut?: string;
  date_fin?: string;
  intervenants: string[];
  pieces: string[];
  objets: ObjetPayload[];
}

export function mapObjet(o: ObjetSaisi): ObjetPayload {
  return {
    categorie: o.categorie,
    sous_type: o.sousType,
    confiance: o.confiance,
    numero_scelle: o.numeroScelle || undefined,
    situation: o.situation,
    lieu: o.lieu || undefined,
    photo_url: o.photo || undefined,
    estimation: o.estimationPrix,
    champs: o.champs.map((c) => ({ cle: c.cle, libelle: c.libelle, valeur: c.valeur, source: c.source, obligatoire: c.obligatoire })),
    categoriesAlternatives: o.categoriesAlternatives,
  };
}

export function buildPerquisitionPayload(perq: Perquisition, una: string, objets: ObjetSaisi[]): PerquisitionPayload {
  return {
    una,
    adresse: perq.adresse,
    code_postal: perq.codePostal || undefined,
    commune: perq.insee || perq.commune || undefined,
    type_lieu: perq.typeLieu,
    perquisitionne: perq.perquisitionne || undefined,
    opj: perq.opj || undefined,
    date_debut: perq.dateDebut || undefined,
    date_fin: perq.dateFin || undefined,
    intervenants: (perq.intervenants || []).filter((s) => s.trim()),
    pieces: (perq.pieces || []).filter((s) => s.trim()),
    objets: objets.map(mapObjet),
  };
}

export async function savePerquisition(
  payload: PerquisitionPayload,
  fetchImpl: typeof fetch = fetch
): Promise<{ id: number }> {
  const res = await fetchImpl("/api/perquisition", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  // rgp-api renvoie HTTP 200 même sur erreur logique (enveloppe {error}).
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) {
    throw new Error(body?.error?.message || body?.error || "ERREUR_ENREGISTREMENT");
  }
  return { id: body.data.id };
}

export interface Procedure {
  una: string;
  unite?: number;
  numero?: number;
  annee?: number;
  type?: string;             // type_libelle côté API (alias possible: type_libelle)
  type_libelle?: string;
  groupe_libelle?: string;
  synthese?: string;
  commune?: string;              // code INSEE
  commune_libelle?: string;      // nom
  commune_code_postal?: string;
  urgent?: boolean;
  sensible?: boolean;
  nb_perquisitions?: number;     // nombre de perquisitions déjà rattachées à cet UNA
  date_submit?: string;          // date de création de l'UNA (ISO), = now() à l'allocation
}
export interface PerquisitionSummary {
  id: number;
  adresse: string;
  code_postal?: string;
  commune_libelle?: string;
  type_lieu?: string;
  date_debut?: string;
  created_at: string;
  nb_objets: number;
}
export interface ApiObjet {
  id: number;
  categorie: string;
  sous_type?: string | null;
  numero_scelle?: string | null;
  situation?: string | null;
  lieu?: string | null;
  photo_url?: string | null;
  champs: { cle: string; libelle: string; valeur: string | null; source: string | null; obligatoire: boolean }[];
  identifiants: { type: string; valeur: string }[];
  // Estimation déjà enregistrée en base, le cas échéant (colonnes estim_* et
  // tables liées d'objet_saisi).
  estim_prix_bas?: number | null;
  estim_prix_moyen?: number | null;
  estim_prix_haut?: number | null;
  estimation_sources?: { site: string; url: string; prix: number | null }[];
  estimation_hypotheses?: string[];
}
export interface PerquisitionDetail {
  id: number;
  una: string;
  adresse: string;
  code_postal?: string | null;
  commune_libelle?: string | null;
  type_lieu?: string | null;
  perquisitionne?: string | null;
  opj?: string | null;
  date_debut?: string | null;
  date_fin?: string | null;
  intervenants: string[];
  pieces: string[];
  objets: ApiObjet[];
}

// Déballe l'enveloppe { data } / { error } (HTTP 200 même sur erreur logique).
async function unwrap<T>(res: Response | any, fallbackMsg: string): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) {
    throw new Error(body?.error?.message || body?.error || fallbackMsg);
  }
  return body.data as T;
}

export async function listProcedures(
  params: { annee?: string; unite?: string; limit?: number } = {},
  fetchImpl: typeof fetch = fetch
): Promise<Procedure[]> {
  const q = new URLSearchParams();
  if (params.annee) q.set("annee", params.annee);
  if (params.unite) q.set("unite", params.unite);
  if (params.limit) q.set("limit", String(params.limit));
  const res = await fetchImpl("/api/procedures" + (q.toString() ? "?" + q.toString() : ""));
  return unwrap<Procedure[]>(res, "ERREUR_PROCEDURES");
}

export async function listPerquisitions(
  una: string,
  fetchImpl: typeof fetch = fetch
): Promise<PerquisitionSummary[]> {
  const res = await fetchImpl("/api/perquisitions?una=" + encodeURIComponent(una));
  return unwrap<PerquisitionSummary[]>(res, "ERREUR_PERQUISITIONS");
}

export async function getPerquisition(
  id: number,
  fetchImpl: typeof fetch = fetch
): Promise<PerquisitionDetail> {
  const res = await fetchImpl("/api/perquisition?id=" + id);
  return unwrap<PerquisitionDetail>(res, "ERREUR_PERQUISITION");
}

export async function addObjets(
  perquisitionId: number,
  objets: ObjetSaisi[],
  fetchImpl: typeof fetch = fetch
): Promise<PerquisitionDetail> {
  const res = await fetchImpl("/api/perquisition/objets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ perquisition_id: perquisitionId, objets: objets.map(mapObjet) }),
  });
  return unwrap<PerquisitionDetail>(res, "ERREUR_AJOUT_OBJETS");
}

export async function updateObjet(
  objetId: number,
  objet: ObjetSaisi,
  fetchImpl: typeof fetch = fetch
): Promise<PerquisitionDetail> {
  const res = await fetchImpl("/api/perquisition/objet/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objet_id: objetId, ...mapObjet(objet) }),
  });
  return unwrap<PerquisitionDetail>(res, "ERREUR_MAJ_OBJET");
}

export async function deleteObjet(
  objetId: number,
  fetchImpl: typeof fetch = fetch
): Promise<PerquisitionDetail> {
  const res = await fetchImpl("/api/perquisition/objet/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objet_id: objetId }),
  });
  return unwrap<PerquisitionDetail>(res, "ERREUR_SUPPRESSION_OBJET");
}

export function apiObjetToDraft(o: ApiObjet): ObjetSaisi {
  return {
    id: String(o.id),
    categorie: o.categorie as CategorieCode,
    sousType: (o.sous_type as SousTypeTransport) ?? undefined,
    confiance: 1,
    numeroScelle: o.numero_scelle ?? "",
    situation: (o.situation as SituationScelle) ?? "SAISI_SOUS_SCELLE",
    lieu: o.lieu ?? "",
    photo: o.photo_url ?? undefined,
    champs: o.champs.map((c) => ({
      cle: c.cle,
      libelle: c.libelle,
      valeur: c.valeur,
      source: c.source === "deduit" ? "deduit" : "a_completer",
      obligatoire: c.obligatoire,
    })),
  };
}

export function photoUrl(key: string): string {
  return "/api/photo?key=" + encodeURIComponent(key);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("LECTURE_FICHIER"));
    r.onload = () => {
      const s = String(r.result);
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.readAsDataURL(file);
  });
}

export async function uploadPhoto(file: File, fetchImpl: typeof fetch = fetch): Promise<string> {
  const imageBase64 = await fileToBase64(file);
  const res = await fetchImpl("/api/photo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, mime: file.type, filename: file.name }),
  });
  const data = await unwrap<{ key: string }>(res, "ERREUR_UPLOAD_PHOTO");
  return data.key;
}
