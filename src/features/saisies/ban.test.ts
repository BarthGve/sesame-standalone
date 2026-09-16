import { expect, test } from "vitest";
import { searchAdresse } from "./ban";

test("appelle /api/adresses et mappe data", async () => {
  const fetchImpl = async (url: string) => {
    expect(url).toBe("/api/adresses?q=rue%20x");
    return {
      ok: true,
      json: async () => ({
        data: [
          {
            label: "L",
            name: "N",
            commune: "C",
            codePostal: "75001",
            insee: "75101",
          },
        ],
      }),
    } as Response;
  };
  const out = await searchAdresse("rue x", fetchImpl as typeof fetch);
  expect(out[0].commune).toBe("C");
});

test("q court → [] sans fetch", async () => {
  let n = 0;
  await searchAdresse("ab", (async () => {
    n++;
  }) as unknown as typeof fetch);
  expect(n).toBe(0);
});

test("!ok → [] sans throw", async () => {
  const fetchImpl = async () => ({ ok: false } as Response);
  await expect(
    searchAdresse("rue x", fetchImpl as typeof fetch)
  ).resolves.toEqual([]);
});
