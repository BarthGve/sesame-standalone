import { expect, test } from "vitest";
import { basemapStyle } from "./mapStyle";

test("sans tuiles : pas d'URL externe", () => {
  const s = JSON.stringify(basemapStyle(null));
  expect(s).not.toMatch(/geopf|https:\/\//);
  expect(basemapStyle(null).sources).toEqual({});
});

test("avec tuiles same-origin", () => {
  const s = basemapStyle("/api/tiles/{z}/{x}/{y}");
  const basemap = s.sources.basemap as { tiles: string[] };
  expect(basemap.tiles[0]).toBe("/api/tiles/{z}/{x}/{y}");
});
