-- server/rens-api/migrations/009_redaction.sql
-- Rédaction d'une FRS depuis l'application : la seule écriture de la feature.
--
-- 007 pose la doctrine : « rens_api et rens_ro restent en LECTURE SEULE, toute écriture passe
-- par un rôle dédié, table par table. » On la suit plutôt que d'ouvrir l'INSERT au rôle qui
-- sert toutes les lectures publiques : ce rôle-là voyage dans une API joignable depuis
-- Internet, et le moindre privilège est ce qui limite les dégâts d'un jeton qui fuite.
--
-- Le mot de passe est posé au déploiement (ALTER ROLE ... PASSWORD), jamais commité.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rens_redaction') THEN
    CREATE ROLE rens_redaction LOGIN;
  END IF;
END$$;

GRANT CONNECT ON DATABASE rens TO rens_redaction;
GRANT USAGE ON SCHEMA public TO rens_redaction;

-- INSERT et rien d'autre sur les tables : ce rôle ajoute des fiches, il ne peut ni les
-- relire en masse, ni les réécrire, ni les supprimer. La lecture des référentiels pour la
-- validation se fait avec le pool rens_api.
GRANT INSERT ON frs, frs_mot_cle TO rens_redaction;

-- RETURNING id (utilisé par POST /frs pour renvoyer l'identifiant créé) exige un SELECT
-- sur les colonnes renvoyées — sans cela PostgreSQL répond « permission denied for table »
-- alors que l'INSERT seul est accordé. Portée au strict minimum : la seule colonne id.
GRANT SELECT (id) ON frs TO rens_redaction;

-- nextval sur les colonnes serial : sans USAGE sur la séquence, le GRANT sur la table ne
-- suffit pas et l'INSERT échoue en « permission denied for sequence ».
GRANT USAGE, SELECT ON SEQUENCE frs_id_seq, frs_mot_cle_id_seq TO rens_redaction;

COMMIT;
