import test from "node:test";
import assert from "node:assert/strict";
import { parseNomFichier, cleNoyau, fusionnerMentions } from "./pieceMeta.mjs";

test("nom LRPGN conforme → champs exacts", () => {
  const m = parseNomFichier("20250221_1445_PVAudition_VIC_BIDULE_MARC.pdf");
  assert.deepEqual(m, {
    date: "2025-02-21", heure: "14:45", typeActe: "audition", role: "victime",
    nom: "BIDULE", prenom: "MARC", avertissements: [],
  });
});

test("nom libre → null", () => {
  assert.equal(parseNomFichier("01_Synthese.pdf"), null);
  assert.equal(parseNomFichier("Audition Elisabeth LE SUEUR.pdf"), null);
  assert.equal(parseNomFichier("perquisition.pdf"), null);
});

test("segment non alphabetique → null plutot qu'un decoupage douteux", () => {
  // Un chiffre ou un espace dans le nom signale un gabarit qu'on ne sait pas lire.
  assert.equal(parseNomFichier("20250221_1445_PVAudition_VIC_BIDULE2_MARC.pdf"), null);
  assert.equal(parseNomFichier("20250221_1445_PVAudition_VIC_LE SUEUR_MARC.pdf"), null);
});

test("type de piece inconnu → autre + avertissement nommant le code", () => {
  const m = parseNomFichier("20250221_1445_PVInconnu_VIC_BIDULE_MARC.pdf");
  assert.equal(m.typeActe, "autre");
  assert.deepEqual(m.avertissements, ["Type de piece inconnu : PVInconnu"]);
});

test("role inconnu → autre + avertissement nommant le code", () => {
  const m = parseNomFichier("20250221_1445_PVAudition_XYZ_BIDULE_MARC.pdf");
  assert.equal(m.role, "autre");
  assert.deepEqual(m.avertissements, ["Role inconnu : XYZ"]);
});

test("date ou heure invalide → null", () => {
  assert.equal(parseNomFichier("20251345_1445_PVAudition_VIC_BIDULE_MARC.pdf"), null);
  assert.equal(parseNomFichier("20250221_2599_PVAudition_VIC_BIDULE_MARC.pdf"), null);
});

test("cleNoyau : ordre des jetons indifferent", () => {
  assert.equal(cleNoyau("Marc BIDULE"), cleNoyau("BIDULE Marc"));
  assert.equal(cleNoyau("Marc BIDULE"), "BIDULE|MARC");
});

test("cleNoyau : casse et accents replies", () => {
  assert.equal(cleNoyau("élisabeth LE SUEUR"), cleNoyau("LE SUEUR Elisabeth"));
});

test("cleNoyau : les initiales sont conservees, elles discriminent", () => {
  assert.equal(cleNoyau("Jean-Pierre M. DUPONT"), "DUPONT|JEAN|M|PIERRE");
});

test("cleNoyau : vide ou sans jeton exploitable → null", () => {
  assert.equal(cleNoyau(""), null);
  assert.equal(cleNoyau("   "), null);
  assert.equal(cleNoyau("X"), null);
  assert.equal(cleNoyau(undefined), null);
});

test("cleNoyau : deux initiales differentes ne fusionnent pas", () => {
  assert.notEqual(cleNoyau("Jean M. DUPONT"), cleNoyau("Jean P. DUPONT"));
});

test("cleNoyau : l'apostrophe lie, elle ne separe pas", () => {
  assert.notEqual(cleNoyau("Charles d'Artagnan"), cleNoyau("Charles Artagnan"));
  assert.equal(cleNoyau("Charles d'Artagnan"), cleNoyau("CHARLES D’ARTAGNAN"));
  assert.equal(cleNoyau("Charles d'Artagnan"), "CHARLES|DARTAGNAN");
});

test("cleNoyau : nom reduit a des initiales → null", () => {
  assert.equal(cleNoyau("X"), null);
  assert.equal(cleNoyau("A. B."), null);
});

test("deux mentions du meme nom sur deux cotes → un groupe", () => {
  const { groupes } = fusionnerMentions([
    { gref: "D3:m1", cote: "D3", nom: "Marc BIDULE", role_apparent: "temoin" },
    { gref: "D9:m4", cote: "D9", nom: "BIDULE Marc", role_apparent: "mis_en_cause" },
  ]);
  assert.equal(groupes.length, 1);
  assert.deepEqual(groupes[0].membres, ["D3:m1", "D9:m4"]);
});

test("roles conserves par cote, role principal le plus engageant", () => {
  const { groupes } = fusionnerMentions([
    { gref: "D3:m1", cote: "D3", nom: "Marc BIDULE", role_apparent: "temoin" },
    { gref: "D9:m4", cote: "D9", nom: "BIDULE Marc", role_apparent: "mis_en_cause" },
  ]);
  assert.deepEqual(groupes[0].roles, [
    { role: "temoin", cote: "D3" },
    { role: "mis_en_cause", cote: "D9" },
  ]);
  assert.equal(groupes[0].role, "mis_en_cause");
});

test("noms distincts → groupes distincts", () => {
  const { groupes } = fusionnerMentions([
    { gref: "D1:m1", cote: "D1", nom: "Marc BIDULE", role_apparent: "victime" },
    { gref: "D1:m2", cote: "D1", nom: "Julie MALLIETTE", role_apparent: "enqueteur" },
  ]);
  assert.equal(groupes.length, 2);
});

test("mention sans cle exploitable → sansCle, jamais fusionnee", () => {
  const { groupes, sansCle } = fusionnerMentions([
    { gref: "D1:m1", cote: "D1", nom: "le suspect", role_apparent: "mis_en_cause" },
    { gref: "D1:m2", cote: "D1", nom: "X", role_apparent: "temoin" },
  ]);
  // "le suspect" donne LE|SUSPECT : deux jetons, donc une cle. "X" n'en donne aucune.
  assert.equal(sansCle.length, 1);
  assert.equal(sansCle[0].gref, "D1:m2");
  assert.equal(groupes.length, 1);
});

test("meme cote, meme personne citee deux fois → un seul groupe, deux membres", () => {
  const { groupes } = fusionnerMentions([
    { gref: "D1:m1", cote: "D1", nom: "Marc BIDULE", role_apparent: "victime" },
    { gref: "D1:m7", cote: "D1", nom: "Marc BIDULE", role_apparent: "victime" },
  ]);
  assert.equal(groupes.length, 1);
  assert.deepEqual(groupes[0].membres, ["D1:m1", "D1:m7"]);
  // Le meme role sur la meme cote n'est pas duplique.
  assert.deepEqual(groupes[0].roles, [{ role: "victime", cote: "D1" }]);
});

test("role_apparent absent ou undefined → enregistre comme autre", () => {
  const { groupes } = fusionnerMentions([
    { gref: "D1:m1", cote: "D1", nom: "Marc BIDULE" },
    { gref: "D1:m2", cote: "D1", nom: "Julie MALLIETTE", role_apparent: undefined },
  ]);
  assert.equal(groupes.find((g) => g.cle === cleNoyau("Marc BIDULE")).role, "autre");
  assert.equal(groupes.find((g) => g.cle === cleNoyau("Julie MALLIETTE")).role, "autre");
});

test("role hors ordre d'engagement ne l'emporte jamais sur un role connu", () => {
  const { groupes } = fusionnerMentions([
    { gref: "D1:m1", cote: "D1", nom: "Marc BIDULE", role_apparent: "greffier" },
    { gref: "D2:m3", cote: "D2", nom: "Marc BIDULE", role_apparent: "temoin" },
  ]);
  assert.equal(groupes.length, 1);
  assert.equal(groupes[0].role, "temoin");
});

test("deux roles differents sur la meme cote → les deux conserves", () => {
  const { groupes } = fusionnerMentions([
    { gref: "D1:m1", cote: "D1", nom: "Marc BIDULE", role_apparent: "victime" },
    { gref: "D1:m2", cote: "D1", nom: "Marc BIDULE", role_apparent: "temoin" },
  ]);
  assert.equal(groupes.length, 1);
  assert.deepEqual(groupes[0].roles, [
    { role: "victime", cote: "D1" },
    { role: "temoin", cote: "D1" },
  ]);
});

test("meme role sur deux cotes differentes → une entree par cote, pas de dedoublonnage abusif", () => {
  const { groupes } = fusionnerMentions([
    { gref: "D1:m1", cote: "D1", nom: "Marc BIDULE", role_apparent: "victime" },
    { gref: "D2:m5", cote: "D2", nom: "Marc BIDULE", role_apparent: "victime" },
  ]);
  assert.equal(groupes.length, 1);
  assert.deepEqual(groupes[0].roles, [
    { role: "victime", cote: "D1" },
    { role: "victime", cote: "D2" },
  ]);
});

test("liste de mentions vide → groupes, sansCle et avertissements vides, sans exception", () => {
  assert.deepEqual(fusionnerMentions([]), { groupes: [], sansCle: [], avertissements: [] });
});

test("meme nom, deux naissances renseignees et differentes → deux groupes", () => {
  // Sur-fusion des homonymes : la naissance discrimine deux personnes distinctes.
  const { groupes } = fusionnerMentions([
    { gref: "D3:m1", cote: "D3", nom: "Jean DUPONT", role_apparent: "temoin", naissance: "1990-05-02" },
    { gref: "D9:m4", cote: "D9", nom: "DUPONT Jean", role_apparent: "mis_en_cause", naissance: "1962-01-30" },
  ]);
  assert.equal(groupes.length, 2);
  assert.deepEqual(groupes[0].membres, ["D3:m1"]);
  assert.deepEqual(groupes[1].membres, ["D9:m4"]);
  assert.equal(groupes[0].naissance, "1990-05-02");
  assert.equal(groupes[1].naissance, "1962-01-30");
  // La cle reste le noyau : elle est informative, elle n'identifie plus un groupe.
  assert.equal(groupes[0].cle, groupes[1].cle);
});

test("meme nom, une seule naissance renseignee → un groupe portant cette naissance", () => {
  // Une naissance vide est compatible avec tout : elle ne fonde pas une scission.
  const { groupes } = fusionnerMentions([
    { gref: "D3:m1", cote: "D3", nom: "Jean DUPONT", role_apparent: "temoin", naissance: null },
    { gref: "D9:m4", cote: "D9", nom: "DUPONT Jean", role_apparent: "mis_en_cause", naissance: "1962-01-30" },
  ]);
  assert.equal(groupes.length, 1);
  assert.deepEqual(groupes[0].membres, ["D3:m1", "D9:m4"]);
  assert.equal(groupes[0].naissance, "1962-01-30");
});

test("naissance vide sous ses trois formes → toujours compatible", () => {
  for (const vide of [null, undefined, ""]) {
    const { groupes } = fusionnerMentions([
      { gref: "D1:m1", cote: "D1", nom: "Jean DUPONT", naissance: vide },
      { gref: "D2:m2", cote: "D2", nom: "DUPONT Jean", naissance: "1962-01-30" },
    ]);
    assert.equal(groupes.length, 1);
    assert.equal(groupes[0].naissance, "1962-01-30");
  }
});

test("meme naissance renseignee de part et d'autre → un seul groupe", () => {
  const { groupes } = fusionnerMentions([
    { gref: "D1:m1", cote: "D1", nom: "Jean DUPONT", naissance: "1990-05-02" },
    { gref: "D2:m2", cote: "D2", nom: "DUPONT Jean", naissance: "1990-05-02" },
  ]);
  assert.equal(groupes.length, 1);
  assert.deepEqual(groupes[0].membres, ["D1:m1", "D2:m2"]);
});

test("role hors vocabulaire → borne a autre dans roles[] comme dans role", () => {
  const { groupes } = fusionnerMentions([
    { gref: "D1:m1", cote: "D1", nom: "Marc BIDULE", role_apparent: "plaignant" },
  ]);
  assert.equal(groupes[0].role, "autre");
  assert.deepEqual(groupes[0].roles, [{ role: "autre", cote: "D1" }]);
});

test("les sept roles du vocabulaire sont conserves tels quels", () => {
  for (const role of ["mis_en_cause", "victime", "temoin", "enqueteur", "requis", "magistrat", "autre"]) {
    const { groupes } = fusionnerMentions([{ gref: "D1:m1", cote: "D1", nom: "Marc BIDULE", role_apparent: role }]);
    assert.equal(groupes[0].role, role);
  }
});

const AVERTISSEMENT_HOMONYMES =
  "Homonymes distingués par la date de naissance : une mention sans date n'a pas pu être rattachée";

test("deux homonymes distingues par la naissance + une mention sans date → la mention sans date n'est rattachee a aucun", () => {
  // Dans le doute, ne pas fusionner : rien ne designe l'un des deux homonymes
  // plutot que l'autre. La rattacher au premier croise lui transmettrait les faits
  // et actes de sa piece — la faute la plus grave du domaine.
  const { groupes, sansCle, avertissements } = fusionnerMentions([
    { gref: "D3:m1", cote: "D3", nom: "Jean DUPONT", role_apparent: "temoin", naissance: "1990-05-02" },
    { gref: "D9:m4", cote: "D9", nom: "DUPONT Jean", role_apparent: "mis_en_cause", naissance: "1962-01-30" },
    { gref: "D5:m2", cote: "D5", nom: "Jean DUPONT", role_apparent: "victime", naissance: null },
  ]);
  assert.equal(groupes.length, 2);
  assert.deepEqual(groupes[0].membres, ["D3:m1"]);
  assert.deepEqual(groupes[1].membres, ["D9:m4"]);
  assert.deepEqual(sansCle.map((m) => m.gref), ["D5:m2"]);
  assert.deepEqual(avertissements, [AVERTISSEMENT_HOMONYMES]);
});

test("le sort de la mention sans naissance ne depend pas de l'ordre des pieces", () => {
  // Le defaut d'origine : selon que la mention sans date arrive avant ou apres les
  // homonymes, elle atterrissait dans l'un ou l'autre groupe. Le resultat doit
  // desormais etre le meme quel que soit l'ordre d'entree.
  const sansDate = { gref: "D5:m2", cote: "D5", nom: "Jean DUPONT", role_apparent: "victime", naissance: null };
  const n1990 = { gref: "D3:m1", cote: "D3", nom: "Jean DUPONT", role_apparent: "temoin", naissance: "1990-05-02" };
  const n1962 = { gref: "D9:m4", cote: "D9", nom: "DUPONT Jean", role_apparent: "mis_en_cause", naissance: "1962-01-30" };
  for (const ordre of [[sansDate, n1990, n1962], [n1990, sansDate, n1962], [n1990, n1962, sansDate]]) {
    const { groupes, sansCle } = fusionnerMentions(ordre);
    assert.equal(groupes.length, 2);
    assert.deepEqual(sansCle.map((m) => m.gref), ["D5:m2"]);
    for (const g of groupes) assert.ok(!g.membres.includes("D5:m2"));
  }
});

test("un seul groupe compatible → la mention sans naissance le rejoint, sans avertissement", () => {
  // Pas d'homonyme a departager ici : la naissance vide n'est pas un motif de
  // scission, la fusion reste acquise et l'utilisateur n'a rien a arbitrer.
  const { groupes, sansCle, avertissements } = fusionnerMentions([
    { gref: "D3:m1", cote: "D3", nom: "Jean DUPONT", role_apparent: "temoin", naissance: null },
    { gref: "D9:m4", cote: "D9", nom: "DUPONT Jean", role_apparent: "mis_en_cause", naissance: "1962-01-30" },
  ]);
  assert.equal(groupes.length, 1);
  assert.deepEqual(groupes[0].membres, ["D3:m1", "D9:m4"]);
  assert.deepEqual(sansCle, []);
  assert.deepEqual(avertissements, []);
});

test("l'avertissement d'homonymie ne porte aucun nom de personne et n'est emis qu'une fois", () => {
  // Les pieces sont a diffusion restreinte : un avertissement affiche a l'ecran ne
  // doit jamais reveler l'identite qu'il concerne.
  const { avertissements } = fusionnerMentions([
    { gref: "D3:m1", cote: "D3", nom: "Jean DUPONT", naissance: "1990-05-02" },
    { gref: "D9:m4", cote: "D9", nom: "DUPONT Jean", naissance: "1962-01-30" },
    { gref: "D5:m2", cote: "D5", nom: "Jean DUPONT", naissance: null },
    { gref: "D6:m3", cote: "D6", nom: "DUPONT Jean", naissance: null },
  ]);
  assert.equal(avertissements.length, 1);
  for (const a of avertissements) {
    assert.ok(!/DUPONT/i.test(a));
    assert.ok(!/Jean/i.test(a));
  }
});

test("meme mention repetee avec le meme gref → le gref est duplique dans membres", () => {
  // Constat du comportement actuel : aucune deduplication par gref n'est faite.
  // Ce n'est pas voulu par la spec (qui parle de "grefs" comme identifiants de
  // mentions), simplement ce que fait le code aujourd'hui — a fiabiliser si des
  // mentions dupliquees venaient a se produire en pratique.
  const { groupes } = fusionnerMentions([
    { gref: "D1:m1", cote: "D1", nom: "Marc BIDULE", role_apparent: "victime" },
    { gref: "D1:m1", cote: "D1", nom: "Marc BIDULE", role_apparent: "victime" },
  ]);
  assert.equal(groupes.length, 1);
  assert.deepEqual(groupes[0].membres, ["D1:m1", "D1:m1"]);
});

const AVERTISSEMENT_ATTRIBUTS_DIVERGENTS =
  "Mentions d'un même nom aux qualités ou adresses divergentes : vérifiez qu'il ne s'agit pas d'homonymes";

test("qualites renseignees et differentes dans un groupe → avertissement", () => {
  // La spec (§4.3) assume la sur-fusion sur le seul nom en la disant « detectable ».
  // Sans ce signal, l'agregat supprime justement l'indice qui la rendrait detectable.
  const { groupes, avertissements } = fusionnerMentions([
    { gref: "D1:m1", cote: "D1", nom: "Jean DUPONT", role_apparent: "temoin", qualite: "boulanger" },
    { gref: "D2:m2", cote: "D2", nom: "DUPONT Jean", role_apparent: "temoin", qualite: "plombier" },
  ]);
  assert.equal(groupes.length, 1);
  assert.ok(avertissements.includes(AVERTISSEMENT_ATTRIBUTS_DIVERGENTS));
});

test("adresses renseignees et differentes dans un groupe → avertissement", () => {
  const { avertissements } = fusionnerMentions([
    { gref: "D1:m1", cote: "D1", nom: "Jean DUPONT", qualite: "boulanger", adresse: "12 rue X" },
    { gref: "D2:m2", cote: "D2", nom: "DUPONT Jean", qualite: "boulanger", adresse: "3 avenue Y" },
  ]);
  assert.ok(avertissements.includes(AVERTISSEMENT_ATTRIBUTS_DIVERGENTS));
});

test("l'avertissement de divergence ne porte ni nom, ni cote, ni valeur d'attribut", () => {
  // Les pieces sont a diffusion restreinte : un avertissement affiche a l'ecran ne
  // revele ni l'identite, ni la piece, ni le contenu qu'il concerne.
  const { avertissements } = fusionnerMentions([
    { gref: "D1:m1", cote: "D1", nom: "Jean DUPONT", qualite: "boulanger", adresse: "12 rue Verte" },
    { gref: "D2:m2", cote: "D2", nom: "DUPONT Jean", qualite: "plombier", adresse: "3 avenue Bleue" },
  ]);
  const a = avertissements.find((x) => x === AVERTISSEMENT_ATTRIBUTS_DIVERGENTS);
  assert.ok(a);
  for (const interdit of [/DUPONT/i, /Jean/i, /D1/, /D2/, /boulanger/i, /plombier/i, /rue Verte/i, /avenue Bleue/i]) {
    assert.ok(!interdit.test(a), `l'avertissement ne doit pas contenir ${interdit}`);
  }
});

test("qualites concordantes ou absentes → aucun avertissement de divergence", () => {
  for (const mentions of [
    [{ gref: "D1:m1", cote: "D1", nom: "Jean DUPONT", qualite: "boulanger", adresse: "12 rue X" },
     { gref: "D2:m2", cote: "D2", nom: "DUPONT Jean", qualite: "boulanger", adresse: "12 rue X" }],
    [{ gref: "D1:m1", cote: "D1", nom: "Jean DUPONT", qualite: "boulanger" },
     { gref: "D2:m2", cote: "D2", nom: "DUPONT Jean", qualite: "", adresse: null }],
    [{ gref: "D1:m1", cote: "D1", nom: "Jean DUPONT" },
     { gref: "D2:m2", cote: "D2", nom: "DUPONT Jean" }],
  ]) {
    const { avertissements } = fusionnerMentions(mentions);
    assert.ok(!avertissements.includes(AVERTISSEMENT_ATTRIBUTS_DIVERGENTS));
  }
});

test("qualites divergentes dans deux groupes distincts → un seul avertissement", () => {
  const { avertissements } = fusionnerMentions([
    { gref: "D1:m1", cote: "D1", nom: "Jean DUPONT", qualite: "boulanger" },
    { gref: "D2:m2", cote: "D2", nom: "DUPONT Jean", qualite: "plombier" },
    { gref: "D3:m3", cote: "D3", nom: "Marc BIDULE", qualite: "ouvrier" },
    { gref: "D4:m4", cote: "D4", nom: "BIDULE Marc", qualite: "retraite" },
  ]);
  assert.equal(avertissements.filter((a) => a === AVERTISSEMENT_ATTRIBUTS_DIVERGENTS).length, 1);
});

test("vocabulaire LRPGN releve en production : types de piece", () => {
  const plainte = parseNomFichier("20250221_1445_PVPlainte_VIC_BIDULE_MARC.pdf");
  assert.equal(plainte.typeActe, "audition");
  assert.deepEqual(plainte.avertissements, []);
  const gav = parseNomFichier("20250221_1445_PVGardeAVue_VIC_BIDULE_MARC.pdf");
  assert.equal(gav.typeActe, "gav");
  assert.deepEqual(gav.avertissements, []);
});

test("vocabulaire LRPGN releve en production : roles", () => {
  const tem = parseNomFichier("20250221_1445_PVAudition_TEM_BIDULE_MARC.pdf");
  assert.equal(tem.role, "temoin");
  assert.deepEqual(tem.avertissements, []);
  const mec = parseNomFichier("20250221_1445_PVAudition_MEC_BIDULE_MARC.pdf");
  assert.equal(mec.role, "mis_en_cause");
  assert.deepEqual(mec.avertissements, []);
});
