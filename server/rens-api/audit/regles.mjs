// Règles du décret que le prompt ne tient pas — et qui, elles, se vérifient.
//
// Elles vivaient dans le rapport de l'analyse à la demande ; le batch nocturne les
// contournait, écrivant en base des écarts qu'un simple contrôle aurait retirés. Elles sont
// donc ICI, appliquées par les DEUX chemins : rien n'est persisté ni affiché sans passer par
// ce filtre.

export const RANG = { bloquant: 3, majeur: 2, mineur: 1 };

// A1 signale une atteinte NON caractérisée. Une atteinte POTENTIELLE suffit à justifier la
// présence de personnes dans la fiche : le décret autorise les données personnelles dès lors
// qu'une atteinte à la sécurité publique ou à la sûreté de l'État est possible, sans attendre
// qu'elle se réalise. Un A1 qui explique le contraire — « les faits caractérisent une
// atteinte », « les faits sont de nature à porter atteinte » — se contredit : l'agent a
// raisonné juste et rendu une entrée pour dire qu'il n'y avait pas lieu d'en rendre une. On
// garde le raisonnement, on jette le signalement.
const AFFIRME_ATTEINTE = /(?:caractéris\w*|constitu\w*|établ\w*)[^.]{0,40}\b(?:une |l'|d'une )?atteinte|\batteinte\b[^.]{0,40}(?:est|sont)\s+(?:bien\s+)?(?:caractéris|établ|constitu)|atteinte (?:potentielle|possible|prévisible)|risque(?:s)? (?:d'|d’)atteinte|de nature à porter atteinte|susceptibles? de porter atteinte|menace(?:nt)? (?:pour|à) (?:la sécurité publique|la sûreté|l'ordre public)/i;
// Toute négation vaut veto : mieux vaut garder un A1 douteux que perdre un A1 fondé.
const NIE_ATTEINTE = /\bne\b[^.]{0,30}(?:caractéris|constitu|établ)|aucune atteinte|pas d'atteinte|sans atteinte|n'est pas caractéris|n'est pas susceptible|ne sont pas susceptibles|aucun risque|pas de risque|sans risque|aucune menace|ne constitue (?:pas|aucune)/i;

const FAMILLE_DONNEES = new Set(['B5', 'B6', 'B7']);
const FAMILLE_REDACTION = new Set(['C9', 'D11', 'D12']);
// Un seul critère est évaluable en SQL (l'ancienneté) : tout le reste se lit dans le texte.
// Données expressément ADMISES par R. 236-22, I, 1° à 3° : les signaler en B6 reviendrait à
// reprocher ce que le décret autorise. Le mot de passe, lui, en est exclu par le texte.
const ADMISES = /\b[A-Z]{2}-\d{3}-[A-Z]{2}\b|immatricul|@[\w_]+|https?:\/\/|\b0\d(?:[ .-]?\d{2}){4}\b|deux-roues|scooter|camionnette|utilitaire|véhicule|voiture|berline|permis de conduire|adresse (?:postale|électronique)|courriel|téléphone/i;
const EXCLUES = /mot de passe|identifiant de connexion|code d'accès/i;

// B5 vise une catégorie FERMÉE (R. 236-23, renvoyant au I de l'article 6 de la loi 78-17) :
// origine raciale ou ethnique, opinions, croyance, appartenance syndicale, santé, vie
// sexuelle. Un qualificatif moral n'en fait pas partie — et B5 étant bloquant, le laisser
// passer lui ferait chasser le D12 qui, lui, est fondé.
const SENSIBLE = /confession|religi|musulman|chrétien|catholique|juif|juive|israélite|islam|croyan|pratiquant|convert|origine (?:maghrébine|africaine|ethnique|raciale)|ethnie|gens du voyage|\brom\b|syndic|parti politique|opinion politique|militant (?:politique|syndical)|santé|malad|traitement|diagnostiq|psychiatr|psychologi|dépress|bipolaire|schizophr|handicap|hospitalis|médecin|thérapie|addiction|orientation sexuelle|homosexu|transgenre|vie sexuelle/i;

// D11 vise l'information qui ne se rattache À PERSONNE. Une source DÉSIGNÉE, même sans nom,
// rattache. L'ordre compte — « selon plusieurs échos » a la forme d'une attribution sans en
// être une, donc la rumeur est testée d'abord.
const RUMEUR = /bruit court|se dit|semblerait|échos|rumeur|on (?:dit|raconte)|dans le (?:quartier|voisinage)|d'aucuns/i;
// Attribution à un tiers / service (inchangé).
const SOURCE_TIERS = /\b(?:par|selon|d'après|auprès de)\s+(?:un|une|le|la|les|l'|son|sa|ses|leur)?\s*(?:riverain|témoin|victime|plaignant|exploitant|proviseur|principal|directeur|enseignant|élu|maire|gendarme|militaire|policier|agent|service|unité|brigade|renseignement|voisin|proche|parent|père|mère|sœur|frère|épouse|compagne|employeur|commerçant)|constaté par|signalé par|transmis par|relevé par|rapporté par|déclaré par|constatation directe|source ouverte|par l['']unité|par la (?:brigade|cob|bta|compagnie)|par les (?:militaires|gendarmes|patrouilles)/i;
// Constatation d'unité à la 1re personne (doctrine : « constatation directe »).
// Pas de \b après les formes accentuées : en JS, é n'est pas un « word char », donc
// `\b` après « constaté » échoue entre é et l'espace. On ancre plutôt par un non-lettre
// à gauche, et on évite le passif sans agent (« ont été constatées ») en exigeant
// contrôlons / nous avons …
const SOURCE_UNITE = /(?:^|[^A-Za-zÀ-ÿ])(?:contrôlons|constatons|observons|relevons|signalons)(?=[^A-Za-zÀ-ÿ]|$)|(?:^|[^A-Za-zÀ-ÿ])nous\s+(?:avons\s+)?(?:contrôlé|constaté|observé|relevé|signalé|intercepté)s?(?=[^A-Za-zÀ-ÿ]|$)/i;
const SOURCE_DESIGNEE = new RegExp(
  `(?:${SOURCE_TIERS.source}|${SOURCE_UNITE.source})`,
  'i',
);

// Comme A1 : si l'agent EXPLIQUE que l'origine EST identifiable, le signalement D11 se
// contredit — on garde le raisonnement, on jette l'entrée.
const AFFIRME_ORIGINE = /origine (?:de l['']information )?(?:est |semble )?identifi|source (?:est |clairement |déjà )?identifi|identifiable comme|constatation directe|rattache(?:ment)? (?:à |de )?l['']origine|l['']information (?:provient|vient|émane) (?:de|d')|origine (?:claire|connue|établie|rattachable)/i;
const NIE_ORIGINE = /origine (?:n['']est pas|non |in)identifi|sans origine|origine (?:absente|manquante|inconnue)|impossible (?:de|d')(?:savoir|identifier)|ne (?:permet|laisse) pas (?:d['']identifier|de savoir)/i;


// Détection de donnée personnelle faite sur le TEXTE. Elle vivait en SQL, calculée par les
// deux requêtes de chargement ; un texte saisi et non encore enregistré n'a pas de ligne à
// interroger. Comme les deux requêtes ramènent déjà `f.texte`, le calcul SQL était superflu :
// la règle vit ici, en un seul endroit, et sert les trois chemins (batch, analyse d'une
// sélection, analyse d'un texte volant).
//
// Un nom de famille se reconnaît à son contexte — une civilité, ou un prénom capitalisé qui
// le précède — et à sa forme : au moins deux voyelles, ce qu'un sigle de service (GGD, SNCF,
// CRS, RN) n'a pas.
const PII = [
  /(M\.|Mme|Mlle|nommé)\s/,
  /[A-ZÀÂÇÉÈÊËÎÏÔÙÛ][a-zàâçéèêëîïôùû]+\s+[A-ZÀÂÇÉÈÊËÎÏÔÙÛ]*[AEIOUYÀÂÉÈÊËÎÏÔÙÛ][A-ZÀÂÇÉÈÊËÎÏÔÙÛ]*[AEIOUYÀÂÉÈÊËÎÏÔÙÛ][A-ZÀÂÇÉÈÊËÎÏÔÙÛ]*/,
  /[A-Z]{2}-[0-9]{3}-[A-Z]{2}/,
  /t\.me\/|x\.com\/|facebook|instagram|tiktok|discord/i,
  /né\(e\) le/,
];

export function portePii(texte) {
  if (typeof texte !== 'string') return false;
  return PII.some((r) => r.test(texte));
}

// Les TROIS agents rendent chacun un verdict DCP par fiche : le préalable est dans les trois
// prompts. Ces verdicts étaient repliés dans un `Map`, où le dernier arrivé écrasait les
// autres — trois avis, un seul retenu, choisi par l'ordre du flux, et un désaccord invisible.
//
// Le vote n'est pas majoritaire, il est asymétrique, comme l'est la conséquence : un « oui »
// fait entrer la fiche dans le décret et lui laisse ses griefs ; un « non » l'en sort et les
// efface TOUS. Une voix suffit donc à retenir, l'unanimité est exigée pour effacer. C'est déjà
// la logique du croisement avec la détection mécanique ; elle vaut aussi entre agents.
export function consensusDcp(dcp) {
  const voix = new Map();
  for (const d of dcp) {
    // Seul un booléen est une voix. parse.mjs rejette déjà le reste, mais un `null` compté
    // comme « non » sortirait une fiche du décret sur une absence de réponse — ici, ce serait
    // silencieux. On ne présume jamais l'absence de donnée personnelle.
    if (typeof d.porte_dcp !== 'boolean') continue;
    const v = voix.get(d.frs_id) || { oui: 0, non: 0 };
    v[d.porte_dcp ? 'oui' : 'non']++;
    voix.set(d.frs_id, v);
  }
  const verdict = new Map();
  const discordants = [];
  for (const [id, v] of voix) {
    verdict.set(id, v.oui > 0);
    if (v.oui > 0 && v.non > 0) discordants.push(id);
  }
  return { verdict, discordants };
}

// Retire d'une liste d'écarts ceux qu'une règle du décret contredit, et ceux qui portent sur
// une fiche sans donnée à caractère personnel. Renvoie les écarts retenus et le compte des
// écartés — jamais un tri silencieux.
export function filtrerEcarts({ fiches, ecarts, dcp = [] }) {
  const connues = new Map(fiches.map((f) => [f.id, f]));
  const { verdict, discordants } = consensusDcp(dcp);

  // On ne retire les griefs d'une fiche que si TOUTES les sources disent « aucune personne » :
  // les verdicts des agents (unanimes, cf. consensusDcp) et la détection faite sur le texte.
  // Un agent qui se tromperait effacerait sinon tous les écarts d'une fiche qui en mérite.
  const horsPerimetre = new Set(
    fiches.filter((f) => verdict.get(f.id) === false && f.porte_pii === false).map((f) => f.id),
  );

  const recouvre = (a, b) => a.includes(b) || b.includes(a);
  const surUnPassage = (critere) => critere !== 'A1';
  const perdContre = (e) => surUnPassage(e.critere) && ecarts.some((autre) => {
    if (autre === e || autre.frs_id !== e.frs_id || !autre.extrait || !e.extrait) return false;
    if (!surUnPassage(autre.critere)) return false;
    if (!recouvre(autre.extrait.toLowerCase(), e.extrait.toLowerCase())) return false;
    if (autre.critere === e.critere) return false;
    const d = RANG[autre.gravite] - RANG[e.gravite];
    if (d !== 0) return d > 0;
    return FAMILLE_REDACTION.has(autre.critere) && FAMILLE_DONNEES.has(e.critere);
  });

  const contredit = (e) => {
    if (e.critere === 'A1' && e.explication && AFFIRME_ATTEINTE.test(e.explication) && !NIE_ATTEINTE.test(e.explication)) return true;
    if (e.critere === 'B5' && e.extrait && !SENSIBLE.test(e.extrait)) return true;
    // D11 : source désignée dans l'extrait, OU explication qui affirme l'origine (cas
    // « contrôlons » = constatation d'unité, où l'agent a raisonné juste et signalé à tort).
    if (e.critere === 'D11') {
      if (e.extrait && !RUMEUR.test(e.extrait) && SOURCE_DESIGNEE.test(e.extrait)) return true;
      if (e.explication && AFFIRME_ORIGINE.test(e.explication) && !NIE_ORIGINE.test(e.explication)) return true;
    }
    if (e.critere === 'B6' && e.extrait && ADMISES.test(e.extrait) && !EXCLUES.test(e.extrait)) return true;
    if (perdContre(e)) return true;
    return false;
  };

  const retenus = [];
  let ecartes = 0;
  for (const e of ecarts) {
    if (!connues.has(e.frs_id)) continue;
    if (horsPerimetre.has(e.frs_id) || contredit(e)) { ecartes++; continue; }
    retenus.push(e);
  }
  return { retenus, ecartes, horsPerimetre, discordants };
}
