-- server/rens-api/migrations/008_drop_champs_inexistants.sql
-- Retrait des trois colonnes ajoutées par 006. Elles n'existent pas à la saisie d'une FRS :
-- le « motif d'enregistrement » de R. 236-22, I, 4° se rattache à la fiche entité — le
-- référent national recommande précisément d'en faire une saisie obligatoire dans une
-- version ultérieure de l'application —, et ni la date d'événement ni l'origine de
-- l'information ne sont des champs du formulaire.
--
-- Conséquence assumée : le contrôle déterministe se réduit au seul critère C10 (ancienneté,
-- sur date_redaction). Les neuf autres critères se lisent dans le TEXTE, donc par les agents.
--
-- Aucune donnée perdue : les colonnes n'ont jamais été alimentées en production.
BEGIN;

REVOKE UPDATE (motif, date_evenement, origine_info) ON frs FROM rens_seed;

DROP INDEX IF EXISTS idx_frs_date_evt;
ALTER TABLE frs DROP COLUMN IF EXISTS motif;
ALTER TABLE frs DROP COLUMN IF EXISTS date_evenement;
ALTER TABLE frs DROP COLUMN IF EXISTS origine_info;

COMMIT;
