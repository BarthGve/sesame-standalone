// Orchestrateur du contrôle qualité nocturne.
//
// IAka ne sait pas boucler mais parallélise depuis une entrée : le workflow reste fixe
// (un fragment, trois agents, une jointure) et la boucle vit ICI, où elle se teste.
//
// Un fragment en échec n'interrompt jamais le run : il est marqué, le run finit
// « partiel », et le front l'affiche. Un audit incomplet qui se tairait ressemblerait
// à un audit vierge — c'est la pire défaillance possible pour un outil de conformité.

import { createRequire } from 'node:module';
import { decouper, composerFragment, TAILLE_DEFAUT } from './fragments.mjs';
import { parseSortieAgents } from './parse.mjs';
import { filtrerEcarts, portePii } from './regles.mjs';
import { execWorkflow as execWorkflowReel, mapConcurrent } from './iaka.mjs';
import { creerRun, creerFragments, enregistrerStructurels, enregistrerEcarts, marquerFragment, cloreRun } from './store.mjs';

const require_ = createRequire(import.meta.url);
const { buildStructurelQuery } = require_('./structurel.js');

const SELECT_JOUR = `
  SELECT f.id, to_char(f.date_redaction, 'YYYY-MM-DD') AS date_redaction,
         f.titre, f.unite, f.code_ggd, f.commune, f.texte
    FROM frs f
   WHERE f.date_redaction = $1::date
   ORDER BY f.id`;

const SELECT_JOUR_IDS = SELECT_JOUR.replace('f.date_redaction = $1::date', 'f.id = ANY($1::int[])');

// Un fragment = UNE transaction, sur SA PROPRE connexion.
//
// Deux raisons, toutes deux nécessaires. (1) Le batch dure ~4 min : si tout tenait dans
// une transaction unique, un redémarrage de conteneur annulerait les 24 fragments déjà
// traités ET les statuts qui permettent la reprise — la reprise par fragment ne serait
// qu'une promesse. (2) Un client `pg` ne porte QU'UNE transaction : avec une concurrence
// de 6 sur un client partagé, les BEGIN/COMMIT s'entrelaceraient silencieusement.
// D'où `avecClient`, qui prête une connexion dédiée le temps de l'écriture.
async function traiterFragment({ avecClient, runId, rang, lot: lotBrut, cfg, execWorkflow }) {
  // La détection vit en JS (regles.mjs) et non plus en SQL : le texte est déjà chargé, et
  // l'analyse d'un texte non enregistré doit passer par la MÊME règle.
  const lot = lotBrut.map((f) => ({ ...f, porte_pii: portePii(f.texte) }));
  const ids = lot.map((f) => f.id);
  // L'appel au workflow (le temps long) se fait HORS connexion : on ne monopolise pas
  // une connexion du pool pendant 45 s d'attente réseau.
  let ecarts, rejets, ecartesRegle = 0, discordants = [];
  try {
    const brut = await execWorkflow({
      prompt: JSON.stringify(composerFragment(rang, lot)),
      appId: cfg.appId, cfg,
    });
    let dcp;
    ({ ecarts, dcp, rejets } = parseSortieAgents(brut, ids));
    // MÊME filtre que l'analyse à la demande : sans lui, le batch persisterait des griefs
    // qu'un simple contrôle retire, et le rapport nocturne dirait autre chose que la page.
    const filtre = filtrerEcarts({ fiches: lot, ecarts, dcp });
    ecarts = filtre.retenus;
    ecartesRegle = filtre.ecartes;
    discordants = filtre.discordants;
  } catch (e) {
    await avecClient(async (c) => marquerFragment(c, runId, rang, 'echec', e.message));
    console.error(`[audit] fragment ${rang} en échec : ${e.message}`);
    return { ecarts: 0, rejets: 0, ecartesRegle: 0 };
  }

  await avecClient(async (c) => {
    await enregistrerEcarts(c, runId, ecarts);
    await marquerFragment(c, runId, rang, 'ok');
  });
  if (rejets.length) console.warn(`[audit] fragment ${rang} : ${rejets.length} entrée(s) rejetée(s)`, rejets.map((r) => r.raison));
  if (ecartesRegle) console.warn(`[audit] fragment ${rang} : ${ecartesRegle} écart(s) retiré(s) par une règle du décret`);
  // Les agents ne s'accordent pas sur la présence d'une personne : la fiche reste dans le
  // décret, mais le désaccord se lit dans le journal — c'est là qu'on verra si la détection
  // hésite sur un gabarit particulier.
  if (discordants.length) console.warn(`[audit] fragment ${rang} : verdict DCP discordant sur ${discordants.length} fiche(s)`, discordants);
  return { ecarts: ecarts.length, rejets: rejets.length, ecartesRegle };
}

export async function auditerJour({ client, jour, cfg, deps = {} }) {
  const execWorkflow = deps.execWorkflow || execWorkflowReel;
  // Par défaut (tests, dry-run), l'écriture réutilise le client courant : une seule
  // connexion, pas de transaction imbriquée. En production, main() injecte un avecClient
  // qui emprunte une connexion au pool et l'entoure d'un BEGIN/COMMIT.
  const avecClient = deps.avecClient || ((fn) => fn(client));
  const taille = Number.isInteger(cfg.tailleFragment) && cfg.tailleFragment > 0 ? cfg.tailleFragment : TAILLE_DEFAUT;

  // REPRISE : on garde le run et ses fragments, on ne rejoue que ceux en échec.
  // Sans ce mode, « un fragment en échec est rejoué seul » serait une promesse sans code.
  if (cfg.reprise) {
    const { rows } = await client.query(
      `SELECT r.id AS run_id, g.rang, g.frs_ids
         FROM frs_audit_run r JOIN frs_audit_fragment g ON g.run_id = r.id
        WHERE r.jour = $1::date AND g.statut = 'echec' ORDER BY g.rang`, [jour]
    );
    if (!rows.length) return { statut: 'complet', totalFiches: 0, fragments: 0, ecarts: 0, rejets: 0, reprise: true };
    const runId = rows[0].run_id;
    const aRejouer = rows.map((r) => ({ rang: r.rang, ids: r.frs_ids }));
    let ecarts = 0;
    await mapConcurrent(aRejouer, cfg.concurrence, async ({ rang, ids }) => {
      const { rows: lot } = await client.query(SELECT_JOUR_IDS, [ids]);
      const r = await traiterFragment({ avecClient, runId, rang, lot, cfg, execWorkflow });
      ecarts += r.ecarts;
    });
    const statut = await cloreRun(client, runId, null);
    return { statut, totalFiches: 0, fragments: aRejouer.length, ecarts, rejets: 0, reprise: true };
  }

  const runId = await creerRun(client, { jour, tailleFragment: taille });

  // 1. Déterministe d'abord : exhaustif, gratuit, et acquis même si tout le LLM échoue.
  const qs = buildStructurelQuery(jour);
  const { rows: structurels } = await client.query(qs.text, qs.values);
  await enregistrerStructurels(client, runId, structurels);

  // 2. Le lot du jour, puis les fragments.
  const { rows: fiches } = await client.query(SELECT_JOUR, [jour]);
  const fragments = decouper(fiches, taille);
  await creerFragments(client, runId, fragments);

  let totalEcarts = 0, totalRejets = 0, totalRegle = 0;

  await mapConcurrent(fragments, cfg.concurrence, async (lot, rang) => {
    const r = await traiterFragment({ avecClient, runId, rang, lot, cfg, execWorkflow });
    totalEcarts += r.ecarts;
    totalRejets += r.rejets;
    totalRegle += r.ecartesRegle || 0;
  });

  const statut = await cloreRun(client, runId, fiches.length);
  return { statut, totalFiches: fiches.length, fragments: fragments.length, ecarts: totalEcarts, rejets: totalRejets, ecartesRegle: totalRegle };
}

/** Opt-in : un `docker exec … nightly.mjs` sans AUDIT_NIGHTLY=1 sort sans appeler IAKA. */
export function shouldRunNightly(env) {
  return env.AUDIT_NIGHTLY === '1';
}

async function main() {
  if (!shouldRunNightly(process.env)) {
    console.log('[audit] AUDIT_NIGHTLY!=1 — noop (set AUDIT_NIGHTLY=1 to run)');
    return;
  }
  // `pg` est importé ICI, pas au chargement du module : les tests d'auditerJour injectent
  // un faux client et tournent hors du conteneur, où la dépendance n'est pas installée.
  const { Pool } = await import('pg');
  const jour = process.env.AUDIT_JOUR || null;
  const dry = process.env.AUDIT_DRY === '1';
  const cfg = {
    appId: process.env.IAKA_QUALITE_APP_ID,
    baseUrl: process.env.IAKA_BASE_URL,
    jwt: process.env.IAKA_JWT,
    tenantId: process.env.IAKA_TENANT_ID,
    executePath: process.env.IAKA_EXECUTE_PATH || '/workflows/execute',
    statusPath: process.env.IAKA_STATUS_PATH || '/workflows/executions/{id}',
    tailleFragment: Number(process.env.AUDIT_TAILLE_FRAGMENT ?? TAILLE_DEFAUT),
    concurrence: Number(process.env.AUDIT_CONCURRENCE ?? 6),
    pollIntervalMs: Number(process.env.AUDIT_POLL_MS ?? 2000),
    pollTimeoutMs: Number(process.env.AUDIT_TIMEOUT_MS ?? 300000),
    reprise: process.env.AUDIT_REPRISE === '1',
    dry,
  };
  const stamp = new Date().toISOString();
  const pool = new Pool({
    max: Math.max(2, cfg.concurrence + 1),
    user: process.env.PGUSER_SEED || process.env.PGUSER_MIGRATE || process.env.PGUSER,
    password: process.env.PGPASSWORD_SEED || process.env.PGPASSWORD_MIGRATE || process.env.PGPASSWORD,
  });
  const client = await pool.connect();
  try {
    const { rows: [{ j }] } = await client.query(
      'SELECT to_char(COALESCE($1::date, CURRENT_DATE - 1), \'YYYY-MM-DD\') AS j', [jour]
    );

    // En DRY-RUN : une seule connexion, une seule transaction, ROLLBACK final — rien
    // n'est écrit. Sinon : une connexion et une transaction PAR FRAGMENT, pour que
    // chaque fragment traité soit durable et serve de point de reprise.
    let avecClient;
    if (dry) {
      await client.query('BEGIN');
      avecClient = (fn) => fn(client);
    } else {
      avecClient = async (fn) => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const out = await fn(c);
          await c.query('COMMIT');
          return out;
        } catch (e) {
          await c.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          c.release();
        }
      };
    }

    const r = await auditerJour({ client, jour: j, cfg, deps: { avecClient } });
    if (dry) await client.query('ROLLBACK');

    console.log(`[audit ${stamp}] ${dry ? 'DRY-RUN ' : ''}${cfg.reprise ? 'REPRISE ' : ''}${j} : ${r.statut}, ${r.totalFiches} fiches, ${r.fragments} fragments, ${r.ecarts} écarts, ${r.rejets} rejets, ${r.ecartesRegle ?? 0} retirés par règle.`);
    if (r.statut !== 'complet') process.exitCode = 1;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`[audit ${stamp}] ÉCHEC : ${e.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('nightly.mjs')) main();
