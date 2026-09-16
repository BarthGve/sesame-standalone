// Extrait l'objet d'identification { categorie, champs, ... } de la sortie IAka
// (même logique que geojson.mjs : trace d'agent + fence + isolation du 1er JSON).

// Trouve récursivement un objet portant un champ "categorie" (string).
// `champs` est optionnel : le workflow peut ne renvoyer que la sortie routeur
// (catégorie + confiance), la fiche étant alors reconstruite côté front.
function findObjet(o, depth = 0) {
  if (!o || typeof o !== "object" || depth > 5) return null;
  if (typeof o.categorie === "string") return o;
  for (const k of Object.keys(o)) {
    const found = findObjet(o[k], depth + 1);
    if (found) return found;
  }
  return null;
}

export function extractObjet(result) {
  if (typeof result !== "string") throw new Error("OBJET_INVALID");
  let text = result.trim();

  const toolOut = text.match(/<tool-output>([\s\S]*?)<\/tool-output>/i);
  if (toolOut) text = toolOut[1].trim();

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  let candidate = text;
  if (!candidate.startsWith("{")) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) throw new Error("OBJET_INVALID");
    candidate = candidate.slice(start, end + 1);
  }

  let obj;
  try {
    obj = JSON.parse(candidate);
  } catch {
    throw new Error("OBJET_INVALID");
  }

  const objet = findObjet(obj);
  if (!objet) throw new Error("OBJET_INVALID");
  return objet;
}
