import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import DropZone from "./DropZone";

const fichier = (name: string, taille: number, type: string) =>
  new File([new Uint8Array(taille)], name, { type });
const pdf = (name: string, taille: number) => fichier(name, taille, "application/pdf");

const base = { files: [], onRemove: () => {}, quoi: "les pièces", hint: "PDF · 5 o max" };

describe("DropZone", () => {
  it("ne retient au dépôt que les fichiers conformes à accept et sous la taille limite", () => {
    const onFiles = vi.fn();
    render(<DropZone {...base} onFiles={onFiles} accept=".pdf" maxBytes={5} multiple />);
    fireEvent.drop(screen.getByRole("button", { name: /déposer/i }), {
      dataTransfer: {
        files: [
          pdf("ok.pdf", 2),                       // gardé
          pdf("trop-gros.pdf", 10),               // écarté (taille)
          fichier("note.txt", 2, "text/plain"),   // écarté (hors accept)
        ],
      },
    });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect((onFiles.mock.calls[0][0] as File[]).map((f) => f.name)).toEqual(["ok.pdf"]);
  });

  it("accept par extension multiple (jpg/png/pdf/docx/odt)", () => {
    const onFiles = vi.fn();
    render(<DropZone {...base} onFiles={onFiles} accept=".jpg,.png,.pdf,.docx,.odt" maxBytes={99} multiple />);
    fireEvent.drop(screen.getByRole("button", { name: /déposer/i }), {
      dataTransfer: { files: [fichier("photo.png", 2, "image/png"), fichier("acte.docx", 2, ""), fichier("x.exe", 2, "")] },
    });
    expect((onFiles.mock.calls[0][0] as File[]).map((f) => f.name)).toEqual(["photo.png", "acte.docx"]);
  });

  it("mode pièce unique : ne remonte qu'un fichier même si plusieurs sont déposés", () => {
    const onFiles = vi.fn();
    render(<DropZone {...base} onFiles={onFiles} accept=".pdf" maxBytes={99} />);
    fireEvent.drop(screen.getByRole("button", { name: /déposer/i }), {
      dataTransfer: { files: [pdf("a.pdf", 2), pdf("b.pdf", 2)] },
    });
    expect((onFiles.mock.calls[0][0] as File[]).map((f) => f.name)).toEqual(["a.pdf"]);
  });

  it("liste les pièces et permet d'en retirer une", () => {
    const onRemove = vi.fn();
    render(<DropZone {...base} onFiles={() => {}} files={[pdf("D1.pdf", 2), pdf("D2.pdf", 2)]} onRemove={onRemove} accept=".pdf" maxBytes={99} multiple />);
    expect(screen.getByText("D1.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Retirer D2.pdf"));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it("désactivé : pas de dépôt pris en compte", () => {
    const onFiles = vi.fn();
    render(<DropZone {...base} onFiles={onFiles} accept=".pdf" maxBytes={99} disabled />);
    fireEvent.drop(screen.getByRole("button", { name: /déposer/i }), { dataTransfer: { files: [pdf("ok.pdf", 2)] } });
    expect(onFiles).not.toHaveBeenCalled();
  });
});
