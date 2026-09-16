import { expect, test } from "vitest";
import { markdownToHtml } from "./markdownToHtml";

test("convertit titres, listes et gras en HTML", () => {
  const html = markdownToHtml("## Objets évalués\n\n- Un\n- Deux\n\n**Total** 100 €");
  expect(html).toContain("<h2>Objets évalués</h2>");
  expect(html).toContain("<ul>");
  expect(html).toContain("<li>Un</li>");
  expect(html).toContain("<strong>Total</strong>");
  // Plus aucune syntaxe Markdown brute ne subsiste.
  expect(html).not.toContain("##");
  expect(html).not.toContain("**");
});

test("une entrée vide donne une chaîne vide", () => {
  expect(markdownToHtml("")).toBe("");
  expect(markdownToHtml("   \n  ")).toBe("");
});

// htmlVersContenu (export PDF) lit h1-h6, p, ul/ol/li, strong/em : la sortie doit
// tenir dans ce sous-ensemble, pas de balises exotiques à parser.
test("produit des balises lisibles par htmlVersContenu", () => {
  const html = markdownToHtml("# Titre\n\nUn paragraphe.");
  expect(html).toContain("<h1>Titre</h1>");
  expect(html).toContain("<p>Un paragraphe.</p>");
});
