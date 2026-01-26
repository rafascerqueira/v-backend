#!/bin/bash
set -e

# Vendinhas Backend Deploy Script
# Usage: ./scripts/deploy.sh

APP_DIR="/var/www/vendinhas/backend"
BRANCH="${1:-main}"

echo "🚀 Deploying Vendinhas Backend..."

cd $APP_DIR

# Pull latest changes
echo "📥 Pulling latest changes from $BRANCH..."
git fetch origin
git checkout $BRANCH
git pull origin $BRANCH

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile

# Generate Prisma client
echo "🔧 Generating Prisma client..."
pnpm prisma generate

# Run migrations
echo "🗄️ Running database migrations..."
pnpm prisma migrate deploy

# Apply database triggers and functions
echo "🔧 Applying database triggers and functions..."
if [ -f "prisma/migrations/manual/subscription_triggers.sql" ]; then
  source .env 2>/dev/null || true
  psql "$DATABASE_URL" -f prisma/migrations/manual/subscription_triggers.sql || echo "⚠️ Warning: Could not apply triggers (may already exist)"
fi

# Build application
echo "🏗️ Building application..."
pnpm build

# Create logs directory
mkdir -p logs

# Restart PM2
echo "♻️ Restarting PM2..."
pm2 reload ecosystem.config.js --env production

echo "✅ Backend deploy completed!"
pm2 status
