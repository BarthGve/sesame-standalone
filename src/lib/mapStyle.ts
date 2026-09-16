import type { StyleSpecification } from "maplibre-gl";

export function ignStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      ign: {
        type: "raster",
        tiles: [
          "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
            "&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM" +
            "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png",
        ],
        tileSize: 256,
        attribution: "IGN-F/Géoplateforme",
      },
    },
    layers: [{ id: "ign", type: "raster", source: "ign" }],
  };
}
