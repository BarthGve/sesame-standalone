// Liste les procédures exploitables pour l'évaluation des avoirs : celles dont
// au moins une perquisition porte un objet saisi.
//
// Aucune route de rgp-api ne répond directement à cette question (/perquisitions
// exige un UNA), et son code appartient à un autre chantier en cours : on agrège
// donc ici. Le navigateur ne fait qu'un appel, et le jour où une requête SQL
// dédiée existera, seul ce fichier changera.

const LIMITE_PAR_DEFAUT = 50;
const CONCURRENCE_PAR_DEFAUT = 6;

async function lireJson(url, cfg, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${cfg.rgpApiToken}` },
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  if (!body || body.error) return null;
  return body.data;
}

// Exécute `traiter` sur chaque élément, au plus `concurrence` en vol.
// L'ordre du résultat suit celui des éléments, pas celui des réponses.
async function enParallele(elements, concurrence, traiter) {
  const resultats = new Array(elements.length);
  let curseur = 0;
  const ouvriers = Array.from({ length: Math.min(concurrence, elements.length) }, async () => {
    for (;;) {
      const i = curseur++;
      if (i >= elements.length) return;
      resultats[i] = await traiter(elements[i]);
    }
  });
  await Promise.all(ouvriers);
  return resultats;
}

/**
 * @param {object} p
 * @param {object} p.cfg          config (rgpApiUrl, rgpApiToken)
 * @param {number} [p.limite]     nombre maximum de procédures examinées
 * @param {number} [p.concurrence] appels simultanés vers rgp-api
 */
export async function listerUnasEvaluables({
  cfg,
  fetchImpl = globalThis.fetch,
  limite = LIMITE_PAR_DEFAUT,
  concurrence = CONCURRENCE_PAR_DEFAUT,
}) {
  const procedures = await lireJson(
    `${cfg.rgpApiUrl}/procedures?limit=${limite}`,
    cfg,
    fetchImpl
  );
  if (!procedures) throw new Error("UNAS_UPSTREAM");

  const examinees = procedures.slice(0, limite);
  const evaluees = await enParallele(examinees, concurrence, async (proc) => {
    const perquisitions = await lireJson(
      `${cfg.rgpApiUrl}/perquisitions?una=${encodeURIComponent(proc.una)}`,
      cfg,
      fetchImpl
    );
    // Procédure illisible : on l'écarte plutôt que de faire échouer toute la
    // liste. Une procédure manquante se remarque ; une liste vide, non.
    if (!perquisitions) return null;

    const avecObjets = perquisitions.filter((p) => Number(p.nb_objets) > 0);
    if (!avecObjets.length) return null;

    return {
      una: proc.una,
      groupe: proc.groupe_libelle ?? proc.groupe ?? null,
      synthese: proc.synthese ?? null,
      urgent: Boolean(proc.urgent),
      sensible: Boolean(proc.sensible),
      nbPerquisitions: avecObjets.length,
      nbObjets: avecObjets.reduce((total, p) => total + Number(p.nb_objets), 0),
    };
  });

  return evaluees.filter(Boolean);
}
