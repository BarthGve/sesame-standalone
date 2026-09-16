import type { Role, Partie, Dossier } from "./arianeApi";

export const ROLE_ORDER: Role[] = ["mis_en_cause", "victime", "temoin", "enqueteur", "requis", "magistrat", "autre"];

export const ROLE_LABELS: Record<Role, string> = {
  mis_en_cause: "Mis en cause",
  victime: "Victimes",
  temoin: "Témoins",
  enqueteur: "Enquêteurs",
  requis: "Requis",
  magistrat: "Magistrats",
  autre: "Autres",
};

// Intitulés au singulier, pour désigner une partie précise et non un groupe.
export const ROLE_LABEL_SINGULIER: Record<Role, string> = {
  mis_en_cause: "Mis en cause",
  victime: "Victime",
  temoin: "Témoin",
  enqueteur: "Enquêteur",
  requis: "Requis",
  magistrat: "Magistrat",
  autre: "Autre",
};

export const ROLE_COLORS: Record<Role, string> = {
  mis_en_cause: "#e1000f",
  victime: "#0063cb",
  temoin: "#716043",
  enqueteur: "#000091",
  requis: "#68a532",
  magistrat: "#6e445a",
  autre: "#929292",
};

export const REL_LABELS: Record<string, string> = {
  famille: "famille",
  complice: "complice",
  connait: "connaît",
  victime_de: "victime de",
  auteur_victime: "auteur sur victime",
  entendu_par: "entendu par",
  requis_par: "requis par",
  autre: "lié à",
};

export function groupByRole(parties: Partie[]) {
  return ROLE_ORDER
    .map((role) => ({ role, label: ROLE_LABELS[role], color: ROLE_COLORS[role], parties: parties.filter((p) => p.role === role) }))
    .filter((g) => g.parties.length > 0);
}

// Orientation canonique des relations DIRIGÉES : le libellé se lit « source LABEL
// cible ». Le REDUCE (LLM) intervertit parfois source/cible, ce qui donne des
// flèches à contresens (un auteur qui pointe une victime avec « victime de »). On
// réoriente à partir des RÔLES quand le type porte une direction non ambiguë :
// { rôle attendu en source, rôle attendu en cible }. Types symétriques (famille,
// complice, connaît, autre) : absents d'ici, jamais réorientés.
const ORIENTATION: Record<string, { src: Role; dst: Role }> = {
  victime_de: { src: "victime", dst: "mis_en_cause" },     // « victime de » : victime → mis en cause
  auteur_victime: { src: "mis_en_cause", dst: "victime" }, // « auteur sur victime » : mis en cause → victime
  entendu_par: { src: "temoin", dst: "enqueteur" },        // cible = enquêteur (source = personne entendue)
  requis_par: { src: "requis", dst: "enqueteur" },         // cible = enquêteur/magistrat
};

// Réoriente un lien si les rôles indiquent qu'il est à l'envers. On ne swap QUE
// quand l'inversion est certaine : la cible actuelle porte le rôle attendu en
// source ET la source actuelle porte le rôle attendu en cible. Tout cas ambigu
// (rôle manquant, rôles non concluants) est laissé tel quel.
function orienter(type: string, source: string, cible: string, roleDe: (id: string) => Role | undefined): [string, string] {
  const o = ORIENTATION[type];
  if (!o) return [source, cible];
  if (roleDe(cible) === o.src && roleDe(source) === o.dst) return [cible, source];
  return [source, cible];
}

// Données pour react-force-graph : nœuds (parties) + liens (relations). Le lien
// garde ses cotes (clic → sélection) et son libellé. `source`/`target` sont des
// ids ; react-force-graph les remplace par les objets nœuds au premier rendu.
export type GraphNode = { id: string; nom: string; role: Role; color: string };
export type GraphLink = { source: string; target: string; label: string; cotes: string[] };
export type GraphData = { nodes: GraphNode[]; links: GraphLink[] };

export function buildForceData(dossier: Dossier): GraphData {
  const ids = new Set(dossier.parties.map((p) => p.id));
  const roleParId = new Map(dossier.parties.map((p) => [p.id, p.role]));
  const roleDe = (id: string) => roleParId.get(id);
  const nodes: GraphNode[] = dossier.parties.map((p) => ({
    id: p.id, nom: p.nom, role: p.role, color: ROLE_COLORS[p.role] ?? ROLE_COLORS.autre,
  }));
  // On n'inclut que les relations dont les deux extrémités existent : une arête
  // vers un id inconnu ferait planter le moteur de forces.
  const links: GraphLink[] = dossier.relations
    .filter((r) => ids.has(r.source) && ids.has(r.cible))
    .map((r) => {
      const [source, target] = orienter(r.type, r.source, r.cible, roleDe);
      return { source, target, label: REL_LABELS[r.type] ?? r.type, cotes: r.cotes };
    });
  return { nodes, links };
}

export type TimelineEntry = { id: string; date: string; libelle: string; cote: string; tag?: string };

const byDate = (a: TimelineEntry, b: TimelineEntry) => a.date.localeCompare(b.date);

// Un bordereau d'envoi judiciaire ne relate rien : il enumere les pieces transmises.
// Ce qu'un modele en tire — « faits » comme « actes » — n'est qu'un reflet des autres
// pieces du dossier, deja presentes dans les chronologies par leur source reelle. Il
// est donc ecarte des deux lignes de temps, ou il n'ajouterait que du bruit.
//
// Les deux graphies relevees sur des dossiers reels : « BEJ_… » et « BORDEREAU… ».
// Aucune autre n'est supposee : une piece nommee autrement resterait affichee.
const estBordereau = (cote: string) => /^(bej|bordereau)/i.test(cote.trim());

export function evenementsToEntries(dossier: Dossier): TimelineEntry[] {
  return dossier.evenements
    .filter((e) => !estBordereau(e.cote_source))
    .map((e) => ({ id: e.id, date: e.date, libelle: e.libelle, cote: e.cote_source }))
    .sort(byDate);
}

export function actesToEntries(dossier: Dossier): TimelineEntry[] {
  return dossier.actes
    .filter((a) => !estBordereau(a.cote))
    .map((a) => ({ id: a.id, date: a.date, libelle: a.libelle, cote: a.cote, tag: a.type }))
    .sort(byDate);
}
