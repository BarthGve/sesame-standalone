import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import BarreProgression from "./BarreProgression";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("annonce l'analyse en cours et son avancement", () => {
  render(<BarreProgression />);
  const barre = screen.getByRole("progressbar");
  expect(barre.getAttribute("aria-valuenow")).toBe("0");
  expect(screen.getByText(/Analyse en cours/)).toBeTruthy();
});

test("l'avancement progresse avec le temps", () => {
  render(<BarreProgression />);
  const barre = screen.getByRole("progressbar");
  act(() => vi.advanceTimersByTime(3000));
  const apres3s = Number(barre.getAttribute("aria-valuenow"));
  expect(apres3s).toBeGreaterThan(0);
  act(() => vi.advanceTimersByTime(10000));
  expect(Number(barre.getAttribute("aria-valuenow"))).toBeGreaterThan(apres3s);
});

test("l'avancement ralentit et ne prétend jamais être terminé", () => {
  render(<BarreProgression />);
  const barre = screen.getByRole("progressbar");
  // Bien au-delà d'une analyse normale : la barre plafonne sous 100.
  act(() => vi.advanceTimersByTime(600000));
  expect(Number(barre.getAttribute("aria-valuenow"))).toBeLessThan(100);
});

test("affiche le temps écoulé en secondes", () => {
  const { container } = render(<BarreProgression />);
  expect(container.textContent).toContain("0 s");
  // L'affichage se met à jour à chaque intervalle (300 ms) : on laisse passer
  // le tick qui suit la 5e seconde.
  act(() => vi.advanceTimersByTime(5100));
  expect(container.textContent).toContain("5 s");
});
