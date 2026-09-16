// Extrait l'objet JSON du `result` d'un workflow RGP IAka.
// Forme : <tool>…<tool-output>{JSON}</tool-output></tool> + texte final de l'agent.
// Le bloc <tool-output> est la source fiable (JSON propre) ; le texte final varie
// (JSON nu en lecture, parfois enrobé ```json``` en écriture).
export function normalizeResult(text) {
  if (typeof text !== "string") return { parsed: null, message: "" };
  const trimmed = text.trim();
  // Texte hors balises <tool>…</tool>, utilisé comme repli pour extraire le JSON
  // quand il n'y a pas de <tool-output>.
  const rawTrailing = trimmed.replace(/<tool>[\s\S]*?<\/tool>/gi, "").trim();

  // Message = rawTrailing débarrassé des blocs de code fencés. Sur une LECTURE, ce
  // texte est du JSON pur (le résultat) → pas un message pour l'utilisateur : on le
  // vide. Sur une ÉCRITURE c'est une phrase → conservé.
  let message = rawTrailing.replace(/```(?:json)?\s*[\s\S]*?```/gi, "").trim();
  if (message.startsWith("{") || message.startsWith("[")) {
    try {
      JSON.parse(message);
      message = "";
    } catch {
      /* pas du JSON valide → on garde le texte */
    }
  }

  let jsonText;
  const toolOut = trimmed.match(/<tool-output>([\s\S]*?)<\/tool-output>/i);
  if (toolOut) jsonText = toolOut[1].trim();
  else jsonText = rawTrailing;

  const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) jsonText = fence[1].trim();

  let candidate = jsonText;
  if (!candidate.startsWith("{")) {
    const s = candidate.indexOf("{");
    const e = candidate.lastIndexOf("}");
    if (s === -1 || e <= s) return { parsed: null, message };
    candidate = candidate.slice(s, e + 1);
  }

  let obj;
  try {
    obj = JSON.parse(candidate);
  } catch {
    return { parsed: null, message };
  }

  // Déballe { json_build_object: {…} } (sortie SQL json_build_object).
  if (obj && typeof obj === "object" && obj.json_build_object && typeof obj.json_build_object === "object") {
    obj = obj.json_build_object;
  }
  return { parsed: obj, message };
}
