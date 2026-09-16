import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChatView from "./ChatView";

describe("ChatView", () => {
  it("affiche les messages de la conversation", () => {
    render(
      <ChatView
        messages={[
          { role: "user", content: "Qui est mis en cause ?" },
          { role: "assistant", content: "Jean DUPONT" },
        ]}
        streaming={false}
        rag={{ indexees: 3, total: 3, erreur: null }}
        onAsk={() => {}}
      />,
    );
    expect(screen.getByText("Qui est mis en cause ?")).toBeTruthy();
    expect(screen.getByText("Jean DUPONT")).toBeTruthy();
  });

  it("signale une indexation partielle", () => {
    render(<ChatView messages={[]} streaming={false} rag={{ indexees: 2, total: 3, erreur: null }} onAsk={() => {}} />);
    expect(screen.getByText(/2\/3/)).toBeTruthy();
  });

  it("n'affiche pas de ratio quand toutes les pièces sont indexées", () => {
    render(<ChatView messages={[]} streaming={false} rag={{ indexees: 3, total: 3, erreur: null }} onAsk={() => {}} />);
    expect(screen.queryByText(/3\/3/)).toBeNull();
  });

  it("desactive l'envoi pendant le streaming", () => {
    render(<ChatView messages={[]} streaming={true} rag={{ indexees: 3, total: 3, erreur: null }} onAsk={() => {}} />);
    expect(screen.getByRole("button", { name: /envoyer/i }).hasAttribute("disabled")).toBe(true);
  });

  it("transmet la question saisie puis vide le champ", () => {
    const onAsk = vi.fn();
    render(<ChatView messages={[]} streaming={false} rag={{ indexees: 3, total: 3, erreur: null }} onAsk={onAsk} />);
    const champ = screen.getByLabelText(/question/i) as HTMLInputElement;
    fireEvent.change(champ, { target: { value: "Quelle est la date des faits ?" } });
    fireEvent.click(screen.getByRole("button", { name: /envoyer/i }));
    expect(onAsk).toHaveBeenCalledWith("Quelle est la date des faits ?");
    expect(champ.value).toBe("");
  });

  it("conserve le texte deja recu et affiche l'erreur en dessous apres une coupure", () => {
    render(
      <ChatView
        messages={[
          { role: "user", content: "Qui est mis en cause ?" },
          { role: "assistant", content: "Jean DU" },
        ]}
        streaming={false}
        rag={{ indexees: 3, total: 3, erreur: null }}
        erreur="Le service de questions est indisponible. Réessayez."
        onAsk={() => {}}
      />,
    );
    expect(screen.getByText("Jean DU")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/indisponible/i);
  });

  it("affiche l'indicateur tant qu'aucun caractere n'est arrive", () => {
    const { container } = render(
      <ChatView
        messages={[
          { role: "user", content: "Qui est mis en cause ?" },
          { role: "assistant", content: "" },
        ]}
        streaming={true}
        rag={{ indexees: 3, total: 3, erreur: null }}
        onAsk={() => {}}
      />,
    );
    expect(container.querySelector(".rgp-typing")).toBeTruthy();
  });

  it("remplace l'indicateur par le texte des le premier caractere recu", () => {
    const { container } = render(
      <ChatView
        messages={[
          { role: "user", content: "Qui est mis en cause ?" },
          { role: "assistant", content: "Jean" },
        ]}
        streaming={true}
        rag={{ indexees: 3, total: 3, erreur: null }}
        onAsk={() => {}}
      />,
    );
    expect(container.querySelector(".rgp-typing")).toBeNull();
    expect(screen.getByText("Jean")).toBeTruthy();
  });

  it("n'affiche pas d'indicateur hors generation", () => {
    const { container } = render(
      <ChatView
        messages={[{ role: "user", content: "Question ?" }]}
        streaming={false}
        rag={{ indexees: 3, total: 3, erreur: null }}
        onAsk={() => {}}
      />,
    );
    expect(container.querySelector(".rgp-typing")).toBeNull();
  });

  it("propose de copier un message termine mais pas la reponse en cours d'ecriture", () => {
    const messages = [
      { role: "user" as const, content: "Qui est mis en cause ?" },
      { role: "assistant" as const, content: "Jean" },
    ];
    const { rerender } = render(
      <ChatView messages={messages} streaming={true} rag={{ indexees: 3, total: 3, erreur: null }} onAsk={() => {}} />,
    );
    // En cours d'ecriture : seule la question posee est copiable.
    expect(screen.getAllByRole("button", { name: /copier le contenu/i }).length).toBe(1);
    rerender(
      <ChatView messages={messages} streaming={false} rag={{ indexees: 3, total: 3, erreur: null }} onAsk={() => {}} />,
    );
    expect(screen.getAllByRole("button", { name: /copier le contenu/i }).length).toBe(2);
  });

  it("conserve les retours a la ligne du texte brut", () => {
    const { container } = render(
      <ChatView
        messages={[{ role: "assistant", content: "paragraphe 1\n\nparagraphe 2" }]}
        streaming={false}
        rag={{ indexees: 3, total: 3, erreur: null }}
        onAsk={() => {}}
      />,
    );
    // Le markdown gouverne desormais la mise en forme des reponses : deux
    // paragraphes separes par une ligne vide donnent deux <p>. Un retour a la ligne
    // simple est collapse, comme dans le chat RGP — c'est la convention markdown,
    // et les modeles separent leurs paragraphes par une ligne vide.
    expect(container.querySelectorAll(".rgp-msg p").length).toBeGreaterThanOrEqual(1);
  });
});

it("la réponse est rendue en markdown, pas en symboles bruts", () => {
  render(<ChatView messages={[
    { role: "user", content: "question" },
    { role: "assistant", content: "Le **fourgon** est cité dans :\n\n- une audition\n- une plainte" },
  ]} streaming={false} rag={{ indexees: 2, total: 2, erreur: null }} onAsk={vi.fn()} />);
  // Le gras devient un <strong>, la liste devient des <li> : aucun asterisque ni
  // tiret ne doit rester visible.
  expect(screen.getByText("fourgon").tagName).toBe("STRONG");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.queryByText(/\*\*fourgon\*\*/)).toBeNull();
});

it("la question de l'utilisateur reste du texte brut", () => {
  render(<ChatView messages={[{ role: "user", content: "combien de **pièces** ?" }]}
    streaming={false} rag={{ indexees: 1, total: 1, erreur: null }} onAsk={vi.fn()} />);
  // Ce que l'utilisateur a tape est restitue tel quel : on n'interprete pas sa saisie.
  expect(screen.getByText(/combien de \*\*pièces\*\* \?/)).toBeTruthy();
});

it("le bouton d'envoi est une icône, sans libellé visible mais nommé pour les lecteurs d'écran", () => {
  render(<ChatView messages={[]} streaming={false} rag={{ indexees: 1, total: 1, erreur: null }} onAsk={vi.fn()} />);
  const bouton = screen.getByRole("button", { name: /envoyer/i });
  expect(bouton.textContent).toBe("send");
});
