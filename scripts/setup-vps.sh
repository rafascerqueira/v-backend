#!/bin/bash
set -e

# Vendinhas VPS Initial Setup Script
# Run this once on a fresh Hostinger KVM2 VPS
# PostgreSQL and Redis run in Docker containers

echo "🚀 Setting up Vendinhas VPS (Hostinger KVM2)..."

# Update system
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Docker
echo "🐳 Installing Docker..."
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Install Docker Compose plugin
echo "🐳 Installing Docker Compose..."
sudo apt install -y docker-compose-plugin

# Install Node.js 22
echo "📦 Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Install pnpm
echo "📦 Installing pnpm..."
sudo npm install -g pnpm

# Install PM2
echo "📦 Installing PM2..."
sudo npm install -g pm2

# Install Nginx
echo "📦 Installing Nginx..."
sudo apt install -y nginx

# Install Certbot for SSL
echo "📦 Installing Certbot..."
sudo apt install -y certbot python3-certbot-nginx

# Install Git
echo "📦 Installing Git..."
sudo apt install -y git

# Create app directories
echo "📁 Creating app directories..."
sudo mkdir -p /var/www/vendinhas/backend
sudo mkdir -p /var/www/vendinhas/frontend
sudo chown -R $USER:$USER /var/www/vendinhas

# Clone repositories (update URLs with your GitHub repos)
echo "📥 Cloning repositories..."
cd /var/www/vendinhas
git clone https://github.com/rafascerqueira/v-backend.git backend
git clone https://github.com/rafascerqueira/v-frontend.git frontend

# Setup backend
echo "🔧 Setting up backend..."
cd /var/www/vendinhas/backend
pnpm install

# Create .env file
cat > .env << 'EOF'
# Database (Docker container) - UPDATE PASSWORD!
DATABASE_URL="postgresql://vendapp_user:CHANGE_THIS_PASSWORD@localhost:5432/vendapp_db?schema=vendinhas"

# Redis (Docker container)
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_KEYS_DIR=./keys
JWT_SECRET=your_jwt_secret_here
JWT_REFRESH_SECRET=your_refresh_secret_here
JWT_ACCESS_TOKEN_EXPIRES_IN=1d
JWT_REFRESH_TOKEN_EXPIRES_IN=7d

# App
PORT=3001
NODE_ENV=production
CORS_ORIGIN=https://vendinhas.app
APP_URL=https://api.vendinhas.app
FRONTEND_URL=https://vendinhas.app
EOF

echo "⚠️  Edit /var/www/vendinhas/backend/.env with your production secrets!"

# Generate RSA keys for JWT
echo "🔑 Generating RSA keys..."
mkdir -p keys
openssl genrsa -out keys/private.pem 2048
openssl rsa -in keys/private.pem -pubout -out keys/public.pem
chmod 600 keys/private.pem

# Create .env for Docker Compose
echo "🐳 Creating Docker environment file..."
cat > .env.docker << 'EOF'
POSTGRES_USER=vendapp_user
POSTGRES_PASSWORD=CHANGE_THIS_SECURE_PASSWORD
POSTGRES_DB=vendapp_db
POSTGRES_SCHEMA=vendinhas
EOF

echo "⚠️  Edit /var/www/vendinhas/backend/.env.docker with a secure password!"

# Start Docker containers (PostgreSQL + Redis)
echo "🐳 Starting PostgreSQL and Redis containers..."
export $(cat .env.docker | xargs)
docker compose up -d

# Wait for containers to be healthy
echo "⏳ Waiting for database to be ready..."
sleep 10

# Generate Prisma client and run migrations
echo "🗄️ Running database migrations..."
pnpm prisma generate
pnpm prisma migrate deploy

# Seed database (optional)
echo "🌱 Seeding database..."
pnpm prisma db seed || true

# Build backend
echo "🏗️ Building backend..."
pnpm build
mkdir -p logs

# Setup frontend
echo "🔧 Setting up frontend..."
cd /var/www/vendinhas/frontend
pnpm install

# Create .env.local
echo "NEXT_PUBLIC_API_URL=https://api.vendinhas.app" > .env.local

# Build frontend
echo "🏗️ Building frontend..."
pnpm build
mkdir -p logs

# Start PM2 apps
echo "▶️ Starting PM2 apps..."
cd /var/www/vendinhas/backend
pm2 start ecosystem.config.js --env production

cd /var/www/vendinhas/frontend
pm2 start ecosystem.config.js --env production

# Save PM2 config and setup startup
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp /home/$USER

# Setup Nginx
echo "🌐 Setting up Nginx..."
sudo cp /var/www/vendinhas/backend/nginx/vendinhas.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/vendinhas.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo ""
echo "=============================================="
echo "✅ VPS setup completed!"
echo "=============================================="
echo ""
echo "📝 Next steps:"
echo ""
echo "1. Edit production secrets:"
echo "   nano /var/www/vendinhas/backend/.env"
echo ""
echo "2. Setup SSL certificates:"
echo "   sudo certbot --nginx -d vendinhas.app -d www.vendinhas.app -d api.vendinhas.app"
echo ""
echo "3. Configure GitHub secrets for CI/CD:"
echo "   - VPS_HOST: $(curl -s ifconfig.me)"
echo "   - VPS_USER: $USER"
echo "   - VPS_SSH_KEY: (your SSH private key)"
echo ""
echo "4. Verify services are running:"
echo ""
docker ps
echo ""
pm2 status
echo ""
echo "🔗 URLs:"
echo "   Frontend: https://vendinhas.app"
echo "   API: https://api.vendinhas.app"
echo "   API Docs: https://api.vendinhas.app/api/docs"
