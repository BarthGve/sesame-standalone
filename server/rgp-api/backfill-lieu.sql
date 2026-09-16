-- Backfill regex du type de lieu pour les CAMBRIOLAGES et VOLS DE CARBURANT existants,
-- sans ligne una_lieu. Idempotent (ne remplit que les manquants). Rejouable.
-- Marqué confiance=0.5 + extrait='(regex)' pour distinguer d'une classif agent/LLM ultérieure.
-- Voir docs/rgp-enrichissement-lieu.md.

INSERT INTO una_lieu (una_id, type_lieu, confiance, extrait)
SELECT u.id,
  CASE
    WHEN u.synthese ~* '(erie\y|commerc|magasin|boutiqu|pharmaci|superett|supermarch|restaur|\ybar\y|entrep[oô]t|soci[eé]t[eé]|entrepris|\ySARL\y|\ySAS\y|bureau|cabinet|atelier|garage|chantier|usine|h[oô]tel|tabac|banqu|station.?service|exploitation|agricol|\ycuve\y|local (commercial|professionnel|industriel))'
      THEN 'LOCAL_PRO'
    WHEN u.synthese ~* '(domicil|maison|appartement|r[eé]sidenc|pavillon|logement|habitation)'
      THEN 'HABITATION'
    WHEN u.synthese ~* '(v[eé]hicul|voiture|camion|fourgon|scooter|siphonn|r[eé]servoir)'
      THEN 'VEHICULE'
    WHEN u.synthese ~* '(voie publique|parking|[eé]cole|mairie|lieu public|[eé]glise)'
      THEN 'LIEU_PUBLIC'
    ELSE 'INDETERMINE'
  END AS type_lieu,
  0.5 AS confiance,
  '(regex)' AS extrait
FROM una u
LEFT JOIN una_lieu l ON l.una_id = u.id
WHERE u.synthese ~* 'cambriol|effraction|introduction|vol par effraction|carburant|gasoil|gazole|\ygnr\y|essence|fioul|\yfuel\y|siphonn|hydrocarbure'
  AND l.una_id IS NULL;
