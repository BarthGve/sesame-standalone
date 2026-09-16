import { expect, test, vi } from "vitest";
import {
  chargerUna,
  estVehiculeTerrestre,
  champ,
  lancerEvaluation,
  resumeEvaluation,
} from "./evaluationApi";
import type { ApiObjet } from "../saisies/perquisitionApi";

const objet = (id: number, categorie: string, sousType?: string): ApiObjet => ({
  id,
  categorie,
  sous_type: sousType ?? null,
  champs: [
    { cle: "marque", libelle: "Marque", valeur: "VOLKSWAGEN", source: "deduit", obligatoire: false },
    { cle: "modele", libelle: "Modèle", valeur: "Scirocco", source: "deduit", obligatoire: false },
  ],
  identifiants: [],
});

// fetch factice : renvoie l'enveloppe { data } de rgp-api selon l'URL appelée.
function fetchFactice(perquisitions: unknown, details: Record<number, unknown>) {
  return (async (url: string) => {
    if (url.startsWith("/api/perquisitions"))
      return { ok: true, json: async () => ({ data: perquisitions }) };
    const id = Number(new URL(url, "http://x").searchParams.get("id"));
    return { ok: true, json: async () => ({ data: details[id] }) };
  }) as unknown as typeof fetch;
}

test("reconnait un vehicule terrestre", () => {
  expect(estVehiculeTerrestre(objet(1, "TRANSPORT", "VEHICULE_TERRESTRE"))).toBe(true);
  expect(estVehiculeTerrestre(objet(2, "TRANSPORT", "BATEAU"))).toBe(false);
  expect(estVehiculeTerrestre(objet(3, "ARME"))).toBe(false);
});

test("lit la valeur d'un champ, chaine vide si absent", () => {
  expect(champ(objet(1, "TRANSPORT", "VEHICULE_TERRESTRE"), "marque")).toBe("VOLKSWAGEN");
  expect(champ(objet(1, "TRANSPORT", "VEHICULE_TERRESTRE"), "kilometrage")).toBe("");
});

// Un ApiObjet venu d'une réponse tronquée peut ne pas porter de liste de champs :
// l'écran doit rester affichable plutôt que de lever pendant le rendu.
test("champ() tolere un objet sans liste de champs", () => {
  const sansChamps = { id: 9, categorie: "TRANSPORT", identifiants: [] } as unknown as ApiObjet;
  expect(champ(sansChamps, "marque")).toBe("");
});

test("rassemble les vehicules de toutes les perquisitions de l'UNA", async () => {
  const perquisitions = [
    { id: 10, adresse: "3 rue A", created_at: "2026-01-01", nb_objets: 2 },
    { id: 11, adresse: "5 rue B", created_at: "2026-01-02", nb_objets: 1 },
  ];
  const details = {
    10: { id: 10, objets: [objet(1, "TRANSPORT", "VEHICULE_TERRESTRE"), objet(2, "ARME")] },
    11: { id: 11, objets: [objet(3, "TRANSPORT", "VEHICULE_TERRESTRE")] },
  };
  const r = await chargerUna("12345/00042/2026", fetchFactice(perquisitions, details));
  expect(r.perquisitions).toHaveLength(2);
  expect(r.vehicules.map((v) => v.objet.id)).toEqual([1, 3]);
  expect(r.vehicules[0].adresse).toBe("3 rue A");
  expect(r.nonEligibles).toBe(1);
});

test("un UNA sans perquisition renvoie des listes vides, sans lever", async () => {
  const r = await chargerUna("12345/00099/2026", fetchFactice([], {}));
  expect(r.perquisitions).toEqual([]);
  expect(r.vehicules).toEqual([]);
  expect(r.nonEligibles).toBe(0);
});

test("l'erreur de l'API remonte telle quelle", async () => {
  const impl = (async () => ({ ok: true, json: async () => ({ error: { message: "UNA introuvable" } }) })) as unknown as typeof fetch;
  await expect(chargerUna("12345/00042/2026", impl)).rejects.toThrow("UNA introuvable");
});

const REPONSE = {
  evaluations: [
    { objet_id: 42, enregistre: true,
      estimation_prix: { prix_bas: 8500, prix_moyen: 10200, prix_haut: 11800, devise: "EUR",
        hypotheses: [], sources: [], confiance: 0.7, avertissement: "Simulée." } },
    { objet_id: 43, enregistre: false,
      estimation_prix: { prix_bas: 1500, prix_moyen: 2000, prix_haut: 2500, devise: "EUR",
        hypotheses: [], sources: [], confiance: 0.5, avertissement: "Simulée." } },
  ],
  non_evalues: [{ objet_id: 57, raison: "Année absente" }],
  // Total volontairement faux (aucune somme des estimations ci-dessus ne peut
  // donner ce chiffre) : sert à vérifier que le front recalcule bel et bien,
  // au lieu de reprendre tel quel le total annoncé par le workflow.
  total: { bas: 999999, moyen: 999999, haut: 999999 },
  pv_evaluation: "## PV",
};

function fetchJob(resultat: unknown) {
  let i = 0;
  const reponses = [{ jobId: "j" }, { status: "done", result: resultat }];
  return (async () => ({ ok: true, json: async () => reponses[Math.min(i++, 1)] })) as unknown as typeof fetch;
}

test("recalcule le total plutot que de reprendre celui du workflow", async () => {
  vi.useFakeTimers();
  const p = lancerEvaluation("12345/00042/2026", [42, 43, 57], fetchJob(REPONSE));
  await vi.advanceTimersByTimeAsync(3000);
  const r = await p;
  vi.useRealTimers();
  expect(r.totalRecalcule).toEqual({ bas: 10000, moyen: 12200, haut: 14300 });
  // Le total annoncé (faux) reste accessible pour comparaison, mais n'est pas
  // celui qu'on affiche ni qu'on remonte à l'AGRASC.
  expect(r.totalAnnonce).toEqual({ bas: 999999, moyen: 999999, haut: 999999 });
});

// Reprise après un F5 : le job tourne côté serveur, détaché. La reprise ne doit
// PAS relancer le workflow (double évaluation), seulement re-poller son statut,
// et reconstruire le résultat à l'identique de lancerEvaluation.
test("resumeEvaluation reprend un job sans le relancer", async () => {
  const appels: { url: string; method?: string }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    appels.push({ url, method: init?.method });
    return { ok: true, status: 200, json: async () => ({ status: "done", result: REPONSE }) };
  }) as unknown as typeof fetch;

  vi.useFakeTimers();
  const p = resumeEvaluation("j", [42, 43, 57], impl);
  await vi.advanceTimersByTimeAsync(3000);
  const r = await p;
  vi.useRealTimers();

  // Aucun POST de démarrage : seul le statut du job détaché est interrogé.
  expect(appels.every((a) => a.url.startsWith("/api/job/status"))).toBe(true);
  expect(appels.some((a) => a.method === "POST")).toBe(false);
  // Résultat reconstruit à l'identique (même périmètre → mêmes calculs).
  expect(r.totalRecalcule).toEqual({ bas: 10000, moyen: 12200, haut: 14300 });
  expect(r.pv).toBe("## PV");
});

// Une estimation inexploitable ne doit jamais entrer dans le total remonté à
// l'AGRASC : ni comme zéro fabriqué (objet 44), ni par concaténation de chaînes
// (objet 45), ni avec une borne manquante comptée pour zéro (objet 46).
test("une estimation absente ou invalide ne fait pas echouer le run", async () => {
  vi.useFakeTimers();
  const reponse = {
    evaluations: [
      { objet_id: 42, enregistre: true,
        estimation_prix: { prix_bas: 8500, prix_moyen: 10200, prix_haut: 11800, devise: "EUR",
          hypotheses: [], sources: [], confiance: 0.7, avertissement: "Simulée." } },
      { objet_id: 43, enregistre: true, estimation_prix: null },
      // Objet d'estimation vide : passe la garde `if (!estimation)` et vaudrait
      // 0 € dans le total.
      { objet_id: 44, enregistre: true, estimation_prix: {} },
      // Bornes non numériques : l'addition concaténerait les chaînes.
      { objet_id: 45, enregistre: true,
        estimation_prix: { prix_bas: "abc", prix_moyen: "10 200 €", prix_haut: null } },
      // Fourchette partielle : le total bas serait sous-estimé pendant que le
      // total haut resterait juste.
      { objet_id: 46, enregistre: true,
        estimation_prix: { prix_bas: null, prix_moyen: 3000, prix_haut: 4000 } },
    ],
    non_evalues: [],
    total: { bas: 999999, moyen: 999999, haut: 999999 },
    pv_evaluation: "## PV",
  };
  const p = lancerEvaluation("12345/00042/2026", [42, 43, 44, 45, 46], fetchJob(reponse));
  await vi.advanceTimersByTimeAsync(3000);
  const r = await p;
  vi.useRealTimers();

  expect(r.evaluations).toHaveLength(1);
  expect(r.evaluations[0].objetId).toBe(42);
  expect(r.nonEvalues.map((n) => n.objetId).sort()).toEqual([43, 44, 45, 46]);
  expect(r.nonEvalues[0].raison).toMatch(/43/);
  for (const n of r.nonEvalues) expect(n.raison).toMatch(/\S/);
  expect(r.manquants).toEqual([]);
  // Le total ne retient que l'objet 42 : aucun zéro fabriqué, aucune chaîne
  // concaténée, aucune borne absente comptée pour zéro.
  expect(r.totalRecalcule).toEqual({ bas: 8500, moyen: 10200, haut: 11800 });
});

test("des prix rendus en chaines de caracteres sont convertis, jamais concatenes", async () => {
  vi.useFakeTimers();
  const reponse = {
    evaluations: [
      { objet_id: 42, enregistre: true,
        estimation_prix: { prix_bas: 5000, prix_moyen: 6000, prix_haut: 7000 } },
      { objet_id: 43, enregistre: true,
        estimation_prix: { prix_bas: "3000", prix_moyen: "3500", prix_haut: "4000" } },
    ],
    non_evalues: [],
    total: null,
    pv_evaluation: "## PV",
  };
  const p = lancerEvaluation("12345/00042/2026", [42, 43], fetchJob(reponse));
  await vi.advanceTimersByTimeAsync(3000);
  const r = await p;
  vi.useRealTimers();

  expect(r.evaluations).toHaveLength(2);
  expect(r.evaluations[1].estimation.prixBas).toBe(3000);
  // 5000 + "3000" donnerait "50003000", soit 50 003 000 € à l'écran.
  expect(r.totalRecalcule).toEqual({ bas: 8000, moyen: 9500, haut: 11000 });
});

test("un total annonce de forme inattendue est ignore, sans ecart fantome", async () => {
  vi.useFakeTimers();
  const reponse = {
    evaluations: [
      { objet_id: 42, enregistre: true,
        estimation_prix: { prix_bas: 5000, prix_moyen: 6000, prix_haut: 7000 } },
    ],
    non_evalues: [],
    // Le workflow a rendu un nombre au lieu d'un objet { bas, moyen, haut }.
    total: 18000,
    pv_evaluation: "## PV",
  };
  const p = lancerEvaluation("12345/00042/2026", [42], fetchJob(reponse));
  await vi.advanceTimersByTimeAsync(3000);
  const r = await p;
  vi.useRealTimers();
  expect(r.totalAnnonce).toBeNull();
});

test("signale les objets envoyes mais absents du resultat", async () => {
  vi.useFakeTimers();
  const p = lancerEvaluation("12345/00042/2026", [42, 43, 57, 99], fetchJob(REPONSE));
  await vi.advanceTimersByTimeAsync(3000);
  const r = await p;
  vi.useRealTimers();
  expect(r.manquants).toEqual([99]);
});

// Toutes les évaluations sont inexploitables : la somme des montants annoncés
// n'est pas 0 €, elle n'existe pas. Un « 0 € à 0 € » se lirait comme un montant
// annoncé par l'analyse.
test("aucune evaluation exploitable ne fabrique pas un total annonce de zero", async () => {
  vi.useFakeTimers();
  const reponse = {
    evaluations: [
      { objet_id: 42, enregistre: true, estimation_prix: null },
      { objet_id: 43, enregistre: true, estimation_prix: { prix_bas: "abc" } },
    ],
    non_evalues: [],
    total: null,
    pv_evaluation: "## PV",
  };
  const p = lancerEvaluation("u", [42, 43], fetchJob(reponse));
  await vi.advanceTimersByTimeAsync(3000);
  const r = await p;
  vi.useRealTimers();
  expect(r.evaluations).toEqual([]);
  expect(r.totalRecalcule).toBeNull();
});

// Un objet que l'enquêteur n'a jamais coché ne doit peser sur AUCUN chiffre de
// l'écran : il n'aurait pas de ligne (celles-ci sont bâties sur objetIds) tout en
// gonflant le total comparatif et en décalant l'écart avec le total annoncé.
// Qu'un agent rende un objet hors du périmètre demandé est en soi une anomalie :
// elle est signalée plutôt que passée sous silence.
test("un objet hors selection ne pese sur aucun total et est signale", async () => {
  vi.useFakeTimers();
  const reponse = {
    evaluations: [
      { objet_id: 42, enregistre: true,
        estimation_prix: { prix_bas: 5000, prix_moyen: 6000, prix_haut: 7000 } },
      // Jamais coché par l'enquêteur : l'agent l'a rendu de son propre chef.
      { objet_id: 999, enregistre: true,
        estimation_prix: { prix_bas: 100000, prix_moyen: 200000, prix_haut: 300000 } },
    ],
    non_evalues: [{ objet_id: 998, raison: "Année absente" }],
    total: { bas: 5000, moyen: 6000, haut: 7000 },
    pv_evaluation: "## PV",
  };
  const p = lancerEvaluation("12345/00042/2026", [42], fetchJob(reponse));
  await vi.advanceTimersByTimeAsync(3000);
  const r = await p;
  vi.useRealTimers();

  // Le total comparatif ne retient que l'objet coché : sans quoi il vaudrait
  // 205 000 € en estimation et fabriquerait un écart avec le total annoncé.
  expect(r.totalRecalcule).toEqual({ bas: 5000, moyen: 6000, haut: 7000 });
  expect(r.evaluations.map((e) => e.objetId)).toEqual([42]);
  expect(r.nonEvalues.map((n) => n.objetId)).toEqual([]);
  // L'anomalie est nommée, dans les deux sens (estimation et non-évaluation).
  expect(r.horsSelection.sort((a, b) => a - b)).toEqual([998, 999]);
  expect(r.manquants).toEqual([]);
});

test("convertit l'estimation au format du front", async () => {
  vi.useFakeTimers();
  const p = lancerEvaluation("u", [42, 43], fetchJob(REPONSE));
  await vi.advanceTimersByTimeAsync(3000);
  const r = await p;
  vi.useRealTimers();
  expect(r.evaluations[0].estimation.prixMoyen).toBe(10200);
  expect(r.evaluations).toHaveLength(2);
});
