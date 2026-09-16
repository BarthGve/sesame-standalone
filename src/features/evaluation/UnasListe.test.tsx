import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import UnasListe from "./UnasListe";
import type { UnaEvaluable } from "./evaluationApi";

const una = (p: Partial<UnaEvaluable> = {}): UnaEvaluable => ({
  una: "12345/00042/2026",
  groupe: "Groupe 1",
  synthese: "Cambriolages en série",
  urgent: false,
  sensible: false,
  nbPerquisitions: 2,
  nbObjets: 5,
  ...p,
});

test("affiche le numero, la synthese, le groupe et les compteurs", () => {
  render(<UnasListe unas={[una()]} unaChoisi="" onChoisir={() => {}} />);
  expect(screen.getByText(/12345\/00042\/2026/)).toBeTruthy();
  expect(screen.getByText(/Cambriolages en série/)).toBeTruthy();
  expect(screen.getByText(/Groupe 1/)).toBeTruthy();
  expect(screen.getByText(/2 perquisition/)).toBeTruthy();
  expect(screen.getByText(/5 objet/)).toBeTruthy();
});

test("signale urgent et sensible quand ils sont poses", () => {
  render(<UnasListe unas={[una({ urgent: true, sensible: true })]} unaChoisi="" onChoisir={() => {}} />);
  expect(screen.getByText("Urgent")).toBeTruthy();
  expect(screen.getByText("Sensible")).toBeTruthy();
});

test("n'affiche ni urgent ni sensible quand ils sont absents", () => {
  render(<UnasListe unas={[una()]} unaChoisi="" onChoisir={() => {}} />);
  expect(screen.queryByText("Urgent")).toBeNull();
  expect(screen.queryByText("Sensible")).toBeNull();
});

test("une procedure sans synthese ni groupe ne laisse pas de ligne vide", () => {
  const { container } = render(
    <UnasListe unas={[una({ synthese: null, groupe: null })]} unaChoisi="" onChoisir={() => {}} />
  );
  expect(screen.getByText(/12345\/00042\/2026/)).toBeTruthy();
  const vides = Array.from(container.querySelectorAll("p")).filter((p) => !p.textContent?.trim());
  expect(vides).toHaveLength(0);
});

test("choisir une procedure remonte son numero", () => {
  const onChoisir = vi.fn();
  render(<UnasListe unas={[una()]} unaChoisi="" onChoisir={onChoisir} />);
  screen.getByRole("button", { name: /12345\/00042\/2026/ }).click();
  expect(onChoisir).toHaveBeenCalledWith("12345/00042/2026");
});

test("la procedure choisie est marquee comme telle", () => {
  render(<UnasListe unas={[una()]} unaChoisi="12345/00042/2026" onChoisir={() => {}} />);
  expect(screen.getByRole("button", { name: /12345\/00042\/2026/ }).getAttribute("aria-pressed")).toBe("true");
});

test("liste vide : message explicite, pas d'ecran muet", () => {
  render(<UnasListe unas={[]} unaChoisi="" onChoisir={() => {}} />);
  expect(screen.getByText(/Aucune procédure/)).toBeTruthy();
});
