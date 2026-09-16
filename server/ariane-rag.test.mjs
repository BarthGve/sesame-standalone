import { test } from "node:test";
import assert from "node:assert/strict";
import { ragActif, chatActif, hashesDepuisListe, purgeCorpus, ingestPiece, chatStream } from "./ariane-rag.mjs";

const cfg = {
  baseUrl: "https://iaka.test",
  jwt: "tok",
  ragBaseUrl: "https://iaka-api.test",
  ragCorpusId: "corpus-1",
  ragIakId: "iak-1",
};

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

// Deux capacites distinctes, deux surfaces d'API : le REST RAG (purge, ingestion)
// vit sur l'hote des workflows, le chat sur un hote OpenAI-compatible dedie. Un
// deploiement peut donc indexer sans pouvoir dialoguer ; l'inverse n'a pas de sens.
test("ragActif (ingestion) n'exige que le corpus", () => {
  assert.equal(ragActif(cfg), true);
  assert.equal(ragActif({ ...cfg, ragCorpusId: undefined }), false);
  // L'ingestion n'utilise ni ragBaseUrl ni ragIakId : leur absence ne la desactive pas.
  assert.equal(ragActif({ ...cfg, ragBaseUrl: undefined, ragIakId: undefined }), true);
});

test("chatActif exige en plus l'hote OpenAI-compatible, l'iak et le modele", () => {
  assert.equal(chatActif({ ...cfg, ragModel: "modele-test" }), true);
  assert.equal(chatActif({ ...cfg, ragModel: "modele-test", ragBaseUrl: undefined }), false);
  assert.equal(chatActif({ ...cfg, ragModel: "modele-test", ragIakId: undefined }), false);
  // Le modele est un prerequis : l'endpoint rejette en 400 un `model` vide, et
  // l'echec surviendrait en plein flux au lieu de griser l'onglet.
  assert.equal(chatActif({ ...cfg, ragModel: undefined }), false);
  // Le corpus reste le garde-fou commun : sans lui, aucune capacite.
  assert.equal(chatActif({ ...cfg, ragModel: "modele-test", ragCorpusId: undefined }), false);
});

test("hashesDepuisListe accepte le tableau nu et la forme enveloppee", () => {
  assert.deepEqual(hashesDepuisListe([{ file_hash: "a" }]), ["a"]);
  assert.deepEqual(hashesDepuisListe({ documents: [{ file_hash: "a" }, { hash: "b" }] }), ["a", "b"]);
  assert.deepEqual(hashesDepuisListe({}), []);
});

// Le format reel de GET /rag/documents n'a pas encore ete observe sur l'API : toute
// forme inattendue doit donner une liste vide, jamais une exception.
test("hashesDepuisListe tolere les formes inattendues", () => {
  assert.deepEqual(hashesDepuisListe({ documents: "pas-un-tableau" }), []);
  assert.deepEqual(hashesDepuisListe([null, 42, "x", { autre: "champ" }]), []);
  assert.deepEqual(hashesDepuisListe(null), []);
  assert.deepEqual(hashesDepuisListe(undefined), []);
  assert.deepEqual(hashesDepuisListe("chaine"), []);
});

test("purgeCorpus liste puis supprime chaque file_hash", async () => {
  const appels = [];
  const fetchImpl = async (url, init) => {
    appels.push(`${init.method} ${url}`);
    if (url.includes("/rag/documents")) return ok({ documents: [{ file_hash: "h1" }, { file_hash: "h2" }] });
    return ok({});
  };
  const n = await purgeCorpus({ cfg, fetchImpl });
  assert.equal(n, 2);
  assert.equal(appels[0], "GET https://iaka.test/rag/documents?corpus_id=corpus-1");
  assert.equal(appels[1], "DELETE https://iaka.test/rag/document?corpus_id=corpus-1&file_hash=h1");
  assert.equal(appels[2], "DELETE https://iaka.test/rag/document?corpus_id=corpus-1&file_hash=h2");
});

test("purgeCorpus sur corpus vide ne supprime rien", async () => {
  const appels = [];
  const fetchImpl = async (url, init) => { appels.push(init.method); return ok({ documents: [] }); };
  assert.equal(await purgeCorpus({ cfg, fetchImpl }), 0);
  assert.deepEqual(appels, ["GET"]);
});

test("purgeCorpus sans corpus configure leve SANS appel reseau", async () => {
  let appele = false;
  const fetchImpl = async () => { appele = true; return ok({}); };
  await assert.rejects(
    () => purgeCorpus({ cfg: { ...cfg, ragCorpusId: undefined }, fetchImpl }),
    /ARIANE_RAG_INDISPONIBLE/,
  );
  assert.equal(appele, false, "garde-fou : aucun appel ne doit partir");
});

test("purgeCorpus propage un echec de suppression", async () => {
  const fetchImpl = async (url) =>
    url.includes("/rag/documents") ? ok({ documents: [{ file_hash: "h1" }] }) : { ok: false, status: 500 };
  await assert.rejects(() => purgeCorpus({ cfg, fetchImpl }), /ARIANE_RAG_PURGE/);
});

// Le corpus est dedie a Ariane : sous-supprimer puis ingerer melangerait deux
// procedures dans le chat. Toute reponse non interpretable doit donc lever, jamais
// emprunter le chemin du succes avec 0 suppression.
// Le listing est ici inexploitable : le rattrapage par retriever est tente, mais il
// echoue a son tour (meme corps non reconnu). Le verdict final reste ARIANE_RAG_PURGE
// et, surtout, aucune suppression partielle ne doit partir.
test("purgeCorpus leve sur une enveloppe non reconnue, sans aucun DELETE", async () => {
  for (const body of [{ items: [{ file_hash: "h1" }] }, {}, 42, "chaine", null]) {
    const methodes = [];
    const fetchImpl = async (url, init) => { methodes.push(init.method); return ok(body); };
    await assert.rejects(() => purgeCorpus({ cfg, fetchImpl }), /ARIANE_RAG_PURGE/);
    assert.ok(!methodes.includes("DELETE"), "aucune suppression ne doit partir");
  }
});

test("purgeCorpus leve si des documents sont la mais aucun hash extrait", async () => {
  const methodes = [];
  const fetchImpl = async (url, init) => {
    methodes.push(init.method);
    if (url.includes("/rag/retriever")) return { ok: false, status: 500 }; // rattrapage indisponible
    return ok({ documents: [{ id: 1 }] });
  };
  await assert.rejects(() => purgeCorpus({ cfg, fetchImpl }), /ARIANE_RAG_PURGE/);
  assert.ok(!methodes.includes("DELETE"));
});

test("purgeCorpus leve si un seul document sur deux porte un hash", async () => {
  const fetchImpl = async (url) =>
    url.includes("/rag/retriever") ? { ok: false, status: 500 } : ok({ documents: [{ file_hash: "h1" }, { id: 2 }] });
  await assert.rejects(() => purgeCorpus({ cfg, fetchImpl }), /ARIANE_RAG_PURGE/);
});

// Une page d'erreur HTML fait lever .json() : le code d'erreur doit rester dans la
// taxonomie ARIANE_RAG_*, pas remonter un SyntaxError.
test("purgeCorpus traduit un corps non-JSON en ARIANE_RAG_PURGE", async () => {
  const methodes = [];
  const fetchImpl = async (url, init) => {
    methodes.push(init.method);
    return { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } };
  };
  await assert.rejects(() => purgeCorpus({ cfg, fetchImpl }), /ARIANE_RAG_PURGE/);
  assert.ok(!methodes.includes("DELETE"));
});

test("purgeCorpus accepte les deux enveloppes vides reconnues", async () => {
  for (const body of [[], { documents: [] }]) {
    const methodes = [];
    const fetchImpl = async (url, init) => { methodes.push(init.method); return ok(body); };
    assert.equal(await purgeCorpus({ cfg, fetchImpl }), 0);
    assert.deepEqual(methodes, ["GET"]);
  }
});

// --- Rattrapage de purge par le retriever -----------------------------------
// Chemin de contournement d'un defaut amont : POST /rag/ingest laisse parfois dans
// le corpus des documents que GET /rag/documents ne sait plus serialiser (400).

// Fabrique un element de reponse retriever, forme observee sur l'API reelle.
const elementRetriever = (hash) => ({
  id: `id-${hash}`,
  type: "Document",
  page_content: "texte",
  metadata: { file_hash: hash, total_pages: 1, corpus_id: "corpus-1" },
});

// Garde-fou de non-regression : tant que le listing est lisible, le chemin normal
// doit rester strictement identique — le retriever n'a rien a faire dans la boucle.
test("purgeCorpus n'interroge jamais le retriever quand le listing est exploitable", async () => {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(`${init.method} ${url}`);
    if (url.includes("/rag/documents")) return ok({ documents: [{ file_hash: "h1" }, { file_hash: "h2" }] });
    return ok({});
  };
  assert.equal(await purgeCorpus({ cfg, fetchImpl }), 2);
  assert.ok(!urls.some((u) => u.includes("/rag/retriever")), "le retriever ne doit pas etre sollicite");
});

test("purgeCorpus vide n'interroge pas le retriever", async () => {
  const urls = [];
  const fetchImpl = async (url, init) => { urls.push(`${init.method} ${url}`); return ok({ documents: [] }); };
  assert.equal(await purgeCorpus({ cfg, fetchImpl }), 0);
  assert.ok(!urls.some((u) => u.includes("/rag/retriever")));
});

// Fabrique un fetch de rattrapage : le listing repond 400 tant que `restantsAvant`
// documents subsistent, puis redevient exploitable (200) — c'est le retablissement
// du listing qui prononce desormais le succes du rattrapage, pas l'epuisement du
// retriever. `parPrompt` decide de ce que rend chaque prompt.
function fetchRattrapage({ parPrompt, listingRetabliApres = 1 }) {
  const journal = { appels: [], supprimes: [], prompts: [], toursListing: 0 };
  const fetchImpl = async (url, init) => {
    journal.appels.push(`${init.method} ${url}`);
    if (url.includes("/rag/documents")) {
      journal.toursListing += 1;
      // Le premier appel est le listing initial ; les suivants sont les reverifications.
      const reverifications = journal.toursListing - 1;
      return reverifications >= listingRetabliApres ? ok({ documents: [] }) : { ok: false, status: 400 };
    }
    if (url.includes("/rag/retriever")) {
      const prompt = JSON.parse(init.body).prompt;
      journal.prompts.push(prompt);
      return ok(parPrompt(prompt, journal));
    }
    journal.supprimes.push(new URL(url).searchParams.get("file_hash"));
    return ok({});
  };
  return { fetchImpl, journal };
}

test("purgeCorpus bascule sur le retriever quand le listing repond 400", async () => {
  const { fetchImpl, journal } = fetchRattrapage({
    parPrompt: () => [elementRetriever("h1"), elementRetriever("h2")],
  });
  assert.equal(await purgeCorpus({ cfg, fetchImpl }), 2);
  assert.equal(journal.appels[0], "GET https://iaka.test/rag/documents?corpus_id=corpus-1");
  assert.equal(journal.appels[1], "POST https://iaka.test/rag/retriever");
  assert.deepEqual(journal.supprimes, ["h1", "h2"]);
});

test("le corps envoye au retriever porte le corpus vise et les en-tetes d'auth", async () => {
  const recus = [];
  const fetchImpl = async (url, init) => {
    if (url.includes("/rag/documents")) return { ok: false, status: 400 };
    if (url.includes("/rag/retriever")) { recus.push(init); return ok([]); }
    return ok({});
  };
  // Premier tour sans aucun hash : la purge ne peut plus se conclure par un succes
  // a zero, elle leve. Les assertions portent sur la requete quand meme emise.
  await assert.rejects(() => purgeCorpus({ cfg, fetchImpl }), /ARIANE_RAG_PURGE/);
  for (const recu of recus) {
    assert.equal(recu.method, "POST");
    assert.equal(recu.headers.Authorization, "Bearer tok");
    const corps = JSON.parse(recu.body);
    assert.deepEqual(corps.corpus_ids, ["corpus-1"]);
    assert.deepEqual(corps.history, []);
    assert.equal(typeof corps.prompt, "string");
    assert.ok(corps.prompt.length > 0);
  }
});

// Le retriever est une recherche par similarite, pas un inventaire : un seul prompt
// generique peut ne rien remonter alors que le corpus n'est pas vide. On interroge
// donc plusieurs formulations et on fait l'union des hashes.
test("le rattrapage interroge plusieurs prompts distincts et en fait l'union", async () => {
  const { fetchImpl, journal } = fetchRattrapage({
    parPrompt: (prompt) => (prompt.includes("proces-verbal") ? [elementRetriever("h1")] : []),
  });
  assert.equal(await purgeCorpus({ cfg, fetchImpl }), 1);
  assert.deepEqual(journal.supprimes, ["h1"], "le hash vu par un seul prompt est bien supprime");
  assert.ok(journal.prompts.length >= 5, `plusieurs prompts, ${journal.prompts.length} emis`);
  assert.equal(new Set(journal.prompts).size, journal.prompts.length, "prompts tous distincts");
});

// Principe 1 : en mode degrade, zero resultat n'est jamais une preuve de vacuite.
test("un premier tour sans aucun hash leve au lieu de conclure a un corpus vide", async () => {
  const methodes = [];
  const fetchImpl = async (url, init) => {
    methodes.push(init.method);
    if (url.includes("/rag/documents")) return { ok: false, status: 400 };
    return ok([]); // le retriever ne remonte rien, sur aucun prompt
  };
  await assert.rejects(() => purgeCorpus({ cfg, fetchImpl }), /ARIANE_RAG_PURGE/);
  assert.ok(!methodes.includes("DELETE"), "aucune suppression ne doit partir");
});

// Principe 2 : le signal objectif est le retablissement de GET /rag/documents.
test("le retablissement du listing conclut la purge sans tour supplementaire", async () => {
  const { fetchImpl, journal } = fetchRattrapage({
    // Le retriever continuerait a rendre h1 indefiniment : seul le listing tranche.
    parPrompt: () => [elementRetriever("h1")],
  });
  assert.equal(await purgeCorpus({ cfg, fetchImpl }), 1);
  assert.deepEqual(journal.supprimes, ["h1"]);
  assert.equal(journal.toursListing, 2, "listing initial + une seule reverification");
  assert.equal(journal.prompts.length, 5, "un seul tour de retriever");
});

// La suppression ne libere pas forcement tout d'un coup : on reinterroge tant que le
// listing n'est pas retabli, en ignorant les hashes deja supprimes.
test("le rattrapage boucle jusqu'au retablissement du listing", async () => {
  const tours = [
    [elementRetriever("h1"), elementRetriever("h2")],
    [elementRetriever("h1"), elementRetriever("h3")], // h1 deja supprime : ignore
  ];
  let tour = 0;
  const { fetchImpl, journal } = fetchRattrapage({
    listingRetabliApres: 2,
    parPrompt: (prompt) => {
      // Un seul prompt du tour porte les elements ; les autres ne rendent rien.
      if (!prompt.includes("proces-verbal")) return [];
      return tours[tour++] ?? [];
    },
  });
  assert.equal(await purgeCorpus({ cfg, fetchImpl }), 3);
  assert.deepEqual(journal.supprimes, ["h1", "h2", "h3"], "chaque hash n'est supprime qu'une fois");
  assert.equal(journal.toursListing, 3, "listing initial + deux reverifications");
});

// Le listing ne se retablit jamais : la purge doit refuser de conclure.
test("un listing jamais retabli epuise le plafond et leve ARIANE_RAG_PURGE", async () => {
  let tour = 0;
  const fetchImpl = async (url) => {
    if (url.includes("/rag/documents")) return { ok: false, status: 400 };
    if (url.includes("/rag/retriever")) return ok([elementRetriever(`h${tour++}`)]);
    return ok({});
  };
  await assert.rejects(() => purgeCorpus({ cfg, fetchImpl }), /ARIANE_RAG_PURGE/);
});

test("un retriever en erreur laisse purgeCorpus lever ARIANE_RAG_PURGE", async () => {
  const methodes = [];
  const fetchImpl = async (url, init) => {
    methodes.push(init.method);
    if (url.includes("/rag/documents")) return { ok: false, status: 400 };
    return { ok: false, status: 502 };
  };
  await assert.rejects(() => purgeCorpus({ cfg, fetchImpl }), /ARIANE_RAG_PURGE/);
  assert.ok(!methodes.includes("DELETE"));
});

test("un retriever au corps illisible laisse purgeCorpus lever ARIANE_RAG_PURGE", async () => {
  for (const reponse of [
    { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } },
    { ok: true, status: 200, json: async () => ({ inattendu: true }) },
  ]) {
    const fetchImpl = async (url) => (url.includes("/rag/documents") ? { ok: false, status: 400 } : reponse);
    await assert.rejects(() => purgeCorpus({ cfg, fetchImpl }), /ARIANE_RAG_PURGE/);
  }
});

// Le retriever rend indefiniment un document que la suppression ne fait pas
// disparaitre, et le listing reste en erreur : la boucle doit s'arreter au plafond et
// refuser la purge plutot que tourner sans fin ou croire a tort le corpus vide.
test("un document qui ne disparait jamais atteint le plafond de tours", async () => {
  let appelsRetriever = 0;
  let suppressions = 0;
  const fetchImpl = async (url) => {
    if (url.includes("/rag/documents")) return { ok: false, status: 400 };
    if (url.includes("/rag/retriever")) { appelsRetriever += 1; return ok([elementRetriever("h1")]); }
    suppressions += 1;
    return ok({});
  };
  await assert.rejects(() => purgeCorpus({ cfg, fetchImpl }), /ARIANE_RAG_PURGE/);
  // Plusieurs tours, mais bornes : chaque tour emet un lot de prompts.
  assert.ok(appelsRetriever > 5 && appelsRetriever <= 50, `boucle bornee, ${appelsRetriever} appels`);
  assert.equal(suppressions, 1, "un hash deja supprime n'est pas resupprime");
});

// --- Tolerance aux sondes en echec ------------------------------------------
// Les cinq prompts sont des sondes REDONDANTES sur un meme corpus : chacune le
// cherche sous un angle different. L'echec de l'une n'invalide donc pas ce que les
// autres ont ramene. Mesure sur un corpus reel de 12 documents : quatre sondes
// rendaient 200 et couvraient l'integralite du corpus, la cinquieme rendait 500 —
// et le rattrapage jetait les douze hashes pour lever.
test("une sonde en echec est ignoree, le tour se poursuit avec les autres", async () => {
  const supprimes = [];
  const prompts = [];
  let listings = 0;
  const fetchImpl = async (url, init) => {
    if (url.includes("/rag/documents")) return listings++ === 0 ? { ok: false, status: 400 } : ok({ documents: [] });
    if (url.includes("/rag/retriever")) {
      const prompt = JSON.parse(init.body).prompt;
      prompts.push(prompt);
      // Une seule sonde tombe ; les autres couvrent le corpus.
      if (prompt.includes("bordereau")) return { ok: false, status: 500 };
      return ok([elementRetriever("h1"), elementRetriever("h2")]);
    }
    supprimes.push(new URL(url).searchParams.get("file_hash"));
    return ok({});
  };
  assert.equal(await purgeCorpus({ cfg, fetchImpl }), 2);
  assert.deepEqual(supprimes, ["h1", "h2"]);
  assert.equal(prompts.length, 5, "toutes les sondes du tour sont emises, l'echec ne court-circuite pas");
});

// Le seul cas ou l'on ignore vraiment le contenu du corpus : aucune sonde n'a
// repondu. La ne rien savoir interdit de conclure, donc on leve.
test("toutes les sondes en echec levent ARIANE_RAG_PURGE, sans aucune suppression", async () => {
  const methodes = [];
  let sondes = 0;
  const fetchImpl = async (url, init) => {
    methodes.push(init.method);
    if (url.includes("/rag/documents")) return { ok: false, status: 400 };
    sondes += 1;
    return { ok: false, status: 500 };
  };
  await assert.rejects(() => purgeCorpus({ cfg, fetchImpl }), /ARIANE_RAG_PURGE/);
  assert.equal(sondes, 5, "les cinq sondes sont tentees avant de renoncer");
  assert.ok(!methodes.includes("DELETE"), "aucune suppression ne doit partir");
});

// Non-regression du principe 1, a ne pas confondre avec le cas precedent : ici les
// sondes REPONDENT toutes, mais aucune ne remonte de hash. Zero resultat n'est
// jamais une preuve de vacuite en mode degrade — on leve quand meme.
test("des sondes qui reussissent toutes sans remonter de hash levent aussi", async () => {
  const methodes = [];
  const fetchImpl = async (url, init) => {
    methodes.push(init.method);
    if (url.includes("/rag/documents")) return { ok: false, status: 400 };
    return ok([]); // 200, forme reconnue, mais rien trouve
  };
  await assert.rejects(() => purgeCorpus({ cfg, fetchImpl }), /ARIANE_RAG_PURGE/);
  assert.ok(!methodes.includes("DELETE"));
});

// « Aucune sonde n'a repondu » et « les sondes ont repondu qu'elles ne trouvaient
// rien » ne doivent jamais etre confondus. Ici la suppression du premier tour libere
// le listing, mais avec un tour de retard ; au deuxieme tour les sondes repondent
// toutes sans plus rien trouver. Ce n'est pas une ignorance : la boucle doit
// poursuivre jusqu'a la reverification, qui prononce le succes.
test("un tour ou les sondes repondent sans rien trouver n'interrompt pas la boucle", async () => {
  const supprimes = [];
  let listings = 0;
  let tours = 0;
  const fetchImpl = async (url, init) => {
    if (url.includes("/rag/documents")) return listings++ < 2 ? { ok: false, status: 400 } : ok({ documents: [] });
    if (url.includes("/rag/retriever")) {
      // Premier tour : h1. Tours suivants : plus rien, mais des reponses valides.
      const premierTour = tours < 5;
      tours += 1;
      return ok(premierTour ? [elementRetriever("h1")] : []);
    }
    supprimes.push(new URL(url).searchParams.get("file_hash"));
    return ok({});
  };
  assert.equal(await purgeCorpus({ cfg, fetchImpl }), 1);
  assert.deepEqual(supprimes, ["h1"]);
  assert.equal(listings, 3, "listing initial + deux reverifications");
});

// Une sonde a mis 21 secondes avant de rendre son 500 : cinq sondes par tour et
// plusieurs tours, et la purge — qui precede l'analyse — la bloque durablement.
// Au-dela du delai, la sonde est abandonnee et traitee comme une sonde en echec.
test("une sonde qui depasse le delai est ignoree comme une sonde en echec", async () => {
  const supprimes = [];
  let listings = 0;
  const fetchImpl = (url, init) => {
    if (url.includes("/rag/documents")) {
      return Promise.resolve(listings++ === 0 ? { ok: false, status: 400 } : ok({ documents: [] }));
    }
    if (url.includes("/rag/retriever")) {
      const prompt = JSON.parse(init.body).prompt;
      if (!prompt.includes("bordereau")) return Promise.resolve(ok([elementRetriever("h1")]));
      // Sonde qui ne repond jamais : seul le signal peut la denouer. `AbortSignal.timeout`
      // utilise un timer UNREF (il ne doit pas maintenir un serveur en vie pour une sonde) ;
      // dans ce test, rien d'autre ne garde la boucle d'evenements active pendant l'attente,
      // donc elle pourrait se vider avant que l'abandon ne se declenche — la sonde resterait
      // alors pendante et node:test annulerait le test (flaky en CI). Un timer REF, nettoye a
      // l'abandon, garde la boucle vivante juste le temps que le delai expire.
      return new Promise((_, reject) => {
        const gardeBoucle = setTimeout(() => {}, 1000);
        init.signal.addEventListener("abort", () => {
          clearTimeout(gardeBoucle);
          reject(init.signal.reason ?? new Error("aborted"));
        });
      });
    }
    supprimes.push(new URL(url).searchParams.get("file_hash"));
    return Promise.resolve(ok({}));
  };
  assert.equal(await purgeCorpus({ cfg, fetchImpl, delaiSondeMs: 20 }), 1);
  assert.deepEqual(supprimes, ["h1"], "le hash ramene par les autres sondes est bien supprime");
});

// Le signal ne doit pas gener les doubles qui l'ignorent : tous les autres tests du
// fichier passent un fetchImpl qui ne le lit pas. On verifie ici explicitement qu'il
// est bien transmis aux sondes, et a elles seules.
test("le signal d'expiration n'est pose que sur les sondes", async () => {
  const signaux = [];
  let listings = 0;
  const fetchImpl = async (url, init) => {
    signaux.push([url.includes("/rag/retriever") ? "sonde" : "autre", Boolean(init.signal)]);
    if (url.includes("/rag/documents")) return listings++ === 0 ? { ok: false, status: 400 } : ok({ documents: [] });
    if (url.includes("/rag/retriever")) return ok([elementRetriever("h1")]);
    return ok({});
  };
  assert.equal(await purgeCorpus({ cfg, fetchImpl }), 1);
  for (const [genre, aSignal] of signaux) {
    assert.equal(aSignal, genre === "sonde", `${genre} : signal ${aSignal ? "pose" : "absent"}`);
  }
});

test("une suppression en echec pendant le rattrapage leve ARIANE_RAG_PURGE", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/rag/documents")) return { ok: false, status: 400 };
    if (url.includes("/rag/retriever")) return ok([elementRetriever("h1"), elementRetriever("h2")]);
    return { ok: false, status: 500 };
  };
  await assert.rejects(() => purgeCorpus({ cfg, fetchImpl }), /ARIANE_RAG_PURGE/);
});

// Corps non-JSON du listing et enveloppe inconnue sont eux aussi des declencheurs :
// le rattrapage prend le relais et n'aboutit que si le listing redevient exploitable.
test("un listing non-JSON ou inconnu declenche le rattrapage et peut aboutir", async () => {
  for (const degrade of [
    { ok: true, status: 200, json: async () => { throw new SyntaxError("<"); } },
    ok({ items: [] }),
  ]) {
    const supprimes = [];
    let listings = 0;
    const fetchImpl = async (url) => {
      if (url.includes("/rag/documents")) return listings++ === 0 ? degrade : ok({ documents: [] });
      if (url.includes("/rag/retriever")) return ok([elementRetriever("h9")]);
      supprimes.push(new URL(url).searchParams.get("file_hash"));
      return ok({});
    };
    assert.equal(await purgeCorpus({ cfg, fetchImpl }), 1);
    assert.deepEqual(supprimes, ["h9"]);
  }
});

// Un listing degrade qui reste illisible (200 mais enveloppe inconnue) n'est pas une
// preuve de purge : un 200 qu'on ne sait pas interpreter ne prononce aucun succes.
test("un listing 200 mais illisible ne suffit pas a confirmer la purge", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/rag/documents")) return ok({ items: [] }); // jamais exploitable
    if (url.includes("/rag/retriever")) return ok([elementRetriever("h9")]);
    return ok({});
  };
  await assert.rejects(() => purgeCorpus({ cfg, fetchImpl }), /ARIANE_RAG_PURGE/);
});

test("ingestPiece envoie file + corpus_id + metadata en multipart", async () => {
  let recu;
  const fetchImpl = async (url, init) => { recu = { url, init }; return ok({}); };
  const file = { base64: Buffer.from("%PDF-1.4").toString("base64"), mime: "application/pdf", filename: "D12.pdf" };
  assert.equal(await ingestPiece({ file, cote: "D12", cfg, fetchImpl }), true);
  assert.equal(recu.url, "https://iaka.test/rag/ingest");
  assert.equal(recu.init.method, "POST");
  assert.equal(recu.init.body.get("corpus_id"), "corpus-1");
  assert.deepEqual(JSON.parse(recu.init.body.get("metadata")), { cote: "D12" });
  assert.equal(recu.init.body.get("file").name, "D12.pdf");
});

// Les metadonnees de document viennent du XML LRPGN, deja parse par le front. Elles
// s'ajoutent a `cote`, qui reste inchangee : c'est elle qui relie la reponse du chat
// a la piece du dossier.
test("ingestPiece joint les metadonnees de document a la cote", async () => {
  let recu;
  const fetchImpl = async (url, init) => { recu = { url, init }; return ok({}); };
  const document = {
    type_piece: "Audition",
    date_acte: "mardi 10 février 2026",
    redacteur: "Adjudant Julie MALLIETTE",
    unite: "COB LE-LION-D-ANGERS",
    procedure: "00059/2025",
    nature_fait: "VOL EN BANDE ORGANISEE",
    natinf: "10832",
    personne_concernee: "Patrick DUVAL",
  };
  const file = { base64: Buffer.from("%PDF-1.4").toString("base64"), mime: "application/pdf", filename: "D12.pdf", meta: { personnes: [], avertissements: [], document } };
  assert.equal(await ingestPiece({ file, cote: "D12", cfg, fetchImpl }), true);
  assert.deepEqual(JSON.parse(recu.init.body.get("metadata")), { cote: "D12", ...document });
});

// Une piece sans XML — ou dont le XML n'a rien donne — s'ingere comme avant.
test("ingestPiece sans metadonnees de document n'envoie que la cote", async () => {
  let recu;
  const fetchImpl = async (url, init) => { recu = { url, init }; return ok({}); };
  const base64 = Buffer.from("%PDF-1.4").toString("base64");
  for (const meta of [undefined, null, { personnes: [], avertissements: [] }, { document: null }]) {
    const file = { base64, mime: "application/pdf", filename: "D12.pdf", meta };
    assert.equal(await ingestPiece({ file, cote: "D12", cfg, fetchImpl }), true);
    assert.deepEqual(JSON.parse(recu.init.body.get("metadata")), { cote: "D12" });
  }
});

// La cote reste la cote : une metadonnee de document ne peut pas l'ecraser.
test("ingestPiece ne laisse pas les metadonnees de document ecraser la cote", async () => {
  let recu;
  const fetchImpl = async (url, init) => { recu = { url, init }; return ok({}); };
  const file = { base64: Buffer.from("%PDF-1.4").toString("base64"), mime: "application/pdf", filename: "D12.pdf", meta: { document: { cote: "AUTRE", natinf: "10832" } } };
  assert.equal(await ingestPiece({ file, cote: "D12", cfg, fetchImpl }), true);
  assert.deepEqual(JSON.parse(recu.init.body.get("metadata")), { cote: "D12", natinf: "10832" });
});

test("ingestPiece en echec leve ARIANE_RAG_INGEST", async () => {
  const fetchImpl = async () => ({ ok: false, status: 502 });
  const file = { base64: "", mime: "application/pdf", filename: "D12.pdf" };
  await assert.rejects(() => ingestPiece({ file, cote: "D12", cfg, fetchImpl }), /ARIANE_RAG_INGEST/);
});

// Une piece sans base64 doit rester dans la taxonomie annoncee (l'ingestion est
// best-effort, mais le code d'erreur qui sort doit etre celui documente).
test("ingestPiece sans base64 leve ARIANE_RAG_INGEST", async () => {
  const fetchImpl = async () => ok({});
  for (const file of [{ mime: "application/pdf" }, { base64: null }, { base64: 42 }]) {
    await assert.rejects(() => ingestPiece({ file, cote: "D12", cfg, fetchImpl }), /ARIANE_RAG_INGEST/);
  }
});

// Fabrique un corps de reponse SSE asynchrone, comme celui d'undici.
function corpsSSE(morceaux) {
  const encoder = new TextEncoder();
  return {
    async *[Symbol.asyncIterator]() {
      for (const m of morceaux) yield encoder.encode(m);
    },
  };
}

const trameDelta = (txt) => `data: ${JSON.stringify({ choices: [{ delta: { content: txt } }] })}\n\n`;

test("chatStream relaie les deltas dans l'ordre", async () => {
  const recus = [];
  const fetchImpl = async () => ({ ok: true, body: corpsSSE([trameDelta("Bon"), trameDelta("jour"), "data: [DONE]\n\n"]) });
  await chatStream({ messages: [{ role: "user", content: "salut" }], cfg, fetchImpl, onDelta: (d) => recus.push(d) });
  assert.deepEqual(recus, ["Bon", "jour"]);
});

test("chatStream reconstitue une trame coupee entre deux morceaux", async () => {
  const recus = [];
  const trame = trameDelta("Bonjour");
  const coupe = [trame.slice(0, 20), trame.slice(20), "data: [DONE]\n\n"];
  const fetchImpl = async () => ({ ok: true, body: corpsSSE(coupe) });
  await chatStream({ messages: [{ role: "user", content: "x" }], cfg, fetchImpl, onDelta: (d) => recus.push(d) });
  assert.deepEqual(recus, ["Bonjour"]);
});

test("chatStream cible l'endpoint corpus+iak et demande le streaming", async () => {
  let recu;
  const fetchImpl = async (url, init) => { recu = { url, init }; return { ok: true, body: corpsSSE(["data: [DONE]\n\n"]) }; };
  await chatStream({ messages: [{ role: "user", content: "x" }], cfg, fetchImpl, onDelta: () => {} });
  assert.equal(recu.url, "https://iaka-api.test/corpus/corpus-1/iak/iak-1/v1/chat/completions");
  const body = JSON.parse(recu.init.body);
  assert.equal(body.stream, true);
  assert.deepEqual(body.messages, [{ role: "user", content: "x" }]);
});

test("chatStream en echec amont leve ARIANE_RAG_CHAT", async () => {
  const fetchImpl = async () => ({ ok: false, status: 502 });
  await assert.rejects(
    () => chatStream({ messages: [{ role: "user", content: "x" }], cfg, fetchImpl, onDelta: () => {} }),
    /ARIANE_RAG_CHAT/,
  );
});

test("chatStream ignore les lignes non-JSON (keep-alive)", async () => {
  const recus = [];
  const fetchImpl = async () => ({ ok: true, body: corpsSSE([": ping\n\n", trameDelta("ok"), "data: [DONE]\n\n"]) });
  await chatStream({ messages: [{ role: "user", content: "x" }], cfg, fetchImpl, onDelta: (d) => recus.push(d) });
  assert.deepEqual(recus, ["ok"]);
});

// Coupure de la connexion amont EN COURS de flux (a distinguer de la trame coupee
// entre deux morceaux, qui est un cas nominal de bufferisation). Le front conserve le
// texte deja recu et affiche l'erreur dessous : les deltas deja emis doivent donc
// rester acquis, et l'erreur sortir dans la taxonomie annoncee, jamais brute.
test("chatStream sur coupure en cours de flux conserve les deltas et leve ARIANE_RAG_CHAT", async () => {
  const recus = [];
  const body = {
    async *[Symbol.asyncIterator]() {
      yield new TextEncoder().encode(trameDelta("Bon"));
      throw new Error("socket hang up");
    },
  };
  const fetchImpl = async () => ({ ok: true, body });
  await assert.rejects(
    () => chatStream({ messages: [{ role: "user", content: "x" }], cfg, fetchImpl, onDelta: (d) => recus.push(d) }),
    /ARIANE_RAG_CHAT/,
  );
  assert.deepEqual(recus, ["Bon"], "le texte deja relaye ne doit pas etre perdu");
});
