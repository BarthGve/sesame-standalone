// Substitution safe du template MAP_TILES_URL : seuls des entiers pour z/x/y
// (anti path-traversal / SSRF via "../" ou segments non numériques).

export function tilesUpstreamUrl(template, z, x, y) {
  if (!template) return null;
  if (![z, x, y].every((v) => /^\d+$/.test(String(v)))) return null;
  return template
    .replaceAll("{z}", String(z))
    .replaceAll("{x}", String(x))
    .replaceAll("{y}", String(y));
}
