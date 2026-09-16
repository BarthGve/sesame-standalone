// Conversion du contexte LRPGN (XML embarque dans le PDF) en metadonnees Ariane.
// Fonction pure : aucun acces DOM, aucun reseau. Le parsing XML a deja eu lieu.
//
// Deux regles du projet s'appliquent ici :
//  - aucune valeur devinee : une implication hors vocabulaire donne "autre" et un
//    avertissement qui la nomme, jamais une correspondance approchee ;
//  - toute date entre au format ISO, celui du MAP et donc celui de la cle de
//    coreference. Une date non reconnue vaut "" : mieux vaut pas de discriminant
//    qu'un discriminant faux, qui separerait deux mentions d'une meme personne.
import type { ContexteProcedure } from "../../lib/lrpgn/lrpgn";
import { formatCote } from "./cotes";

export type MetaPersonne = { nom: string; prenom: string; naissance: string; role: string };

// Metadonnees qui qualifient le DOCUMENT, jointes a l'ingestion RAG a cote de la cote.
// Tous les champs sont facultatifs : une source vide donne un champ absent, jamais un
// champ vide — une chaine vide se retrouverait telle quelle dans la reponse du modele.
export type MetaDocument = {
  type_piece?: string;
  date_acte?: string;
  redacteur?: string;
  unite?: string;
  procedure?: string;
  nature_fait?: string;
  natinf?: string;
  personne_concernee?: string;
};

export type MetaPiece = { personnes: MetaPersonne[]; avertissements: string[]; document?: MetaDocument };

// Seul VICTIME est confirme par la fixture reelle. Les autres valeurs seront
// ajoutees au vu de XML reels, pas par supposition.
// Vocabulaire releve sur des XML LRPGN reels, jamais suppose. Les cles sont ecrites
// sans accent : la recherche depouille les accents, de sorte que "TÉMOIN" et "TEMOIN"
// designent le meme role au lieu de produire deux avertissements distincts.
const IMPLICATIONS: Record<string, string> = {
  VICTIME: "victime",
  TEMOIN: "temoin",
  "MIS EN CAUSE": "mis_en_cause",
  // Graphie inclusive relevee en production. La variante purement feminine
  // ("MISE EN CAUSE") n'est pas ajoutee : elle n'a pas ete observee, et le projet
  // n'inscrit que des codes constates. Si elle apparait, l'avertissement la nommera.
  "MIS(E) EN CAUSE": "mis_en_cause",
};

// Casse repliee et accents retires. L'avertissement, lui, cite le code TEL QU'IL EST
// ecrit dans le XML : c'est cette graphie que l'utilisateur retrouvera dans ses pieces.
function normaliserCode(implication: string): string {
  return implication.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

// "21/02/1985" → "1985-02-21". Toute autre forme rend "" plutot qu'une date fausse.
function versIso(date: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date.trim());
  if (!m) return "";
  const [, jour, mois, annee] = m;
  if (+mois < 1 || +mois > 12 || +jour < 1 || +jour > 31) return "";
  return `${annee}-${mois}-${jour}`;
}

export function contexteVersMeta(contexte: ContexteProcedure | null): MetaPiece | null {
  // Pas de contexte, ou XML sans aucune personne : rien a produire.
  if (!contexte || contexte.personnes.length === 0) return null;
  const personnes: MetaPersonne[] = [];
  const avertissements: string[] = [];
  for (const p of contexte.personnes) {
    const nom = p.nom.trim();
    const prenom = p.prenom.trim();
    if (!nom && !prenom) continue; // sans nom exploitable, la personne n'identifie rien
    const role = IMPLICATIONS[normaliserCode(p.implication)];
    if (!role) {
      const message = `Implication inconnue : ${p.implication.trim()}`;
      if (!avertissements.includes(message)) avertissements.push(message);
    }
    personnes.push({ nom, prenom, naissance: versIso(p.naissanceDate), role: role ?? "autre" });
  }
  return { personnes, avertissements };
}

// N'inscrit la cle que si la valeur est non vide, une fois les espaces retires.
function poser(cible: Record<string, string>, cle: keyof MetaDocument, valeur: string | undefined) {
  const v = (valeur ?? "").trim();
  if (v) cible[cle] = v;
}

// Le libelle de formatCote n'est exploitable que si le nom de fichier suit la
// convention LRPGN : sinon la fonction rend le nom de fichier brut, qui n'est pas un
// type d'acte. La date, elle, ne vient jamais du nom de fichier : le XML porte l'acte
// dans une forme deja lisible ("vendredi 21 fevrier 2025"), c'est celle-la qui sert.
function typePiece(nomFichier: string): string {
  const { date, libelle } = formatCote(nomFichier.replace(/\.[^.]+$/, ""));
  return date ? libelle : "";
}

// Identite des personnes visees par la piece, dans l'ordre du XML — celui de la piece.
// Aucun tri : l'ordre de la source est deterministe et porte un sens (la victime y
// precede generalement les temoins).
//
// L'etat civil est ici assume, et non subi : voir la spec RAG chat, §8bis.
function personnesConcernees(contexte: ContexteProcedure): string {
  return contexte.personnes
    .map((p) => [p.prenom.trim(), p.nom.trim()].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(", ");
}

// Metadonnees de document a partir du contexte XML et du nom de fichier. Fonction pure :
// le parsing XML a deja eu lieu, il n'y a ici ni DOM ni reseau.
//
// Sans contexte XML, on rend null meme si le nom de fichier suffirait a deduire le type
// d'acte : une piece sans XML s'ingere avec sa seule cote, c'est le contrat.
export function contexteVersMetaDocument(contexte: ContexteProcedure | null, nomFichier: string): MetaDocument | null {
  if (!contexte) return null;
  const doc: Record<string, string> = {};
  poser(doc, "type_piece", typePiece(nomFichier));
  poser(doc, "date_acte", contexte.procedure.dateActe);
  poser(doc, "redacteur", contexte.enqueteurs[0]?.nom);
  poser(doc, "unite", contexte.procedure.unite);
  const numero = contexte.procedure.numero.trim();
  const annee = contexte.procedure.annee.trim();
  poser(doc, "procedure", numero && annee ? `${numero}/${annee}` : numero);
  poser(doc, "nature_fait", contexte.faits[0]?.libelle);
  poser(doc, "natinf", contexte.faits[0]?.natinf);
  poser(doc, "personne_concernee", personnesConcernees(contexte));
  // Un XML present mais vide de bout en bout ne vaut pas mieux que pas d'XML.
  return Object.keys(doc).length > 0 ? doc : null;
}
