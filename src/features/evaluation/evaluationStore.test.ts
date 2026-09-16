import { beforeEach, expect, test, vi } from "vitest";
import type { ApiObjet } from "../saisies/perquisitionApi";

const objet = (id: number): ApiObjet => ({
  id,
  categorie: "TRANSPORT",
  sous_type: "VEHICULE_TERRESTRE",
  champs: [],
  identifiants: [],
});

function fetchFactice(nbVehicules: number) {
  const perquisitions = [{ id: 10, adresse: "3 rue A", created_at: "2026-01-01", nb_objets: nbVehicules }];
  const objets = Array.from({ length: nbVehicules }, (_, i) => objet(i + 1));
  return (async (url: string) => {
    if (url.startsWith("/api/perquisitions"))
      return { ok: true, json: async () => ({ data: perquisitions }) };
    return { ok: true, json: async () => ({ data: { id: 10, objets } }) };
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  sessionStorage.clear();
  vi.resetModules();
});

test("charge les vehicules de l'UNA saisi", async () => {
  const store = await import("./evaluationStore");
  store.setUna("12345/00042/2026");
  await store.charger(fetchFactice(3));
  expect(store.lireEtat().donnees?.vehicules).toHaveLength(3);
  expect(store.lireEtat().chargement).toBe(false);
  expect(store.lireEtat().erreur).toBeNull();
});

test("une erreur de chargement est affichee sans perdre l'UNA saisi", async () => {
  const store = await import("./evaluationStore");
  const impl = (async () => ({ ok: true, json: async () => ({ error: { message: "UNA introuvable" } }) })) as unknown as typeof fetch;
  store.setUna("12345/00099/2026");
  await store.charger(impl);
  expect(store.lireEtat().erreur).toBe("UNA introuvable");
  expect(store.lireEtat().una).toBe("12345/00099/2026");
  expect(store.lireEtat().chargement).toBe(false);
});

test("basculer coche puis decoche un vehicule", async () => {
  const store = await import("./evaluationStore");
  store.setUna("12345/00042/2026");
  await store.charger(fetchFactice(2));
  store.basculer(1);
  expect(store.lireEtat().selection).toEqual([1]);
  store.basculer(2);
  expect(store.lireEtat().selection).toEqual([1, 2]);
  store.basculer(1);
  expect(store.lireEtat().selection).toEqual([2]);
});

test("la selection est plafonnee a 20 vehicules", async () => {
  const store = await import("./evaluationStore");
  store.setUna("12345/00042/2026");
  await store.charger(fetchFactice(25));
  for (let id = 1; id <= 25; id++) store.basculer(id);
  expect(store.lireEtat().selection).toHaveLength(store.MAX_SELECTION);
  expect(store.lireEtat().erreur).toMatch(/20/);
});

test("changer d'UNA vide la selection precedente", async () => {
  const store = await import("./evaluationStore");
  store.setUna("12345/00042/2026");
  await store.charger(fetchFactice(2));
  store.basculer(1);
  store.setUna("12345/00043/2026");
  expect(store.lireEtat().selection).toEqual([]);
  expect(store.lireEtat().donnees).toBeNull();
});

function fetchLent(nbVehicules: number, delaiMs = 20) {
  const rapide = fetchFactice(nbVehicules);
  return (async (url: string) => {
    await new Promise((resolve) => setTimeout(resolve, delaiMs));
    return rapide(url);
  }) as unknown as typeof fetch;
}

function fetchLentEnErreur(message: string, delaiMs = 20) {
  return (async () => {
    await new Promise((resolve) => setTimeout(resolve, delaiMs));
    return { ok: true, json: async () => ({ error: { message } }) };
  }) as unknown as typeof fetch;
}

test("changer d'UNA pendant un chargement en vol n'affiche pas les donnees de l'ancien UNA", async () => {
  const store = await import("./evaluationStore");
  store.setUna("12345/00042/2026");
  const chargement = store.charger(fetchLent(3));
  store.setUna("12345/00099/2026");
  await chargement;
  expect(store.lireEtat().una).toBe("12345/00099/2026");
  expect(store.lireEtat().donnees).toBeNull();
  expect(store.lireEtat().chargement).toBe(false);
});

test("un clear() pendant un chargement en vol n'affiche pas les donnees perimees", async () => {
  const store = await import("./evaluationStore");
  store.setUna("12345/00042/2026");
  const chargement = store.charger(fetchLent(3));
  store.clear();
  await chargement;
  expect(store.lireEtat().una).toBe("");
  expect(store.lireEtat().donnees).toBeNull();
  expect(store.lireEtat().chargement).toBe(false);
});

test("une erreur sur un chargement perime n'est pas affichee", async () => {
  const store = await import("./evaluationStore");
  store.setUna("12345/00042/2026");
  const chargement = store.charger(fetchLentEnErreur("UNA introuvable"));
  store.setUna("12345/00099/2026");
  await chargement;
  expect(store.lireEtat().una).toBe("12345/00099/2026");
  expect(store.lireEtat().erreur).toBeNull();
  expect(store.lireEtat().chargement).toBe(false);
});

test("un chargement sans interruption reste fonctionnel", async () => {
  const store = await import("./evaluationStore");
  store.setUna("12345/00042/2026");
  await store.charger(fetchLent(3));
  expect(store.lireEtat().donnees?.vehicules).toHaveLength(3);
  expect(store.lireEtat().chargement).toBe(false);
  expect(store.lireEtat().erreur).toBeNull();
});

test("l'UNA est retrouve apres un rechargement de page", async () => {
  const store = await import("./evaluationStore");
  store.setUna("12345/00042/2026");
  vi.resetModules();
  const recharge = await import("./evaluationStore");
  expect(recharge.lireEtat().una).toBe("12345/00042/2026");
  expect(recharge.lireEtat().chargement).toBe(false);
});

const unasFactices = [
  { una: "12345/00042/2026", groupe: null, synthese: null, urgent: false, sensible: false, nbPerquisitions: 1, nbObjets: 2 },
];

test("charge la liste des procedures exploitables", async () => {
  const store = await import("./evaluationStore");
  const impl = (async () => ({ ok: true, json: async () => ({ data: unasFactices }) })) as unknown as typeof fetch;
  await store.chargerUnas(impl);
  expect(store.lireEtat().unas).toHaveLength(1);
  expect(store.lireEtat().chargementUnas).toBe(false);
});

test("un echec de chargement de la liste s'affiche sans bloquer l'ecran", async () => {
  const store = await import("./evaluationStore");
  const impl = (async () => ({ ok: false, json: async () => ({ error: { message: "Service indisponible" } }) })) as unknown as typeof fetch;
  await store.chargerUnas(impl);
  expect(store.lireEtat().erreur).toBe("Service indisponible");
  expect(store.lireEtat().chargementUnas).toBe(false);
  expect(store.lireEtat().unas).toEqual([]);
});

test("evaluer renseigne le resultat et retombe l'indicateur", async () => {
  const store = await import("./evaluationStore");
  const resultat = {
    evaluations: [{ objet_id: 1, enregistre: true,
      estimation_prix: { prix_bas: 1, prix_moyen: 2, prix_haut: 3, devise: "EUR",
        hypotheses: [], sources: [], confiance: 0.5, avertissement: "x" } }],
    non_evalues: [], total: { bas: 1, moyen: 2, haut: 3 }, pv_evaluation: "## PV",
  };
  let i = 0;
  const reponses: unknown[] = [{ jobId: "j" }, { status: "done", result: resultat }];
  const impl = (async (url: string) => {
    if (url.startsWith("/api/perquisitions") || url.startsWith("/api/perquisition?"))
      return { ok: true, json: async () => ({ data: url.includes("?id=") ? { id: 10, objets: [] } : [] }) };
    return { ok: true, json: async () => reponses[Math.min(i++, 1)] };
  }) as unknown as typeof fetch;

  store.setUna("12345/00042/2026");
  store.basculer(1);
  vi.useFakeTimers();
  const p = store.evaluer(impl);
  await vi.advanceTimersByTimeAsync(3000);
  await p;
  vi.useRealTimers();

  // Le PV Markdown est converti en HTML à l'entrée du résultat (éditeur + PDF).
  expect(store.lireEtat().resultat?.pv).toContain(">PV<");
  expect(store.lireEtat().resultat?.pv).not.toContain("##");
  expect(store.lireEtat().evaluationEnCours).toBe(false);
});

test("le resultat d'evaluation resiste a un rechargement de page (F5)", async () => {
  const store = await import("./evaluationStore");
  const resultat = {
    evaluations: [{ objet_id: 1, enregistre: true,
      estimation_prix: { prix_bas: 1, prix_moyen: 2, prix_haut: 3, devise: "EUR",
        hypotheses: [], sources: [], confiance: 0.5, avertissement: "x" } }],
    non_evalues: [], total: { bas: 1, moyen: 2, haut: 3 }, pv_evaluation: "## PV",
  };
  let i = 0;
  const reponses: unknown[] = [{ jobId: "j" }, { status: "done", result: resultat }];
  const impl = (async (url: string) => {
    if (url.startsWith("/api/perquisitions") || url.startsWith("/api/perquisition?"))
      return { ok: true, json: async () => ({ data: url.includes("?id=") ? { id: 10, objets: [] } : [] }) };
    return { ok: true, json: async () => reponses[Math.min(i++, 1)] };
  }) as unknown as typeof fetch;

  store.setUna("12345/00042/2026");
  store.basculer(1);
  vi.useFakeTimers();
  const p = store.evaluer(impl);
  await vi.advanceTimersByTimeAsync(3000);
  await p;
  vi.useRealTimers();
  // PV converti en HTML à l'entrée du résultat, y compris ce qui est persisté.
  expect(store.lireEtat().resultat?.pv).toContain(">PV<");

  // F5 : modules réinitialisés, sessionStorage conservé → le résultat terminé est réhydraté.
  vi.resetModules();
  const recharge = await import("./evaluationStore");
  expect(recharge.lireEtat().resultat?.pv).toContain(">PV<");
  expect(recharge.lireEtat().una).toBe("12345/00042/2026");
});

// Le panneau « véhicules non traités » invite à relancer l'évaluation sur ces
// véhicules : la finalisation ne doit pas effacer la sélection.
test("une evaluation reussie conserve la selection", async () => {
  const store = await import("./evaluationStore");
  const resultat = {
    evaluations: [{ objet_id: 1, enregistre: true,
      estimation_prix: { prix_bas: 1, prix_moyen: 2, prix_haut: 3, devise: "EUR",
        hypotheses: [], sources: [], confiance: 0.5, avertissement: "x" } }],
    non_evalues: [], total: { bas: 1, moyen: 2, haut: 3 }, pv_evaluation: "## PV",
  };
  let i = 0;
  const reponses: unknown[] = [{ jobId: "j" }, { status: "done", result: resultat }];
  const impl = (async (url: string) => {
    if (url.startsWith("/api/perquisitions") || url.startsWith("/api/perquisition?"))
      return { ok: true, json: async () => ({ data: url.includes("?id=") ? { id: 10, objets: [] } : [] }) };
    return { ok: true, json: async () => reponses[Math.min(i++, 1)] };
  }) as unknown as typeof fetch;

  store.setUna("12345/00042/2026");
  store.basculer(1);
  vi.useFakeTimers();
  const p = store.evaluer(impl);
  await vi.advanceTimersByTimeAsync(3000);
  await p;
  vi.useRealTimers();

  expect(store.lireEtat().selection).toEqual([1]);
});

// Reprise après un F5 : un job en vol persisté (jobId + périmètre) est repris au
// montage du module, sans relancer le workflow, puis finalisé comme un lancement
// normal.
test("reprend un job en vol persiste au montage, sans le relancer", async () => {
  const resultat = {
    evaluations: [{ objet_id: 1, enregistre: true,
      estimation_prix: { prix_bas: 1, prix_moyen: 2, prix_haut: 3, devise: "EUR",
        hypotheses: [], sources: [], confiance: 0.5, avertissement: "x" } }],
    non_evalues: [], total: { bas: 1, moyen: 2, haut: 3 }, pv_evaluation: "## PV",
  };
  const enVol = {
    jobId: "j",
    objetIds: [1],
    startedAt: 1000,
  };
  // État persisté d'un onglet rechargé en pleine évaluation.
  sessionStorage.setItem("evaluation:una", JSON.stringify({ una: "12345/00042/2026", enVol }));

  let poste = false;
  const impl = (async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") poste = true;
    if (url.startsWith("/api/job/status"))
      return { ok: true, status: 200, json: async () => ({ status: "done", result: resultat }) };
    if (url.startsWith("/api/perquisitions"))
      return { ok: true, json: async () => ({ data: [{ id: 10, adresse: "3 rue A", created_at: "", nb_objets: 1 }] }) };
    return { ok: true, json: async () => ({ data: { id: 10, objets: [objet(1)] } }) };
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", impl);

  vi.useFakeTimers();
  // Le montage déclenche resumeIfPending() (appel en pied de module) sur le fetch
  // stubé ; on laisse le polling se dérouler.
  const store = await import("./evaluationStore");
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();

  // Reprise = re-poll d'un job détaché : aucun POST, donc pas de double évaluation.
  expect(poste).toBe(false);
  expect(store.lireEtat().resultat?.pv).toContain(">PV<");
  expect(store.lireEtat().evaluationEnCours).toBe(false);
  expect(store.lireEtat().enVol).toBeNull();
});

test("un echec d'evaluation s'affiche sans perdre la selection", async () => {
  const store = await import("./evaluationStore");
  const impl = (async () => ({ ok: false, json: async () => ({ error: "EVALUATION_UPSTREAM" }) })) as unknown as typeof fetch;
  store.setUna("12345/00042/2026");
  store.basculer(7);
  await store.evaluer(impl);
  expect(store.lireEtat().erreur).toBeTruthy();
  expect(store.lireEtat().selection).toEqual([7]);
  expect(store.lireEtat().evaluationEnCours).toBe(false);
});

// Un enquêteur ne doit jamais lire un code technique dans un dossier judiciaire.
test.each([
  ["EVALUATION_UPSTREAM", /indisponible/i],
  ["EVALUATION_TIMEOUT", /délai/i],
  ["EVALUATION_INVALIDE", /non conforme/i],
  ["JOB_INCONNU", /introuvable/i],
  ["INTERNAL_ERROR", /erreur interne/i],
  ["OBJETS_REQUIS", /sélectionnez/i],
  // Code jamais vu : repli générique, surtout pas le code brut.
  ["UN_CODE_IMPREVU", /erreur inconnue/i],
])("le code %s est traduit en message lisible", async (code, attendu) => {
  const store = await import("./evaluationStore");
  const impl = (async () => ({ ok: false, json: async () => ({ error: code }) })) as unknown as typeof fetch;
  store.setUna("12345/00042/2026");
  store.basculer(7);
  await store.evaluer(impl);
  const erreur = store.lireEtat().erreur ?? "";
  expect(erreur).toMatch(attendu);
  expect(erreur).not.toMatch(/[A-Z]{4,}_[A-Z]{4,}/);
});

test("setPv remplace le texte du PV sans toucher au reste", async () => {
  const store = await import("./evaluationStore");
  const resultat = {
    evaluations: [{ objet_id: 1, enregistre: true,
      estimation_prix: { prix_bas: 1, prix_moyen: 2, prix_haut: 3, devise: "EUR",
        hypotheses: [], sources: [], confiance: 0.5, avertissement: "x" } }],
    non_evalues: [{ objet_id: 2, raison: "test" }],
    total: { bas: 1, moyen: 2, haut: 3 },
    pv_evaluation: "## PV initial",
  };
  let i = 0;
  const reponses: unknown[] = [{ jobId: "j" }, { status: "done", result: resultat }];
  const impl = (async (url: string) => {
    if (url.startsWith("/api/perquisitions") || url.startsWith("/api/perquisition?"))
      return { ok: true, json: async () => ({ data: url.includes("?id=") ? { id: 10, objets: [] } : [] }) };
    return { ok: true, json: async () => reponses[Math.min(i++, 1)] };
  }) as unknown as typeof fetch;

  store.setUna("12345/00042/2026");
  store.basculer(1);
  vi.useFakeTimers();
  const p = store.evaluer(impl);
  await vi.advanceTimersByTimeAsync(3000);
  await p;
  vi.useRealTimers();

  const avant = store.lireEtat().resultat;
  store.setPv("## Corrigé");
  const apres = store.lireEtat().resultat;

  expect(apres?.pv).toBe("## Corrigé");
  expect(apres?.evaluations).toEqual(avant?.evaluations);
  expect(apres?.nonEvalues).toEqual(avant?.nonEvalues);
  expect(apres?.totalRecalcule).toEqual(avant?.totalRecalcule);
  expect(apres?.manquants).toEqual(avant?.manquants);
});
