// Extrait le markdown narratif du result IAka de synthèse RENS : on retire la trace
// d'agent <tool>…</tool> (qui contient <tool-output>{JSON}</tool-output>) et on déballe
// une éventuelle fence markdown englobante. On NE déballe PAS les tableaux GFM (ils
// doivent rester tels quels pour le rendu react-markdown).
export function extractSynthese(result) {
  if (typeof result !== 'string') throw new Error('RENS_INVALIDE');
  let text = result.replace(/<tool>[\s\S]*?<\/tool>/gi, '').trim();
  const fence = text.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i);
  if (fence) text = fence[1].trim();
  if (!text) throw new Error('RENS_INVALIDE');
  return text;
}
