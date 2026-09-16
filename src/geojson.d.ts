declare module "*.geojson" {
  const value: import("./lib/geo").FeatureCollection;
  export default value;
}

// Version applicative injectée par Vite (`define`), issue de package.json.
declare const __APP_VERSION__: string;
