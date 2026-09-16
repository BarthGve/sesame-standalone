// Rattrapage historique frs → référentiels de rédaction.
//
// Ce n'est PAS le chemin nominal de peuplement. Les vraies données arrivent via
// seed/load-referentiels.mjs (catalogue.mjs + communes-fr.json). Formulaire et cron
// lisent ensuite ref_* pour créer une FRS.
//
// Ce module ne sert qu'à absorber d'anciennes fiches écrites avant le catalogue
// (migration 010, reload après un seed SQL historique). Idempotent :
// INSERT … ON CONFLICT DO NOTHING. Marqueurs techniques (defaut:, signal-faible:) exclus.

export async function reconcileReferentiels(client) {
  await client.query(`
    INSERT INTO ref_ggd (code, code_dept, nom_departement)
    SELECT DISTINCT f.code_ggd,
           regexp_replace(f.code_ggd, '^GGD[[:space:]]*', ''),
           f.departement
      FROM frs f
     WHERE f.code_ggd IS NOT NULL AND f.code_ggd <> ''
    ON CONFLICT (code) DO NOTHING`);

  await client.query(`
    INSERT INTO ref_unite (code_ggd, nom)
    SELECT DISTINCT f.code_ggd, f.unite
      FROM frs f
      JOIN ref_ggd g ON g.code = f.code_ggd
     WHERE f.unite IS NOT NULL AND f.unite <> ''
    ON CONFLICT (code_ggd, nom) DO NOTHING`);

  await client.query(`
    INSERT INTO ref_mot_cle (mot)
    SELECT DISTINCT m.mot
      FROM frs_mot_cle m
     WHERE m.mot NOT LIKE 'defaut:%'
       AND m.mot NOT LIKE 'signal-faible:%'
       AND length(m.mot) <= 40
    ON CONFLICT (mot) DO NOTHING`);

  await client.query(`
    INSERT INTO ref_commune (code_insee, nom, code_dept)
    SELECT DISTINCT
           'EXT-' || substr(md5(f.commune || '|' || regexp_replace(f.code_ggd, '^GGD[[:space:]]*', '')), 1, 12),
           f.commune,
           regexp_replace(f.code_ggd, '^GGD[[:space:]]*', '')
      FROM frs f
     WHERE f.commune IS NOT NULL AND f.commune <> ''
       AND NOT EXISTS (
         SELECT 1 FROM ref_commune c
          WHERE c.code_dept = regexp_replace(f.code_ggd, '^GGD[[:space:]]*', '')
            AND lower(c.nom) = lower(f.commune)
       )
    ON CONFLICT (code_insee) DO NOTHING`);
}
