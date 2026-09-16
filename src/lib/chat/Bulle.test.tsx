import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Bulle, BoutonCopier, Indicateur } from "./Bulle";

describe("Bulle", () => {
  it("aplatit le coin bas droit cote utilisateur", () => {
    const { container } = render(<Bulle from="user">Bonjour</Bulle>);
    const bulle = container.querySelector(".rgp-msg > div") as HTMLElement;
    expect(bulle.style.borderRadius).toBe("18px");
    expect(bulle.style.borderBottomRightRadius).toBe("5px");
    expect(bulle.style.borderBottomLeftRadius).toBe("18px");
  });

  it("aplatit le coin bas gauche cote reponse", () => {
    const { container } = render(<Bulle from="bot">Reponse</Bulle>);
    const bulle = container.querySelector(".rgp-msg > div") as HTMLElement;
    expect(bulle.style.borderBottomLeftRadius).toBe("5px");
    expect(bulle.style.borderBottomRightRadius).toBe("18px");
  });

  it("applique des largeurs distinctes selon l'expediteur", () => {
    const { container: cu } = render(<Bulle from="user">Q</Bulle>);
    const { container: cb } = render(<Bulle from="bot">R</Bulle>);
    expect((cu.querySelector(".rgp-msg > div") as HTMLElement).style.maxWidth).toBe("78%");
    expect((cb.querySelector(".rgp-msg > div") as HTMLElement).style.maxWidth).toBe("88%");
  });

  it("utilise la variable de charte pour le fond des bulles utilisateur", () => {
    const { container } = render(<Bulle from="user">Q</Bulle>);
    const bulle = container.querySelector(".rgp-msg > div") as HTMLElement;
    expect(bulle.getAttribute("style")).toContain("--c--contextuals--background--semantic--brand--primary");
  });

  it("conserve les retours a la ligne quand on le demande", () => {
    const { container } = render(<Bulle from="bot" preserverLignes>{"a\nb"}</Bulle>);
    expect((container.querySelector(".rgp-msg > div") as HTMLElement).style.whiteSpace).toBe("pre-wrap");
  });

  it("ne force pas pre-wrap par defaut", () => {
    const { container } = render(<Bulle from="bot">texte</Bulle>);
    expect((container.querySelector(".rgp-msg > div") as HTMLElement).style.whiteSpace).toBe("");
  });

  it("porte role=alert quand la bulle signale une erreur", () => {
    render(<Bulle from="bot" alert>Service indisponible</Bulle>);
    expect(screen.getByRole("alert").textContent).toBe("Service indisponible");
  });

  it("n'affiche le bouton copier que si un texte est fourni", () => {
    const { rerender } = render(<Bulle from="bot">Reponse</Bulle>);
    expect(screen.queryByRole("button", { name: /copier/i })).toBeNull();
    rerender(<Bulle from="bot" copyText="Reponse">Reponse</Bulle>);
    expect(screen.getByRole("button", { name: /copier/i })).toBeTruthy();
  });
});

describe("BoutonCopier", () => {
  it("ecrit le texte dans le presse-papiers et confirme", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<BoutonCopier text="a copier" />);
    fireEvent.click(screen.getByRole("button", { name: /copier le contenu/i }));
    expect(writeText).toHaveBeenCalledWith("a copier");
    await waitFor(() => expect(screen.getByRole("button", { name: /copié/i })).toBeTruthy());
  });

  it("reste silencieux si le presse-papiers est indisponible", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("refuse"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<BoutonCopier text="a copier" />);
    fireEvent.click(screen.getByRole("button", { name: /copier le contenu/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /copier le contenu/i })).toBeTruthy();
  });
});

describe("Indicateur", () => {
  it("affiche trois points animes dans une bulle de reponse", () => {
    const { container } = render(<Indicateur />);
    const points = container.querySelector(".rgp-typing") as HTMLElement;
    expect(points).toBeTruthy();
    expect(points.getAttribute("aria-label")).toMatch(/rédige/i);
    expect(points.querySelectorAll("span").length).toBe(3);
  });
});
