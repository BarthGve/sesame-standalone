import { Buffer } from "node:buffer";

// Corpus RAG IAka : purge, ingestion des pieces, chat en streaming.
// Separe de ariane.mjs qui porte le map-reduce : deux sujets, deux modules.
// Aucune dependance a ariane.mjs : une defaillance RAG ne doit jamais casser l'analyse.
//
// Journalisation : ce module ne journalise rien. Les pieces sont a diffusion
// restreinte — ni nom, ni cote, ni nom de fichier, ni contenu ne doit sortir en log.

const ragHeaders = (cfg) => ({ Authorization: `Bearer ${cfg.jwt}` });

// Garde-fou : sans corpus configure, aucune operation (a fortiori destructive) ne part.
function corpusRequis(cfg) {
  if (!cfg.ragCorpusId) throw new Error("ARIANE_RAG_INDISPONIBLE");
  return cfg.ragCorpusId;
}

// Deux capacites, deux surfaces d'API — a ne pas gouverner par un seul drapeau :
//  - ingestion (purge + ingestPiece) : REST RAG, sur l'hote des workflows (cfg.baseUrl) ;
//  - chat : endpoint OpenAI-compatible, sur son propre hote (cfg.ragBaseUrl) + un iak.
// Un deploiement peut donc indexer la procedure sans que l'onglet de dialogue soit
// ouvert ; c'est le cas nominal tant que l'iak de chat n'est pas provisionne.
//
// cfg.baseUrl ne figure volontairement PAS dans ragActif : l'hote des workflows est
// deja indispensable a l'analyse elle-meme, un pipeline qui tourne l'a forcement. L'y
// tester n'ajouterait aucune protection et desactiverait le RAG sur les configurations
// de test qui ne portent que les cles rag*. Son absence reelle est rattrapee par
// ARIANE_RAG_INGEST / ARIANE_RAG_PURGE, en best-effort.
export const ragActif = (cfg) => Boolean(cfg.ragCorpusId);

// Le corpus reste le garde-fou commun : sans lui, aucune capacite, purge comprise.
// Le modele fait partie des prerequis : l'endpoint exige le champ `model` et
// echouerait en 400 au milieu du flux si on le laissait vide. Mieux vaut un onglet
// grise avec sa raison qu'une question posee qui casse a la reponse.
export const chatActif = (cfg) => Boolean(cfg.ragCorpusId && cfg.ragBaseUrl && cfg.ragIakId && cfg.ragModel);

// SEUL point d'interpretation de la reponse de GET /rag/documents. Le format reel
// n'a pas encore ete observe sur l'API : si la forme differe, la correction tient ici.
// Fonction totale par contrat — toute forme inattendue donne [], jamais une exception.
// La severite est portee par purgeCorpus, qui distingue "corpus vide" de "je n'ai
// pas su lire la reponse" ; cette aide-la ne peut pas faire cette difference.
export function hashesDepuisListe(body) {
  const docs = documentsDepuisEnveloppe(body) ?? [];
  return docs.map((d) => d?.file_hash ?? d?.hash).filter((h) => typeof h === "string" && h !== "");
}

// Reconnait l'enveloppe de GET /rag/documents et renvoie le tableau de documents,
// ou null si la forme n'est pas interpretable. Le null est le signal dont purgeCorpus
// a besoin : il separe "corpus vide" ([]) de "enveloppe inconnue" (null), que la
// seule longueur de la liste de hashes confondrait.
function documentsDepuisEnveloppe(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.documents)) return body.documents;
  return null;
}

// Suppression unitaire, partagee par le chemin normal et le rattrapage : meme
// endpoint, meme code d'erreur, pour qu'aucun des deux ne soit plus permissif.
async function supprimerDocument({ cfg, corpusId, hash, fetchImpl }) {
  const q = encodeURIComponent(corpusId);
  const url = `${cfg.baseUrl}/rag/document?corpus_id=${q}&file_hash=${encodeURIComponent(hash)}`;
  const res = await fetchImpl(url, { method: "DELETE", headers: ragHeaders(cfg) });
  if (!res.ok) throw new Error("ARIANE_RAG_PURGE");
}

// Interroge GET /rag/documents et rend les hashes du corpus si — et seulement si — la
// reponse est exploitable de bout en bout ; null sinon.
//
// Predicat UNIQUE et partage, a dessein : il sert a la fois de declencheur du
// rattrapage (listing illisible au depart) et de preuve de sa reussite (listing
// retabli apres suppressions). Deux copies de cette logique finiraient par diverger,
// et la divergence se paierait par une purge declaree reussie sur un corpus pollue.
//
// Strict a dessein : le corpus etant dedie a Ariane, trop supprimer est le but
// recherche ; le seul vrai danger est de sous-supprimer puis d'ingerer, ce qui ferait
// repondre le chat sur deux procedures melangees. Toute reponse qu'on ne sait pas lire
// vaut donc « inexploitable », jamais « corpus vide ».
async function listerHashes({ cfg, corpusId, fetchImpl }) {
  const q = encodeURIComponent(corpusId);
  const res = await fetchImpl(`${cfg.baseUrl}/rag/documents?corpus_id=${q}`, {
    method: "GET",
    headers: ragHeaders(cfg),
  });
  if (!res.ok) return null; // 400 du defaut amont, 5xx, etc.
  let corps;
  try {
    corps = await res.json(); // page d'erreur HTML, corps vide : SyntaxError
  } catch {
    return null;
  }
  const docs = documentsDepuisEnveloppe(corps);
  if (docs === null) return null; // enveloppe non reconnue
  const hashes = hashesDepuisListe(docs);
  // Des documents mais pas autant de hashes : le champ qui porte le hash s'appelle
  // autrement. Supprimer le sous-ensemble lisible laisserait le corpus pollue.
  if (docs.length > 0 && hashes.length !== docs.length) return null;
  return hashes;
}

// DESTRUCTIF : supprime TOUS les documents du corpus, sans distinction d'origine, et
// definitivement cote IAka. Le corpus vise par IAKA_RAG_CORPUS_ID doit etre dedie a la
// demo Ariane. N'est jamais appelee implicitement par une autre fonction du module.
// `delaiSondeMs` n'existe que pour les tests : il rend l'expiration d'une sonde
// observable sans attendre dix secondes. La production garde toujours le defaut.
export async function purgeCorpus({ cfg, fetchImpl = globalThis.fetch, delaiSondeMs = DELAI_SONDE_MS }) {
  const corpusId = corpusRequis(cfg); // leve avant tout appel reseau
  const hashes = await listerHashes({ cfg, corpusId, fetchImpl });
  // Listing inexploitable : on ne se resigne pas tout de suite, on tente le rattrapage
  // decrit plus bas. Il leve le meme ARIANE_RAG_PURGE s'il echoue : le §7 (aucune
  // ingestion, onglet grise) reste le dernier rempart, on ne fait qu'ajouter une
  // chance de s'en passer.
  if (hashes === null) return purgerParRetriever({ cfg, corpusId, fetchImpl, delaiSondeMs });
  // A partir d'ici le listing est exploitable : chemin normal, inchange. Le retriever
  // n'est pas sollicite, et un echec de suppression leve comme avant.
  for (const hash of hashes) {
    await supprimerDocument({ cfg, corpusId, hash, fetchImpl });
  }
  return hashes.length;
}

// --- Rattrapage de purge par le retriever ------------------------------------
//
// RAISON D'ETRE — defaut AMONT, a supprimer des qu'il sera corrige cote IAka :
// POST /rag/ingest repond 200 mais laisse dans le corpus des documents que
// GET /rag/documents ne sait plus serialiser ; le listing repond alors 400
// (validation Pydantic, corpus_id et page_no manquants). Notre requete d'ingestion
// est pourtant conforme au contrat documente. Sans ce contournement, la purge du
// lancement suivant echoue, donc plus rien n'est ingere, donc le chat est mort des
// la deuxieme demonstration. POST /rag/retriever, lui, continue de repondre 200 sur
// un corpus dont le listing echoue, et ses elements portent le file_hash necessaire
// a la suppression. Ce chemin n'a aucune autre justification : quand le defaut amont
// sera corrige, tout ce bloc doit disparaitre.
//
// L'ENUMERATION PAR LE RETRIEVER N'EST PAS FIABLE, ET NE PEUT PAS L'ETRE : c'est une
// recherche par similarite, pas un inventaire. Le resultat depend entierement de la
// formulation. Mesure sur le corpus reel, alors que des documents y subsistaient :
//   prompt "document"                           -> 0 element,  0 hash
//   prompt "liste tous les documents du corpus" -> 3 elements, 1 hash
//   prompt "proces-verbal audition"             -> 3 elements, 1 hash
// Un unique prompt generique a donc conclu « corpus vide », rendu un succes a zero
// suppression et autorise l'ingestion : faux succes, chat repondant sur deux
// procedures melangees. Deux mesures en decoulent.
//
// 1. Plusieurs prompts varies a chaque tour, dont on fait l'union, pour ne pas
//    dependre d'une formulation unique. Ils sont choisis dans le vocabulaire des
//    pieces de procedure, la ou la similarite a une chance d'accrocher.
// 2. Surtout : LE SUCCES DU RATTRAPAGE N'EST PLUS PRONONCE PAR L'EPUISEMENT DU
//    RETRIEVER, MAIS PAR LE RETABLISSEMENT DU LISTING. C'est le coeur de la
//    correction. GET /rag/documents echoue PRECISEMENT a cause des documents
//    malformes laisses par le defaut amont ; son retour a une reponse exploitable est
//    donc une preuve INDEPENDANTE de leur disparition — verifie a la main : apres
//    suppression du dernier document restant, le listing repasse a 200. C'est ce qui
//    rend ce chemin sur malgre une enumeration qui ne l'est pas : on emprunte au
//    retriever ses hashes (il est bon a designer ce qu'il trouve), jamais son verdict
//    de vacuite (il est incapable de prouver qu'il ne reste rien).
//
// Corollaire du meme raisonnement : un tour sans aucun hash ne prouve rien. En mode
// degrade on ne peut pas distinguer « le corpus est vide » de « la similarite n'a
// rien trouve ». Si le premier tour ne remonte rien, on leve.
//
// 3. LES SONDES SONT REDONDANTES, DONC L'ECHEC DE L'UNE N'EST PAS FATAL. Chacune des
//    formulations ci-dessous cherche LE MEME corpus sous un angle different ; ce sont
//    des angles d'attaque concurrents, pas les etapes d'une procedure ou chaque etape
//    conditionnerait la suivante. Ce que les autres ont ramene reste donc vrai et
//    exploitable quand l'une tombe. Mesure sur un corpus reel de 12 documents :
//      "liste tous les documents du corpus"  -> 200, 19 fragments
//      "proces-verbal audition"              -> 200, 22 fragments
//      "plainte victime temoin"              -> 200, 16 fragments
//      "garde a vue perquisition"            -> 200, 18 fragments
//      "bordereau transport constatations"   -> 500, apres 21 secondes
//      union des quatre premieres            -> les 12 documents
//    Traiter la cinquieme comme fatale jetait les douze hashes et levait : purge en
//    echec, ingestion bloquee, onglet de questions inaccessible — alors que toute
//    l'information necessaire etait la. Une sonde en echec est donc simplement
//    ignoree. LE SEUL CAS OU L'ON IGNORE VRAIMENT LE CONTENU DU CORPUS EST CELUI OU
//    AUCUNE SONDE N'A REPONDU : la, et la seulement, on ne sait rien et on leve.
//    A ne pas confondre avec le corollaire ci-dessus : des sondes qui repondent
//    toutes sans rien remonter (union vide) restent regies par la regle « zero
//    resultat n'est pas une preuve de vacuite ».
const PROMPTS_RATTRAPAGE = [
  "liste tous les documents du corpus",
  "proces-verbal audition",
  "plainte victime temoin",
  "garde a vue perquisition",
  "bordereau transport constatations",
];
// Plafond bas assume : chaque tour est desormais cinq fois plus large qu'avant, et le
// signal d'arret est le listing, pas l'epuisement. Au-dela, on refuse d'ingerer.
const TOURS_MAX_RATTRAPAGE = 4;
// Delai maximal accorde a une sonde. Mesure sur l'API : une sonde a mis 21 secondes
// avant de rendre son 500. Cinq sondes par tour et jusqu'a quatre tours, et la purge
// — qui precede l'analyse et la bloque — devient interminable. Au-dela de ce delai la
// sonde est abandonnee, ce qui la ramene simplement au cas « sonde en echec » traite
// ci-dessus : les autres suffisent, et le pire cas de duree redevient borne.
const DELAI_SONDE_MS = 10_000;

// Une sonde : rend les file_hash distincts des elements renvoyes, ou `null` si elle
// a echoue, quelle qu'en soit la raison (transport, statut, corps illisible, forme
// non reconnue, expiration du delai). Le `null` n'est PAS une liste vide : il dit
// « cette sonde n'a rien appris », la ou `[]` dit « cette sonde a repondu qu'elle ne
// trouvait rien ». C'est l'appelant qui tranche la severite, avec la vue d'ensemble
// du tour ; une sonde isolee ne peut pas le faire.
async function hashesPourPrompt({ cfg, corpusId, prompt, fetchImpl, delaiSondeMs }) {
  let res;
  try {
    res = await fetchImpl(`${cfg.baseUrl}/rag/retriever`, {
      method: "POST",
      headers: { ...ragHeaders(cfg), "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, corpus_ids: [corpusId], history: [] }),
      // Natif Node, sans dependance. Les doubles de test qui ignorent `signal` ne
      // sont pas genes : c'est une option de plus dans `init`, jamais un prerequis.
      signal: AbortSignal.timeout(delaiSondeMs),
    });
  } catch {
    return null; // expiration du delai, coupure reseau
  }
  if (!res.ok) return null;
  let corps;
  try {
    corps = await res.json();
  } catch {
    return null;
  }
  const elements = Array.isArray(corps) ? corps : documentsDepuisEnveloppe(corps);
  if (elements === null) return null; // forme non reconnue
  const hashes = [];
  for (const e of elements) {
    // Forme observee : le hash vit dans metadata ; le repli couvre une remontee a plat.
    // Rien d'autre de `metadata` n'est lu ni journalise : elle porte la cote, donc
    // l'etat civil. Seul le hash sort d'ici.
    const h = e?.metadata?.file_hash ?? e?.file_hash;
    if (typeof h === "string" && h !== "") hashes.push(h);
  }
  return hashes;
}

// Un tour complet : toutes les sondes, union des hashes. Aucun court-circuit, ni au
// succes ni a l'echec — une sonde qui rend deja des hashes ne dispense pas
// d'interroger les suivantes (c'est la couverture croisee qui compense la
// similarite), et une sonde qui tombe n'interrompt pas les suivantes (elles portent
// la meme information sous un autre angle).
//
// Rend `null` si et seulement si AUCUNE sonde n'a repondu : le tour n'a alors rien
// appris du corpus. Rend la liste — eventuellement vide — des qu'au moins une a
// repondu. Ces deux cas ne doivent jamais etre confondus : ils n'ont pas la meme
// severite chez l'appelant.
async function hashesDepuisRetriever({ cfg, corpusId, fetchImpl, delaiSondeMs }) {
  const hashes = new Set();
  let auMoinsUneReponse = false;
  for (const prompt of PROMPTS_RATTRAPAGE) {
    const trouves = await hashesPourPrompt({ cfg, corpusId, prompt, fetchImpl, delaiSondeMs });
    if (trouves === null) continue; // sonde en echec : ignoree, les autres restent valables
    auMoinsUneReponse = true;
    for (const h of trouves) hashes.add(h);
  }
  return auMoinsUneReponse ? [...hashes] : null;
}

// Boucle « interroger, supprimer, verifier le listing ». Le seul arret en succes est
// le retablissement du listing ; toutes les autres sorties levent ARIANE_RAG_PURGE,
// et la regle absolue « purge en echec => aucune ingestion » s'applique alors.
async function purgerParRetriever({ cfg, corpusId, fetchImpl, delaiSondeMs }) {
  const supprimes = new Set();
  for (let tour = 0; tour < TOURS_MAX_RATTRAPAGE; tour += 1) {
    const hashes = await hashesDepuisRetriever({ cfg, corpusId, fetchImpl, delaiSondeMs });
    // Tour entierement muet : le listing est inexploitable ET aucune sonde n'a
    // repondu. Plus aucune source ne nous renseigne sur le corpus, a n'importe quel
    // tour — continuer reviendrait a supprimer a l'aveugle ou a conclure sans preuve.
    if (hashes === null) throw new Error("ARIANE_RAG_PURGE");
    // Premier tour sans hash, mais des sondes qui ont bien repondu : le listing est
    // inexploitable ET la similarite ne trouve rien. Aucune des deux sources ne peut
    // affirmer que le corpus est vide, donc personne ne le peut. On leve — surtout
    // pas un succes a zero suppression.
    if (tour === 0 && hashes.length === 0) throw new Error("ARIANE_RAG_PURGE");
    for (const hash of hashes) {
      if (supprimes.has(hash)) continue; // deja traite : on ne resupprime pas
      await supprimerDocument({ cfg, corpusId, hash, fetchImpl });
      supprimes.add(hash);
    }
    // La preuve independante. Placee apres les suppressions du tour, elle vaut aussi
    // garantie de non-redondance : des qu'elle est acquise, aucun tour supplementaire.
    if ((await listerHashes({ cfg, corpusId, fetchImpl })) !== null) return supprimes.size;
  }
  // Plafond atteint sans que le listing soit retabli : des documents subsistent, ou
  // bien on ne peut pas prouver le contraire — ce qui revient au meme ici.
  throw new Error("ARIANE_RAG_PURGE");
}

// Ingere une piece. Reutilise le buffer deja en memoire pour le MAP : cout quasi nul.
export async function ingestPiece({ file, cote, cfg, fetchImpl = globalThis.fetch }) {
  const corpusId = corpusRequis(cfg);
  const form = new FormData();
  // Une piece sans base64 ferait lever un TypeError, hors taxonomie ARIANE_RAG_*.
  // L'ingestion est best-effort, mais le code qui sort doit etre celui annonce.
  let bytes;
  try {
    bytes = Buffer.from(file.base64, "base64");
  } catch {
    throw new Error("ARIANE_RAG_INGEST");
  }
  form.append("file", new Blob([bytes], { type: file.mime || "application/pdf" }), file.filename || `${cote}.pdf`);
  form.set("corpus_id", corpusId);
  form.set("url_source", `ariane://${cote}`);
  // Metadonnees de document derivees du XML LRPGN, deja parse et normalise par le
  // front (src/features/ariane/metaXml.ts). Elles s'ajoutent a la cote, qui reste
  // inchangee et prevaut : elle est la cle qui relie la reponse du chat a la piece
  // du dossier, aucun champ venant du client ne doit pouvoir l'ecraser.
  // Ces metadonnees portent de l'etat civil : elles ne sont jamais journalisees.
  const document = file.meta?.document;
  const metadata = document && typeof document === "object" ? { ...document, cote } : { cote };
  form.set("metadata", JSON.stringify(metadata));
  const res = await fetchImpl(`${cfg.baseUrl}/rag/ingest`, {
    method: "POST",
    headers: ragHeaders(cfg),
    body: form,
  });
  if (!res.ok) throw new Error("ARIANE_RAG_INGEST");
  return true;
}

// Chat RAG : l'endpoint OpenAI-compatible fait la recherche et la generation, on ne
// gere que l'historique et le relais du flux. onDelta plutot que la reponse HTTP :
// le module reste testable sans socket, la route branche onDelta sur res.write.
export async function chatStream({ messages, cfg, fetchImpl = globalThis.fetch, onDelta }) {
  const corpusId = corpusRequis(cfg);
  const url = `${cfg.ragBaseUrl}/corpus/${corpusId}/iak/${cfg.ragIakId}/v1/chat/completions`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { ...ragHeaders(cfg), "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.ragModel,
      messages,
      temperature: 0.1,
      max_tokens: cfg.ragMaxTokens,
      stream: true,
    }),
  });
  // Echec avant le premier octet : rien n'est encore parti vers le client, la route
  // peut donc repondre un statut d'erreur en bonne et due forme.
  if (!res.ok || !res.body) throw new Error("ARIANE_RAG_CHAT");

  try {
    const decoder = new TextDecoder();
    let tampon = "";
    for await (const morceau of res.body) {
      tampon += decoder.decode(morceau, { stream: true });
      const lignes = tampon.split("\n");
      tampon = lignes.pop() ?? ""; // derniere ligne peut-etre incomplete : on la garde
      for (const ligne of lignes) {
        if (!ligne.startsWith("data:")) continue; // commentaires SSE, lignes vides
        const data = ligne.slice(5).trim();
        if (data === "[DONE]") return;
        // Le try ne couvre que l'analyse : si onDelta levait ici (ecriture sur un
        // client deconnecte), la coupure serait avalee comme un keep-alive et on
        // continuerait a vider l'amont dans le vide. Il doit remonter au catch
        // exterieur, qui arrete le relais.
        let delta;
        try {
          delta = JSON.parse(data).choices?.[0]?.delta?.content;
        } catch {
          continue; // trame non-JSON (keep-alive) : ignoree
        }
        if (delta) onDelta(delta);
      }
    }
  } catch {
    // Coupure en cours de flux : les deltas deja passes par onDelta restent acquis
    // cote client, seule la suite manque. On traduit dans la taxonomie ARIANE_RAG_*
    // pour que la route emette un evenement d'erreur exploitable au lieu de fermer
    // brutalement. La cause d'origine est volontairement abandonnee : son message
    // peut porter des octets du flux, donc du texte de procedure.
    throw new Error("ARIANE_RAG_CHAT");
  }
}
