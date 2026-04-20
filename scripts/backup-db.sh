#!/bin/bash
set -euo pipefail

# Vendinhas Database Backup Script
# Usage: ./scripts/backup-db.sh
# Intended to be called by cron — see DEPLOY.md for installation.

BACKUP_DIR="/var/www/vendinhas/backups"
ENV_FILE="/var/www/vendinhas/backend/.env"
CONTAINER="vendinhas-postgres"
RETENTION_DAYS=7

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [ -z "${POSTGRES_USER:-}" ] || [ -z "${POSTGRES_DB:-}" ]; then
  echo "Error: POSTGRES_USER or POSTGRES_DB missing from $ENV_FILE"
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "Error: container ${CONTAINER} is not running"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_FILE="${BACKUP_DIR}/${POSTGRES_DB}-${TIMESTAMP}.sql.gz"

echo "Backing up ${POSTGRES_DB} → ${BACKUP_FILE}"
docker exec "$CONTAINER" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  | gzip > "$BACKUP_FILE"

if [ ! -s "$BACKUP_FILE" ]; then
  echo "Error: backup file is empty — removing"
  rm -f "$BACKUP_FILE"
  exit 1
fi

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "Backup OK (${SIZE})"

echo "Pruning backups older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -maxdepth 1 -name "${POSTGRES_DB}-*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete

echo "Done"
