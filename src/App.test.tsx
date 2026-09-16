import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import App from "./App";
import { setHtml, clear as clearSynthese } from "./features/synthese/syntheseStore";

vi.mock("maplibre-gl", () => import("./test/maplibre-mock"));

beforeEach(() => {
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  clearSynthese();
});

function renderApp() {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /^Entrer$/i }));
}

test("la route / affiche la page d'accueil", () => {
  render(<App />);
  expect(screen.getByRole("button", { name: /^Entrer$/i })).toBeInTheDocument();
  expect(document.documentElement.innerHTML).not.toMatch(
    /lasuite\.numerique|lagaufre/i
  );
});

test("le bouton Entrer amène sur /app/accueil", () => {
  renderApp();
  expect(window.location.pathname).toBe("/app/accueil");
});

test("la route /app/accueil affiche l'écran Accueil", () => {
  window.history.pushState({}, "", "/app/accueil");
  render(<App />);
  expect(screen.getByRole("heading", { name: /Enjeu et objectifs/i })).toBeInTheDocument();
});

test("la route /app (index) redirige vers l'accueil", () => {
  window.history.pushState({}, "", "/app");
  render(<App />);
  expect(window.location.pathname).toBe("/app/accueil");
  expect(screen.getByRole("heading", { name: /Enjeu et objectifs/i })).toBeInTheDocument();
});

test("lien direct vers /app/analyse affiche l'écran d'analyse", () => {
  window.history.pushState({}, "", "/app/analyse");
  render(<App />);
  expect(screen.getByRole("heading", { name: /Analyse d'audition/i })).toBeInTheDocument();
});

test("une route inconnue hors /app renvoie sur la page d'accueil", () => {
  window.history.pushState({}, "", "/nimporte-quoi");
  render(<App />);
  expect(screen.getByRole("button", { name: /^Entrer$/i })).toBeInTheDocument();
  expect(window.location.pathname).toBe("/");
});

test("le logo du header ramène sur la page d'accueil (landing)", () => {
  window.history.pushState({}, "", "/app/analyse");
  render(<App />);
  fireEvent.click(screen.getByRole("link", { name: /Retour à l'accueil/i }));
  expect(window.location.pathname).toBe("/");
  expect(screen.getByRole("button", { name: /^Entrer$/i })).toBeInTheDocument();
});

test("le menu affiche une pastille d'état quand une page a un résultat", () => {
  setHtml("<p>synthèse prête</p>"); // page Analyse → statut « terminé »
  window.history.pushState({}, "", "/app/accueil");
  render(<App />);
  const pastille = screen.getByRole("status", { name: /terminé/i });
  expect(pastille).toBeInTheDocument();
});

test("visiter la page concernée efface son badge vert (notification lue)", () => {
  setHtml("<p>synthèse prête</p>"); // Analyse a un résultat…
  window.history.pushState({}, "", "/app/analyse"); // …mais on est dessus → badge lu.
  render(<App />);
  expect(screen.queryByRole("status", { name: /terminé/i })).toBeNull();
});

test("la sidebar navigue entre les pages via les liens", () => {
  window.history.pushState({}, "", "/app/accueil");
  render(<App />);
  fireEvent.click(screen.getByRole("link", { name: /^Perquisitions$/i }));
  expect(window.location.pathname).toBe("/app/saisies");
  expect(screen.getByRole("heading", { name: /Choisir une procédure/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: /^Carte BDSP$/i }));
  expect(window.location.pathname).toBe("/app/carte");
  expect(screen.getByRole("heading", { name: /Interroger la base BDSP/i })).toBeInTheDocument();
});
