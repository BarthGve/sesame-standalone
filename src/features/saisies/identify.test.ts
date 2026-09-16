import { describe, it, expect, vi } from "vitest";
import { identifyObject } from "./identify";

function makeFile(): File {
  return new File(["fake-bytes"], "photo.jpg", { type: "image/jpeg" });
}

// La lecture du fichier (FileReader, jsdom) passe par de vrais timers réels ;
// on ne bascule sur des timers fictifs qu'une fois le POST de démarrage lancé
// (repéré via un premier appel fetch), pour ne faker que le polling.
async function run<T>(promise: Promise<T>, waitForStartCall: Promise<void>): Promise<T> {
  const guarded = promise.then(
    (v) => ({ ok: true as const, v }),
    (e) => ({ ok: false as const, e })
  );
  await waitForStartCall;
  vi.useFakeTimers();
  try {
    await vi.advanceTimersByTimeAsync(3000);
    const r = await guarded;
    if (!r.ok) throw r.e;
    return r.v;
  } finally {
    vi.useRealTimers();
  }
}

describe("identifyObject", () => {
  it("poste la photo et normalise la réponse", async () => {
    const calls: [string, RequestInit?][] = [];
    const responses = [
      { jobId: "j" },
      {
        status: "done",
        result: {
          categorie: "MULTIMEDIA",
          confiance: 0.9,
          champs: [{ cle: "marque", libelle: "Marque", valeur: "Sony", source: "deduit" }],
        },
      },
    ];
    let i = 0;
    let resolveStart: () => void;
    const startCalled = new Promise<void>((r) => (resolveStart = r));
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (calls.length === 1) resolveStart();
      return { ok: true, json: async () => responses[Math.min(i++, responses.length - 1)] };
    }) as unknown as typeof fetch;

    const out = await run(identifyObject(makeFile(), impl), startCalled);
    expect(out.categorie).toBe("MULTIMEDIA");
    expect(out.champs).toEqual([
      { cle: "marque", libelle: "Marque", valeur: "Sony", source: "deduit", obligatoire: false },
    ]);
    expect(calls[0][0]).toBe("/api/identify");
    const body = JSON.parse(calls[0][1]!.body as string);
    expect(body.mime).toBe("image/jpeg");
    expect(body.filename).toBe("photo.jpg");
  });

  it("remonte le code d'erreur du proxy", async () => {
    const responses = [{ jobId: "j" }, { status: "error", error: "IDENTIFY_TIMEOUT" }];
    let i = 0;
    let resolveStart: () => void;
    const startCalled = new Promise<void>((r) => (resolveStart = r));
    const impl = (async () => {
      const isFirst = i === 0;
      const res = { ok: true, json: async () => responses[Math.min(i++, responses.length - 1)] };
      if (isFirst) resolveStart();
      return res;
    }) as unknown as typeof fetch;

    await expect(run(identifyObject(makeFile(), impl), startCalled)).rejects.toThrow("IDENTIFY_TIMEOUT");
  });
});
