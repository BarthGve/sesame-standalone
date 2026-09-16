import { beforeEach, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { pdfAvecXml, pdfSansPieceJointe } from "../../test/pdfAvecXml";
import XML_LRPGN from "../../fixtures/lrpgn-audition.xml?raw";

const KEY = "synthese:html";

beforeEach(() => {
  sessionStorage.clear();
  vi.resetModules();
});

test("setHtml persiste dans sessionStorage, clear le retire", async () => {
  const store = await import("./syntheseStore");
  store.setHtml("<p>bonjour</p>");
  expect(JSON.parse(sessionStorage.getItem(KEY)!).html).toBe("<p>bonjour</p>");
  store.clear();
  expect(sessionStorage.getItem(KEY)).toBeNull();
});

test("le html est réhydraté depuis sessionStorage au chargement du module", async () => {
  sessionStorage.setItem(KEY, "<p>déjà là</p>");
  const store = await import("./syntheseStore");
  const { result } = renderHook(() => store.useSynthese());
  expect(result.current.html).toBe("<p>déjà là</p>");
  expect(result.current.loading).toBe(false);
});

test("une pièce porteuse de XML alimente contexte et xml", async () => {
  const store = await import("./syntheseStore");
  store.setPieces([await pdfAvecXml(XML_LRPGN)]);
  await vi.waitFor(() => {
    expect(store.lireEtat().contexte?.personnes[0].nom).toBe("BIDULE");
  });
  expect(store.lireEtat().xml).toContain("<Procedure");
});

test("une pièce sans XML laisse contexte à null, sans erreur", async () => {
  const store = await import("./syntheseStore");
  store.setPieces([await pdfSansPieceJointe()]);
  await new Promise((r) => setTimeout(r, 20));
  expect(store.lireEtat().contexte).toBeNull();
  expect(store.lireEtat().xml).toBeNull();
  expect(store.lireEtat().error).toBeNull();
  expect(store.lireEtat().pieces).toHaveLength(1);
});

test("le XML survit à un rechargement et le contexte est reconstruit", async () => {
  const store = await import("./syntheseStore");
  store.setPieces([await pdfAvecXml(XML_LRPGN)]);
  await vi.waitFor(() => expect(store.lireEtat().contexte).not.toBeNull());
  store.setHtml("<h2>Faits</h2>");

  // Rechargement : le module est réévalué et relit sessionStorage.
  vi.resetModules();
  const recharge = await import("./syntheseStore");
  expect(recharge.lireEtat().html).toBe("<h2>Faits</h2>");
  expect(recharge.lireEtat().contexte?.personnes[0].nom).toBe("BIDULE");
  expect(recharge.lireEtat().pieces).toEqual([]);
  expect(recharge.lireEtat().loading).toBe(false);
});

test("un html persisté au format historique reste lisible", async () => {
  sessionStorage.setItem("synthese:html", "<p>ancienne analyse</p>");
  const store = await import("./syntheseStore");
  expect(store.lireEtat().html).toBe("<p>ancienne analyse</p>");
  expect(store.lireEtat().contexte).toBeNull();
});

test("clear remet le contexte à zéro", async () => {
  const store = await import("./syntheseStore");
  store.setPieces([await pdfAvecXml(XML_LRPGN)]);
  await vi.waitFor(() => expect(store.lireEtat().contexte).not.toBeNull());
  store.clear();
  expect(store.lireEtat().contexte).toBeNull();
  expect(store.lireEtat().xml).toBeNull();
});
