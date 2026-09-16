-- Données fictives de démonstration (pas de PII réelle, pas d'IMEI).
INSERT INTO unite (code, description) VALUES (12345, 'COB Démo') ON CONFLICT DO NOTHING;
INSERT INTO type_document (id, libelle, description) VALUES (1, 'PV', 'Procès-verbal') ON CONFLICT DO NOTHING;
INSERT INTO groupe (id, libelle) VALUES (1, 'Démo') ON CONFLICT DO NOTHING;
INSERT INTO communes (code_insee, nom, code_postal, nom_norm)
VALUES ('49001', 'Segré-en-Anjou Bleu', '49500', 'segre-en-anjou bleu')
ON CONFLICT DO NOTHING;
INSERT INTO una (unite, numero, annee, type_document, groupe, synthese, urgent, sensible, commune, date_submit)
VALUES (12345, 1, 2026, 1, 1, 'Procédure de démonstration — faits fictifs.', false, false, '49001', now())
ON CONFLICT DO NOTHING;

-- perquisition + objet : INSERT ... SELECT id FROM una WHERE unite=12345 AND numero=1 AND annee=2026
INSERT INTO perquisition (una_id, adresse, code_postal, commune, type_lieu, date_debut)
SELECT u.id,
       '1 rue de la Gendarmerie, 49500 Segré-en-Anjou Bleu',
       '49500',
       '49001',
       'DOMICILE',
       now()
FROM una u
WHERE u.unite = 12345 AND u.numero = 1 AND u.annee = 2026
  AND NOT EXISTS (
    SELECT 1 FROM perquisition p WHERE p.una_id = u.id
  );

INSERT INTO objet_saisi (perquisition_id, categorie, numero_scelle, situation)
SELECT p.id, 'TELEPHONE', 'SC-DEMO-1', 'SAISI_SOUS_SCELLE'
FROM perquisition p
JOIN una u ON u.id = p.una_id
WHERE u.unite = 12345 AND u.numero = 1 AND u.annee = 2026
  AND NOT EXISTS (
    SELECT 1 FROM objet_saisi o WHERE o.numero_scelle = 'SC-DEMO-1'
  );
