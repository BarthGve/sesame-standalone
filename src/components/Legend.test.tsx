import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Legend from "./Legend";

const data = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [2,48] }, properties: { _layer: "eoliennes" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [3,49] }, properties: { _layer: "interv" } },
  ],
  meta: {
    layers: [
      { id: "eoliennes", label: "Éoliennes", count: 46 },
      { id: "interv", label: "Interventions (pendaison)", count: 7 },
    ],
    coverage_note: "Constructions : Grand Est ; interventions : mai-juin 2026.",
  },
} as any;

describe("Legend", () => {
  it("affiche une entrée par couche depuis meta.layers, avec label et count", () => {
    render(<Legend data={data} show={{}} onToggle={() => {}} />);
    expect(screen.getByText(/Éoliennes/)).toBeInTheDocument();
    expect(screen.getByText(/46/)).toBeInTheDocument();
    expect(screen.getByText(/Interventions/)).toBeInTheDocument();
    expect(screen.getByText(/Grand Est/)).toBeInTheDocument();
  });
  it("toggle appelle onToggle avec l'id de couche", () => {
    const onToggle = vi.fn();
    render(<Legend data={data} show={{}} onToggle={onToggle} />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onToggle).toHaveBeenCalledWith("eoliennes");
  });
});
