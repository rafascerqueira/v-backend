#!/bin/bash
set -euo pipefail

# Vendinhas Backend Deploy Script
# Usage: ./scripts/deploy.sh [branch]
# Called by GitHub Actions deploy workflow or manually on VPS

APP_DIR="/var/www/vendinhas/backend"
BRANCH="${1:-main}"
BACKUP_DIR="/var/www/vendinhas/backups"
HEALTH_URL="http://localhost:3001/health"
HEALTH_RETRIES=5
HEALTH_DELAY=3

rollback() {
  echo "❌ Deploy failed! Rolling back..."
  if [ -d "$BACKUP_DIR/dist" ]; then
    rm -rf "$APP_DIR/dist"
    cp -r "$BACKUP_DIR/dist" "$APP_DIR/dist"
    echo "♻️ Restored previous dist/"
  fi
  if [ -f "$BACKUP_DIR/package.json" ]; then
    cp "$BACKUP_DIR/package.json" "$APP_DIR/package.json"
    cp "$BACKUP_DIR/pnpm-lock.yaml" "$APP_DIR/pnpm-lock.yaml"
    cd "$APP_DIR" && pnpm install --frozen-lockfile
    echo "♻️ Restored previous dependencies"
  fi
  source_env
  pm2 reload ecosystem.config.js --update-env || true
  echo "♻️ PM2 reloaded with previous build"
  exit 1
}

source_env() {
  if [ -f "$APP_DIR/.env" ]; then
    set -a
    source "$APP_DIR/.env"
    set +a
  else
    echo "⚠️ No .env file found at $APP_DIR/.env"
    exit 1
  fi
}

health_check() {
  echo "🏥 Running health check..."
  for i in $(seq 1 $HEALTH_RETRIES); do
    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
      echo "✅ Health check passed (attempt $i/$HEALTH_RETRIES)"
      return 0
    fi
    echo "⏳ Health check attempt $i/$HEALTH_RETRIES failed, retrying in ${HEALTH_DELAY}s..."
    sleep $HEALTH_DELAY
  done
  echo "❌ Health check failed after $HEALTH_RETRIES attempts"
  return 1
}

trap rollback ERR

echo "🚀 Deploying Vendinhas Backend..."
echo "📍 Branch: $BRANCH"
echo "📅 $(date -Iseconds)"

cd "$APP_DIR"

# Backup current state
echo "💾 Backing up current state..."
mkdir -p "$BACKUP_DIR"
if [ -d "dist" ]; then
  rm -rf "$BACKUP_DIR/dist"
  cp -r dist "$BACKUP_DIR/dist"
fi
cp package.json "$BACKUP_DIR/package.json"
cp pnpm-lock.yaml "$BACKUP_DIR/pnpm-lock.yaml"

# Pull latest changes
echo "📥 Pulling latest changes from $BRANCH..."
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile

# Generate Prisma client
echo "🔧 Generating Prisma client..."
source_env
pnpm prisma generate

# Run migrations
echo "🗄️ Running database migrations..."
pnpm prisma migrate deploy

# Apply database triggers and functions
if [ -f "prisma/migrations/manual/subscription_triggers.sql" ]; then
  echo "🔧 Applying database triggers and functions..."
  psql "$DATABASE_URL" -f prisma/migrations/manual/subscription_triggers.sql 2>/dev/null || echo "⚠️ Triggers may already exist (skipped)"
fi

# Build application
echo "🏗️ Building application..."
pnpm build

# Reload PM2 with environment from .env
echo "♻️ Reloading PM2..."
pm2 reload ecosystem.config.js --update-env

# Health check
if ! health_check; then
  rollback
fi

echo ""
echo "✅ Backend deploy completed successfully!"
echo "📅 $(date -Iseconds)"
pm2 status
