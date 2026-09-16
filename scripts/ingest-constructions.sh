#!/usr/bin/env bash
#
# Ingestion des données BD TOPO thème CONSTRUCTION (jeu `data_geoint`) dans la
# table `bdsp.constructions` du conteneur PostGIS OVH (brunogauville-postgis-bdsp-1).
#
# Voie : conteneur GDAL jetable (ogr2ogr) branché sur le réseau docker privé, car
# `shp2pgsql` est absent de l'image postgis. Les 3 shapefiles (ponctuel / linéaire
# / surfacique) sont fusionnés dans UNE table mixte (colonne `forme`), SRID 2154,
# encodage UTF-8, avec index GiST.
#
# /!\ MODIF PROD : écrit dans la base live `bdsp`. Ne touche QUE la table
# `constructions` (créée / écrasée). Idempotent : relançable sans effet de bord
# sur les autres tables.
#
# Usage :
#   scripts/ingest-constructions.sh --dry-run     # ne touche pas la base : compte les features
#   scripts/ingest-constructions.sh               # ingestion réelle (demande confirmation)
#   DATA_GEOINT=/chemin/vers/data scripts/ingest-constructions.sh
#
set -euo pipefail

# --- Config (surchargeable par env) ---------------------------------------
SRC="${DATA_GEOINT:-/Users/brunogauville/Developpeur/XP-IAka/data_geoint}"
SSH_HOST="${SSH_HOST:-ovh}"
GDAL_IMAGE="${GDAL_IMAGE:-osgeo/gdal:alpine-small-latest}"
NETWORK="${NETWORK:-brunogauville_default}"
DB_HOST="${DB_HOST:-postgis-bdsp}"
DB_NAME="${DB_NAME:-bdsp}"
PG_CONTAINER="${PG_CONTAINER:-brunogauville-postgis-bdsp-1}"
TABLE="${TABLE:-constructions}"
# user/password lus au runtime depuis l'env du conteneur postgis (source de
# vérité DB ; ~/.env peut être périmé).
REMOTE_TMP="/tmp/constructions_ingest"

DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

# fichier -> valeur de la colonne `forme`
declare -a LAYERS=(
  "CONSTRUCTION_PONCTUELLE:ponctuel"
  "CONSTRUCTION_LINEAIRE:lineaire"
  "CONSTRUCTION_SURFACIQUE:surfacique"
)

log() { printf '\033[36m[ingest]\033[0m %s\n' "$*"; }
err() { printf '\033[31m[ingest] ERREUR:\033[0m %s\n' "$*" >&2; }

# --- Vérifs locales -------------------------------------------------------
for pair in "${LAYERS[@]}"; do
  base="${pair%%:*}"
  for ext in shp dbf shx prj; do
    [[ -f "$SRC/$base.$ext" ]] || { err "manquant : $SRC/$base.$ext"; exit 1; }
  done
done
log "source : $SRC"

# --- DRY-RUN : compte les features localement via GDAL distant ? Non : local si ogrinfo dispo,
#     sinon on délègue le comptage au conteneur GDAL sur OVH (aucune écriture DB).
if [[ $DRY -eq 1 ]]; then
  log "DRY-RUN — comptage des features (aucune écriture base)"
  scp_files() { :; }  # pas de copie nécessaire pour le comptage local si ogrinfo présent
  if command -v ogrinfo >/dev/null 2>&1; then
    total=0
    for pair in "${LAYERS[@]}"; do
      base="${pair%%:*}"
      n=$(ogrinfo -so "$SRC/$base.shp" "$base" | awk -F': ' '/Feature Count/{print $2}')
      log "  $base : $n features"
      total=$((total + n))
    done
    log "TOTAL attendu en base : $total"
  else
    err "ogrinfo local absent — relance sans --dry-run (le comptage réel se fait après ingestion)."
    exit 1
  fi
  exit 0
fi

# --- Confirmation (modif prod) --------------------------------------------
log "Cible : ${DB_HOST}/${DB_NAME} table '${TABLE}' (conteneur ${PG_CONTAINER})"
read -r -p "Écrire dans la base PROD '${DB_NAME}' ? tape 'oui' : " ok
[[ "$ok" == "oui" ]] || { err "annulé."; exit 1; }

# --- Copie des shapefiles sur OVH -----------------------------------------
log "copie des shapefiles vers ${SSH_HOST}:${REMOTE_TMP}"
# shellcheck disable=SC2029
ssh "$SSH_HOST" "rm -rf $REMOTE_TMP && mkdir -p $REMOTE_TMP"
for pair in "${LAYERS[@]}"; do
  base="${pair%%:*}"
  scp -q "$SRC/$base".{shp,dbf,shx,prj,cpg} "$SSH_HOST:$REMOTE_TMP/" 2>/dev/null || \
  scp -q "$SRC/$base".{shp,dbf,shx,prj} "$SSH_HOST:$REMOTE_TMP/"
done

# --- Ingestion via GDAL distant -------------------------------------------
# Premier layer : -overwrite (crée/écrase la table). Suivants : -append.
# -nlt GEOMETRY   : autorise Point + LineString + Polygon dans la même colonne.
# LAUNDER=YES     : NATURE->nature, NAT_DETAIL->nat_detail, HAUTEUR->hauteur...
# SPATIAL_INDEX=GIST : index géo créé par ogr2ogr.
log "pull image GDAL + ingestion (peut prendre 1-2 min)"
first=1
for pair in "${LAYERS[@]}"; do
  base="${pair%%:*}"; forme="${pair##*:}"
  mode="-append"; [[ $first -eq 1 ]] && mode="-overwrite"
  log "  $base -> forme=$forme ($mode)"
  # user/pwd lus depuis l'env du conteneur postgis (jamais loggés), passés au conteneur GDAL.
  ssh "$SSH_HOST" bash -s -- "$REMOTE_TMP" "$base" "$forme" "$mode" \
      "$GDAL_IMAGE" "$NETWORK" "$DB_HOST" "$DB_NAME" "$TABLE" "$PG_CONTAINER" <<'REMOTE'
set -euo pipefail
TMP="$1"; BASE="$2"; FORME="$3"; MODE="$4"; IMG="$5"; NET="$6"; DBH="$7"; DBN="$8"; TBL="$9"; PGC="${10}"
PGUSER="$(docker exec "$PGC" printenv POSTGRES_USER)"
PGPASSWORD="$(docker exec "$PGC" printenv POSTGRES_PASSWORD)"
docker run --rm --network "$NET" -e PGPASSWORD="$PGPASSWORD" -v "$TMP":/data "$IMG" \
  ogr2ogr -f PostgreSQL \
    "PG:host=$DBH dbname=$DBN user=$PGUSER" \
    "/data/$BASE.shp" \
    -nln "$TBL" $MODE -nlt GEOMETRY \
    -s_srs EPSG:2154 -t_srs EPSG:2154 \
    -lco GEOMETRY_NAME=geom -lco LAUNDER=YES -lco SPATIAL_INDEX=GIST \
    -sql "SELECT *, '$FORME' AS forme FROM $BASE"
REMOTE
  first=0
done

# --- Vérification counts --------------------------------------------------
log "vérification des comptes en base"
ssh "$SSH_HOST" bash -s -- "$PG_CONTAINER" "$DB_NAME" "$TABLE" <<'VERIF' 2>&1 || true
PGC="$1"; DBN="$2"; TBL="$3"
U="$(docker exec "$PGC" printenv POSTGRES_USER)"
docker exec "$PGC" psql -U "$U" -d "$DBN" -c \
  "SELECT forme, count(*) FROM \"$TBL\" GROUP BY forme ORDER BY forme; SELECT count(*) AS total FROM \"$TBL\";"
VERIF

# --- Cleanup --------------------------------------------------------------
ssh "$SSH_HOST" "rm -rf $REMOTE_TMP"
log "terminé. Attendu : ponctuel=9060, lineaire=31094, surfacique=2235 (total 42389)."
