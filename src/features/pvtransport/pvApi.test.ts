import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendPv } from "./pvApi";
import { fetchSeq } from "../../test/fetchSeq";

const piece = { base64: "AAAA", mime: "text/markdown", filename: "notes.md" };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function run<T>(promise: Promise<T>): Promise<T> {
  const guarded = promise.then(
    (v) => ({ ok: true as const, v }),
    (e) => ({ ok: false as const, e })
  );
  await vi.advanceTimersByTimeAsync(3000);
  const r = await guarded;
  if (!r.ok) throw r.e;
  return r.v;
}

describe("sendPv", () => {
  it("poste les notes et renvoie le texte du PV", async () => {
    const calls: [string, RequestInit?][] = [];
    const responses = [
      { jobId: "j" },
      { status: "done", result: { texte: "<h2>Saisine</h2><p>...</p>" } },
    ];
    let i = 0;
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return { ok: true, json: async () => responses[Math.min(i++, responses.length - 1)] };
    }) as unknown as typeof fetch;

    const out = await run(sendPv([piece], impl));
    expect(out).toBe("<h2>Saisine</h2><p>...</p>");
    expect(calls[0][0]).toBe("/api/pvtcmp");
    expect(JSON.parse(calls[0][1]!.body as string)).toEqual({ files: [piece] });
  });

  it("remonte le code d'erreur du proxy", async () => {
    const impl = fetchSeq([{ jobId: "j" }, { status: "error", error: "PVTCMP_TIMEOUT" }]);
    await expect(run(sendPv([piece], impl))).rejects.toThrow("PVTCMP_TIMEOUT");
  });

  it("réponse sans texte → PVTCMP_INVALIDE", async () => {
    const impl = fetchSeq([{ jobId: "j" }, { status: "done", result: {} }]);
    await expect(run(sendPv([piece], impl))).rejects.toThrow("PVTCMP_INVALIDE");
  });
});
