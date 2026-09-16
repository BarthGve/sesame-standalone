import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Convertit un texte Markdown (`##` titres, `-` listes, `**gras**`) en HTML.
//
// L'éditeur de proposition (TipTap, `PropositionEditor`) attend du HTML pour son
// `content` — lui passer du Markdown l'afficherait littéralement (« ## Objets
// évalués » au lieu d'un titre). L'export PDF (`htmlVersContenu`) part lui aussi
// du HTML. On convertit donc une fois, à l'entrée du résultat.
//
// On réutilise react-markdown + remark-gfm, exactement comme le rendu RENS
// (`RensResult`), pour une interprétation GFM identique partout — plutôt qu'un
// mini-parseur maison qui divergerait. `htmlVersContenu` sait lire les balises
// produites (h1-h6, p, ul/ol/li, strong/em, table).
export function markdownToHtml(md: string): string {
  if (!md || !md.trim()) return "";
  return renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: [remarkGfm] }, md)
  );
}
