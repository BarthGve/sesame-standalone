import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PartiesView from "./PartiesView";
import Timeline from "./Timeline";
import type { Dossier } from "./arianeApi";
import { evenementsToEntries } from "./graph";

const dossier: Dossier = {
  affaire: { reference: "r", nature: "Vol", service: "BR", periode: { debut: "2026-03-04", fin: "2026-03-06" }, nb_cotes: 1 },
  synthese: "## Synthèse\n\ntexte",
  parties: [{ id: "p1", nom: "DUPONT", role: "mis_en_cause", aliases: ["le suspect"], qualite: "sans profession", premiere_cote: "D1" }],
  evenements: [{ id: "e1", date: "2026-03-04", precision: "jour", libelle: "effraction", cote_source: "D2", parties: ["p1"] }],
  actes: [], relations: [],
};

describe("vues Ariane", () => {
  it("PartiesView affiche le nom et le rôle", () => {
    render(<PartiesView dossier={dossier} />);
    expect(screen.getByText("DUPONT")).toBeTruthy();
    expect(screen.getByText(/Mis en cause/i)).toBeTruthy();
  });

  it("PartiesView n'échoue pas si une partie n'a pas d'aliases", () => {
    const dossierSansAliases: Dossier = {
      ...dossier,
      parties: [{ id: "p1", nom: "SANS", role: "temoin", qualite: "", premiere_cote: "D1" } as unknown as import("./arianeApi").Partie],
    };
    render(<PartiesView dossier={dossierSansAliases} />);
    expect(screen.getByText("SANS")).toBeTruthy();
  });

  it("Timeline affiche l'entrée et déclenche onSelectCote au clic sur la cote", () => {
    const onSelectCote = vi.fn();
    render(<Timeline entries={evenementsToEntries(dossier)} onSelectCote={onSelectCote} />);
    expect(screen.getByText("effraction")).toBeTruthy();
    fireEvent.click(screen.getByText("D2"));
    expect(onSelectCote).toHaveBeenCalledWith("D2");
  });

  it("Timeline affiche les dates au format francais, pas en ISO", () => {
    render(<Timeline entries={[{ id: "e1", date: "2012-12-01", libelle: "fait", cote: "D1" }]} onSelectCote={vi.fn()} />);
    expect(screen.getByText("01/12/2012")).toBeTruthy();
    expect(screen.queryByText("2012-12-01")).toBeNull();
  });

  it("PartiesView affiche l'historique des rôles quand il existe", async () => {
    const { default: PartiesView } = await import("./PartiesView");
    const dossier = {
      affaire: { reference: "r", nature: "Vol", service: "BR", periode: { debut: null, fin: null }, nb_cotes: 2 },
      synthese: "s", evenements: [], actes: [], relations: [],
      parties: [{ id: "p1", nom: "Marc BIDULE", role: "mis_en_cause", aliases: [], qualite: "", premiere_cote: "D3",
                  roles: [{ role: "temoin", cote: "D3" }, { role: "mis_en_cause", cote: "D9" }] }],
    };
    render(<PartiesView dossier={dossier as never} />);
    // Les roles sont nommes une fois chacun, et leurs cotes deviennent des reperes
    // distincts — plus « Temoin en D3 · Mis en cause en D9 » recopie en toutes lettres.
    expect(screen.getByText("Témoin")).toBeTruthy();
    // « Mis en cause » apparait deux fois : en-tete de section (role principal) et
    // sur la fiche, ou il rattache la cote au bon role.
    expect(screen.getAllByText("Mis en cause").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("D3")).toBeTruthy();
    expect(screen.getByText("D9")).toBeTruthy();
  });
});
