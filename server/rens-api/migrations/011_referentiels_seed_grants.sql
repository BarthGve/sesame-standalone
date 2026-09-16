-- server/rens-api/migrations/011_referentiels_seed_grants.sql
-- L'alimentation nocturne (rôle rens_seed, seed/nightly.mjs) doit pouvoir :
--   1. LIRE les référentiels (ref_unite, ref_commune, ref_ggd, ref_mot_cle) pour y puiser
--      les rattachements — le cron n'invente plus d'unités hors catalogue ;
--   2. Éventuellement rattraper l'historique (INSERT … ON CONFLICT DO NOTHING via reconcile).
-- Les vraies données sont chargées une fois par load-referentiels.mjs.
BEGIN;

GRANT SELECT, INSERT ON ref_ggd, ref_unite, ref_commune, ref_mot_cle TO rens_seed;
GRANT USAGE, SELECT ON SEQUENCE ref_unite_id_seq TO rens_seed;

-- ON CONFLICT DO UPDATE (chargement COG / reload) n'est pas requis du cron : le nightly
-- ne fait que de l'INSERT … ON CONFLICT DO NOTHING. Pas de GRANT UPDATE.

COMMIT;
