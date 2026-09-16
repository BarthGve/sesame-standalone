import { beforeEach, afterEach, vi } from "vitest";
import { sendSynthese } from "./syntheseApi";
import { fetchSeq } from "../../test/fetchSeq";

const piece = { base64: "AAAA", mime: "application/pdf", filename: "pv.pdf" };

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

test("poste les pièces et renvoie le texte", async () => {
  const calls: [string, RequestInit?][] = [];
  let i = 0;
  const responses = [{ jobId: "j" }, { status: "done", result: { texte: "## Faits" } }];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    return { ok: true, json: async () => responses[Math.min(i++, responses.length - 1)] };
  }) as unknown as typeof fetch;

  expect(await run(sendSynthese([piece], null, impl))).toBe("## Faits");
  expect(calls[0][0]).toBe("/api/synthese");
  expect(JSON.parse(calls[0][1]!.body as string)).toEqual({ files: [piece] });
});

test("remonte le code d'erreur du proxy", async () => {
  const impl = fetchSeq([{ jobId: "j" }, { status: "error", error: "SYNTHESE_TIMEOUT" }]);
  await expect(run(sendSynthese([piece], null, impl))).rejects.toThrow("SYNTHESE_TIMEOUT");
});

test("réponse sans texte → SYNTHESE_INVALIDE", async () => {
  const impl = fetchSeq([{ jobId: "j" }, { status: "done", result: {} }]);
  await expect(run(sendSynthese([piece], null, impl))).rejects.toThrow("SYNTHESE_INVALIDE");
});

test("le contexte XML est joint au corps quand il est fourni", async () => {
  const calls: [string, RequestInit?][] = [];
  let i = 0;
  const responses = [{ jobId: "j" }, { status: "done", result: { texte: "## Faits" } }];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    return { ok: true, json: async () => responses[Math.min(i++, responses.length - 1)] };
  }) as unknown as typeof fetch;

  await run(sendSynthese([piece], "<Procedure/>", impl));
  expect(JSON.parse(calls[0][1]!.body as string)).toEqual({
    files: [piece],
    contexte: "<Procedure/>",
  });
});

test("aucun champ contexte quand il n'y a pas de XML", async () => {
  const calls: [string, RequestInit?][] = [];
  let i = 0;
  const responses = [{ jobId: "j" }, { status: "done", result: { texte: "## Faits" } }];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    return { ok: true, json: async () => responses[Math.min(i++, responses.length - 1)] };
  }) as unknown as typeof fetch;

  await run(sendSynthese([piece], null, impl));
  expect(JSON.parse(calls[0][1]!.body as string)).toEqual({ files: [piece] });
});
