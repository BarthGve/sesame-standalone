-- server/rens-api/migrations/007_audit_grants.sql
-- Droits sur les objets créés par 006. La migration précédente n'en posait aucun : le job
-- nocturne (rôle rens_seed, cf. 005) aurait échoué en « permission denied » dès la création
-- du run, et l'API n'aurait rien pu lire si les privilèges par défaut n'avaient pas suivi.
--
-- Le partage des rôles ne change pas : rens_api et rens_ro restent en LECTURE SEULE, toute
-- écriture passe par rens_seed, table par table.
BEGIN;

-- Écriture de l'audit : le job crée un run, marque ses fragments, insère et met à jour les
-- écarts (ON CONFLICT DO UPDATE), et supprime le run du jour avant de le recréer.
GRANT SELECT, INSERT, UPDATE, DELETE ON frs_audit_run      TO rens_seed;
GRANT SELECT, INSERT, UPDATE, DELETE ON frs_audit_fragment TO rens_seed;
GRANT SELECT, INSERT, UPDATE, DELETE ON frs_audit          TO rens_seed;

-- nextval sur les séquences serial : le GRANT sur la table ne suffit pas à un INSERT.
GRANT USAGE, SELECT ON SEQUENCE frs_audit_run_id_seq      TO rens_seed;
GRANT USAGE, SELECT ON SEQUENCE frs_audit_fragment_id_seq TO rens_seed;
GRANT USAGE, SELECT ON SEQUENCE frs_audit_id_seq          TO rens_seed;

-- Les trois colonnes ajoutées par 006 sont alimentées par l'alimentation nocturne. Le droit
-- est donné COLONNE PAR COLONNE : rens_seed ne doit pas pouvoir réécrire le texte d'une fiche.
GRANT UPDATE (motif, date_evenement, origine_info) ON frs TO rens_seed;

-- Lecture par l'API. Explicite plutôt qu'hérité des privilèges par défaut de 002 : ceux-ci
-- ne s'appliquent qu'aux tables créées par le rôle qui les a posés.
GRANT SELECT ON frs_audit_run, frs_audit_fragment, frs_audit TO rens_api, rens_ro;

COMMIT;
