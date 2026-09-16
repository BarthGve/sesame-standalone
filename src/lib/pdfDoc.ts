// Conversion du HTML de la proposition (et du cartouche de contexte) vers le
// format de contenu de pdfmake. Module PUR : aucune dépendance à pdfmake ni au
// navigateur au-delà de DOMParser, pour rester testable.
//
// Le PDF produit contient du VRAI TEXTE, sélectionnable et cherchable — ces
// documents sont destinés à une procédure, une capture d'image ne conviendrait
// pas.

export type Fragment = { text: string; bold?: boolean; italics?: boolean };
export type Bloc =
  | { text: string; style: string }
  | { text: Fragment[]; style: string }
  | { ul: Fragment[][]; style: string }
  | { ol: Fragment[][]; style: string }
  | { table: { headerRows: number; widths: string[]; body: Fragment[][] }; style: string };

const TITRES: Record<string, string> = { H1: "h1", H2: "h2", H3: "h3", H4: "h3", H5: "h3", H6: "h3" };

// Normalise les blancs du HTML (retours à la ligne d'indentation compris) sans
// toucher au contenu lui-même.
function propre(texte: string): string {
  return texte.replace(/\s+/g, " ").trim();
}

// Aplatit un élément en fragments, en propageant gras et italique.
// Les blancs sont réduits à une espace mais PAS supprimés en bord de fragment :
// c'est cette espace qui sépare « Il déclare » de « avoir vu » quand le second
// est en gras. Les bords de la ligne entière sont nettoyés par `bordsNets`.
function fragments(noeud: Node, bold = false, italics = false): Fragment[] {
  if (noeud.nodeType === Node.TEXT_NODE) {
    const texte = (noeud.textContent ?? "").replace(/\s+/g, " ");
    return texte ? [{ text: texte, ...(bold && { bold }), ...(italics && { italics }) }] : [];
  }
  if (noeud.nodeType !== Node.ELEMENT_NODE) return [];
  const balise = (noeud as Element).tagName;
  const g = bold || balise === "STRONG" || balise === "B";
  const i = italics || balise === "EM" || balise === "I";
  return Array.from(noeud.childNodes).flatMap((enfant) => fragments(enfant, g, i));
}

// Retire l'espace d'indentation en tête et en fin de ligne, puis les fragments
// devenus vides.
function bordsNets(parts: Fragment[]): Fragment[] {
  const nets = parts.map((f, i) => {
    let text = f.text;
    if (i === 0) text = text.replace(/^\s+/, "");
    if (i === parts.length - 1) text = text.replace(/\s+$/, "");
    return { ...f, text };
  });
  return nets.filter((f) => f.text);
}

function cellules(ligne: Element): Fragment[] {
  return Array.from(ligne.children).map((c) => ({
    text: propre(c.textContent ?? ""),
    ...(c.tagName === "TH" && { bold: true }),
  }));
}

function table(element: Element): Bloc | null {
  const lignes = Array.from(element.querySelectorAll("tr"));
  if (!lignes.length) return null;
  const body = lignes.map(cellules);
  const enTete = element.querySelector("thead tr") ? 1 : 0;
  return {
    style: "p",
    table: { headerRows: enTete, widths: body[0].map(() => "*"), body },
  };
}

// Parcourt le document : chaque élément de bloc rencontré produit un bloc
// pdfmake ; les conteneurs (section, div…) sont traversés sans rien produire.
function blocs(element: Element): Bloc[] {
  return Array.from(element.children).flatMap((enfant): Bloc[] => {
    const balise = enfant.tagName;

    if (TITRES[balise]) {
      const texte = propre(enfant.textContent ?? "");
      return texte ? [{ text: texte, style: TITRES[balise] }] : [];
    }
    if (balise === "P") {
      const parts = bordsNets(fragments(enfant));
      return parts.length ? [{ text: parts, style: "p" }] : [];
    }
    if (balise === "UL" || balise === "OL") {
      const items = Array.from(enfant.children)
        .map((li) => bordsNets(fragments(li)))
        .filter((f) => f.length);
      if (!items.length) return [];
      return [balise === "UL" ? { ul: items, style: "liste" } : { ol: items, style: "liste" }];
    }
    if (balise === "TABLE") {
      const t = table(enfant);
      return t ? [t] : [];
    }
    // Conteneur : on descend d'un cran.
    return blocs(enfant);
  });
}

export function htmlVersContenu(html: string): Bloc[] {
  if (!html.trim()) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  return blocs(doc.body);
}

// Nom de fichier : lisible, sans accent ni caractère interdit par les systèmes
// de fichiers, et sans laisser de tirets en double ou en bordure.
export function nomFichierPdf(nom: string, prenom: string): string {
  const identite = [nom, prenom]
    .map((p) =>
      p
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^A-Za-z0-9]+/g, "-")
    )
    .join("-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return identite ? `analyse-audition-${identite}.pdf` : "analyse-audition.pdf";
}
