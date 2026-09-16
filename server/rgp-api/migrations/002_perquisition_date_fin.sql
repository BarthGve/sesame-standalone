-- Ajoute l'horodatage de fin de perquisition (début déjà présent via date_debut).
ALTER TABLE perquisition ADD COLUMN IF NOT EXISTS date_fin timestamptz;
