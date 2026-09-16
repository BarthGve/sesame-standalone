// Pipeline map-reduce du cas d'usage Ariane (analyse de procédure judiciaire).
// Voir docs/superpowers/specs/2026-07-19-ariane-design.md et docs/iaka-ariane-workflow.md.

import { randomUUID } from "node:crypto";
import { parseNomFichier, cleNoyau, fusionnerMentions, rangRole, normaliserRole, naissancesCompatibles } from "./pieceMeta.mjs";
import { ragActif, purgeCorpus, ingestPiece } from "./ariane-rag.mjs";

// Déballe la sortie brute d'une exécution IAka en objet JSON :
// retire les traces <tool>…</tool>, une éventuelle fence ```json, puis parse
// du premier '{' au dernier '}'.
export function extractJson(result) {
  if (typeof result !== "string" || !result.trim()) throw new Error("ARIANE_INVALIDE");
  let text = result.replace(/<tool>[\s\S]*?<\/tool>/gi, "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("ARIANE_INVALIDE");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("ARIANE_INVALIDE");
  }
}

const ROLES = new Set(["mis_en_cause", "victime", "temoin", "enqueteur", "requis", "magistrat", "autre"]);
const TYPES_ACTE = new Set(["audition", "constatation", "perquisition", "requisition", "gav", "transport", "soit_transmis", "autre"]);
// "auteur_victime" exprime la relation centrale d'un dossier penal — qui a commis
// quoi sur qui. Le sens va toujours de l'auteur (source) vers la victime (cible).
const TYPES_REL = new Set(["famille", "complice", "connait", "victime_de", "auteur_victime", "entendu_par", "requis_par", "autre"]);

// Destine a l'ecran, meme regle de diffusion que les avertissements de pieceMeta.mjs :
// les pieces sont a diffusion restreinte. Le type est un code, il peut etre nomme ;
// ni la personne, ni la cote, ni le libelle de la relation ne doivent apparaitre.
export const avertissementTypeRelInconnu = (type) => `Type de relation inconnu : ${type}`;

// Meme principe que normaliserRole : un type hors vocabulaire vaut "autre" et
// l'utilisateur est averti. Sans ce filet, validateContract leverait ARIANE_INVALIDE
// et l'analyse de tout le dossier serait perdue pour un seul type invente par le LLM.
// Le libelle de la relation, lui, n'est jamais touche : c'est lui qui porte le sens,
// et il reste lisible meme quand le type est reclasse.
export function normaliserTypeRel(type, onAvertissement = () => {}) {
  if (TYPES_REL.has(type)) return type;
  onAvertissement(avertissementTypeRelInconnu(type));
  return "autre";
}

// Meme filet que normaliserRole / normaliserTypeRel, appliqué au type d'acte : le MAP
// invente régulièrement des types hors vocabulaire (« prelevement », « expertise »,
// « bordereau »…) pour les cotes atypiques. Sans ce reclassement en "autre", validateContract
// lèverait ARIANE_INVALIDE et TOUTE l'analyse serait perdue pour un seul acte mal étiqueté.
// Le libellé de l'acte n'est jamais touché : il reste lisible même quand le type est reclassé.
export const avertissementTypeActeInconnu = (type) => `Type d'acte inconnu : ${type}`;
export function normaliserTypeActe(type, onAvertissement = () => {}) {
  if (TYPES_ACTE.has(type)) return type;
  onAvertissement(avertissementTypeActeInconnu(type));
  return "autre";
}

const PRECISIONS = new Set(["annee", "mois", "jour", "heure"]);
// Précision hors vocabulaire (le MAP peut écrire « date », « minute »…) : on retombe sur
// "jour", la granularité par défaut, plutôt que de faire échouer tout le dossier. Silencieux :
// c'est un détail d'affichage de la ligne de temps, sans action attendue de l'utilisateur.
const normaliserPrecision = (p) => (PRECISIONS.has(p) ? p : "jour");

// Filet de sécurité : le contrat est déjà cohérent par construction (assembleContract),
// on vérifie qu'aucun id n'est orphelin et qu'aucune enum n'est inconnue.
export function validateContract(contract) {
  // Ce filet ne doit plus jamais se déclencher : rôles, types d'acte, types de relation et
  // précisions sont tous bornés au vocabulaire par assembleContract. S'il se déclenche malgré
  // tout, c'est un vrai défaut de cohérence — on trace la cause (codes d'enum et ids seulement,
  // aucun contenu de pièce) pour ne pas répéter un ARIANE_INVALIDE opaque.
  const bad = (why) => { console.error(`[ariane] contrat invalide: ${why}`); throw new Error("ARIANE_INVALIDE"); };
  if (!Array.isArray(contract.parties)) bad("parties absent");
  if (!Array.isArray(contract.evenements)) bad("evenements absent");
  if (!Array.isArray(contract.actes)) bad("actes absent");
  if (!Array.isArray(contract.relations)) bad("relations absent");
  const ids = new Set();
  for (const p of contract.parties) {
    if (ids.has(p.id)) bad(`id partie en double: ${p.id}`);
    ids.add(p.id);
    if (!ROLES.has(p.role)) bad(`role hors vocabulaire: ${p.role}`);
  }
  const ref = (id, ou) => { if (!ids.has(id)) bad(`ref orpheline (${ou}): ${id}`); };
  for (const e of contract.evenements) {
    if (!PRECISIONS.has(e.precision)) bad(`precision hors vocabulaire: ${e.precision}`);
    e.parties.forEach((id) => ref(id, "evenement"));
  }
  for (const a of contract.actes) {
    if (!TYPES_ACTE.has(a.type)) bad(`type d'acte hors vocabulaire: ${a.type}`);
    if (a.redacteur != null) ref(a.redacteur, "acte.redacteur");
    a.concernes.forEach((id) => ref(id, "acte.concernes"));
  }
  for (const r of contract.relations) {
    if (!TYPES_REL.has(r.type)) bad(`type de relation hors vocabulaire: ${r.type}`);
    ref(r.source, "relation.source"); ref(r.cible, "relation.cible");
  }
  return contract;
}

// Construit l'agregat compact envoye au REDUCE. Chaque ref locale devient un
// identifiant global gref = "<cote>:<ref>". On ne pousse que personnes + relations
// lues (faits et meta-actes restent au BFF pour l'assemblage ss4.4).
export function buildAggregate(mapOutputs) {
  const mentions = [];
  const relations_lues = [];
  for (const p of mapOutputs) {
    for (const pers of p.personnes || []) {
      mentions.push({
        gref: `${p.cote}:${pers.ref}`, cote: p.cote, nom: pers.nom,
        aliases: pers.aliases || [], role_apparent: pers.role_apparent,
        naissance: pers.naissance ?? null, qualite: pers.qualite ?? null, adresse: pers.adresse ?? null,
      });
    }
    for (const r of p.relations_lues || []) {
      relations_lues.push({ de: `${p.cote}:${r.de}`, vers: `${p.cote}:${r.vers}`, type: r.type, libelle: r.libelle, cote: p.cote });
    }
  }
  // Les mentions dont la cle est exploitable partent au REDUCE deja regroupees :
  // il n'a plus a les rapprocher, seulement a les nommer et a les qualifier.
  const { groupes, sansCle, avertissements } = fusionnerMentions(mentions);
  const parGref = new Map(mentions.map((m) => [m.gref, m]));
  // Le regroupement doit enrichir la connaissance d'une personne, jamais l'appauvrir :
  // on reunit ce que chaque piece du groupe apporte plutot que de ne retenir que la
  // premiere mention rencontree et de jeter le reste.
  const premiereValeurNonVide = (membres, champ) => {
    for (const m of membres) {
      const v = m[champ];
      if (v !== null && v !== undefined && v !== "") return v;
    }
    return null;
  };
  const personnes = [
    ...groupes.map((g) => {
      const membres = g.membres.map((gref) => parGref.get(gref));
      const premiere = membres[0];
      const aliases = [];
      for (const m of membres) {
        for (const a of m.aliases || []) {
          if (!aliases.includes(a)) aliases.push(a);
        }
      }
      // cote et gref restent ceux de la premiere mention : ils identifient le
      // representant du groupe, pas une donnee metier a reunir.
      return { gref: g.membres[0], membres: g.membres, cote: premiere.cote, nom: g.nom,
        aliases, role_apparent: g.role,
        naissance: premiereValeurNonVide(membres, "naissance"),
        qualite: premiereValeurNonVide(membres, "qualite"),
        adresse: premiereValeurNonVide(membres, "adresse") };
    }),
    ...sansCle,
  ];
  // `avertissements` est destine a l'utilisateur, pas au LLM : runAriane le detache
  // avant d'envoyer l'agregat, dont la serialisation forme le prompt du REDUCE.
  return { personnes, relations_lues, avertissements };
}

// Assemble le contrat final §4.4 depuis les extractions MAP + la sortie REDUCE.
// Le LLM ne produit jamais les ids croisés : c'est ici, en code, qu'on les pose.
// `onAvertissement` est le canal utilisateur existant (runAriane → job.avertissements) :
// les types de relation hors vocabulaire y remontent, plutot que dans la journalisation,
// qui ne doit pas servir de canal d'interface.
export function assembleContract(mapOutputs, reduce, onAvertissement = () => {}) {
  // 1. table gref → party_id
  const parties0 = reduce.parties || [];
  const partyIds = new Set(parties0.map((p) => p.id));
  const grefToParty = new Map();
  for (const p of parties0) for (const g of p.membres || []) grefToParty.set(g, p.id);
  const refToParty = (cote, ref) => (ref == null ? null : grefToParty.get(`${cote}:${ref}`) ?? null);

  // 2. parties (sans membres). Le role est borne au vocabulaire des ici, donc pour
  // TOUTE partie du contrat final — y compris celles qu'aucun groupe calcule ne
  // touche (personne dont la cle de coreference est nulle, ou grefs inventes par le
  // REDUCE). Borner seulement le chemin groupe laisserait passer un "plaignant" ou
  // un "garde a vue" : validateContract leverait ARIANE_INVALIDE et l'analyse de
  // tout le dossier serait perdue pour un seul mot hors vocabulaire.
  const parties = parties0.map(({ membres, ...p }) => ({ ...p, role: normaliserRole(p.role) }));

  // Coreference calculee en code depuis les mentions d'origine, une seule fois :
  // elle sert a la fois a etendre le rattachement (ci-dessous) et a reconstituer
  // l'historique des roles, que le REDUCE ne produit pas (il ne voit qu'un role
  // par groupe). La naissance doit y figurer, sinon deux homonymes de dates
  // differentes formeraient un seul groupe et l'extension attribuerait les actes
  // de l'un a l'autre.
  const mentions = [];
  for (const p of mapOutputs) {
    for (const pers of p.personnes || []) {
      mentions.push({ gref: `${p.cote}:${pers.ref}`, cote: p.cote, nom: pers.nom,
        role_apparent: pers.role_apparent, naissance: pers.naissance ?? null });
    }
  }
  const groupeParGref = new Map();
  for (const g of fusionnerMentions(mentions).groupes) {
    for (const gref of g.membres) groupeParGref.set(gref, g);
  }
  // Role lu par le MAP pour chaque mention, borne au vocabulaire. Indexe par gref et
  // non par groupe : l'historique d'une partie se derive de SES grefs (voir plus bas),
  // pas de tout ce que ses groupes contiennent.
  const roleParGref = new Map(mentions.map((m) => [m.gref, { role: normaliserRole(m.role_apparent), cote: m.cote }]));
  // Les membres d'une partie peuvent relever de plusieurs groupes de coreference
  // distincts (le REDUCE regroupe parfois plus large que fusionnerMentions) : on
  // retient tous ces groupes plutot que le premier seulement.
  const groupesTouchesPar = (membres) => {
    const vus = new Set();
    const touches = [];
    for (const gref of membres || []) {
      const g = groupeParGref.get(gref);
      if (g && !vus.has(g)) { vus.add(g); touches.push(g); }
    }
    return touches;
  };
  const groupesParPartie = parties0.map((p) => groupesTouchesPar(p.membres));

  // Le REDUCE ne renvoie que les grefs de la liste qu'il a recue, or l'agregat ne
  // lui expose qu'un gref representant par groupe : s'en tenir a sa reponse laisse
  // les evenements et actes des autres cotes sans partie, alors que la fiche de la
  // partie affiche bien ces cotes. On etend donc le rattachement aux grefs des
  // groupes touches. Un gref deja rattache n'est jamais reattribue : le rattachement
  // du REDUCE prime, ce qui empeche l'extension de refusionner deux parties qu'il a
  // deliberement separees.
  //
  // Reste a departager les grefs d'un groupe que personne ne revendique. Les donner
  // a la premiere partie rencontree ferait dependre le titulaire des actes de l'ordre
  // de sortie du LLM. La regle est donc fondee sur le contenu : le gref libre revient
  // a la partie qui detient deja le plus de grefs revendiques de CE groupe ; a
  // egalite, a celle dont l'id est le plus petit en ordre lexicographique.
  const partiesParGroupe = new Map();
  parties0.forEach((p, i) => {
    for (const g of groupesParPartie[i]) {
      let ids = partiesParGroupe.get(g);
      if (!ids) { ids = []; partiesParGroupe.set(g, ids); }
      if (!ids.includes(p.id)) ids.push(p.id);
    }
  });
  for (const [g, ids] of partiesParGroupe) {
    // Les revendications comptees ici sont celles du REDUCE seul : les groupes etant
    // disjoints, aucune attribution faite pour un autre groupe ne peut les fausser.
    const revendiques = (id) => g.membres.filter((gref) => grefToParty.get(gref) === id).length;
    const titulaire = [...ids].sort((a, b) => revendiques(b) - revendiques(a) || (a < b ? -1 : a > b ? 1 : 0))[0];
    for (const gref of g.membres) {
      if (!grefToParty.has(gref)) grefToParty.set(gref, titulaire);
    }
  }

  // L'historique des roles se derive du rattachement FINAL, gref par gref, et non des
  // groupes touches : quand le REDUCE scinde un groupe en deux parties, chacune ne
  // porte que les roles des cotes qui lui reviennent reellement. Deriver des groupes
  // entiers donnerait a une partie temoin en D3 un "mis_en_cause en D9" — une cote a
  // laquelle ni acte ni evenement ne la rattache. Une partie qui touche plusieurs
  // groupes reunit bien les roles de tous ses grefs, quel que soit leur groupe.
  // On parcourt les grefs par les groupes touches : une mention sans cle de
  // coreference n'appartient a aucun groupe et ne fonde donc aucun role.
  parties.forEach((partie, i) => {
    const groupesTouches = groupesParPartie[i];
    if (groupesTouches.length === 0) return;
    const clesVues = new Set();
    const roles = [];
    for (const g of groupesTouches) {
      for (const gref of g.membres) {
        if (grefToParty.get(gref) !== partie.id) continue;
        const r = roleParGref.get(gref);
        if (!r) continue;
        const cle = `${r.role}|${r.cote}`;
        if (!clesVues.has(cle)) { clesVues.add(cle); roles.push(r); }
      }
    }
    if (roles.length === 0) return; // aucun gref ne lui revient : rien a documenter
    partie.roles = roles;
    // L'ensemble calcule ne prime que lorsqu'il apporte une information. Si le MAP
    // n'a qualifie la personne dans aucune piece, tous ses roles valent "autre" :
    // ecraser avec cet ensemble effacerait le verdict du REDUCE — qui, lui, a lu la
    // procedure — et basculerait la partie dans le groupe "Autres" a l'ecran. On
    // garde alors le role du REDUCE, deja borne au vocabulaire ci-dessus.
    // Sinon, ordre d'engagement recalcule sur l'ensemble reuni, pas le choix du REDUCE.
    if (roles.some((r) => r.role !== "autre")) {
      partie.role = [...roles].sort((a, b) => rangRole(a.role) - rangRole(b.role))[0].role;
    }
  });

  // 3. événements ← faits
  const evenements = [];
  for (const piece of mapOutputs) {
    for (const f of piece.faits || []) {
      if (!f.date) continue;
      const ps = [...new Set((f.personnes_refs || []).map((r) => refToParty(piece.cote, r)).filter(Boolean))];
      evenements.push({ id: `e${evenements.length + 1}`, date: f.date, precision: normaliserPrecision(f.precision), libelle: f.libelle, cote_source: piece.cote, parties: ps });
    }
  }

  // 4. actes ← méta-acte de chaque pièce
  const actes = [];
  for (const piece of mapOutputs) {
    const a = piece.acte;
    if (!a) continue;
    actes.push({ id: `a${actes.length + 1}`, date: a.date, type: normaliserTypeActe(a.type, onAvertissement), cote: piece.cote, libelle: a.libelle,
      redacteur: refToParty(piece.cote, a.redacteur_ref),
      concernes: [...new Set((a.concernes_refs || []).map((r) => refToParty(piece.cote, r)).filter(Boolean))] });
  }

  // 5. relations : lues (REDUCE) + procédurales dérivées, fusion par clé source|cible|type
  const relByKey = new Map();
  const addRel = (r) => {
    const k = `${r.source}|${r.cible}|${r.type}`;
    const cur = relByKey.get(k);
    if (cur) cur.cotes = [...new Set([...cur.cotes, ...r.cotes])];
    else relByKey.set(k, { source: r.source, cible: r.cible, type: r.type, libelle: r.libelle, cotes: [...r.cotes] });
  };
  for (const r of reduce.relations || []) {
    // Normalisation ici et non dans addRel : les relations procedurales ci-dessous
    // sont derivees en code, donc valides par construction — elles ne doivent produire
    // aucun avertissement. Seul le type change, le libelle et les cotes sont intacts.
    if (partyIds.has(r.source) && partyIds.has(r.cible)) { // ignore best-effort les ids orphelins
      addRel({ ...r, type: normaliserTypeRel(r.type, onAvertissement) });
    }
  }
  const PROC = { audition: "entendu_par", requisition: "requis_par" };
  for (const piece of mapOutputs) {
    const a = piece.acte;
    const type = a && PROC[a.type];
    if (!type) continue;
    const red = refToParty(piece.cote, a.redacteur_ref);
    if (!red) continue;
    for (const ref of a.concernes_refs || []) {
      const c = refToParty(piece.cote, ref);
      if (c && c !== red) addRel({ source: c, cible: red, type, libelle: type === "entendu_par" ? "entendu par" : "requis par", cotes: [piece.cote] });
    }
  }
  const relations = [...relByKey.values()];

  // 6. affaire : periode (min/max) + nb_cotes (cotes distinctes)
  const dates = [...evenements.map((e) => e.date), ...actes.map((a) => a.date)].filter(Boolean).sort();
  const cotes = new Set(mapOutputs.map((p) => p.cote));
  const affaire = { ...reduce.affaire, periode: { debut: dates[0] ?? null, fin: dates[dates.length - 1] ?? null }, nb_cotes: cotes.size };

  return { affaire, synthese: reduce.synthese, parties, evenements, actes, relations };
}

// Applique les metadonnees deterministes a une extraction. Le LLM n'est jamais
// autoritaire sur les champs que le nom de fichier fournit (spec §3.2) : on ecrase.
// Rien n'est supprime — une personne du nom de fichier absente de l'extraction est
// ajoutee plutot que de faire disparaitre celles que le LLM a vues.
export function appliquerMeta(out, meta) {
  if (!meta) return out;
  if (out.acte) {
    // "autre" signifie ici « le nom de fichier ne nous apprend rien » (gabarit
    // inconnu), pas « c'est effectivement autre chose ». Une valeur inconnue
    // n'est pas une valeur certaine : elle ne peut donc pas ecraser un type
    // que le LLM a peut-etre correctement devine en lisant la piece.
    if (meta.typeActe !== "autre") out.acte.type = meta.typeActe;
    out.acte.date = meta.date;
  }
  const cleMeta = cleNoyau(`${meta.nom} ${meta.prenom}`);
  // cleNoyau(null) survient pour un nom reduit a des initiales. Si on comparait
  // sans garde, deux noyaux nuls (celui du fichier et celui d'une personne
  // extraite non identifiable) seraient juges egaux et apparies a tort : deux
  // personnes distinctes fusionnees, la faute la plus grave du domaine. On
  // n'apparie donc que sur une cle non nulle, et jamais sur null === null.
  const existante = cleMeta ? (out.personnes || []).find((p) => cleNoyau(p.nom) === cleMeta) : null;
  if (existante) {
    // Meme raisonnement que pour typeActe : un role inconnu ("autre") n'est
    // pas une information certaine, il ne peut donc pas ecraser un role que
    // le LLM a devine.
    if (meta.role !== "autre") existante.role_apparent = meta.role;
  } else {
    // La personne du fichier est ajoutee dans tous les cas — rien n'est perdu —
    // meme quand son role n'est pas exploitable (elle part alors avec "autre").
    out.personnes = [...(out.personnes || []),
      { ref: `meta_${cleMeta}`, nom: `${meta.nom} ${meta.prenom}`, role_apparent: meta.role, aliases: [] }];
  }
  return out;
}

// Applique l'etat civil issu du XML LRPGN embarque dans la piece. Applique APRES
// appliquerMeta pour que le XML l'emporte sur le nom de fichier (spec §3.2).
//
// Ce que le XML apporte seul : la date de naissance, discriminant de la cle de
// coreference. C'est elle qui empeche deux homonymes d'etre confondus.
//
// Comme pour le nom de fichier, une valeur absente ou inconnue n'ecrase rien : elle
// ne nous apprend rien, elle ne peut donc pas primer sur ce que le LLM a lu.
// Destine a l'ecran, meme regle de diffusion que les avertissements de pieceMeta.mjs :
// les pieces sont a diffusion restreinte, le libelle ne nomme donc ni la personne, ni
// la piece, ni la date concernee.
export const AVERTISSEMENT_ETAT_CIVIL_AMBIGU =
  "Etat civil non attribuable : plusieurs personnes du meme nom dans une piece";

export function appliquerMetaXml(out, metaXml, onAvertissement = () => {}) {
  if (!metaXml || !Array.isArray(metaXml.personnes)) return out;
  // Les personnes extraites par le LLM, figees avant la boucle : une entree du XML
  // ne s'apparie qu'a une extraction, jamais a une personne qu'une autre entree du
  // XML vient d'ajouter. Deux entrees du XML sont deux personnes de l'etat civil,
  // les apparier entre elles en ferait disparaitre une.
  const extraites = [...(out.personnes || [])];
  const dejaAppariees = new Set();
  metaXml.personnes.forEach((pers, i) => {
    const cle = cleNoyau(`${pers.nom} ${pers.prenom}`);
    if (!cle) return; // pas de cle exploitable : on n'apparie sur rien
    // Le noyau du nom ne suffit pas : c'est la naissance que le XML apporte qui
    // discrimine deux homonymes dans fusionnerMentions. Apparier sans elle
    // reviendrait a ecraser le discriminant qu'on est cense alimenter — soit en
    // faisant disparaitre un homonyme, soit en detruisant une date que le MAP
    // avait correctement lue. On applique donc ici la regle de fusionnerMentions.
    const candidats = extraites.filter((p) => !dejaAppariees.has(p)
      && cleNoyau(p.nom) === cle
      && naissancesCompatibles(p.naissance, pers.naissance));
    if (candidats.length > 1) {
      // Plusieurs extractions du meme nom qu'aucune date ne separe : rien ne dit
      // laquelle est celle du XML. Dans le doute, on ne fusionne pas — on n'attribue
      // l'etat civil a aucune, et l'utilisateur est averti plutot que de voir le
      // rattachement se jouer sur l'ordre de sortie du LLM.
      onAvertissement(AVERTISSEMENT_ETAT_CIVIL_AMBIGU);
      return;
    }
    const existante = candidats[0];
    if (existante) {
      // Une seule entree du XML alimente une personne extraite donnee.
      dejaAppariees.add(existante);
      if (pers.naissance) existante.naissance = pers.naissance;
      if (pers.role && pers.role !== "autre") existante.role_apparent = pers.role;
    } else {
      out.personnes = [...(out.personnes || []), {
        // La ref doit rester unique dans la piece : `xml_${cle}` collisionnerait
        // pour un pere et son fils, dont le noyau du nom est le meme.
        ref: `xml_${cle}_${i}`, nom: `${pers.nom} ${pers.prenom}`.trim(),
        role_apparent: pers.role || "autre", aliases: [],
        naissance: pers.naissance || null,
      }];
    }
  });
  return out;
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Les pieces d'une procedure sont a diffusion restreinte : on ne dump jamais de
// contenu dans les logs par defaut (meme regle qu'proxy.mjs pour les FRS). Seules
// les metadonnees sortent ; les corps de reponse exigent ARIANE_DEBUG=1.
const debugContenu = () => process.env.ARIANE_DEBUG === "1";

// Diagnostic : ARIANE_UPSTREAM est un code opaque cote front et n'est pas logge
// par proxy.mjs (il est dans ERROR_STATUS). On trace ici la cause reelle.
async function logUpstream(etape, res) {
  let detail = "";
  if (debugContenu()) {
    try {
      detail = ` ${(await res.text()).slice(0, 500)}`;
    } catch {
      detail = " <illisible>";
    }
  }
  console.error(`[ariane] ${etape} HTTP ${res.status}${detail}`);
}

// Poll commun : attend le result brut d'une exécution IAka.
async function pollResult({ executionId, cfg, fetchImpl, sleep, headers, etape = "poll" }) {
  const statusTpl = cfg.statusPath || "/workflows/executions/{id}";
  const statusUrl = `${cfg.baseUrl}${statusTpl.replace("{id}", executionId)}?tenant_id=${cfg.tenantId}`;
  const startMs = Date.now();
  while (Date.now() - startMs <= cfg.pollTimeoutMs) {
    const res = await fetchImpl(statusUrl, { method: "GET", headers });
    if (!res.ok) {
      await logUpstream(`${etape}/status`, res);
      throw new Error("ARIANE_UPSTREAM");
    }
    const body = await res.json();
    if (body.status === "SUCCESS") return body.result;
    if (body.status === "ERROR") {
      console.error(`[ariane] ${etape} exec ${executionId} ERROR: ${String(body.error ?? "").slice(0, 200)}`);
      // L'ingestion du fichier (indexation en amont de l'agent, avant tout nœud) échoue par
      // intermittence côté IAka (« Ingestion failed / not completed »). C'est transitoire, aucune
      // extraction n'a été faite : erreur DISTINCTE et réessayable, comme sur pvtcmp. Seule une
      // nouvelle exécution relance l'ingestion (un nœud Boucle ne rattrape pas un ERROR d'exécution).
      if (/ingestion/i.test(JSON.stringify(body))) throw new Error("ARIANE_INGESTION");
      throw new Error("ARIANE_UPSTREAM");
    }
    await sleep(cfg.pollIntervalMs);
  }
  console.error(`[ariane] ${etape} exec ${executionId} TIMEOUT apres ${cfg.pollTimeoutMs}ms`);
  throw new Error("ARIANE_TIMEOUT");
}

// MAP : une pièce PDF → extraction (schéma §4.1). La cote est stampée par le BFF.
export async function runExtraction({ file, cote, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  const auth = { Authorization: `Bearer ${cfg.jwt}` };
  const execPath = cfg.executePath || "/workflows/execute";
  const form = new FormData();
  form.set("app_id", cfg.arianeExtractionAppId);
  form.set("tenant_id", cfg.tenantId);
  const bytes = Buffer.from(file.base64, "base64");
  form.append("file", new Blob([bytes], { type: file.mime || "application/pdf" }), file.filename || `${cote}.pdf`);
  const execRes = await fetchImpl(`${cfg.baseUrl}${execPath}`, { method: "POST", headers: auth, body: form });
  if (!execRes.ok) {
    await logUpstream("map/execute", execRes);
    throw new Error("ARIANE_UPSTREAM");
  }
  const { execution_id } = await execRes.json();
  if (!execution_id) {
    console.error("[ariane] map/execute sans execution_id");
    throw new Error("ARIANE_UPSTREAM");
  }
  const result = await pollResult({ executionId: execution_id, cfg, fetchImpl, sleep, headers: auth, etape: "map" });
  let out;
  try {
    out = extractJson(result);
  } catch (e) {
    // Meme diagnostic que pour le REDUCE : la longueur et l'equilibre des accolades
    // distinguent un JSON tronque (desequilibre) d'une reponse en prose (0/0), sans
    // rien divulguer du contenu. La cote n'y figure pas : elle derive du nom de
    // fichier, qui porte l'etat civil.
    const s = typeof result === "string" ? result : JSON.stringify(result);
    const ouvrantes = (s.match(/{/g) || []).length;
    const fermantes = (s.match(/}/g) || []).length;
    console.error(`[ariane] map sortie non parsable: ${s.length} car, accolades ${ouvrantes}/${fermantes} (tronquee si desequilibre)`);
    if (debugContenu()) console.error(`[ariane] map debut|fin\n${s.slice(0, 400)}\n…\n${s.slice(-400)}`);
    throw e;
  }
  out.cote = cote; // BFF autoritaire sur la cote
  return out;
}

// REDUCE : agrégat compact (envoyé en prompt) → parties/relations/synthèse (schéma §4.3).
export async function runConsolidation({ aggregate, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  const headers = { Authorization: `Bearer ${cfg.jwt}`, "Content-Type": "application/json" };
  const execPath = cfg.executePath || "/workflows/execute";
  const prompt = JSON.stringify(aggregate);
  console.error(`[ariane] reduce prompt ${prompt.length} car, ${aggregate.personnes.length} personnes, ${aggregate.relations_lues.length} relations`);
  const payload = { app_id: cfg.arianeConsolidationAppId, tenant_id: cfg.tenantId, prompt, langue: "fr" };
  const execRes = await fetchImpl(`${cfg.baseUrl}${execPath}`, { method: "POST", headers, body: JSON.stringify(payload) });
  if (!execRes.ok) {
    await logUpstream("reduce/execute", execRes);
    throw new Error("ARIANE_UPSTREAM");
  }
  const { execution_id } = await execRes.json();
  if (!execution_id) {
    console.error("[ariane] reduce/execute sans execution_id");
    throw new Error("ARIANE_UPSTREAM");
  }
  const result = await pollResult({ executionId: execution_id, cfg, fetchImpl, sleep, headers, etape: "reduce" });
  try {
    return extractJson(result);
  } catch (e) {
    // Sortie REDUCE non parsable. La longueur + l'equilibre des accolades suffisent a
    // distinguer une troncature d'un preambule du LLM, sans dumper de contenu.
    const s = typeof result === "string" ? result : JSON.stringify(result);
    const ouvrantes = (s.match(/{/g) || []).length;
    const fermantes = (s.match(/}/g) || []).length;
    console.error(`[ariane] reduce sortie non parsable: ${s.length} car, accolades ${ouvrantes}/${fermantes} (tronquee si desequilibre)`);
    if (debugContenu()) console.error(`[ariane] reduce debut|fin\n${s.slice(0, 400)}\n…\n${s.slice(-400)}`);
    throw e;
  }
}

// Exécute un pool de tâches avec une concurrence bornée.
async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

const coteFromFilename = (name, i) => (name ? name.replace(/\.[^.]+$/, "") : `piece-${i + 1}`);

// Orchestration complète : normalisation → purge RAG → MAP fan-out (best-effort, avec
// ingestion RAG en parallèle) → agrégat → REDUCE → assemblage → validation.
// deps injectables pour les tests.
export async function runAriane({ files, cfg, fetchImpl = globalThis.fetch, sleep = defaultSleep, onProgress = () => {}, onPieceIgnoree = () => {}, onAvertissement = () => {}, onRag = () => {}, deps = {} }) {
  const extract = deps.runExtraction || runExtraction;
  const consolidate = deps.runConsolidation || runConsolidation;
  const purge = deps.purgeCorpus || purgeCorpus;
  const ingest = deps.ingestPiece || ingestPiece;
  const units = files.map((file, i) => ({ file, cote: coteFromFilename(file.filename, i) }));
  const total = units.length;

  // Le RAG est un bonus : il ne doit jamais faire échouer l'analyse. Si la purge
  // échoue on n'ingère pas — le corpus contiendrait encore la procédure précédente,
  // et le chat répondrait sur la mauvaise affaire. Elle est donc séquentielle et
  // s'achève avant la moindre ingestion.
  let ragOk = ragActif(cfg);
  const rag = { indexees: 0, total: ragOk ? total : 0, erreur: null };
  if (ragOk) {
    try {
      await purge({ cfg, fetchImpl });
    } catch (e) {
      ragOk = false;
      rag.total = 0;
      rag.erreur = e.message;
    }
  }
  onRag({ ...rag });

  // Réessaie une pièce dont l'INGESTION IAka a échoué (transitoire) : seule une nouvelle
  // exécution relance l'ingestion. Seule ARIANE_INGESTION est réessayée ; tout autre échec
  // propage aussitôt. Tentatives épuisées → ARIANE_UPSTREAM (affichage front inchangé).
  const arianeMaxAttempts = cfg.arianeMaxAttempts ?? 3;
  const arianeRetryDelayMs = cfg.arianeRetryDelayMs ?? 2000;
  async function extractAvecReprise(u, idx) {
    for (let attempt = 1; attempt <= arianeMaxAttempts; attempt++) {
      try {
        return await extract({ file: u.file, cote: u.cote, cfg, fetchImpl, sleep });
      } catch (e) {
        if (e.message !== "ARIANE_INGESTION") throw e;
        console.error(`[ariane] map piece ${idx + 1}/${total} ingestion transitoire, tentative ${attempt}/${arianeMaxAttempts}`);
        if (attempt < arianeMaxAttempts) await sleep(arianeRetryDelayMs);
      }
    }
    throw new Error("ARIANE_UPSTREAM"); // ingestion transitoire devenue persistante
  }

  let done = 0;
  const mapResults = await mapPool(units, cfg.mapConcurrency ?? 4, async (u, idx) => {
    // Ingestion lancée AVANT l'attente du MAP : les deux courent en parallèle sur le
    // même buffer. Elle ne rejette jamais (best-effort, comme le MAP).
    const ingestion = ragOk
      ? ingest({ file: u.file, cote: u.cote, cfg, fetchImpl })
          .then(() => { rag.indexees++; })
          .catch(() => { /* pièce non indexée : le ratio indexees/total le porte déjà */ })
      : null;
    let out = null;
    try {
      out = await extractAvecReprise(u, idx);
      const meta = parseNomFichier(u.file.filename);
      if (meta) {
        meta.avertissements.forEach(onAvertissement);
        out = appliquerMeta(out, meta);
      }
      if (u.file.meta) {
        (u.file.meta.avertissements || []).forEach(onAvertissement);
        out = appliquerMetaXml(out, u.file.meta, onAvertissement);
      }
    } catch (e) {
      // best-effort : pièce ignorée — mais on trace, sinon un MAP intégralement en
      // échec ressort en ARIANE_UPSTREAM sans aucune trace de la cause.
      // Index et pas cote : le nom de fichier porte souvent un nom de personne.
      console.error(`[ariane] map piece ${idx + 1}/${total} echec: ${e.message}`);
      onPieceIgnoree({ cote: u.cote, raison: e.message });
      out = null;
    }
    if (ingestion) {
      await ingestion;
      onRag({ ...rag });
    }
    onProgress({ done: ++done, total });
    return out;
  });
  const mapOutputs = mapResults.filter(Boolean);
  console.error(`[ariane] map termine: ${mapOutputs.length}/${total} pieces exploitables`);
  if (mapOutputs.length === 0) throw new Error("ARIANE_UPSTREAM"); // aucune pièce exploitable
  // Les avertissements du regroupement remontent a l'ecran par le meme canal que
  // ceux de parseNomFichier, et sont retires de l'agregat : ce dernier est serialise
  // tel quel en prompt du REDUCE, un message d'interface n'y a pas sa place.
  const { avertissements, ...aggregate } = buildAggregate(mapOutputs);
  avertissements.forEach(onAvertissement);
  const reduce = await consolidate({ aggregate, cfg, fetchImpl, sleep });
  return validateContract(assembleContract(mapOutputs, reduce, onAvertissement));
}

// Store de jobs en mémoire (démo, pas de persistance). Chaque job suit la progression
// du pipeline pour l'endpoint de polling. Même garde-fous que jobs.mjs : TTL + plafond.
const JOB_TTL_MS = Number(process.env.JOB_TTL_MS ?? 30 * 60 * 1000);
const JOB_MAX = Number(process.env.JOB_MAX ?? 500);
const jobs = new Map();

function purgeExpired(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}

function enforceMax() {
  while (jobs.size >= JOB_MAX) {
    const oldest = jobs.keys().next().value;
    if (oldest === undefined) break;
    jobs.delete(oldest);
  }
}

export function createJob() {
  purgeExpired();
  enforceMax();
  const jobId = randomUUID();
  jobs.set(jobId, {
    status: "pending",
    createdAt: Date.now(),
    progress: { done: 0, total: 0 },
    rag: { indexees: 0, total: 0, erreur: null },
  });
  return jobId;
}

export function getJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  if (Date.now() - job.createdAt > JOB_TTL_MS) {
    jobs.delete(jobId);
    return undefined;
  }
  return job;
}

// Lance le pipeline en arrière-plan et met à jour le job. Résout quand le job est
// terminé (done/error) — la route n'attend pas ce résultat, elle a déjà renvoyé le jobId.
export async function startJob({ jobId, files, cfg, fetchImpl, deps }) {
  const job = getJob(jobId);
  if (!job) return;
  job.status = "map";
  job.progress = { done: 0, total: files.length };
  // Une pièce en échec est écartée en silence par le MAP best-effort : on la remonte
  // au front, sinon le dossier paraît complet alors qu'il ne l'est pas.
  job.pieces_ignorees = [];
  job.avertissements = [];
  try {
    const contract = await runAriane({
      files, cfg, fetchImpl, deps,
      onPieceIgnoree: (p) => job.pieces_ignorees.push(p),
      onAvertissement: (a) => { if (!job.avertissements.includes(a)) job.avertissements.push(a); },
      onProgress: (p) => {
        job.progress = p;
        if (p.done === p.total && p.total > 0) job.status = "reduce";
      },
      // Une défaillance RAG n'alimente que ce champ, jamais job.error : elle dégrade
      // l'onglet Questions et laisse le dossier analysé intact.
      onRag: (r) => { job.rag = r; },
    });
    job.result = contract;
    job.status = "done";
  } catch (e) {
    console.error(`[ariane] job ${jobId} echec: ${e.message}`);
    job.status = "error";
    job.error = e.message;
  }
}
