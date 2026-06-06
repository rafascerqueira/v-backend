#!/bin/bash
set -euo pipefail

# One-time migration: copy existing local uploads into the MinIO bucket.
#
# Local files live at  $UPLOAD_DIR/<key>  (e.g. products/<seller>/x.jpg, profiles/y.jpg)
# and are mirrored to   s3://$STORAGE_S3_BUCKET/<key>  with the SAME keys, so the
# already-stored URLs (https://api.vendinhas.app/uploads/<key>) keep resolving once
# nginx serves /uploads/ from MinIO. No database changes are required.
#
# Safe to re-run: `mc mirror` only copies new/changed objects.
# Usage: ./scripts/migrate-uploads-to-minio.sh

APP_DIR="${APP_DIR:-/var/www/vendinhas/backend}"

cd "$APP_DIR"
if [ ! -f .env ]; then
  echo "❌ .env not found at $APP_DIR/.env"
  exit 1
fi
set -a
source .env
set +a

UPLOAD_DIR="${UPLOAD_DIR:-/var/www/vendinhas/uploads}"
BUCKET="${STORAGE_S3_BUCKET:-vendinhas-uploads}"

if [ -z "${MINIO_ROOT_USER:-}" ] || [ -z "${MINIO_ROOT_PASSWORD:-}" ]; then
  echo "❌ MINIO_ROOT_USER / MINIO_ROOT_PASSWORD missing from .env"
  exit 1
fi

if [ ! -d "$UPLOAD_DIR" ] || [ -z "$(ls -A "$UPLOAD_DIR" 2>/dev/null)" ]; then
  echo "ℹ️  No files in $UPLOAD_DIR — nothing to migrate."
  exit 0
fi

echo "📦 Migrating $UPLOAD_DIR → s3://$BUCKET ..."

# --network host so the mc container reaches the loopback-bound MinIO (127.0.0.1:9000).
docker run --rm --network host \
  -v "$UPLOAD_DIR":/data:ro \
  --entrypoint /bin/sh \
  minio/mc -c "
    set -e
    mc alias set local http://localhost:9000 '$MINIO_ROOT_USER' '$MINIO_ROOT_PASSWORD'
    mc mb --ignore-existing local/$BUCKET
    # Only product images are public; avatars (profiles/) stay private.
    mc anonymous set download local/$BUCKET/products
    mc mirror --overwrite /data local/$BUCKET
  "

echo "✅ Migration complete. Verify a file, e.g.:"
echo "   curl -I https://api.vendinhas.app/uploads/profiles/<some-id>-profile.jpg"
