import type { StyleSpecification } from "maplibre-gl";

export function basemapStyle(tilesUrl: string | null): StyleSpecification {
  if (!tilesUrl) {
    return { version: 8, sources: {}, layers: [] };
  }
  return {
    version: 8,
    sources: {
      basemap: { type: "raster", tiles: [tilesUrl], tileSize: 256 },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  };
}
