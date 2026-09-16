// Alimentation NOCTURNE de la base RENS/FRS — ajoute 900 à 1200 fiches par nuit, datées du
// jour du run, avec les mêmes contraintes GIPASP que le seed déterministe (corpus.mjs) :
// bruit de fond thématique + quelques fiches « signal faible », identités/plaques FICTIVES.
//
// Différences avec generate.mjs :
//   - aléa RÉEL (Math.random) : chaque nuit un lot différent, non reproductible ;
//   - insertion directe en base (pg) au lieu d'un dump SQL ;
//   - purge glissante : supprime les fiches plus vieilles que RETENTION_DAYS (défaut 90) ;
//   - rattachements UNIQUEMENT depuis les référentiels (ref_unite, ref_commune, ref_ggd).
//
// Prérequis : `node seed/load-referentiels.mjs` a peuplé ref_* (vraies données).
// Sans unités / communes en base, le run échoue explicitement.
//
// Exécution (dans le conteneur rens-api, rôle rens_seed — migrations 005 + 011) :
//   docker exec rens-api node /app/seed/nightly.mjs
// Variables : RETENTION_DAYS (défaut 90), NIGHTLY_DRY=1 (tout en transaction puis ROLLBACK),
//             N_BRUIT (défaut 900–1200), TRAME_PROB, AUDIT_DEFAUTS.
import { Pool } from 'pg';
import { PL, PRENOMS, NOMS, HANDLES, PLATS } from './corpus.mjs';
import { buildLot } from './build-lot.mjs';
import { reconcileReferentiels } from './reconcile-refs.mjs';

// --- Aléa réel (contrairement au seed, pas de graine fixe) -------------------------------
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randint = (n) => Math.floor(Math.random() * n);

function plaque() {
  const l = () => PL[randint(PL.length)];
  return `${l()}${l()}-${100 + randint(900)}-${l()}${l()}`;
}
function identite() {
  const an = 1968 + randint(40);
  return `${pick(PRENOMS)} ${pick(NOMS)}, né(e) le ${String(1 + randint(28)).padStart(2, '0')}/${String(1 + randint(12)).padStart(2, '0')}/${an}`;
}
function pseudo() { return '@' + pick(HANDLES); }
function url() { return pick(PLATS) + pick(HANDLES); }
function fill(t) {
  return t.replace(/\{PLAQUE\}/g, () => plaque())
          .replace(/\{IDENTITE\}/g, () => identite())
          .replace(/\{PSEUDO\}/g, () => pseudo())
          .replace(/\{URL\}/g, () => url());
}

/** Communes officielles groupées par département. */
export async function chargerCommunesParDept(client) {
  const { rows } = await client.query(
    `SELECT code_dept, nom FROM ref_commune ORDER BY code_dept, nom`,
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.code_dept)) map.set(r.code_dept, []);
    map.get(r.code_dept).push(r.nom);
  }
  return map;
}

/** Unités du référentiel groupées par GGD. */
export async function chargerUnitesParGgd(client) {
  const { rows } = await client.query(
    `SELECT code_ggd, nom FROM ref_unite ORDER BY code_ggd, nom`,
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.code_ggd)) map.set(r.code_ggd, []);
    map.get(r.code_ggd).push(r.nom);
  }
  return map;
}

// --- Insertion / purge --------------------------------------------------------------------
async function main() {
  const dry = process.env.NIGHTLY_DRY === '1';
  const retention = Number(process.env.RETENTION_DAYS ?? 90);
  const stamp = new Date().toISOString();

  const pool = new Pool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const [communesByDept, unitesByGgd] = await Promise.all([
      chargerCommunesParDept(client),
      chargerUnitesParGgd(client),
    ]);

    if (!unitesByGgd.size || !communesByDept.size) {
      throw new Error(
        'référentiels vides (ref_unite / ref_commune) : lancer seed/load-referentiels.mjs avant le cron',
      );
    }

    const nBruitEnv = process.env.N_BRUIT;
    const fiches = buildLot({
      pick, randint, random: Math.random, fill,
      nBruit: nBruitEnv !== undefined && nBruitEnv !== '' ? Number(nBruitEnv) : undefined,
      trameProb: Number(process.env.TRAME_PROB ?? 0.4),
      auditDefauts: Number(process.env.AUDIT_DEFAUTS ?? 40),
      communesByDept,
      unitesByGgd,
    });

    // Purge glissante (le CASCADE sur frs_mot_cle nettoie les mots-clés).
    const purge = await client.query(
      `DELETE FROM frs WHERE date_redaction < CURRENT_DATE - ($1::int * INTERVAL '1 day')`,
      [retention],
    );

    // Insertion des fiches — date = jour du run (CURRENT_DATE côté serveur).
    // Rattachements déjà tirés dans ref_* : aucune invention ici.
    let motsInseres = 0;
    for (const f of fiches) {
      const { rows: [{ id }] } = await client.query(
        `INSERT INTO frs (date_redaction, titre, unite, code_ggd, departement, commune, texte)
         VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6) RETURNING id`,
        [f.titre, f.unite, f.ggd, f.dep, f.commune, f.texte],
      );
      for (let i = 0; i < f.mots.length; i++) {
        await client.query(
          `INSERT INTO frs_mot_cle (frs_id, mot, ordre) VALUES ($1, $2, $3)`,
          [id, f.mots[i], i],
        );
        motsInseres++;
      }
    }

    // Rattrapage historique uniquement (no-op si tout vient déjà de ref_*).
    await reconcileReferentiels(client);

    if (dry) {
      await client.query('ROLLBACK');
      console.log(`[rens-nightly ${stamp}] DRY-RUN (rollback) : ${fiches.length} fiches / ${motsInseres} mots-clés simulés, purge ${purge.rowCount} fiches (>${retention}j), unites-ref=${unitesByGgd.size} ggd, communes-ref=${communesByDept.size} depts.`);
    } else {
      await client.query('COMMIT');
      const { rows: [{ total }] } = await client.query('SELECT count(*)::int total FROM frs');
      console.log(`[rens-nightly ${stamp}] OK : +${fiches.length} fiches / +${motsInseres} mots-clés, purge -${purge.rowCount} (>${retention}j), total=${total}, unites-ref=${unitesByGgd.size} ggd, communes-ref=${communesByDept.size} depts.`);
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`[rens-nightly ${stamp}] ÉCHEC : ${e.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
