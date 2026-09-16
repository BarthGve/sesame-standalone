import { expect, test } from "vitest";
import { htmlVersContenu, nomFichierPdf } from "./pdfDoc";

test("les titres portent leur niveau", () => {
  const c = htmlVersContenu("<h1>Analyse</h1><h2>Faits</h2><h3>Détail</h3>");
  expect(c).toEqual([
    { text: "Analyse", style: "h1" },
    { text: "Faits", style: "h2" },
    { text: "Détail", style: "h3" },
  ]);
});

test("un paragraphe devient du texte simple", () => {
  expect(htmlVersContenu("<p>Le témoin déclare avoir vu.</p>")).toEqual([
    { text: [{ text: "Le témoin déclare avoir vu." }], style: "p" },
  ]);
});

test("gras et italique sont conservés", () => {
  const c = htmlVersContenu("<p>Il déclare <strong>avoir vu</strong> et <em>entendu</em>.</p>");
  expect(c[0]).toEqual({
    style: "p",
    text: [
      { text: "Il déclare " },
      { text: "avoir vu", bold: true },
      { text: " et " },
      { text: "entendu", italics: true },
      { text: "." },
    ],
  });
});

test("les listes deviennent des listes pdfmake", () => {
  const c = htmlVersContenu("<ul><li>Premier</li><li>Second</li></ul>");
  expect(c).toEqual([
    { ul: [[{ text: "Premier" }], [{ text: "Second" }]], style: "liste" },
  ]);
  const o = htmlVersContenu("<ol><li>Un</li></ol>");
  expect(o).toEqual([{ ol: [[{ text: "Un" }]], style: "liste" }]);
});

test("un tableau devient une table à largeurs réparties", () => {
  const c = htmlVersContenu(
    "<table><thead><tr><th>Champ</th><th>Valeur</th></tr></thead><tbody><tr><td>Nom</td><td>BIDULE</td></tr></tbody></table>"
  );
  expect(c).toEqual([
    {
      style: "p",
      table: {
        headerRows: 1,
        widths: ["*", "*"],
        body: [
          [
            { text: "Champ", bold: true },
            { text: "Valeur", bold: true },
          ],
          [{ text: "Nom" }, { text: "BIDULE" }],
        ],
      },
    },
  ]);
});

test("le cartouche de contexte est rendu comme du texte, pas ignoré", () => {
  const cartouche =
    '<section aria-label="Contexte de la procédure"><p>Personne entendue</p><p>BIDULE Marc VICTIME</p></section>';
  const c = htmlVersContenu(cartouche);
  const texte = JSON.stringify(c);
  expect(texte).toContain("Personne entendue");
  expect(texte).toContain("BIDULE Marc");
});

test("les blancs superflus disparaissent, les paragraphes vides aussi", () => {
  expect(htmlVersContenu("<p>   </p><p>\n  Texte  \n</p>")).toEqual([
    { text: [{ text: "Texte" }], style: "p" },
  ]);
});

test("html vide → contenu vide", () => {
  expect(htmlVersContenu("")).toEqual([]);
});

test("le nom de fichier reprend la personne entendue quand elle est connue", () => {
  expect(nomFichierPdf("BIDULE", "Marc")).toBe("analyse-audition-BIDULE-Marc.pdf");
  expect(nomFichierPdf("", "")).toBe("analyse-audition.pdf");
});

test("le nom de fichier est assaini des caractères interdits", () => {
  expect(nomFichierPdf("DE LA/CROIX", "Jean-Éric")).toBe("analyse-audition-DE-LA-CROIX-Jean-Eric.pdf");
});
