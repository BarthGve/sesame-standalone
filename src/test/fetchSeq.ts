/**
 * Fake `fetch` qui renvoie une séquence de corps JSON (tests d'API async / jobs).
 * Chaque appel consomme la réponse suivante ; le dernier est rejoué si épuisé.
 */
export function fetchSeq(responses: unknown[]): typeof fetch {
  let i = 0;
  return (async () => {
    const r = responses[Math.min(i++, responses.length - 1)];
    return {
      ok: true,
      status: 200,
      json: async () => r,
      text: async () => JSON.stringify(r),
    } as Response;
  }) as unknown as typeof fetch;
}
