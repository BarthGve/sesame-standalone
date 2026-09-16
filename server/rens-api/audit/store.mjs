// Persistance de l'audit. Le dédoublonnage n'est pas écrit ici : il est porté par la
// contrainte UNIQUE (run_id, frs_id, critere) et un ON CONFLICT — une règle en base
// vaut mieux qu'une règle en code, elle ne peut pas être contournée.

import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { graviteDe, fondementDe } = require_('./criteres.js');

export async function creerRun(client, { jour, tailleFragment }) {
  await client.query('DELETE FROM frs_audit_run WHERE jour = $1', [jour]);
  const { rows } = await client.query(
    `INSERT INTO frs_audit_run (jour, taille_fragment) VALUES ($1, $2) RETURNING id`,
    [jour, tailleFragment]
  );
  return rows[0].id;
}

export async function creerFragments(client, runId, fragments) {
  for (let i = 0; i < fragments.length; i++) {
    await client.query(
      `INSERT INTO frs_audit_fragment (run_id, rang, frs_ids) VALUES ($1, $2, $3)`,
      [runId, i, fragments[i].map((f) => f.id)]
    );
  }
  await client.query('UPDATE frs_audit_run SET fragments_total = $2 WHERE id = $1', [runId, fragments.length]);
}

const INSERT_ECART = `
  INSERT INTO frs_audit (run_id, frs_id, critere, gravite, source, fondement, extrait, explication, confiance)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (run_id, frs_id, critere) DO UPDATE SET
    fondement   = EXCLUDED.fondement,
    extrait     = EXCLUDED.extrait,
    explication = EXCLUDED.explication,
    confiance   = CASE WHEN frs_audit.confiance = 'moyenne' THEN EXCLUDED.confiance ELSE frs_audit.confiance END`;

export async function enregistrerStructurels(client, runId, lignes) {
  for (const l of lignes) {
    await client.query(INSERT_ECART, [runId, l.frs_id, l.critere, graviteDe(l.critere), 'sql', fondementDe(l.critere), null, null, null]);
  }
  return lignes.length;
}

export async function enregistrerEcarts(client, runId, ecarts) {
  for (const e of ecarts) {
    await client.query(INSERT_ECART, [runId, e.frs_id, e.critere, e.gravite, 'llm', e.fondement, e.extrait, e.explication, e.confiance]);
  }
  return ecarts.length;
}

export async function marquerFragment(client, runId, rang, statut, erreur = null) {
  await client.query(
    'UPDATE frs_audit_fragment SET statut = $3, erreur = $4 WHERE run_id = $1 AND rang = $2',
    [runId, rang, statut, erreur ? String(erreur).slice(0, 500) : null]
  );
}

export async function cloreRun(client, runId, totalFiches) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE statut = 'ok')::int AS ok
       FROM frs_audit_fragment WHERE run_id = $1`,
    [runId]
  );
  const { total, ok } = rows[0];
  // total === 0 → journée sans production : c'est un audit COMPLET, pas partiel.
  const statut = ok === total ? 'complet' : 'partiel';
  await client.query(
    // COALESCE : en reprise on ne recompte pas le lot, on garde le total du run initial.
    `UPDATE frs_audit_run SET statut = $2, fragments_ok = $3, total_fiches = COALESCE($4, total_fiches), termine_a = now() WHERE id = $1`,
    [runId, statut, ok, totalFiches]
  );
  return statut;
}
