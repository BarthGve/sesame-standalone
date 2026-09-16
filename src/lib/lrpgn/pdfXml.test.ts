import { expect, test } from "vitest";
import { extraireXmlPdf } from "./pdfXml";
import { pdfAvecXml, pdfSansPieceJointe } from "../../test/pdfAvecXml";

const XML =
  '<?xml version="1.0" encoding="UTF-8"?><Procedure><Entete><Code_Unite>04340</Code_Unite></Entete></Procedure>';

test("restitue le XML embarqué d'un PDF", async () => {
  expect(await extraireXmlPdf(await pdfAvecXml(XML))).toBe(XML);
});

test("PDF sans pièce jointe → null", async () => {
  expect(await extraireXmlPdf(await pdfSansPieceJointe())).toBeNull();
});

test("flux compressé corrompu → null, sans lever", async () => {
  const sain = new Uint8Array(await (await pdfAvecXml(XML)).arrayBuffer());
  // Casse les octets du flux compressé, après l'en-tête de l'objet PDF.
  const debut = sain.indexOf(0x0a, sain.indexOf(0x3e)) + 1; // après "stream\n"
  sain.fill(0x41, debut + 2, debut + 12);
  const casse = new File([sain], "pv.pdf", { type: "application/pdf" });
  expect(await extraireXmlPdf(casse)).toBeNull();
});

test("pièce jointe qui n'est pas une procédure LRPGN → null", async () => {
  expect(await extraireXmlPdf(await pdfAvecXml("<Autre>rien</Autre>"))).toBeNull();
});

test("un dictionnaire dont une valeur contient « stream » n'égare pas l'extraction", async () => {
  // Cas réel constaté sur un PV LRPGN : /Subtype/application#2foctet-stream
  // contient la sous-chaîne « stream » avant le vrai mot-clé qui ouvre le
  // flux. `pdfAvecXml` reproduit ce dictionnaire ; l'extraction doit passer
  // outre cette occurrence fortuite et retrouver le vrai flux.
  expect(await extraireXmlPdf(await pdfAvecXml(XML))).toBe(XML);
});
