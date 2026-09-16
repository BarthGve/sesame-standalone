import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { queryMap } from "./api";
import { fetchSeq } from "../test/fetchSeq";

const fc = { type: "FeatureCollection", features: [] };

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

describe("queryMap", () => {
  it("renvoie le GeoJSON sur 200", async () => {
    const fakeFetch = fetchSeq([{ jobId: "j" }, { status: "done", result: fc }]);
    const out = await run(queryMap("communes", fakeFetch));
    expect(out.type).toBe("FeatureCollection");
  });

  it("lève le code d'erreur du proxy sur non-200", async () => {
    const fakeFetch = fetchSeq([{ jobId: "j" }, { status: "error", error: "IAKA_UPSTREAM" }]);
    await expect(run(queryMap("x", fakeFetch))).rejects.toThrow("IAKA_UPSTREAM");
  });
});
