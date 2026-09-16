import type { ReactNode } from "react";
import { Button, ConfirmationModal, ModalSize } from "@gouvfr-lasuite/cunningham-react";

// Confirmation avant une action destructive, partagée par les boutons « Vider »
// (analyse d'audition, PV transport, RGP, Ariane). S'appuie sur la modale du
// design system : piège de focus, échappement et rôles ARIA sont pris en charge
// par Cunningham, rien n'est réimplémenté ici.
//
// Deux écarts assumés au comportement par défaut du composant :
//   - les actions sont fournies via `rightActions` plutôt que via `onDecide`.
//     Les libellés natifs viennent des traductions Cunningham, et l'application
//     monte son fournisseur sans locale (donc en-US) : « Yes » / « Cancel »
//     n'ont pas leur place dans une interface française.
//   - la croix de fermeture est masquée pour la même raison (son aria-label est
//     « close »). « Annuler » et la touche Échap couvrent la sortie.
//
// Le message n'a pas de valeur par défaut : chaque page nomme ce qu'elle
// détruit. Une confirmation qui ne dit pas ce qu'elle efface ne protège de rien.

export type ModaleConfirmationProps = {
  ouverte: boolean;
  titre: string;
  /** Libellé du bouton destructif — distinct de « Vider » pour rester sans ambiguïté. */
  libelleConfirmer: string;
  onConfirmer: () => void;
  onAnnuler: () => void;
  /** Ce que l'action détruit, en toutes lettres. */
  children: ReactNode;
};

export default function ModaleConfirmation({
  ouverte,
  titre,
  libelleConfirmer,
  onConfirmer,
  onAnnuler,
  children,
}: ModaleConfirmationProps) {
  // Fermée, la modale reste hors de l'arbre : les écrans qui ne l'ouvrent pas
  // n'ont pas à fournir le contexte Cunningham.
  if (!ouverte) return null;

  return (
    <ConfirmationModal
      isOpen
      size={ModalSize.SMALL}
      title={titre}
      titleIcon={
        <span className="material-icons" aria-hidden>
          warning
        </span>
      }
      hideCloseButton
      closeOnEsc
      closeOnClickOutside
      onClose={onAnnuler}
      // Neutralisé : les décisions passent par les boutons ci-dessous.
      onDecide={() => {}}
      rightActions={
        <>
          <Button variant="bordered" color="neutral" fullWidth onClick={onAnnuler}>
            Annuler
          </Button>
          <Button color="error" fullWidth onClick={onConfirmer}>
            {libelleConfirmer}
          </Button>
        </>
      }
    >
      {children}
    </ConfirmationModal>
  );
}
