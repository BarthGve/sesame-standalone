// Fausse API de cote automobile — calquée sur server/rgp-api/server.js :
// serveur HTTP natif, authentification Bearer, enveloppe { data } / { error }.
// Sert de source à l'agent IAka d'évaluation des avoirs, via un serveur MCP
// dérivé de openapi.json.

const http = require("http");
const { coter } = require("./cote");

const TOKEN = process.env.API_TOKEN || "";
// Fail-closed : sans jeton configuré, refus de démarrer plutôt que de servir
// l'API ouverte en silence (même règle que rgp-api).
if (!TOKEN && require.main === module) {
  console.error("FATAL: API_TOKEN manquant — refus de démarrer");
  process.exit(1);
}

const json = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
};
const err = (res, code, c, m) => json(res, code, { error: { code: c, message: m } });

function createHandler() {
  return (req, res) => {
    const u = new URL(req.url, "http://x");
    // Journal d'exploitation SANS le contenu de la requête : marque, modèle et
    // année d'un véhicule proviennent, dans le flux d'évaluation, d'une procédure
    // judiciaire — ils ne doivent pas atterrir dans les logs de ce service (même
    // règle que le BFF). On ne trace que la méthode, la route et la présence d'un
    // jeton, de quoi diagnostiquer sans exposer de données de procédure.
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        m: req.method,
        p: u.pathname,
        auth: !!req.headers.authorization,
      })
    );

    if (u.pathname === "/health") return json(res, 200, { data: { ok: true } });

    // Sans jeton configure (TOKEN === ""), aucune comparaison ne doit pouvoir reussir —
    // sinon un en-tete "Bearer " (jeton vide) passerait l'authentification.
    if (!TOKEN || (req.headers.authorization || "") !== "Bearer " + TOKEN)
      return err(res, 401, "unauthorized", "Token invalide ou manquant");

    if (u.pathname === "/cote" && req.method === "GET") {
      const marque = (u.searchParams.get("marque") || "").trim();
      const modele = (u.searchParams.get("modele") || "").trim();
      const anneeBrute = (u.searchParams.get("annee") || "").trim();
      const annee = Number(anneeBrute);
      if (!marque || !modele || !anneeBrute)
        return err(res, 400, "bad_request", "Paramètres marque, modele et annee requis");
      if (!Number.isInteger(annee) || annee < 1900 || annee > 2100)
        return err(res, 400, "bad_request", "Paramètre annee : année à quatre chiffres attendue");

      const km = u.searchParams.get("km");
      const carrosserie = u.searchParams.get("carrosserie") || undefined;
      return json(res, 200, { data: coter({ marque, modele, annee, km, carrosserie }) });
    }

    return err(res, 404, "not_found", "Route inconnue");
  };
}

if (require.main === module) {
  http.createServer(createHandler()).listen(8082, () => console.log("cote-api sur :8082"));
}

module.exports = { createHandler };
