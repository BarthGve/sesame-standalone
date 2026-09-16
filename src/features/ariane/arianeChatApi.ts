// Client du chat RAG : POST /api/ariane/chat lu en SSE, et purge du corpus.
// Separe de arianeApi.ts (analyse du dossier) : deux surfaces distinctes, comme
// cote serveur. Aucun contenu de message n'est journalise ici : ces textes sont
// des pieces de procedure.

export type ChatMessage = { role: "user" | "assistant"; content: string };

// EventSource ne sait pas faire de POST : le flux se lit sur le corps de la reponse
// fetch. Un evenement peut arriver coupe entre deux morceaux reseau, d'ou le tampon
// qui conserve la derniere ligne tant qu'elle n'est pas terminee par un saut de ligne.
export async function streamChat(
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl("/api/ariane/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok || !res.body) throw new Error("ARIANE_RAG_CHAT");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let tampon = "";
  // Le serveur emet `event: error` suivi de `data: {"error":"CODE"}` : le code n'est
  // connu qu'a la ligne suivante, on marque donc l'evenement en attendant sa donnee.
  let erreurEnCours = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    tampon += decoder.decode(value, { stream: true });
    const lignes = tampon.split("\n");
    tampon = lignes.pop() ?? ""; // derniere ligne peut-etre incomplete
    for (const brute of lignes) {
      const ligne = brute.replace(/\r$/, "");
      if (ligne.startsWith("event:")) {
        erreurEnCours = ligne.slice(6).trim() === "error";
        continue;
      }
      if (!ligne.startsWith("data:")) continue;
      const data = ligne.slice(5).trim();
      if (erreurEnCours) throw new Error(codeErreur(data));
      if (data === "[DONE]") return;
      let delta: string | undefined;
      try {
        ({ delta } = JSON.parse(data) as { delta?: string });
      } catch {
        continue; // trame illisible : on ignore plutot que de casser le flux
      }
      if (delta) onDelta(delta);
    }
  }
}

function codeErreur(data: string): string {
  try {
    return (JSON.parse(data) as { error?: string }).error || "ARIANE_RAG_CHAT";
  } catch {
    return "ARIANE_RAG_CHAT";
  }
}

// DESTRUCTIF cote serveur : vide le corpus RAG. Appelee par le bouton Vider, avant
// la reinitialisation de l'ecran.
export async function purgeCorpusApi(fetchImpl: typeof fetch = fetch): Promise<number> {
  const res = await fetchImpl("/api/ariane/corpus/purge", { method: "POST" });
  if (!res.ok) {
    let code = "ARIANE_RAG_PURGE";
    try {
      code = ((await res.json()) as { error?: string }).error || code;
    } catch {
      /* corps illisible : on garde le code generique */
    }
    throw new Error(code);
  }
  const { supprimes } = (await res.json()) as { supprimes?: number };
  return supprimes ?? 0;
}
