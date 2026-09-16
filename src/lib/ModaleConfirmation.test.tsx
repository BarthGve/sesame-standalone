import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CunninghamProvider } from "@gouvfr-lasuite/cunningham-react";
import ModaleConfirmation from "./ModaleConfirmation";

// La modale s'appuie sur le composant Cunningham, qui exige le contexte du
// design system : les tests montent donc le même fournisseur que src/App.tsx.
function rendre(props: Partial<React.ComponentProps<typeof ModaleConfirmation>> = {}) {
  const onConfirmer = vi.fn();
  const onAnnuler = vi.fn();
  const rendu = render(
    <CunninghamProvider theme="dsfr-light">
      <ModaleConfirmation
        ouverte
        titre="Vider le dossier ?"
        libelleConfirmer="Vider le dossier"
        onConfirmer={onConfirmer}
        onAnnuler={onAnnuler}
        {...props}
      >
        Vider efface le dossier analysé.
      </ModaleConfirmation>
    </CunninghamProvider>
  );
  return { onConfirmer, onAnnuler, ...rendu };
}

describe("ModaleConfirmation", () => {
  it("fermée, ne rend rien : les écrans qui ne l'ouvrent pas gardent leur arbre inchangé", () => {
    const { container } = rendre({ ouverte: false });
    expect(container.textContent).toBe("");
    expect(document.body.textContent).not.toMatch(/Vider efface le dossier/);
  });

  it("ouverte, annonce le titre, le message et deux actions en français", () => {
    rendre();
    expect(screen.getByText("Vider le dossier ?")).toBeTruthy();
    expect(screen.getByText(/Vider efface le dossier analysé/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Vider le dossier" })).toBeTruthy();
    // Aucun libellé anglais hérité du fournisseur Cunningham (locale par défaut en-US).
    expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("confirmer déclenche onConfirmer, et lui seul", () => {
    const { onConfirmer, onAnnuler } = rendre();
    fireEvent.click(screen.getByRole("button", { name: "Vider le dossier" }));
    expect(onConfirmer).toHaveBeenCalledTimes(1);
    expect(onAnnuler).not.toHaveBeenCalled();
  });

  it("la touche Échap emprunte la voie de l'annulation", () => {
    const { onConfirmer, onAnnuler } = rendre();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape", keyCode: 27 });
    expect(onAnnuler).toHaveBeenCalledTimes(1);
    expect(onConfirmer).not.toHaveBeenCalled();
  });

  it("annuler déclenche onAnnuler, et lui seul", () => {
    const { onConfirmer, onAnnuler } = rendre();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(onAnnuler).toHaveBeenCalledTimes(1);
    expect(onConfirmer).not.toHaveBeenCalled();
  });
});

// REGRESSION : en production, App.tsx monte le CunninghamProvider d'ui-kit, qui est
// un composant DISTINCT de celui de cunningham-react — dont cette modale consomme le
// contexte. Montee sous le seul fournisseur d'ui-kit, elle levait
// « useCunningham must be used within a CunninghamProvider », erreur qu'aucun test
// ne voyait puisqu'ils montaient tous le fournisseur de cunningham-react.
it("s'affiche sous le fournisseur d'ui-kit, comme en production", async () => {
  const { CunninghamProvider: ProviderUiKit } = await import("@gouvfr-lasuite/ui-kit");
  const { CunninghamProvider: ProviderBase } = await import("@gouvfr-lasuite/cunningham-react");
  render(
    <ProviderUiKit theme="dsfr-light" currentLocale="fr-FR">
      <ProviderBase theme="dsfr-light" currentLocale="fr-FR">
        <ModaleConfirmation ouverte titre="Vider" libelleConfirmer="Vider" onConfirmer={vi.fn()} onAnnuler={vi.fn()}>
          Le travail en cours sera perdu.
        </ModaleConfirmation>
      </ProviderBase>
    </ProviderUiKit>,
  );
  expect(screen.getByText("Le travail en cours sera perdu.")).toBeTruthy();
});
