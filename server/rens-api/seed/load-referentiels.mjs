// Peuple les tables de référentiels de rédaction FRS avec de VRAIES données.
//
// Usage (conteneur rens-api ou local avec PG*) :
//   node seed/load-referentiels.mjs
//
// Ordre imposé (source de vérité → tables ref_*) :
//   1. GGD (catalogue national)
//   2. Unités (ordre de bataille de démo par groupement)
//   3. Mots-clés (thèmes + signatures de trames)
//   4. Communes officielles COG (~35k, communes-fr.json)
//   5. Rattrapage historique uniquement (frs déjà en base avant le catalogue)
//
// Après ce script, formulaire et cron ne font que LIRE ref_* pour créer une FRS.

import { Pool } from 'pg';
import {
  catalogueGgd, catalogueUnites, catalogueMotsCles, catalogueCommunes,
} from './catalogue.mjs';
import { reconcileReferentiels } from './reconcile-refs.mjs';

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  database: process.env.PGDATABASE || 'rens',
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. GGD
    for (const g of catalogueGgd()) {
      await client.query(
        `INSERT INTO ref_ggd (code, code_dept, nom_departement)
         VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE SET
           code_dept = EXCLUDED.code_dept,
           nom_departement = EXCLUDED.nom_departement`,
        [g.code, g.code_dept, g.nom_departement],
      );
    }

    // 2. Unités (après les GGD : FK).
    for (const u of catalogueUnites()) {
      await client.query(
        `INSERT INTO ref_unite (code_ggd, nom)
         VALUES ($1, $2)
         ON CONFLICT (code_ggd, nom) DO NOTHING`,
        [u.code_ggd, u.nom],
      );
    }

    // 3. Mots-clés de rédaction.
    for (const mot of catalogueMotsCles()) {
      await client.query(
        `INSERT INTO ref_mot_cle (mot) VALUES ($1) ON CONFLICT (mot) DO NOTHING`,
        [mot],
      );
    }

    // 4. Communes officielles (COG — catalogueCommunes / communes-fr.json).
    const communes = catalogueCommunes();
    console.log(`chargement de ${communes.length} communes…`);
    const LOT = 500;
    for (let i = 0; i < communes.length; i += LOT) {
      const slice = communes.slice(i, i + LOT);
      const values = [];
      const params = [];
      let n = 1;
      for (const c of slice) {
        values.push(`($${n++}, $${n++}, $${n++})`);
        params.push(c.code_insee, c.nom, c.code_dept);
      }
      await client.query(
        `INSERT INTO ref_commune (code_insee, nom, code_dept) VALUES ${values.join(',')}
         ON CONFLICT (code_insee) DO UPDATE SET nom = EXCLUDED.nom, code_dept = EXCLUDED.code_dept`,
        params,
      );
    }

    // 5. Rattrapage historique seulement (FRS antérieures au catalogue).
    // Ne crée PAS de nouvelles valeurs de rédaction pour le nightly : le cron lit ref_*.
    await reconcileReferentiels(client);

    await client.query('COMMIT');
    const counts = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM ref_ggd) AS ggd,
        (SELECT count(*)::int FROM ref_unite) AS unites,
        (SELECT count(*)::int FROM ref_commune) AS communes,
        (SELECT count(*)::int FROM ref_mot_cle) AS mots`);
    console.log('référentiels OK', counts.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('load-referentiels échec', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
