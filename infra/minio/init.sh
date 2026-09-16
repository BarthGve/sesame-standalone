#!/bin/sh
set -e
# Bucket perquisitions — credentials = placeholders air-gap LAN (compose), pas prod.
until mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"; do
  sleep 1
done
mc mb --ignore-existing local/perquisitions
