#!/bin/bash
set -e

# =============================================================================
# Vendinhas VPS Initial Setup Script
# Para Hostinger VPS KVM2 com Ubuntu 22.04/24.04
# Executa uma vez em uma VPS limpa
# =============================================================================

echo "🚀 Configurando VPS Vendinhas (Hostinger KVM2)..."
echo ""

# Detectar IP da VPS
VPS_IP=$(curl -s ifconfig.me 2>/dev/null || echo "UNKNOWN")
echo "📍 IP da VPS: $VPS_IP"
echo ""

# Update system
echo "📦 Atualizando pacotes do sistema..."
sudo apt update && sudo apt upgrade -y

# Install essential tools
echo "📦 Instalando ferramentas essenciais..."
sudo apt install -y curl wget git htop unzip software-properties-common

# Install Docker
echo "🐳 Instalando Docker..."
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Install Docker Compose plugin
echo "🐳 Instalando Docker Compose..."
sudo apt install -y docker-compose-plugin

# Install Node.js 22 LTS
echo "📦 Instalando Node.js 22 LTS..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Install pnpm
echo "📦 Instalando pnpm..."
sudo npm install -g pnpm

# Install PM2
echo "📦 Instalando PM2..."
sudo npm install -g pm2

# Install Nginx
echo "📦 Instalando Nginx..."
sudo apt install -y nginx

# Install Certbot for SSL
echo "📦 Instalando Certbot (Let's Encrypt)..."
sudo apt install -y certbot python3-certbot-nginx

# Install PostgreSQL client for running SQL scripts
echo "📦 Instalando cliente PostgreSQL..."
sudo apt install -y postgresql-client

# Install Postfix for email
echo "📧 Instalando Postfix para envio de emails..."
sudo debconf-set-selections <<< "postfix postfix/mailname string vendinhas.app"
sudo debconf-set-selections <<< "postfix postfix/main_mailer_type string 'Internet Site'"
sudo apt install -y postfix mailutils

# Configure Postfix
echo "📧 Configurando Postfix..."
sudo postconf -e "myhostname = vendinhas.app"
sudo postconf -e "mydomain = vendinhas.app"
sudo postconf -e "myorigin = vendinhas.app"
sudo postconf -e "mydestination = localhost"
sudo postconf -e "relayhost ="
sudo postconf -e "inet_interfaces = loopback-only"
sudo postconf -e "smtp_tls_security_level = may"
sudo postconf -e "smtp_tls_CAfile = /etc/ssl/certs/ca-certificates.crt"
sudo systemctl restart postfix
sudo systemctl enable postfix

# Create app directories
echo "📁 Criando diretórios da aplicação..."
sudo mkdir -p /var/www/vendinhas/backend
sudo mkdir -p /var/www/vendinhas/frontend
sudo mkdir -p /var/www/vendinhas/uploads
sudo mkdir -p /var/www/vendinhas/backups
sudo mkdir -p /var/log/pm2
sudo chown -R $USER:$USER /var/www/vendinhas
sudo chown -R $USER:$USER /var/log/pm2

# Clone repositories
echo "📥 Clonando repositórios..."
cd /var/www/vendinhas
if [ ! -d "backend/.git" ]; then
  git clone https://github.com/rafascerqueira/v-backend.git backend
fi
if [ ! -d "frontend/.git" ]; then
  git clone https://github.com/rafascerqueira/v-frontend.git frontend
fi

# Generate secrets
echo "🔐 Gerando secrets seguros..."
JWT_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')

# Setup backend
echo "🔧 Configurando backend..."
cd /var/www/vendinhas/backend
pnpm install --frozen-lockfile

# Create .env file
cat > .env << EOF
# ===========================================
# SERVIDOR
# ===========================================
NODE_ENV=production
PORT=3001
CORS_ORIGIN=https://vendinhas.app

# ===========================================
# BANCO DE DADOS (PostgreSQL)
# ===========================================
DATABASE_URL="postgresql://vendapp_user:${POSTGRES_PASSWORD}@localhost:5432/vendapp_db"

POSTGRES_USER=vendapp_user
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=vendapp_db
POSTGRES_HOST=localhost
POSTGRES_PORT=5432

# ===========================================
# JWT (Autenticação)
# ===========================================
JWT_KEYS_DIR=./keys
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_ACCESS_TOKEN_EXPIRES_IN=1d
JWT_REFRESH_TOKEN_EXPIRES_IN=7d

# ===========================================
# REDIS (Cache e Sessões)
# ===========================================
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_DEFAULT_TTL=3600
REDIS_KEY_PREFIX=vendinhas:

# ===========================================
# URLs da Aplicação
# ===========================================
APP_URL=https://api.vendinhas.app
FRONTEND_URL=https://vendinhas.app

# ===========================================
# EMAIL (Postfix local)
# ===========================================
SMTP_HOST=localhost
SMTP_PORT=25
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@vendinhas.app

# ===========================================
# UPLOAD DE ARQUIVOS
# ===========================================
UPLOAD_DIR=/var/www/vendinhas/uploads
UPLOAD_MAX_SIZE=5242880

# ===========================================
# STRIPE (Pagamentos) - Opcional
# ===========================================
# STRIPE_SECRET_KEY=sk_live_xxx
# STRIPE_WEBHOOK_SECRET=whsec_xxx
# STRIPE_PRICE_PRO=price_xxx
# STRIPE_PRICE_ENTERPRISE=price_xxx
EOF

echo "✅ Arquivo .env criado com secrets gerados automaticamente!"

# Generate RSA keys for JWT
echo "🔑 Gerando chaves RSA para JWT..."
mkdir -p keys
openssl genrsa -out keys/private.pem 2048
openssl rsa -in keys/private.pem -pubout -out keys/public.pem
chmod 600 keys/private.pem

# Create .env for Docker Compose
echo "🐳 Criando arquivo de ambiente Docker..."
cat > .env.docker << EOF
POSTGRES_USER=vendapp_user
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=vendapp_db
EOF

# Start Docker containers (PostgreSQL + Redis)
echo "🐳 Iniciando containers PostgreSQL e Redis..."
docker compose up -d

# Wait for containers to be healthy
echo "⏳ Aguardando banco de dados ficar pronto..."
sleep 15

# Generate Prisma client and run migrations
echo "🗄️ Executando migrations do banco de dados..."
pnpm prisma generate
pnpm prisma migrate deploy

# Apply database triggers and functions
echo "🔧 Aplicando triggers e funções do banco..."
if [ -f "prisma/migrations/manual/subscription_triggers.sql" ]; then
  source .env 2>/dev/null || true
  psql "$DATABASE_URL" -f prisma/migrations/manual/subscription_triggers.sql || echo "⚠️ Aviso: Não foi possível aplicar triggers"
fi

# Seed database (optional)
echo "🌱 Populando banco de dados..."
pnpm prisma db seed || true

# Build backend
echo "🏗️ Compilando backend..."
pnpm build

# Setup frontend
echo "🔧 Configurando frontend..."
cd /var/www/vendinhas/frontend
pnpm install --frozen-lockfile

# Create .env.local
echo "NEXT_PUBLIC_API_URL=https://api.vendinhas.app" > .env.local

# Build frontend
echo "🏗️ Compilando frontend..."
pnpm build

# Start PM2 with backend ecosystem.config.js (env vars loaded from .env)
echo "▶️ Iniciando aplicações com PM2..."
cd /var/www/vendinhas/backend
set -a
source .env
set +a
pm2 start ecosystem.config.js --update-env

# Save PM2 config and setup startup
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp /home/$USER

# Setup Nginx using canonical config from repo
echo "🌐 Configurando Nginx..."
sudo cp /var/www/vendinhas/backend/nginx/vendinhas.conf /etc/nginx/sites-available/vendinhas.conf
sudo ln -sf /etc/nginx/sites-available/vendinhas.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo ""
echo "=============================================="
echo "✅ Configuração da VPS concluída!"
echo "=============================================="
echo ""
echo "📋 Secrets gerados automaticamente:"
echo "   JWT_SECRET: ${JWT_SECRET:0:16}..."
echo "   JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET:0:16}..."
echo "   POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:0:8}..."
echo ""
echo "📝 Próximos passos:"
echo ""
echo "1. Configurar SSL (Let's Encrypt):"
echo "   sudo certbot --nginx -d vendinhas.app -d www.vendinhas.app"
echo ""
echo "2. Configurar DNS (no provedor de domínio):"
echo "   A     @       $VPS_IP"
echo "   A     www     $VPS_IP"
echo "   A     mail    $VPS_IP"
echo "   TXT   @       v=spf1 ip4:$VPS_IP ~all"
echo "   TXT   _dmarc  v=DMARC1; p=none"
echo "   MX    @       mail.vendinhas.app (prioridade 10)"
echo ""
echo "3. Testar envio de email:"
echo "   echo 'Teste' | mail -s 'Teste Vendinhas' seu@email.com"
echo ""
echo "4. Configurar GitHub Secrets para CI/CD:"
echo "   - VPS_HOST: $VPS_IP"
echo "   - VPS_USER: $USER"
echo "   - VPS_SSH_KEY: (chave SSH privada)"
echo ""
echo "5. Verificar serviços:"
echo ""
docker ps
echo ""
pm2 status
echo ""
echo "🔗 URLs (após configurar SSL):"
echo "   Site:    https://vendinhas.app"
echo "   API:     https://api.vendinhas.app"
echo "   Swagger: https://api.vendinhas.app/docs"
echo "   Health:  https://api.vendinhas.app/health"
