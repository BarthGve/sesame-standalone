import { expect, test } from "vitest";
import { fetchRuntimeConfig } from "./runtimeConfig";

test("retourne data de /api/config", async () => {
  const data = {
    tiles: true,
    tilesUrl: "/api/tiles/{z}/{x}/{y}",
    ban: true,
    workflows: { rgp: true },
    rag: false,
  };
  const fetchImpl = async (url: string) => {
    expect(url).toBe("/api/config");
    return { ok: true, json: async () => ({ data }) } as Response;
  };
  await expect(fetchRuntimeConfig(fetchImpl as typeof fetch)).resolves.toEqual(
    data
  );
});

test("échec → EMPTY", async () => {
  const fetchImpl = async () => ({ ok: false } as Response);
  await expect(fetchRuntimeConfig(fetchImpl as typeof fetch)).resolves.toEqual({
    tiles: false,
    tilesUrl: null,
    ban: false,
    workflows: {},
    rag: false,
  });
});

test("fetch throw → EMPTY", async () => {
  const fetchImpl = async () => {
    throw new Error("network");
  };
  await expect(fetchRuntimeConfig(fetchImpl as typeof fetch)).resolves.toEqual({
    tiles: false,
    tilesUrl: null,
    ban: false,
    workflows: {},
    rag: false,
  });
});
