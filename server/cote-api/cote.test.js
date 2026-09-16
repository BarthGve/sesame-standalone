const { test } = require("node:test");
const assert = require("node:assert/strict");
const { coter } = require("./cote");

const SCIROCCO = { marque: "VOLKSWAGEN", modele: "SCIROCCO", annee: 2016, km: 120000 };

test("deux appels identiques donnent exactement la meme reponse", () => {
  assert.deepEqual(coter(SCIROCCO), coter({ ...SCIROCCO }));
});

test("un modele du catalogue est reconnu exactement", () => {
  const r = coter(SCIROCCO);
  assert.equal(r.correspondance, "exacte");
  assert.equal(r.reference.marque, "VOLKSWAGEN");
  assert.equal(r.fourchette.devise, "EUR");
});

test("la casse, les accents et les espaces ne changent pas la reconnaissance", () => {
  const r = coter({ marque: " volkswagen ", modele: "Scirocco", annee: 2016, km: 120000 });
  assert.equal(r.correspondance, "exacte");
  assert.equal(r.fourchette.moyen, coter(SCIROCCO).fourchette.moyen);
});

test("un vehicule plus ancien cote moins cher", () => {
  const recent = coter({ ...SCIROCCO, annee: 2022 }).fourchette.moyen;
  const ancien = coter({ ...SCIROCCO, annee: 2010 }).fourchette.moyen;
  assert.ok(ancien < recent, `${ancien} devrait etre inferieur a ${recent}`);
});

test("un vehicule plus kilometre cote moins cher", () => {
  const peu = coter({ ...SCIROCCO, km: 40000 }).fourchette.moyen;
  const beaucoup = coter({ ...SCIROCCO, km: 250000 }).fourchette.moyen;
  assert.ok(beaucoup < peu, `${beaucoup} devrait etre inferieur a ${peu}`);
});

test("la fourchette encadre le prix moyen", () => {
  const f = coter(SCIROCCO).fourchette;
  assert.ok(f.bas < f.moyen && f.moyen < f.haut);
});

test("un modele voisin est reconnu comme approchant", () => {
  const r = coter({ marque: "VOLKSWAGEN", modele: "SCIROCCO 2.0 TSI", annee: 2016, km: 120000 });
  assert.equal(r.correspondance, "approchante");
});

test("un modele tronque a une lettre ne passe pas pour approchant", () => {
  const r = coter({ marque: "VOLKSWAGEN", modele: "T", annee: 2016 });
  assert.equal(r.correspondance, "repli_segment");
});

test("une marque connue mais un modele inconnu tombe en repli de segment, sans erreur", () => {
  const r = coter({ marque: "VOLKSWAGEN", modele: "XYZ-INTROUVABLE", annee: 2016, km: 120000 });
  assert.equal(r.correspondance, "repli_segment");
  assert.ok(r.fourchette.moyen > 0);
});

test("une marque inconnue tombe aussi en repli, sans erreur", () => {
  const r = coter({ marque: "MARQUE-FANTOME", modele: "MODELE-FANTOME", annee: 2016, km: 120000 });
  assert.equal(r.correspondance, "repli_segment");
  assert.ok(r.fourchette.moyen > 0);
});

test("le repli de segment sans carrosserie retombe sur COMPACTE, par defaut documente", () => {
  const r = coter({ marque: "MARQUE-FANTOME", modele: "MODELE-FANTOME", annee: 2016, km: 120000 });
  assert.equal(r.reference.segment, "COMPACTE");
});

test("une carrosserie inconnue en repli garde le defaut COMPACTE", () => {
  const r = coter({
    marque: "MARQUE-FANTOME",
    modele: "MODELE-FANTOME",
    annee: 2016,
    km: 120000,
    carrosserie: "SOUCOUPE-VOLANTE",
  });
  assert.equal(r.reference.segment, "COMPACTE");
});

test("une carrosserie reconnue en repli oriente le segment, et donc le prix", () => {
  const suv = coter({
    marque: "MARQUE-FANTOME",
    modele: "MODELE-FANTOME",
    annee: 2016,
    km: 120000,
    carrosserie: "SUV",
  });
  assert.equal(suv.reference.segment, "SUV");
  const utilitaire = coter({
    marque: "MARQUE-FANTOME",
    modele: "MODELE-FANTOME",
    annee: 2016,
    km: 120000,
    carrosserie: "UTILITAIRE",
  });
  assert.equal(utilitaire.reference.segment, "UTILITAIRE");
  assert.notEqual(suv.fourchette.moyen, utilitaire.fourchette.moyen);
});

test("trois a cinq annonces comparables, coherentes avec la fourchette", () => {
  const r = coter(SCIROCCO);
  assert.ok(r.annonces.length >= 3 && r.annonces.length <= 5);
  for (const a of r.annonces) {
    assert.ok(a.prix >= r.fourchette.bas && a.prix <= r.fourchette.haut, `${a.prix} hors fourchette`);
    assert.ok(a.titre && a.lieu && a.url);
  }
});

test("le kilometrage absent est remplace par une hypothese d'usage moyen", () => {
  const r = coter({ marque: "VOLKSWAGEN", modele: "SCIROCCO", annee: 2016 });
  assert.ok(r.reference.km > 0);
  assert.match(r.methode, /kilom/i);
});

test("un vehicule tres ancien garde une valeur residuelle positive", () => {
  const r = coter({ ...SCIROCCO, annee: 1990, km: 400000 });
  assert.ok(r.fourchette.bas > 0);
});

test("l'avertissement de simulation est toujours present", () => {
  assert.match(coter(SCIROCCO).avertissement, /simul/i);
});

function assertFourchetteExploitable(r) {
  assert.equal(typeof r.fourchette.bas, "number");
  assert.equal(typeof r.fourchette.moyen, "number");
  assert.equal(typeof r.fourchette.haut, "number");
  assert.ok(!Number.isNaN(r.fourchette.bas));
  assert.ok(!Number.isNaN(r.fourchette.moyen));
  assert.ok(!Number.isNaN(r.fourchette.haut));
  assert.ok(r.fourchette.bas > 0 && r.fourchette.moyen > 0 && r.fourchette.haut > 0);
  for (const a of r.annonces) {
    assert.equal(typeof a.prix, "number");
    assert.ok(!Number.isNaN(a.prix));
    assert.ok(a.prix > 0);
  }
}

const HYPOTHESE_ANNEE = /suppos.*(age|ann[ée]e)|(age|ann[ée]e).*suppos/i;

test("l'annee absente ne produit ni null ni NaN, et l'hypothese est dite", () => {
  const r = coter({ marque: "VOLKSWAGEN", modele: "SCIROCCO", km: 120000 });
  assertFourchetteExploitable(r);
  assert.match(r.methode, HYPOTHESE_ANNEE);
  assert.equal(typeof r.reference.annee, "number");
});

test("une annee non numerique ne produit ni null ni NaN, et l'hypothese est dite", () => {
  const r = coter({ marque: "VOLKSWAGEN", modele: "SCIROCCO", annee: "abcd", km: 120000 });
  assertFourchetteExploitable(r);
  assert.match(r.methode, HYPOTHESE_ANNEE);
  assert.equal(typeof r.reference.annee, "number");
});

test("une annee aberrante trop ancienne ne produit ni null ni NaN, et l'hypothese est dite", () => {
  const r = coter({ marque: "VOLKSWAGEN", modele: "SCIROCCO", annee: 1200, km: 120000 });
  assertFourchetteExploitable(r);
  assert.match(r.methode, HYPOTHESE_ANNEE);
  assert.equal(typeof r.reference.annee, "number");
});

test("une annee aberrante trop future ne produit ni null ni NaN, et l'hypothese est dite", () => {
  const r = coter({ marque: "VOLKSWAGEN", modele: "SCIROCCO", annee: 3000, km: 120000 });
  assertFourchetteExploitable(r);
  assert.match(r.methode, HYPOTHESE_ANNEE);
  assert.equal(typeof r.reference.annee, "number");
});
