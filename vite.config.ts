import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

const geojsonPlugin = {
  name: "load-geojson",
  resolveId(id: string, importer: string | undefined) {
    if (id.endsWith(".geojson")) {
      let resolved: string;
      if (id.startsWith("/")) {
        resolved = id;
      } else if (path.isAbsolute(id)) {
        resolved = id;
      } else {
        resolved = path.resolve(path.dirname(importer || process.cwd()), id);
      }
      return { id: resolved, external: false };
    }
  },
  load(id: string) {
    if (id.endsWith(".geojson")) {
      try {
        const content = fs.readFileSync(id, "utf-8");
        return `export default ${content}`;
      } catch (e) {
        throw new Error(`Failed to load ${id}: ${e}`);
      }
    }
  },
};

// Version affichée dans le front (pied du menu) : source unique = package.json,
// injectée à la compilation. Pas d'import JSON dans le bundle applicatif.
const pkgVersion = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8")
).version;

export default defineConfig({
  plugins: [geojsonPlugin, react()],
  define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
  // Le minifieur CSS lightningcss rejette une media query héritée du CSS DSFR vendu
  // (`@media (min-width: 0\0)`, hack IE) et fait échouer le build. Vite 8 (rolldown) ne
  // fournit pas esbuild pour la minification CSS → on la désactive (CSS non minifié).
  build: { cssMinify: false },
  server: {
    proxy: { "/api": `http://localhost:${process.env.PROXY_PORT ?? 8787}` },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/setupTests.ts",
  },
});
