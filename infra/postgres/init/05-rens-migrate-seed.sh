#!/bin/sh
# First-volume only (docker-entrypoint-initdb.d). Applies rens migrations
# 001–012 then frs_seed.sql as superuser $POSTGRES_USER (sesame), after
# 01-databases / 02-passwords (roles exist). SQL stays in git; compose
# bind-mounts migrations + seed under /opt/rens/.
set -eu

MIG_DIR=/opt/rens/migrations
SEED=/opt/rens/frs_seed.sql

if ! ls "$MIG_DIR"/*.sql >/dev/null 2>&1; then
  echo "rens migrate: aucun SQL dans $MIG_DIR" >&2
  exit 1
fi
if [ ! -f "$SEED" ]; then
  echo "rens seed: frs_seed.sql manquant" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname rens <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

for f in "$MIG_DIR"/*.sql; do
  base=$(basename "$f")
  echo "rens migrate: $base"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname rens -f "$f"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname rens \
    -c "INSERT INTO schema_migrations (filename) VALUES ('${base}') ON CONFLICT DO NOTHING;"
done

echo "rens seed: frs_seed.sql"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname rens -f "$SEED"
