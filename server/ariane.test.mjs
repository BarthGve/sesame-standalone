import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractJson, validateContract, buildAggregate, assembleContract, runExtraction, runConsolidation, runAriane, createJob, getJob, startJob, appliquerMeta, appliquerMetaXml } from "./ariane.mjs";
import { parseNomFichier } from "./pieceMeta.mjs";

test("extractJson retire la trace <tool> et parse l'objet", () => {
  const r = '<tool>lire<tool-output>x</tool-output></tool>\n{"cote":"D1","personnes":[]}';
  assert.deepEqual(extractJson(r), { cote: "D1", personnes: [] });
});

test("extractJson déballe une fence ```json", () => {
  const r = '```json\n{"a":1}\n```';
  assert.deepEqual(extractJson(r), { a: 1 });
});

test("extractJson non-string ou JSON invalide → ARIANE_INVALIDE", () => {
  assert.throws(() => extractJson(null), /ARIANE_INVALIDE/);
  assert.throws(() => extractJson(""), /ARIANE_INVALIDE/);
  assert.throws(() => extractJson("pas de json ici"), /ARIANE_INVALIDE/);
});

const contratOk = {
  affaire: { reference: "X", nature: "Vol", service: "BR", periode: { debut: "2026-03-04", fin: "2026-03-06" }, nb_cotes: 2 },
  synthese: "s",
  parties: [{ id: "p1", nom: "A", role: "mis_en_cause", aliases: [], qualite: "", premiere_cote: "D1" }],
  evenements: [{ id: "e1", date: "2026-03-04", precision: "jour", libelle: "f", cote_source: "D1", parties: ["p1"] }],
  actes: [{ id: "a1", date: "2026-03-06", type: "audition", cote: "D2", libelle: "au", redacteur: null, concernes: ["p1"] }],
  relations: [],
};

test("validateContract accepte un contrat coherent", () => {
  assert.equal(validateContract(contratOk), contratOk);
});

test("validateContract rejette un id de partie orphelin", () => {
  const bad = structuredClone(contratOk);
  bad.evenements[0].parties = ["pX"];
  assert.throws(() => validateContract(bad), /ARIANE_INVALIDE/);
});

test("validateContract rejette une enum inconnue", () => {
  const bad = structuredClone(contratOk);
  bad.actes[0].type = "photocopie";
  assert.throws(() => validateContract(bad), /ARIANE_INVALIDE/);
});

test("validateContract rejette un id de partie duplique", () => {
  const bad = structuredClone(contratOk);
  bad.parties.push({ id: "p1", nom: "B", role: "temoin", aliases: [], qualite: "", premiere_cote: "D2" });
  assert.throws(() => validateContract(bad), /ARIANE_INVALIDE/);
});

test("la fixture docs/ariane-exemple.json passe validateContract", () => {
  const fixture = JSON.parse(readFileSync(new URL("../docs/ariane-exemple.json", import.meta.url)));
  assert.equal(validateContract(fixture), fixture);
  assert.ok(fixture.parties.length >= 6, "au moins 6 parties");
  assert.ok(fixture.actes.length >= 8, "au moins 8 actes");
  assert.ok(fixture.relations.length >= 5, "au moins 5 relations");
});

const mapOut = [
  { cote: "D3", acte: { type: "audition", date: "2026-03-04", libelle: "au", redacteur_ref: "m9", concernes_refs: ["m1"] },
    personnes: [{ ref: "m1", nom: "Jean DUPONT", aliases: [], role_apparent: "mis_en_cause", naissance: "1990-05-02", qualite: "", adresse: "" },
                { ref: "m9", nom: "ADC MARTIN", aliases: [], role_apparent: "enqueteur" }],
    faits: [{ date: "2026-03-04", precision: "jour", libelle: "vol", personnes_refs: ["m1"] }],
    relations_lues: [{ de: "m1", vers: "m2", type: "complice", libelle: "avec" }] },
];

test("buildAggregate prefixe les refs par la cote (gref)", () => {
  const agg = buildAggregate(mapOut);
  assert.equal(agg.personnes[0].gref, "D3:m1");
  assert.equal(agg.personnes[0].cote, "D3");
  assert.equal(agg.personnes.length, 2);
  assert.deepEqual(agg.relations_lues[0], { de: "D3:m1", vers: "D3:m2", type: "complice", libelle: "avec", cote: "D3" });
});

const MAP = [
  { cote: "D2", acte: { type: "constatation", date: "2026-03-04", libelle: "constat", redacteur_ref: "m9", concernes_refs: ["m3"] },
    personnes: [{ ref: "m3", nom: "MERIDIA", role_apparent: "victime" }, { ref: "m9", nom: "ADC MARTIN", role_apparent: "enqueteur" }],
    faits: [{ date: "2026-03-04", precision: "jour", libelle: "effraction", personnes_refs: ["m1"] }],
    relations_lues: [] },
  { cote: "D3", acte: { type: "audition", date: "2026-03-06", libelle: "audition DUPONT", redacteur_ref: "m9b", concernes_refs: ["m1b"] },
    personnes: [{ ref: "m1b", nom: "Jean DUPONT", role_apparent: "mis_en_cause" }, { ref: "m9b", nom: "ADC MARTIN", role_apparent: "enqueteur" }],
    faits: [], relations_lues: [] },
];
const REDUCE = {
  affaire: { reference: "PV 1", nature: "Vol", service: "BR" },
  synthese: "s",
  parties: [
    { id: "p1", nom: "Jean DUPONT", role: "mis_en_cause", aliases: [], qualite: "", premiere_cote: "D3", membres: ["D2:m1", "D3:m1b"] },
    { id: "p2", nom: "MERIDIA", role: "victime", aliases: [], qualite: "", premiere_cote: "D2", membres: ["D2:m3"] },
    { id: "p3", nom: "ADC MARTIN", role: "enqueteur", aliases: [], qualite: "", premiere_cote: "D2", membres: ["D2:m9", "D3:m9b"] },
  ],
  relations: [{ source: "p1", cible: "p2", type: "victime_de", libelle: "vol", cotes: ["D2"] }],
};

test("assembleContract construit events/actes avec party ids", () => {
  const c = assembleContract(MAP, REDUCE);
  assert.equal(c.evenements.length, 1);
  assert.equal(c.evenements[0].id, "e1");
  assert.equal(c.evenements[0].cote_source, "D2");
  assert.deepEqual(c.evenements[0].parties, ["p1"]);   // D2:m1 → p1
  assert.equal(c.actes.length, 2);
  assert.equal(c.actes[1].redacteur, "p3");            // D3:m9b → p3
  assert.deepEqual(c.actes[1].concernes, ["p1"]);      // D3:m1b → p1
});

test("assembleContract dérive les relations procédurales + calcule affaire", () => {
  const c = assembleContract(MAP, REDUCE);
  // audition D3 : concerné p1 entendu_par redacteur p3
  const proc = c.relations.find((r) => r.type === "entendu_par");
  assert.deepEqual({ s: proc.source, c: proc.cible, cotes: proc.cotes }, { s: "p1", c: "p3", cotes: ["D3"] });
  assert.ok(c.relations.some((r) => r.type === "victime_de")); // relation lue conservée
  assert.deepEqual(c.affaire.periode, { debut: "2026-03-04", fin: "2026-03-06" });
  assert.equal(c.affaire.nb_cotes, 2);
});

test("assembleContract → contrat valide", () => {
  assert.doesNotThrow(() => validateContract(assembleContract(MAP, REDUCE)));
});

// Régression : un type d'acte ou une précision hors vocabulaire (fréquents quand le MAP lit
// une cote atypique — ADN, expertise, bordereau…) ne doit plus faire échouer TOUT le dossier
// via ARIANE_INVALIDE. Ils sont bornés au vocabulaire, comme les rôles et types de relation.
test("assembleContract borne un type d'acte / une précision hors vocabulaire (dossier sauvé)", () => {
  const map = structuredClone(MAP);
  map[0].acte.type = "prelevement";     // hors TYPES_ACTE
  map[0].faits[0].precision = "date";   // hors PRECISIONS
  const avert = [];
  const c = assembleContract(map, REDUCE, (a) => avert.push(a));
  assert.equal(c.actes.find((a) => a.cote === "D2").type, "autre");
  assert.equal(c.evenements[0].precision, "jour");
  assert.ok(avert.some((a) => /Type d'acte inconnu/.test(a)), "l'utilisateur est averti du reclassement");
  assert.doesNotThrow(() => validateContract(c));
});

test("assembleContract ignore une relation reduce à id orphelin (best-effort)", () => {
  const reduceOrphan = structuredClone(REDUCE);
  reduceOrphan.relations = [{ source: "p1", cible: "pX", type: "complice", libelle: "?", cotes: ["D2"] }];
  let c;
  assert.doesNotThrow(() => { c = assembleContract(MAP, reduceOrphan); });
  assert.ok(!c.relations.some((r) => r.cible === "pX"));
  assert.doesNotThrow(() => validateContract(c));
});

// Filet de securite : un type de relation hors vocabulaire ne doit jamais detruire
// l'analyse de tout le dossier. Il est ramene a "autre" et l'utilisateur est averti.
test("un type de relation inconnu est ramene a autre, le libelle est conserve, un avertissement nomme le type", () => {
  const reduceInconnu = structuredClone(REDUCE);
  reduceInconnu.relations = [{ source: "p1", cible: "p2", type: "chantage", libelle: "a fait chanter", cotes: ["D2"] }];
  const avertissements = [];
  let c;
  assert.doesNotThrow(() => { c = assembleContract(MAP, reduceInconnu, (a) => avertissements.push(a)); });
  const rel = c.relations.find((r) => r.source === "p1" && r.cible === "p2");
  assert.equal(rel.type, "autre");
  assert.equal(rel.libelle, "a fait chanter"); // le libelle porte le sens : intact
  assert.doesNotThrow(() => validateContract(c));
  assert.deepEqual(avertissements, ["Type de relation inconnu : chantage"]);
});

// Les pieces sont a diffusion restreinte : l'avertissement ne nomme que le code du
// type, jamais une personne, une cote ou le libelle de la relation.
test("l'avertissement de type de relation inconnu ne divulgue ni nom, ni cote, ni libelle", () => {
  const reduceInconnu = structuredClone(REDUCE);
  reduceInconnu.relations = [{ source: "p1", cible: "p2", type: "chantage",
    libelle: "Jean DUPONT a fait chanter MERIDIA en D2", cotes: ["D2"] }];
  const avertissements = [];
  assembleContract(MAP, reduceInconnu, (a) => avertissements.push(a));
  assert.equal(avertissements.length, 1);
  const a = avertissements[0];
  for (const interdit of ["DUPONT", "Jean", "MERIDIA", "D2", "a fait chanter"]) {
    assert.ok(!a.includes(interdit), `l'avertissement ne doit pas contenir "${interdit}" : ${a}`);
  }
});

// Les relations procedurales sont derivees en code depuis le type d'acte : elles sont
// valides par construction et ne doivent produire aucun avertissement.
test("les relations procedurales derivees en code ne produisent aucun avertissement", () => {
  const avertissements = [];
  const c = assembleContract(MAP, REDUCE, (a) => avertissements.push(a));
  assert.ok(c.relations.some((r) => r.type === "entendu_par"));
  assert.deepEqual(avertissements, []);
});

// Relation centrale d'un dossier penal : qui a commis quoi sur qui. Le sens va de
// l'auteur vers la victime — inverser source/cible afficherait la victime comme
// auteur des faits.
test("une relation auteur_victime est conservee telle quelle, sans inversion ni avertissement", () => {
  const reduceAuteur = structuredClone(REDUCE);
  reduceAuteur.relations = [{ source: "p1", cible: "p2", type: "auteur_victime",
    libelle: "a commis des actes sexuels sur", cotes: ["D2"] }];
  const avertissements = [];
  const c = assembleContract(MAP, reduceAuteur, (a) => avertissements.push(a));
  const rel = c.relations.find((r) => r.type === "auteur_victime");
  assert.ok(rel, "la relation auteur_victime doit etre conservee");
  assert.equal(rel.source, "p1"); // l'auteur reste la source
  assert.equal(rel.cible, "p2");  // la victime reste la cible
  assert.equal(rel.libelle, "a commis des actes sexuels sur");
  assert.deepEqual(avertissements, []);
  assert.doesNotThrow(() => validateContract(c));
});

test("validateContract accepte le type de relation auteur_victime", () => {
  const ok = structuredClone(contratOk);
  ok.parties.push({ id: "p2", nom: "B", role: "victime", aliases: [], qualite: "", premiere_cote: "D1" });
  ok.relations = [{ source: "p1", cible: "p2", type: "auteur_victime", libelle: "a commis un attouchement sexuel sur", cotes: ["D1"] }];
  assert.equal(validateContract(ok), ok);
});

test("validateContract rejette un contrat dont parties n'est pas un tableau", () => {
  const bad = { parties: null, evenements: [], actes: [], relations: [] };
  assert.throws(() => validateContract(bad), /ARIANE_INVALIDE/);
});

test("assembleContract sans clé parties dans reduce ne lève pas et donne parties=[]", () => {
  const reduceSansParties = { synthese: "s", relations: [], affaire: {} };
  let result;
  assert.doesNotThrow(() => { result = assembleContract(MAP, reduceSansParties); });
  assert.deepEqual(result.parties, []);
});

test("buildAggregate regroupe les mentions d'une meme personne", () => {
  const agg = buildAggregate([
    { cote: "D3", personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }], relations_lues: [] },
    { cote: "D9", personnes: [{ ref: "m4", nom: "BIDULE Marc", role_apparent: "mis_en_cause" }], relations_lues: [] },
  ]);
  assert.equal(agg.personnes.length, 1);
  assert.deepEqual(agg.personnes[0].membres, ["D3:m1", "D9:m4"]);
});

test("buildAggregate reunit naissance/qualite/adresse de toutes les mentions du groupe", () => {
  const agg = buildAggregate([
    { cote: "D3", personnes: [{ ref: "m1", nom: "Jean DUPONT", role_apparent: "mis_en_cause", aliases: [], naissance: null, qualite: "", adresse: null }], relations_lues: [] },
    { cote: "D9", personnes: [{ ref: "m4", nom: "DUPONT Jean", role_apparent: "mis_en_cause", aliases: [], naissance: "1990-05-02", qualite: "ouvrier", adresse: "12 rue X" }], relations_lues: [] },
  ]);
  assert.equal(agg.personnes.length, 1);
  assert.equal(agg.personnes[0].naissance, "1990-05-02");
  assert.equal(agg.personnes[0].qualite, "ouvrier");
  assert.equal(agg.personnes[0].adresse, "12 rue X");
});

test("buildAggregate reunit les aliases de toutes les mentions du groupe (union dedupliquee, ordre de premiere apparition)", () => {
  const agg = buildAggregate([
    { cote: "D3", personnes: [{ ref: "m1", nom: "Jean DUPONT", role_apparent: "mis_en_cause", aliases: ["Jeannot"] }], relations_lues: [] },
    { cote: "D9", personnes: [{ ref: "m4", nom: "DUPONT Jean", role_apparent: "mis_en_cause", aliases: ["Le Grand", "Jeannot"] }], relations_lues: [] },
  ]);
  assert.equal(agg.personnes.length, 1);
  assert.deepEqual(agg.personnes[0].aliases, ["Jeannot", "Le Grand"]);
});

test("buildAggregate laisse passer les mentions sans cle exploitable", () => {
  const agg = buildAggregate([
    { cote: "D1", personnes: [{ ref: "m1", nom: "X", role_apparent: "temoin" }], relations_lues: [] },
  ]);
  assert.equal(agg.personnes.length, 1);
  assert.equal(agg.personnes[0].gref, "D1:m1");
});

test("assembleContract enrichit les parties de leur historique de roles", () => {
  const mapOutputs = [
    { cote: "D3", personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }], faits: [], acte: null, relations_lues: [] },
    { cote: "D9", personnes: [{ ref: "m4", nom: "BIDULE Marc", role_apparent: "mis_en_cause" }], faits: [], acte: null, relations_lues: [] },
  ];
  const reduce = { affaire: {}, synthese: "s", relations: [],
    parties: [{ id: "p1", nom: "Marc BIDULE", role: "temoin", aliases: [], qualite: "", premiere_cote: "D3", membres: ["D3:m1", "D9:m4"] }] };
  const c = assembleContract(mapOutputs, reduce);
  assert.deepEqual(c.parties[0].roles, [
    { role: "temoin", cote: "D3" },
    { role: "mis_en_cause", cote: "D9" },
  ]);
  // Le role principal du contrat suit l'ordre d'engagement, pas celui du REDUCE.
  assert.equal(c.parties[0].role, "mis_en_cause");
});

test("assembleContract reunit les roles quand les membres d'une partie relevent de deux groupes distincts", () => {
  // Les grefs de la partie renvoyee par le REDUCE couvrent deux personnes qui,
  // du point de vue de fusionnerMentions (cle de coreference sur le nom), forment
  // deux groupes distincts : "Jean DUPONT" (D3) et "Dupont Jean-Paul" (D9).
  const mapOutputs = [
    { cote: "D3", personnes: [{ ref: "m1", nom: "Jean DUPONT", role_apparent: "temoin" }], faits: [], acte: null, relations_lues: [] },
    { cote: "D9", personnes: [{ ref: "m4", nom: "Dupont Jean-Paul", role_apparent: "mis_en_cause" }], faits: [], acte: null, relations_lues: [] },
  ];
  const reduce = { affaire: {}, synthese: "s", relations: [],
    parties: [{ id: "p1", nom: "Dupont", role: "victime", aliases: [], qualite: "", premiere_cote: "D3", membres: ["D3:m1", "D9:m4"] }] };
  const c = assembleContract(mapOutputs, reduce);
  assert.deepEqual(c.parties[0].roles, [
    { role: "temoin", cote: "D3" },
    { role: "mis_en_cause", cote: "D9" },
  ]);
  // Le plus engageant de l'ensemble reuni, pas seulement du premier groupe trouve.
  assert.equal(c.parties[0].role, "mis_en_cause");
});

test("assembleContract : partie sans membre connu → pas de roles, role du REDUCE conserve", () => {
  const reduce = { affaire: {}, synthese: "s", relations: [],
    parties: [{ id: "p1", nom: "Inconnu", role: "temoin", aliases: [], qualite: "", premiere_cote: "D1", membres: [] }] };
  const c = assembleContract([], reduce);
  assert.equal(c.parties[0].roles, undefined);
  assert.equal(c.parties[0].role, "temoin");
});

test("buildAggregate ne fusionne pas deux homonymes de naissances differentes et conserve les deux dates", () => {
  const agg = buildAggregate([
    { cote: "D3", personnes: [{ ref: "m1", nom: "Jean DUPONT", role_apparent: "temoin", aliases: [], naissance: "1990-05-02" }], relations_lues: [] },
    { cote: "D9", personnes: [{ ref: "m4", nom: "DUPONT Jean", role_apparent: "mis_en_cause", aliases: [], naissance: "1962-01-30" }], relations_lues: [] },
  ]);
  assert.equal(agg.personnes.length, 2);
  assert.deepEqual(agg.personnes.map((p) => p.naissance).sort(), ["1962-01-30", "1990-05-02"]);
  assert.deepEqual(agg.personnes.map((p) => p.gref).sort(), ["D3:m1", "D9:m4"]);
});

test("assembleContract rattache les grefs du groupe que le REDUCE a omis", () => {
  // Le REDUCE ne renvoie qu'un membre sur deux (il ne voit qu'un gref representant
  // par groupe) : les evenements et actes de l'autre cote doivent tout de meme
  // trouver leur partie, sinon le contrat contredit la fiche de la partie.
  const mapOutputs = [
    { cote: "D3", personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }, { ref: "m9", nom: "Julie MALLIETTE", role_apparent: "enqueteur" }],
      faits: [], acte: null, relations_lues: [] },
    { cote: "D9", personnes: [{ ref: "m4", nom: "BIDULE Marc", role_apparent: "mis_en_cause" }, { ref: "m9b", nom: "Julie MALLIETTE", role_apparent: "enqueteur" }],
      faits: [{ date: "2026-03-05", precision: "jour", libelle: "vol", personnes_refs: ["m4"] }],
      acte: { type: "audition", date: "2026-03-05", libelle: "a", redacteur_ref: "m9b", concernes_refs: ["m4"] },
      relations_lues: [] },
  ];
  const reduce = { affaire: {}, synthese: "s", relations: [],
    parties: [
      { id: "p1", nom: "Marc BIDULE", role: "temoin", aliases: [], qualite: "", premiere_cote: "D3", membres: ["D3:m1"] },
      { id: "p2", nom: "Julie MALLIETTE", role: "enqueteur", aliases: [], qualite: "", premiere_cote: "D3", membres: ["D3:m9"] },
    ] };
  const c = assembleContract(mapOutputs, reduce);
  assert.deepEqual(c.evenements[0].parties, ["p1"]);   // D9:m4 → p1 par le groupe
  assert.deepEqual(c.actes[0].concernes, ["p1"]);
  assert.equal(c.actes[0].redacteur, "p2");            // D9:m9b → p2 par le groupe
  assert.doesNotThrow(() => validateContract(c));
});

test("assembleContract ne reattribue pas un gref que le REDUCE a explicitement donne a une autre partie", () => {
  // Les deux grefs d'un meme groupe sont revendiques par deux parties distinctes :
  // le premier rattachement gagne, l'extension ne fusionne jamais ce que le REDUCE
  // a deliberement separe.
  const mapOutputs = [
    { cote: "D3", personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }], faits: [], acte: null, relations_lues: [] },
    { cote: "D9", personnes: [{ ref: "m4", nom: "BIDULE Marc", role_apparent: "mis_en_cause" }],
      faits: [{ date: "2026-03-05", precision: "jour", libelle: "vol", personnes_refs: ["m4"] }], acte: null, relations_lues: [] },
  ];
  const reduce = { affaire: {}, synthese: "s", relations: [],
    parties: [
      { id: "p1", nom: "Marc BIDULE", role: "temoin", aliases: [], qualite: "", premiere_cote: "D3", membres: ["D3:m1"] },
      { id: "p2", nom: "Marc BIDULE", role: "mis_en_cause", aliases: [], qualite: "", premiere_cote: "D9", membres: ["D9:m4"] },
    ] };
  const c = assembleContract(mapOutputs, reduce);
  assert.deepEqual(c.evenements[0].parties, ["p2"]);
});

test("un role_apparent hors vocabulaire donne roles[] a autre sans effacer le verdict du REDUCE", () => {
  const mapOutputs = [
    { cote: "D1", personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "plaignant" }], faits: [], acte: null, relations_lues: [] },
  ];
  const reduce = { affaire: {}, synthese: "s", relations: [],
    parties: [{ id: "p1", nom: "Marc BIDULE", role: "victime", aliases: [], qualite: "", premiere_cote: "D1", membres: ["D1:m1"] }] };
  const c = assembleContract(mapOutputs, reduce);
  // "plaignant" est hors vocabulaire : borne a "autre" dans l'historique, il
  // n'apporte aucune information et ne peut donc pas ecraser le "victime" du
  // REDUCE. L'essentiel tient : rien d'invente ne ressort, le contrat reste valide.
  assert.deepEqual(c.parties[0].roles, [{ role: "autre", cote: "D1" }]);
  assert.equal(c.parties[0].role, "victime");
  assert.doesNotThrow(() => validateContract(c));
});

test("partie sans membre connu et role hors vocabulaire → role borne a autre, contrat valide", () => {
  // Le REDUCE fabrique une partie pour une personne qu'aucun groupe calcule ne
  // touche (nom reduit a des initiales, ou grefs inventes) et lui donne un role de
  // son cru. Sans bornage sur ce chemin, validateContract leve ARIANE_INVALIDE et
  // l'analyse de tout le dossier est perdue.
  const mapOutputs = [
    { cote: "D1", personnes: [{ ref: "m1", nom: "X", role_apparent: "temoin" }], faits: [], acte: null, relations_lues: [] },
  ];
  const reduce = { affaire: {}, synthese: "s", relations: [],
    parties: [
      { id: "p1", nom: "X", role: "partie civile", aliases: [], qualite: "", premiere_cote: "D1", membres: ["D1:m1"] },
      { id: "p2", nom: "Inconnu", role: "garde a vue", aliases: [], qualite: "", premiere_cote: "D1", membres: [] },
      { id: "p3", nom: "Autre", role: "plaignant", aliases: [], qualite: "", premiere_cote: "D1", membres: ["D1:invente"] },
    ] };
  const c = assembleContract(mapOutputs, reduce);
  assert.deepEqual(c.parties.map((p) => p.role), ["autre", "autre", "autre"]);
  assert.doesNotThrow(() => validateContract(c));
});

test("tous les roles calcules valent autre → le verdict du REDUCE est conserve", () => {
  // Le MAP n'a qualifie la personne nulle part : l'ensemble calcule n'apporte
  // aucune information et ne doit pas ecraser le "victime" du REDUCE, qui
  // basculerait la partie dans le groupe "Autres" a l'ecran.
  const mapOutputs = [
    { cote: "D1", personnes: [{ ref: "m1", nom: "Marc BIDULE" }], faits: [], acte: null, relations_lues: [] },
    { cote: "D2", personnes: [{ ref: "m2", nom: "BIDULE Marc", role_apparent: "autre" }], faits: [], acte: null, relations_lues: [] },
  ];
  const reduce = { affaire: {}, synthese: "s", relations: [],
    parties: [{ id: "p1", nom: "Marc BIDULE", role: "victime", aliases: [], qualite: "", premiere_cote: "D1", membres: ["D1:m1"] }] };
  const c = assembleContract(mapOutputs, reduce);
  assert.equal(c.parties[0].role, "victime");
  // L'historique reste celui du calcul : il documente ce que les pieces disent.
  assert.deepEqual(c.parties[0].roles, [{ role: "autre", cote: "D1" }, { role: "autre", cote: "D2" }]);
});

test("des qu'un role calcule apporte une information, l'ensemble calcule prime sur le REDUCE", () => {
  const mapOutputs = [
    { cote: "D1", personnes: [{ ref: "m1", nom: "Marc BIDULE" }], faits: [], acte: null, relations_lues: [] },
    { cote: "D2", personnes: [{ ref: "m2", nom: "BIDULE Marc", role_apparent: "temoin" }], faits: [], acte: null, relations_lues: [] },
  ];
  const reduce = { affaire: {}, synthese: "s", relations: [],
    parties: [{ id: "p1", nom: "Marc BIDULE", role: "mis_en_cause", aliases: [], qualite: "", premiere_cote: "D1", membres: ["D1:m1"] }] };
  const c = assembleContract(mapOutputs, reduce);
  // "temoin" est moins engageant que le "mis_en_cause" du REDUCE : l'ensemble
  // calcule l'emporte quand meme, il est fonde sur ce que les pieces montrent.
  assert.equal(c.parties[0].role, "temoin");
});

test("assembleContract transmet la naissance a la coreference : deux homonymes restent deux parties", () => {
  // Sans naissance dans les mentions reconstruites, les deux grefs formeraient un
  // seul groupe et l'extension rattacherait D9:m4 a p1 : les actes du second
  // homonyme seraient portes au compte du premier.
  const mapOutputs = [
    { cote: "D3", personnes: [{ ref: "m1", nom: "Jean DUPONT", role_apparent: "temoin", naissance: "1990-05-02" }], faits: [], acte: null, relations_lues: [] },
    { cote: "D9", personnes: [{ ref: "m4", nom: "DUPONT Jean", role_apparent: "mis_en_cause", naissance: "1962-01-30" }],
      faits: [{ date: "2026-03-05", precision: "jour", libelle: "vol", personnes_refs: ["m4"] }], acte: null, relations_lues: [] },
  ];
  const reduce = { affaire: {}, synthese: "s", relations: [],
    parties: [{ id: "p1", nom: "Jean DUPONT", role: "temoin", aliases: [], qualite: "", premiere_cote: "D3", membres: ["D3:m1"] }] };
  const c = assembleContract(mapOutputs, reduce);
  assert.deepEqual(c.evenements[0].parties, []);       // D9:m4 n'est pas p1
  assert.deepEqual(c.parties[0].roles, [{ role: "temoin", cote: "D3" }]);
  assert.equal(c.parties[0].role, "temoin");
});

const cfg = { baseUrl: "http://iaka", jwt: "j", tenantId: "t", arianeExtractionAppId: "extract", arianeConsolidationAppId: "consol", pollIntervalMs: 0, pollTimeoutMs: 1000 };
const noSleep = () => Promise.resolve();

function fakeFetch(execBody, statusResult) {
  return async (urlArg, init) => {
    const url = String(urlArg);
    if (url.endsWith("/workflows/execute")) return { ok: true, json: async () => ({ execution_id: "x1" }), ...execBody };
    return { ok: true, json: async () => ({ status: "SUCCESS", result: statusResult }) };
  };
}

test("runExtraction poll → extractJson + stampe la cote", async () => {
  const out = await runExtraction({ file: { base64: "AA==", mime: "application/pdf", filename: "D7.pdf" }, cote: "D7", cfg, fetchImpl: fakeFetch({}, '{"personnes":[],"faits":[],"acte":null,"relations_lues":[]}'), sleep: noSleep });
  assert.equal(out.cote, "D7");
  assert.deepEqual(out.personnes, []);
});

test("runConsolidation envoie l'agrégat en prompt et parse la sortie", async () => {
  let sentBody;
  const fetchImpl = async (urlArg, init) => {
    const url = String(urlArg);
    if (url.endsWith("/workflows/execute")) { sentBody = JSON.parse(init.body); return { ok: true, json: async () => ({ execution_id: "x2" }) }; }
    return { ok: true, json: async () => ({ status: "SUCCESS", result: '{"parties":[],"relations":[],"synthese":"s","affaire":{}}' }) };
  };
  const out = await runConsolidation({ aggregate: { personnes: [], relations_lues: [] }, cfg, fetchImpl, sleep: noSleep });
  assert.equal(out.synthese, "s");
  assert.equal(sentBody.app_id, "consol");
  assert.ok(typeof sentBody.prompt === "string");
});

test("runExtraction upstream non-ok → ARIANE_UPSTREAM", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => "boom" });
  await assert.rejects(() => runExtraction({ file: { base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }, cote: "D1", cfg, fetchImpl, sleep: noSleep }), /ARIANE_UPSTREAM/);
});

test("runExtraction : ERROR d'ingestion → ARIANE_INGESTION (distinct, réessayable)", async () => {
  const fetchImpl = async (urlArg) => {
    const url = String(urlArg);
    if (url.endsWith("/workflows/execute")) return { ok: true, json: async () => ({ execution_id: "x1" }) };
    return { ok: true, json: async () => ({ status: "ERROR", error: "Ingestion failed : {'nom_fichier': 'D1'}" }) };
  };
  await assert.rejects(() => runExtraction({ file: { base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }, cote: "D1", cfg, fetchImpl, sleep: noSleep }), /ARIANE_INGESTION/);
});

test("runAriane : réessaie une pièce dont l'ingestion a échoué de façon transitoire", async () => {
  const essais = new Map();
  const deps = {
    runExtraction: async ({ cote }) => {
      const n = (essais.get(cote) ?? 0) + 1;
      essais.set(cote, n);
      // D2 échoue à l'ingestion 2 fois puis passe ; les autres passent d'emblée.
      if (cote === "D2" && n < 3) throw new Error("ARIANE_INGESTION");
      return { cote, personnes: [], faits: [], acte: null, relations_lues: [] };
    },
    runConsolidation: async () => ({ parties: [], relations: [], synthese: "s", affaire: {} }),
  };
  const files = [
    { base64: "AA==", mime: "application/pdf", filename: "D1.pdf" },
    { base64: "AA==", mime: "application/pdf", filename: "D2.pdf" },
  ];
  const ignorees = [];
  const c = await runAriane({ files, cfg: { mapConcurrency: 2, arianeRetryDelayMs: 0 }, deps, sleep: noSleep, onPieceIgnoree: (p) => ignorees.push(p) });
  assert.equal(essais.get("D2"), 3, "D2 réessayée jusqu'au succès");
  assert.equal(ignorees.length, 0, "aucune pièce écartée");
  assert.ok(c.parties, "contrat assemblé");
});

test("runAriane : ingestion durablement en échec → pièce écartée en ARIANE_UPSTREAM (front inchangé)", async () => {
  const deps = {
    runExtraction: async ({ cote }) => {
      if (cote === "D1") throw new Error("ARIANE_INGESTION");
      return { cote, personnes: [], faits: [], acte: null, relations_lues: [] };
    },
    runConsolidation: async () => ({ parties: [], relations: [], synthese: "s", affaire: {} }),
  };
  const files = [
    { base64: "AA==", mime: "application/pdf", filename: "D1.pdf" },
    { base64: "AA==", mime: "application/pdf", filename: "D2.pdf" },
  ];
  const ignorees = [];
  await runAriane({ files, cfg: { mapConcurrency: 2, arianeMaxAttempts: 2, arianeRetryDelayMs: 0 }, deps, sleep: noSleep, onPieceIgnoree: (p) => ignorees.push(p) });
  assert.deepEqual(ignorees, [{ cote: "D1", raison: "ARIANE_UPSTREAM" }]);
});

test("runAriane : MAP best-effort + assemblage, progression rapportée", async () => {
  const files = [
    { base64: "AA==", mime: "application/pdf", filename: "D2.pdf" },
    { base64: "AA==", mime: "application/pdf", filename: "D3.pdf" },
    { base64: "AA==", mime: "application/pdf", filename: "D4.pdf" }, // celle-ci échoue
  ];
  const deps = {
    runExtraction: async ({ cote }) => {
      if (cote === "D4") throw new Error("ARIANE_UPSTREAM");
      if (cote === "D2") return { cote: "D2", acte: { type: "constatation", date: "2026-03-04", libelle: "c", redacteur_ref: "m9", concernes_refs: ["m3"] },
        personnes: [{ ref: "m3", nom: "V", role_apparent: "victime" }, { ref: "m9", nom: "E", role_apparent: "enqueteur" }],
        faits: [{ date: "2026-03-04", precision: "jour", libelle: "vol", personnes_refs: ["m3"] }], relations_lues: [] };
      return { cote: "D3", acte: { type: "audition", date: "2026-03-06", libelle: "a", redacteur_ref: "m9b", concernes_refs: ["m1"] },
        personnes: [{ ref: "m1", nom: "S", role_apparent: "mis_en_cause" }, { ref: "m9b", nom: "E", role_apparent: "enqueteur" }],
        faits: [], relations_lues: [] };
    },
    runConsolidation: async ({ aggregate }) => ({
      affaire: { reference: "r", nature: "Vol", service: "BR" }, synthese: "s",
      parties: [
        { id: "p1", nom: "S", role: "mis_en_cause", aliases: [], qualite: "", premiere_cote: "D3", membres: ["D3:m1"] },
        { id: "p2", nom: "V", role: "victime", aliases: [], qualite: "", premiere_cote: "D2", membres: ["D2:m3"] },
        { id: "p3", nom: "E", role: "enqueteur", aliases: [], qualite: "", premiere_cote: "D2", membres: ["D2:m9", "D3:m9b"] },
      ], relations: [],
    }),
  };
  const progress = [];
  const c = await runAriane({ files, cfg: { mapConcurrency: 2 }, deps, onProgress: (p) => progress.push({ ...p }) });
  assert.equal(c.affaire.nb_cotes, 2);        // D4 échouée exclue
  assert.equal(c.actes.length, 2);
  assert.ok(c.relations.some((r) => r.type === "entendu_par"));
  assert.deepEqual(progress[progress.length - 1], { done: 3, total: 3 });
});

test("startJob mène un job jusqu'à done avec le contrat en result", async () => {
  const jobId = createJob();
  assert.equal(getJob(jobId).status, "pending");
  const deps = {
    runExtraction: async ({ cote }) => ({ cote, acte: { type: "audition", date: "2026-03-06", libelle: "a", redacteur_ref: "m9", concernes_refs: ["m1"] },
      personnes: [{ ref: "m1", nom: "S", role_apparent: "mis_en_cause" }, { ref: "m9", nom: "E", role_apparent: "enqueteur" }], faits: [], relations_lues: [] }),
    runConsolidation: async () => ({ affaire: { reference: "r", nature: "Vol", service: "BR" }, synthese: "s",
      parties: [{ id: "p1", nom: "S", role: "mis_en_cause", aliases: [], qualite: "", premiere_cote: "D1", membres: ["D1:m1"] },
                { id: "p2", nom: "E", role: "enqueteur", aliases: [], qualite: "", premiere_cote: "D1", membres: ["D1:m9"] }], relations: [] }),
  };
  await startJob({ jobId, files: [{ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }], cfg: { mapConcurrency: 1 }, deps });
  const job = getJob(jobId);
  assert.equal(job.status, "done");
  assert.equal(job.result.actes.length, 1);
});

test("runAriane : MAP totalement en échec → ARIANE_UPSTREAM, pas de REDUCE", async () => {
  const files = [
    { base64: "AA==", mime: "application/pdf", filename: "D1.pdf" },
    { base64: "AA==", mime: "application/pdf", filename: "D2.pdf" },
  ];
  let consolidationCalled = false;
  const deps = {
    runExtraction: async () => { throw new Error("ARIANE_UPSTREAM"); },
    runConsolidation: async () => { consolidationCalled = true; return { affaire: {}, synthese: "s", parties: [], relations: [] }; },
  };
  await assert.rejects(() => runAriane({ files, cfg: { mapConcurrency: 2 }, deps }), /ARIANE_UPSTREAM/);
  assert.equal(consolidationCalled, false);
});

test("startJob passe en error si le pipeline lève", async () => {
  const jobId = createJob();
  const deps = { runExtraction: async () => ({ cote: "D1", personnes: [], faits: [], acte: null, relations_lues: [] }),
                 runConsolidation: async () => { throw new Error("ARIANE_UPSTREAM"); } };
  await startJob({ jobId, files: [{ base64: "AA==", mime: "application/pdf", filename: "D1.pdf" }], cfg: {}, deps });
  assert.equal(getJob(jobId).status, "error");
  assert.equal(getJob(jobId).error, "ARIANE_UPSTREAM");
});

test("runAriane signale chaque pièce écartée via onPieceIgnoree", async () => {
  const files = [
    { base64: "AA==", mime: "application/pdf", filename: "D1.pdf" },
    { base64: "AA==", mime: "application/pdf", filename: "D2.pdf" }, // celle-ci échoue
  ];
  const deps = {
    runExtraction: async ({ cote }) => {
      if (cote === "D2") throw new Error("ARIANE_TIMEOUT");
      return { cote, personnes: [], faits: [], acte: null, relations_lues: [] };
    },
    runConsolidation: async () => ({ affaire: {}, synthese: "s", parties: [], relations: [] }),
  };
  const ignorees = [];
  await runAriane({ files, cfg: { mapConcurrency: 2 }, deps, onPieceIgnoree: (p) => ignorees.push(p) });
  assert.deepEqual(ignorees, [{ cote: "D2", raison: "ARIANE_TIMEOUT" }]);
});

test("startJob expose les pièces écartées sur le job", async () => {
  const jobId = createJob();
  const deps = {
    runExtraction: async ({ cote }) => {
      if (cote === "D2") throw new Error("ARIANE_UPSTREAM");
      return { cote, personnes: [], faits: [], acte: null, relations_lues: [] };
    },
    runConsolidation: async () => ({ affaire: {}, synthese: "s", parties: [], relations: [] }),
  };
  await startJob({ jobId, files: [
    { base64: "AA==", mime: "application/pdf", filename: "D1.pdf" },
    { base64: "AA==", mime: "application/pdf", filename: "D2.pdf" },
  ], cfg: { mapConcurrency: 2 }, deps });
  const job = getJob(jobId);
  assert.equal(job.status, "done");
  assert.deepEqual(job.pieces_ignorees, [{ cote: "D2", raison: "ARIANE_UPSTREAM" }]);
});

test("startJob expose les avertissements sur le job", async () => {
  const jobId = createJob();
  const deps = {
    runExtraction: async ({ cote }) => ({ cote, personnes: [], faits: [], acte: null, relations_lues: [] }),
    runConsolidation: async () => ({ affaire: {}, synthese: "s", parties: [], relations: [] }),
  };
  await startJob({ jobId, files: [{ base64: "AA==", mime: "application/pdf", filename: "20250221_1445_PVInconnu_VIC_BIDULE_MARC.pdf" }], cfg: { mapConcurrency: 1 }, deps });
  assert.deepEqual(getJob(jobId).avertissements, ["Type de piece inconnu : PVInconnu"]);
});

test("startJob remonte l'avertissement d'homonymie du regroupement, sans nom de personne", async () => {
  const jobId = createJob();
  const personnes = {
    D1: [{ ref: "m1", nom: "Jean DUPONT", role_apparent: "temoin", naissance: "1990-05-02" }],
    D2: [{ ref: "m4", nom: "DUPONT Jean", role_apparent: "mis_en_cause", naissance: "1962-01-30" }],
    D3: [{ ref: "m2", nom: "Jean DUPONT", role_apparent: "victime", naissance: null }],
  };
  let recu = null;
  const deps = {
    runExtraction: async ({ cote }) => ({ cote, personnes: personnes[cote], faits: [], acte: null, relations_lues: [] }),
    runConsolidation: async ({ aggregate }) => {
      recu = aggregate;
      return { affaire: {}, synthese: "s", parties: [], relations: [] };
    },
  };
  await startJob({ jobId, files: ["D1", "D2", "D3"].map((c) => ({ base64: "AA==", mime: "application/pdf", filename: `${c}.pdf` })),
    cfg: { mapConcurrency: 1 }, deps });
  const job = getJob(jobId);
  assert.equal(job.status, "done");
  assert.equal(job.avertissements.length, 1);
  assert.match(job.avertissements[0], /Homonymes/);
  assert.ok(!/DUPONT/i.test(job.avertissements[0]));
  // L'avertissement est destine a l'utilisateur, pas au LLM : il n'a rien a faire
  // dans le prompt du REDUCE, qui est la serialisation de l'agregat.
  assert.deepEqual(Object.keys(recu).sort(), ["personnes", "relations_lues"]);
});

test("le nom de fichier ecrase le type et la date devines par le LLM", () => {
  const meta = parseNomFichier("20250221_1445_PVAudition_VIC_BIDULE_MARC.pdf");
  const out = appliquerMeta({
    cote: "D1",
    acte: { type: "constatation", date: "2020-01-01", libelle: "l", redacteur_ref: null, concernes_refs: [] },
    personnes: [], faits: [], relations_lues: [],
  }, meta);
  assert.equal(out.acte.type, "audition");
  assert.equal(out.acte.date, "2025-02-21");
});

test("le role de la personne nommee dans le fichier ecrase celui du LLM", () => {
  const meta = parseNomFichier("20250221_1445_PVAudition_VIC_BIDULE_MARC.pdf");
  const out = appliquerMeta({
    cote: "D1", acte: null,
    personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }],
    faits: [], relations_lues: [],
  }, meta);
  assert.equal(out.personnes[0].role_apparent, "victime");
});

test("personne du fichier absente de l'extraction → ajoutee", () => {
  const meta = parseNomFichier("20250221_1445_PVAudition_VIC_BIDULE_MARC.pdf");
  const out = appliquerMeta({
    cote: "D1", acte: null,
    personnes: [{ ref: "m1", nom: "Julie MALLIETTE", role_apparent: "enqueteur" }],
    faits: [], relations_lues: [],
  }, meta);
  assert.equal(out.personnes.length, 2);
  const ajoutee = out.personnes.find((p) => p.nom === "BIDULE MARC");
  assert.equal(ajoutee.role_apparent, "victime");
});

test("meta null → sortie inchangee", () => {
  const brut = { cote: "D1", acte: { type: "constatation", date: "2020-01-01" }, personnes: [], faits: [], relations_lues: [] };
  assert.deepEqual(appliquerMeta(brut, null), brut);
});

test("deux noyaux nuls ne sont jamais apparies (pas de sur-fusion)", () => {
  // Fichier : nom/prenom reduits a des initiales → cleNoyau(meta) = null.
  const meta = parseNomFichier("20250221_1445_PVAudition_VIC_A_B.pdf");
  assert.equal(meta.role, "victime");
  const out = appliquerMeta({
    cote: "D1", acte: null,
    // La personne extraite par le LLM a elle aussi un noyau null ("X" seul).
    personnes: [{ ref: "x1", nom: "X", role_apparent: "temoin" }],
    faits: [], relations_lues: [],
  }, meta);
  // La personne extraite n'est pas touchee : deux cles nulles ne s'apparient pas.
  assert.equal(out.personnes[0].role_apparent, "temoin");
  // La personne du fichier est ajoutee a part, jamais fusionnee.
  assert.equal(out.personnes.length, 2);
  const ajoutee = out.personnes.find((p) => p.nom === "A B");
  assert.ok(ajoutee);
  assert.equal(ajoutee.role_apparent, "victime");
});

test("un type de gabarit inconnu ne remplace pas le type devine par le LLM", () => {
  const meta = parseNomFichier("20250221_1445_PVInconnu_VIC_BIDULE_MARC.pdf");
  assert.equal(meta.typeActe, "autre");
  assert.deepEqual(meta.avertissements, ["Type de piece inconnu : PVInconnu"]);
  const out = appliquerMeta({
    cote: "D1",
    acte: { type: "perquisition", date: "2020-01-01", libelle: "l", redacteur_ref: null, concernes_refs: [] },
    personnes: [], faits: [], relations_lues: [],
  }, meta);
  assert.equal(out.acte.type, "perquisition");
});

test("un role inconnu ne remplace pas le role_apparent devine par le LLM", () => {
  const meta = parseNomFichier("20250221_1445_PVAudition_XXX_BIDULE_MARC.pdf");
  assert.equal(meta.role, "autre");
  const out = appliquerMeta({
    cote: "D1", acte: null,
    personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }],
    faits: [], relations_lues: [],
  }, meta);
  assert.equal(out.personnes[0].role_apparent, "temoin");
});

test("un type de gabarit connu ecrase bien le type devine par le LLM (non-regression)", () => {
  const meta = parseNomFichier("20250221_1445_PVAudition_VIC_BIDULE_MARC.pdf");
  assert.equal(meta.typeActe, "audition");
  const out = appliquerMeta({
    cote: "D1",
    acte: { type: "perquisition", date: "2020-01-01", libelle: "l", redacteur_ref: null, concernes_refs: [] },
    personnes: [], faits: [], relations_lues: [],
  }, meta);
  assert.equal(out.acte.type, "audition");
});

test("runAriane applique les metadonnees et remonte leurs avertissements", async () => {
  const files = [{ base64: "AA==", mime: "application/pdf", filename: "20250221_1445_PVInconnu_VIC_BIDULE_MARC.pdf" }];
  const deps = {
    runExtraction: async ({ cote }) => ({ cote, acte: { type: "constatation", date: "2020-01-01", libelle: "l", redacteur_ref: null, concernes_refs: [] },
      personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }], faits: [], relations_lues: [] }),
    runConsolidation: async () => ({ affaire: {}, synthese: "s",
      parties: [{ id: "p1", nom: "Marc BIDULE", role: "victime", aliases: [], qualite: "", premiere_cote: "D1", membres: [] }], relations: [] }),
  };
  const avertissements = [];
  await runAriane({ files, cfg: { mapConcurrency: 1 }, deps, onAvertissement: (a) => avertissements.push(a) });
  assert.deepEqual(avertissements, ["Type de piece inconnu : PVInconnu"]);
});

test("assembleContract : un groupe scinde en deux parties → chacune ne porte que les roles de ses grefs", () => {
  // Le REDUCE separe deliberement deux parties dont les grefs relevent d'un meme
  // groupe de coreference. L'historique des roles doit suivre le rattachement reel :
  // la partie rattachee a la seule cote D3, ou la personne est temoin, ne doit ni
  // ressortir "mis_en_cause" ni afficher une cote a laquelle rien ne la rattache.
  const mapOutputs = [
    { cote: "D3", personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }], faits: [], acte: null, relations_lues: [] },
    { cote: "D9", personnes: [{ ref: "m4", nom: "BIDULE Marc", role_apparent: "mis_en_cause" }], faits: [], acte: null, relations_lues: [] },
  ];
  const reduce = { affaire: {}, synthese: "s", relations: [],
    parties: [
      { id: "p1", nom: "Marc BIDULE", role: "temoin", aliases: [], qualite: "", premiere_cote: "D3", membres: ["D3:m1"] },
      { id: "p2", nom: "Marc BIDULE", role: "mis_en_cause", aliases: [], qualite: "", premiere_cote: "D9", membres: ["D9:m4"] },
    ] };
  const c = assembleContract(mapOutputs, reduce);
  assert.deepEqual(c.parties[0].roles, [{ role: "temoin", cote: "D3" }]);
  assert.equal(c.parties[0].role, "temoin");
  assert.deepEqual(c.parties[1].roles, [{ role: "mis_en_cause", cote: "D9" }]);
  assert.equal(c.parties[1].role, "mis_en_cause");
});

test("assembleContract : un gref que personne ne revendique ne depend pas de l'ordre des parties du REDUCE", () => {
  // D4:m4 n'est revendique par aucune partie. Il revient a celle qui detient deja le
  // plus de grefs du groupe (p1, deux grefs contre un), quel que soit l'ordre dans
  // lequel le LLM a liste ses parties.
  const mapOutputs = [
    { cote: "D1", personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }], faits: [], acte: null, relations_lues: [] },
    { cote: "D2", personnes: [{ ref: "m2", nom: "BIDULE Marc", role_apparent: "temoin" }], faits: [], acte: null, relations_lues: [] },
    { cote: "D3", personnes: [{ ref: "m3", nom: "Marc BIDULE", role_apparent: "temoin" }], faits: [], acte: null, relations_lues: [] },
    { cote: "D4", personnes: [{ ref: "m4", nom: "BIDULE Marc", role_apparent: "temoin" }],
      faits: [{ date: "2026-03-05", precision: "jour", libelle: "vol", personnes_refs: ["m4"] }],
      acte: { type: "constatation", date: "2026-03-05", libelle: "a", redacteur_ref: null, concernes_refs: ["m4"] },
      relations_lues: [] },
  ];
  const p1 = { id: "p1", nom: "Marc BIDULE", role: "temoin", aliases: [], qualite: "", premiere_cote: "D1", membres: ["D1:m1", "D2:m2"] };
  const p2 = { id: "p2", nom: "Marc BIDULE", role: "temoin", aliases: [], qualite: "", premiere_cote: "D3", membres: ["D3:m3"] };
  for (const parties of [[p1, p2], [p2, p1]]) {
    const c = assembleContract(mapOutputs, { affaire: {}, synthese: "s", relations: [], parties });
    assert.deepEqual(c.evenements[0].parties, ["p1"]);
    assert.deepEqual(c.actes[0].concernes, ["p1"]);
  }
});

test("assembleContract : a egalite de grefs revendiques, le gref libre revient au plus petit id", () => {
  const mapOutputs = [
    { cote: "D1", personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }], faits: [], acte: null, relations_lues: [] },
    { cote: "D2", personnes: [{ ref: "m2", nom: "BIDULE Marc", role_apparent: "temoin" }], faits: [], acte: null, relations_lues: [] },
    { cote: "D3", personnes: [{ ref: "m3", nom: "Marc BIDULE", role_apparent: "temoin" }],
      faits: [{ date: "2026-03-05", precision: "jour", libelle: "vol", personnes_refs: ["m3"] }], acte: null, relations_lues: [] },
  ];
  const pa = { id: "pa", nom: "Marc BIDULE", role: "temoin", aliases: [], qualite: "", premiere_cote: "D1", membres: ["D1:m1"] };
  const pb = { id: "pb", nom: "Marc BIDULE", role: "temoin", aliases: [], qualite: "", premiere_cote: "D2", membres: ["D2:m2"] };
  for (const parties of [[pa, pb], [pb, pa]]) {
    const c = assembleContract(mapOutputs, { affaire: {}, synthese: "s", relations: [], parties });
    assert.deepEqual(c.evenements[0].parties, ["pa"]);
  }
});

test("buildAggregate remonte un avertissement quand les qualites d'un groupe divergent", () => {
  const agg = buildAggregate([
    { cote: "D1", personnes: [{ ref: "m1", nom: "Jean DUPONT", role_apparent: "temoin", aliases: [], qualite: "boulanger" }], relations_lues: [] },
    { cote: "D2", personnes: [{ ref: "m2", nom: "DUPONT Jean", role_apparent: "temoin", aliases: [], qualite: "plombier" }], relations_lues: [] },
  ]);
  assert.equal(agg.personnes.length, 1);
  assert.equal(agg.avertissements.length, 1);
  assert.ok(!/DUPONT|Jean|boulanger|plombier|D1|D2/i.test(agg.avertissements[0]));
});

test("la naissance du XML est portee sur la personne extraite correspondante", () => {
  const out = appliquerMetaXml({
    cote: "D1", acte: null,
    personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }],
    faits: [], relations_lues: [],
  }, { personnes: [{ nom: "BIDULE", prenom: "Marc", naissance: "1985-02-21", role: "victime" }], avertissements: [] });
  assert.equal(out.personnes[0].naissance, "1985-02-21");
  assert.equal(out.personnes[0].role_apparent, "victime");
});

test("une personne du XML absente de l'extraction est ajoutee avec sa naissance", () => {
  const out = appliquerMetaXml({
    cote: "D1", acte: null, personnes: [], faits: [], relations_lues: [],
  }, { personnes: [{ nom: "BIDULE", prenom: "Marc", naissance: "1985-02-21", role: "victime" }], avertissements: [] });
  assert.equal(out.personnes.length, 1);
  assert.equal(out.personnes[0].naissance, "1985-02-21");
});

test("un role inconnu du XML n'ecrase pas le role du LLM", () => {
  const out = appliquerMetaXml({
    cote: "D1", acte: null,
    personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }],
    faits: [], relations_lues: [],
  }, { personnes: [{ nom: "BIDULE", prenom: "Marc", naissance: "", role: "autre" }], avertissements: [] });
  assert.equal(out.personnes[0].role_apparent, "temoin");
});

test("une naissance vide du XML n'efface pas celle du LLM", () => {
  const out = appliquerMetaXml({
    cote: "D1", acte: null,
    personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin", naissance: "1985-02-21" }],
    faits: [], relations_lues: [],
  }, { personnes: [{ nom: "BIDULE", prenom: "Marc", naissance: "", role: "victime" }], avertissements: [] });
  assert.equal(out.personnes[0].naissance, "1985-02-21");
});

test("meta XML absente → sortie inchangee", () => {
  const brut = { cote: "D1", acte: null, personnes: [], faits: [], relations_lues: [] };
  assert.deepEqual(appliquerMetaXml(brut, null), brut);
});

test("runAriane applique le XML et remonte ses avertissements", async () => {
  const files = [{ base64: "AA==", mime: "application/pdf", filename: "D1.pdf",
    meta: { personnes: [{ nom: "BIDULE", prenom: "Marc", naissance: "1985-02-21", role: "victime" }],
            avertissements: ["Implication inconnue : GREFFIER"] } }];
  const deps = {
    runExtraction: async ({ cote }) => ({ cote, acte: null,
      personnes: [{ ref: "m1", nom: "Marc BIDULE", role_apparent: "temoin" }], faits: [], relations_lues: [] }),
    runConsolidation: async ({ aggregate }) => {
      // Le discriminant doit avoir voyage jusqu'a l'agregat.
      assert.equal(aggregate.personnes[0].naissance, "1985-02-21");
      return { affaire: {}, synthese: "s",
        parties: [{ id: "p1", nom: "Marc BIDULE", role: "victime", aliases: [], qualite: "", premiere_cote: "D1", membres: ["D1:m1"] }],
        relations: [] };
    },
  };
  const avertissements = [];
  await runAriane({ files, cfg: { mapConcurrency: 1 }, deps, onAvertissement: (a) => avertissements.push(a) });
  assert.deepEqual(avertissements, ["Implication inconnue : GREFFIER"]);
});

test("deux homonymes distingues par le XML ne fusionnent pas", async () => {
  const files = [
    { base64: "AA==", mime: "application/pdf", filename: "D1.pdf",
      meta: { personnes: [{ nom: "DUPONT", prenom: "Jean", naissance: "1990-05-02", role: "victime" }], avertissements: [] } },
    { base64: "AA==", mime: "application/pdf", filename: "D2.pdf",
      meta: { personnes: [{ nom: "DUPONT", prenom: "Jean", naissance: "1962-01-30", role: "temoin" }], avertissements: [] } },
  ];
  const deps = {
    runExtraction: async ({ cote }) => ({ cote, acte: null,
      personnes: [{ ref: "m1", nom: "Jean DUPONT", role_apparent: "temoin" }], faits: [], relations_lues: [] }),
    runConsolidation: async ({ aggregate }) => {
      assert.equal(aggregate.personnes.length, 2); // deux personnes, pas une
      return { affaire: {}, synthese: "s", parties: [], relations: [] };
    },
  };
  await runAriane({ files, cfg: { mapConcurrency: 1 }, deps });
});

// L'etat civil du XML alimente le discriminant de fusionnerMentions : il doit donc
// obeir a la meme regle de compatibilite des naissances. Apparier sur le seul noyau
// du nom fait disparaitre un homonyme, ou detruit un discriminant que le MAP avait
// correctement pose — dans les deux cas une sur-fusion, silencieuse de surcroit.

test("deux personnes du XML de meme nom aux dates differentes restent deux personnes", () => {
  const out = appliquerMetaXml({
    cote: "D1", acte: null, personnes: [], faits: [], relations_lues: [],
  }, { personnes: [
    { nom: "DUPONT", prenom: "Jean", naissance: "1962-01-30", role: "temoin" },
    { nom: "DUPONT", prenom: "Jean", naissance: "1990-05-02", role: "victime" },
  ], avertissements: [] });
  assert.equal(out.personnes.length, 2);
  assert.deepEqual(out.personnes.map((p) => p.naissance).sort(), ["1962-01-30", "1990-05-02"]);
  // La ref identifie la personne dans la piece : deux entrees de meme noyau ne
  // peuvent pas porter la meme, sinon les grefs se confondent a l'agregat.
  assert.equal(new Set(out.personnes.map((p) => p.ref)).size, 2);
});

test("le XML ne detruit pas les dates de deux homonymes correctement extraits", () => {
  const out = appliquerMetaXml({
    cote: "D1", acte: null,
    personnes: [
      { ref: "m1", nom: "Jean DUPONT", role_apparent: "temoin", naissance: "1962-01-30" },
      { ref: "m2", nom: "DUPONT Jean", role_apparent: "temoin", naissance: "1990-05-02" },
    ],
    faits: [], relations_lues: [],
  }, { personnes: [
    { nom: "DUPONT", prenom: "Jean", naissance: "1962-01-30", role: "temoin" },
    { nom: "DUPONT", prenom: "Jean", naissance: "1990-05-02", role: "victime" },
  ], avertissements: [] });
  assert.equal(out.personnes.length, 2);
  assert.equal(out.personnes.find((p) => p.ref === "m1").naissance, "1962-01-30");
  assert.equal(out.personnes.find((p) => p.ref === "m2").naissance, "1990-05-02");
  // Chacun a bien recu l'etat civil de SON entree XML, pas de celle de l'autre.
  assert.equal(out.personnes.find((p) => p.ref === "m2").role_apparent, "victime");
  // Le discriminant survit jusqu'a l'agregat : deux personnes, pas une.
  const agg = buildAggregate([{ cote: "D1", personnes: out.personnes, relations_lues: [] }]);
  assert.equal(agg.personnes.length, 2);
});

test("etat civil non attribuable entre deux homonymes sans date : aucune modification, un avertissement", () => {
  const avertissements = [];
  const out = appliquerMetaXml({
    cote: "D1", acte: null,
    personnes: [
      { ref: "m1", nom: "Jean DUPONT", role_apparent: "temoin" },
      { ref: "m2", nom: "DUPONT Jean", role_apparent: "temoin" },
    ],
    faits: [], relations_lues: [],
  }, { personnes: [{ nom: "DUPONT", prenom: "Jean", naissance: "1990-05-02", role: "victime" }], avertissements: [] },
     (a) => avertissements.push(a));
  assert.equal(out.personnes.length, 2);
  for (const p of out.personnes) {
    assert.equal(p.naissance ?? null, null); // dans le doute, on n'attribue a personne
    assert.equal(p.role_apparent, "temoin");
  }
  assert.equal(avertissements.length, 1);
  // Pieces a diffusion restreinte : ni nom, ni cote, ni date dans le libelle.
  assert.ok(!/DUPONT|Jean|D1|1990|05|02/i.test(avertissements[0]));
});

test("une personne extraite non identifiable n'est jamais appariee a une entree XML", () => {
  // cleNoyau("M. B.") et cleNoyau("J. D.") valent tous deux null. Sans garde, ils
  // seraient juges egaux (null === null) et deux personnes distinctes fusionneraient.
  const out = appliquerMetaXml({
    cote: "D1", acte: null,
    personnes: [{ ref: "m1", nom: "M. B.", role_apparent: "temoin" }],
    faits: [], relations_lues: [],
  }, { personnes: [{ nom: "J.", prenom: "D.", naissance: "1990-05-02", role: "victime" }], avertissements: [] });
  assert.equal(out.personnes.length, 1);
  assert.equal(out.personnes[0].naissance ?? null, null);
  assert.equal(out.personnes[0].role_apparent, "temoin");
});

test("runAriane remonte l'avertissement d'etat civil non attribuable", async () => {
  const files = [{ base64: "AA==", mime: "application/pdf", filename: "D1.pdf",
    meta: { personnes: [{ nom: "DUPONT", prenom: "Jean", naissance: "1990-05-02", role: "victime" }],
            avertissements: [] } }];
  const deps = {
    runExtraction: async ({ cote }) => ({ cote, acte: null, personnes: [
      { ref: "m1", nom: "Jean DUPONT", role_apparent: "temoin" },
      { ref: "m2", nom: "DUPONT Jean", role_apparent: "temoin" },
    ], faits: [], relations_lues: [] }),
    runConsolidation: async () => ({ affaire: {}, synthese: "s", parties: [], relations: [] }),
  };
  const avertissements = [];
  await runAriane({ files, cfg: { mapConcurrency: 1 }, deps, onAvertissement: (a) => avertissements.push(a) });
  assert.ok(avertissements.some((a) => /non attribuable/i.test(a)));
});

// --- RAG : couture au pipeline (best-effort, jamais bloquant) ---

const cfgRag = {
  mapConcurrency: 2,
  ragBaseUrl: "https://iaka-api.test",
  ragCorpusId: "corpus-1",
  ragIakId: "iak-1",
};

const extractionOk = async ({ cote }) => ({ cote, acte: null, personnes: [], faits: [], relations_lues: [] });
const consolidationOk = async () => ({ affaire: {}, synthese: "s", parties: [], relations: [] });

test("runAriane purge le corpus AVANT toute ingestion", async () => {
  const ordre = [];
  await runAriane({
    files: [{ filename: "D1.pdf", base64: "" }],
    cfg: cfgRag,
    deps: {
      runExtraction: extractionOk,
      runConsolidation: consolidationOk,
      purgeCorpus: async () => { ordre.push("purge"); return 0; },
      ingestPiece: async () => { ordre.push("ingest"); return true; },
    },
  });
  assert.deepEqual(ordre, ["purge", "ingest"]);
});

test("runAriane : purge en echec → aucune ingestion, analyse poursuivie", async () => {
  let ingestions = 0;
  let dernierRag;
  const contrat = await runAriane({
    files: [{ filename: "D1.pdf", base64: "" }],
    cfg: cfgRag,
    onRag: (r) => { dernierRag = r; },
    deps: {
      runExtraction: extractionOk,
      runConsolidation: consolidationOk,
      purgeCorpus: async () => { throw new Error("ARIANE_RAG_PURGE"); },
      ingestPiece: async () => { ingestions++; return true; },
    },
  });
  assert.equal(ingestions, 0, "sans purge reussie on n'ingere pas : risque de melange");
  assert.ok(contrat.parties, "l'analyse doit aboutir malgre l'echec RAG");
  assert.equal(dernierRag.erreur, "ARIANE_RAG_PURGE");
  assert.equal(dernierRag.total, 0);
});

test("runAriane : une ingestion en echec sur trois → indexees 2/3", async () => {
  let dernierRag;
  await runAriane({
    files: [{ filename: "D1.pdf", base64: "" }, { filename: "D2.pdf", base64: "" }, { filename: "D3.pdf", base64: "" }],
    cfg: cfgRag,
    onRag: (r) => { dernierRag = r; },
    deps: {
      runExtraction: extractionOk,
      runConsolidation: consolidationOk,
      purgeCorpus: async () => 0,
      ingestPiece: async ({ cote }) => {
        if (cote === "D2") throw new Error("ARIANE_RAG_INGEST");
        return true;
      },
    },
  });
  assert.deepEqual(dernierRag, { indexees: 2, total: 3, erreur: null });
});

test("runAriane sans RAG configure n'appelle ni purge ni ingestion", async () => {
  let appels = 0;
  let dernierRag;
  await runAriane({
    files: [{ filename: "D1.pdf", base64: "" }],
    cfg: { mapConcurrency: 2 }, // pas de ragCorpusId
    onRag: (r) => { dernierRag = r; },
    deps: {
      runExtraction: extractionOk,
      runConsolidation: consolidationOk,
      purgeCorpus: async () => { appels++; return 0; },
      ingestPiece: async () => { appels++; return true; },
    },
  });
  assert.equal(appels, 0);
  assert.deepEqual(dernierRag, { indexees: 0, total: 0, erreur: null });
});

test("startJob expose le champ rag dans le statut", async () => {
  const jobId = createJob();
  await startJob({
    jobId,
    files: [{ filename: "D1.pdf", base64: "" }],
    cfg: cfgRag,
    deps: {
      runExtraction: extractionOk,
      runConsolidation: consolidationOk,
      purgeCorpus: async () => 0,
      ingestPiece: async () => true,
    },
  });
  const job = getJob(jobId);
  assert.equal(job.status, "done");
  assert.deepEqual(job.rag, { indexees: 1, total: 1, erreur: null });
});

// Le REDUCE trace deja la longueur et l'equilibre des accolades quand sa sortie
// n'est pas parsable — c'est ce qui a permis de distinguer une troncature d'une
// reponse en prose. Le MAP n'avait pas cet equivalent : une piece perdue en
// ARIANE_INVALIDE ne disait pas pourquoi.
test("une sortie MAP non parsable trace un diagnostic sans fuite de donnees", async () => {
  const traces = [];
  const err = console.error;
  console.error = (...a) => traces.push(a.join(" "));
  try {
    const fetchImpl = async (url) =>
      url.endsWith("/workflows/execute")
        ? { ok: true, json: async () => ({ execution_id: "x" }) }
        : { ok: true, json: async () => ({ status: "SUCCESS", result: "Je ne peux pas traiter cette piece." }) };
    await assert.rejects(
      () => runExtraction({ file: { base64: "AA==", mime: "application/pdf", filename: "f.pdf" },
        cote: "20260210_0930_PVPlainte_VIC_MARCHAND_HELENE", cfg, fetchImpl, sleep: noSleep }),
      /ARIANE_INVALIDE/,
    );
  } finally {
    console.error = err;
  }
  const diag = traces.find((t) => t.includes("map sortie non parsable"));
  assert.ok(diag, "un diagnostic doit etre trace");
  assert.match(diag, /35 car/);        // longueur du texte renvoye
  assert.match(diag, /accolades 0\/0/); // de la prose, pas un JSON tronque
  // La cote derive du nom de fichier et porte l'etat civil : jamais dans les traces.
  for (const t of traces) {
    assert.doesNotMatch(t, /MARCHAND|HELENE|PVPlainte|traiter cette piece/i);
  }
});
