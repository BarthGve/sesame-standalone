import { describe, it, expect } from "vitest";
import { streamChat, purgeCorpusApi } from "./arianeChatApi";

// Flux factice : la reponse SSE est rendue morceau par morceau, comme le ferait le
// reseau. Aucun appel reel n'est effectue.
function reponseSSE(morceaux: string[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () =>
          i < morceaux.length
            ? { done: false, value: encoder.encode(morceaux[i++]) }
            : { done: true, value: undefined },
      }),
    },
  } as unknown as Response;
}

const trame = (d: string) => `data: ${JSON.stringify({ delta: d })}\n\n`;

describe("streamChat", () => {
  it("accumule les deltas dans l'ordre", async () => {
    const recus: string[] = [];
    const fetchImpl = (async () =>
      reponseSSE([trame("Bon"), trame("jour"), "data: [DONE]\n\n"])) as unknown as typeof fetch;
    await streamChat([{ role: "user", content: "salut" }], (d) => recus.push(d), fetchImpl);
    expect(recus).toEqual(["Bon", "jour"]);
  });

  it("reconstitue une trame coupee entre deux morceaux", async () => {
    const recus: string[] = [];
    const t = trame("Bonjour");
    const fetchImpl = (async () =>
      reponseSSE([t.slice(0, 12), t.slice(12), "data: [DONE]\n\n"])) as unknown as typeof fetch;
    await streamChat([{ role: "user", content: "x" }], (d) => recus.push(d), fetchImpl);
    expect(recus).toEqual(["Bonjour"]);
  });

  it("poste la conversation sur la route de chat", async () => {
    let recu: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      recu = { url, init };
      return reponseSSE(["data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;
    await streamChat([{ role: "user", content: "x" }], () => {}, fetchImpl);
    expect(recu!.url).toBe("/api/ariane/chat");
    expect(recu!.init?.method).toBe("POST");
    expect(JSON.parse(String(recu!.init?.body))).toEqual({ messages: [{ role: "user", content: "x" }] });
  });

  it("leve sur event: error", async () => {
    const fetchImpl = (async () =>
      reponseSSE(['event: error\ndata: {"error":"ARIANE_RAG_CHAT"}\n\n'])) as unknown as typeof fetch;
    await expect(
      streamChat([{ role: "user", content: "x" }], () => {}, fetchImpl),
    ).rejects.toThrow("ARIANE_RAG_CHAT");
  });

  // Le serveur emet aussi ARIANE_RAG_INDISPONIBLE et INTERNAL_ERROR sur ce meme
  // canal : le code doit remonter tel quel, sinon le store ne peut pas distinguer
  // « service en panne » de « corpus non configure ».
  it("remonte le code porte par l'evenement d'erreur", async () => {
    const fetchImpl = (async () =>
      reponseSSE(['event: error\ndata: {"error":"ARIANE_RAG_INDISPONIBLE"}\n\n'])) as unknown as typeof fetch;
    await expect(
      streamChat([{ role: "user", content: "x" }], () => {}, fetchImpl),
    ).rejects.toThrow("ARIANE_RAG_INDISPONIBLE");
  });

  it("conserve les deltas deja emis avant l'evenement d'erreur", async () => {
    const recus: string[] = [];
    const fetchImpl = (async () =>
      reponseSSE([trame("debut"), 'event: error\ndata: {"error":"ARIANE_RAG_CHAT"}\n\n'])) as unknown as typeof fetch;
    await expect(
      streamChat([{ role: "user", content: "x" }], (d) => recus.push(d), fetchImpl),
    ).rejects.toThrow("ARIANE_RAG_CHAT");
    expect(recus).toEqual(["debut"]);
  });

  it("leve si la reponse n'est pas ok", async () => {
    const fetchImpl = (async () => ({ ok: false }) as Response) as unknown as typeof fetch;
    await expect(
      streamChat([{ role: "user", content: "x" }], () => {}, fetchImpl),
    ).rejects.toThrow("ARIANE_RAG_CHAT");
  });
});

describe("purgeCorpusApi", () => {
  it("rend le nombre de documents supprimes", async () => {
    const fetchImpl = (async () =>
      ({ ok: true, json: async () => ({ supprimes: 3 }) }) as Response) as unknown as typeof fetch;
    expect(await purgeCorpusApi(fetchImpl)).toBe(3);
  });

  it("leve ARIANE_RAG_PURGE si la route echoue", async () => {
    const fetchImpl = (async () =>
      ({ ok: false, json: async () => ({ error: "ARIANE_RAG_PURGE" }) }) as Response) as unknown as typeof fetch;
    await expect(purgeCorpusApi(fetchImpl)).rejects.toThrow("ARIANE_RAG_PURGE");
  });

  it("remonte le code d'erreur rendu par la route", async () => {
    const fetchImpl = (async () =>
      ({ ok: false, json: async () => ({ error: "ARIANE_RAG_INDISPONIBLE" }) }) as Response) as unknown as typeof fetch;
    await expect(purgeCorpusApi(fetchImpl)).rejects.toThrow("ARIANE_RAG_INDISPONIBLE");
  });

  it("leve ARIANE_RAG_PURGE si le corps d'erreur est illisible", async () => {
    const fetchImpl = (async () =>
      ({ ok: false, json: async () => { throw new Error("boum"); } }) as unknown as Response) as unknown as typeof fetch;
    await expect(purgeCorpusApi(fetchImpl)).rejects.toThrow("ARIANE_RAG_PURGE");
  });
});
