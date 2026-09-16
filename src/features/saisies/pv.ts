import type { ApiObjet } from "./perquisitionApi";
import { CATEGORIES, SOUS_TYPES_TRANSPORT } from "./catalogue";
import type { CategorieCode, SousTypeTransport } from "./types";

export const PLACEHOLDER = "_____________";

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export function formatPvDate(iso?: string | null): { longue: string; courte: string; heure: string } {
  if (!iso) return { longue: PLACEHOLDER, courte: PLACEHOLDER, heure: PLACEHOLDER };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { longue: PLACEHOLDER, courte: PLACEHOLDER, heure: PLACEHOLDER };
  const courte = `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
  const longue = `${JOURS[d.getDay()]} ${courte}`; // jour + date, sans article ("Le "/"le " ajouté par le gabarit)
  const h = d.getHours();
  const m = d.getMinutes();
  const heure = `${h} heure${h > 1 ? "s" : ""} ${String(m).padStart(2, "0")} minute${m > 1 ? "s" : ""}`;
  return { longue, courte, heure };
}

export function situationLabel(s?: string | null): string {
  if (s === "SAISI_SOUS_SCELLE") return "Saisi sous scellé";
  if (s === "SAISI_NON_SCELLE") return "Saisi non scellé";
  return "Saisi";
}

// En-tête d'un objet pour le PV : « Catégorie · situation ».
export function objetEntete(o: ApiObjet): string {
  const cat = CATEGORIES[o.categorie as CategorieCode]?.libelle ?? o.categorie;
  return `${cat} · ${situationLabel(o.situation)}`;
}

// Champs à afficher (sous-type transport en tête, puis champs à valeur non vide) pour un rendu en grille.
export function objetChamps(o: ApiObjet): { libelle: string; valeur: string }[] {
  const out: { libelle: string; valeur: string }[] = [];
  if (o.sous_type) out.push({ libelle: "Type de moyen", valeur: SOUS_TYPES_TRANSPORT[o.sous_type as SousTypeTransport] ?? o.sous_type });
  for (const c of o.champs) {
    const v = (c.valeur ?? "").trim();
    if (v) out.push({ libelle: c.libelle, valeur: v });
  }
  return out;
}

export function groupByLieu(objets: ApiObjet[]): { lieu: string; objets: ApiObjet[] }[] {
  const out: { lieu: string; objets: ApiObjet[] }[] = [];
  const idx = new Map<string, number>();
  for (const o of objets) {
    const lieu = (o.lieu ?? "").trim() || "Lieu non précisé";
    if (!idx.has(lieu)) { idx.set(lieu, out.length); out.push({ lieu, objets: [] }); }
    out[idx.get(lieu)!].objets.push(o);
  }
  return out;
}
