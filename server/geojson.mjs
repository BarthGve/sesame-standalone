// Trouve récursivement une FeatureCollection dans un objet, éventuellement
// enveloppée ( { json_build_object: FC }, { geojson: FC }, { result: FC }... ).
function findFeatureCollection(o, depth = 0) {
  if (!o || typeof o !== "object" || depth > 5) return null;
  if (o.type === "FeatureCollection" && Array.isArray(o.features)) return o;
  for (const k of Object.keys(o)) {
    const found = findFeatureCollection(o[k], depth + 1);
    if (found) return found;
  }
  return null;
}

export function extractGeoJSON(result) {
  if (typeof result !== "string") throw new Error("GEOJSON_INVALID");
  let text = result.trim();

  // 1. Trace d'agent IAka : le résultat SQL est dans <tool-output>...</tool-output>
  //    (le reste = markup <tool>/<tool-input> + éventuel message d'erreur final).
  const toolOut = text.match(/<tool-output>([\s\S]*?)<\/tool-output>/i);
  if (toolOut) text = toolOut[1].trim();

  // 2. Retire un éventuel bloc de code ```json ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  // 3. Isole le premier objet JSON { ... } de la string
  let candidate = text;
  if (!candidate.startsWith("{")) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) throw new Error("GEOJSON_INVALID");
    candidate = candidate.slice(start, end + 1);
  }

  let obj;
  try {
    obj = JSON.parse(candidate);
  } catch {
    throw new Error("GEOJSON_INVALID");
  }

  // 4. Trouve la FeatureCollection (éventuellement enveloppée)
  const fc = findFeatureCollection(obj);
  if (!fc || !Array.isArray(fc.features)) throw new Error("GEOJSON_INVALID");
  return fc;
}
