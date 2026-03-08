# VPS Runbook — Vendinhas Backend

## Infrastructure Overview

```
┌─────────────────────────────────────────────────────────┐
│                        NGINX                            │
│              (Reverse Proxy + SSL)                      │
│                    :80 / :443                           │
└───────────────┬─────────────────────┬───────────────────┘
                │                     │
                ▼                     ▼
┌───────────────────────┐   ┌───────────────────────┐
│   vendinhas.app       │   │  api.vendinhas.app    │
│   (Next.js :3000)     │   │   (NestJS :3001)      │
│   PM2 - 2 instances   │   │   PM2 - 2 instances   │
└───────────────────────┘   └───────────┬───────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    │                                       │
                    ▼                                       ▼
        ┌───────────────────────┐           ┌───────────────────────┐
        │  vendinhas-postgres   │           │   vendinhas-redis     │
        │  (PostgreSQL :5432)   │           │   (Redis :6379)       │
        │  Docker Container     │           │   Docker Container    │
        └───────────────────────┘           └───────────────────────┘
```

- **VPS**: Hostinger KVM2, Ubuntu 22.04/24.04
- **Domain**: vendinhas.app (frontend) / api.vendinhas.app (backend API)
- **App runtime**: Node.js 22 + PM2 (cluster mode, 2 instances)
- **Database**: PostgreSQL 17 (Docker) — `public` schema only
- **Cache**: Redis 7 (Docker)
- **Reverse proxy**: Nginx + Let's Encrypt SSL
- **Process manager**: PM2 with systemd startup

## Directory Layout

```
/var/www/vendinhas/
├── backend/              # v-backend repo (NestJS API)
│   ├── .env              # Environment variables (NOT in git)
│   ├── .env.docker       # Docker Compose env (NOT in git)
│   ├── dist/             # Compiled JS (built by deploy.sh)
│   ├── keys/             # RSA keys for JWT (NOT in git)
│   ├── ecosystem.config.js  # PM2 config (from repo)
│   └── nginx/vendinhas.conf # Canonical Nginx config
├── frontend/             # v-frontend repo (Next.js)
├── uploads/              # User-uploaded files
│   ├── products/
│   ├── profiles/
│   └── temp/
└── backups/              # Rollback artifacts (managed by deploy.sh)
    ├── dist/             # Previous compiled output
    ├── package.json
    └── pnpm-lock.yaml
```

## Deploy Flow

Deploys are triggered automatically by GitHub Actions on push to `main`:

1. **CI job** (GitHub-hosted runner): lint → build → test
2. **Deploy job** (SSH to VPS): runs `scripts/deploy.sh main`
3. **External health check**: `curl https://api.vendinhas.app/health`

### What `deploy.sh` does:
1. Backs up current `dist/`, `package.json`, `pnpm-lock.yaml` to `/var/www/vendinhas/backups/`
2. `git pull origin main`
3. `pnpm install --frozen-lockfile`
4. Sources `.env` and runs `pnpm prisma generate`
5. `pnpm prisma migrate deploy`
6. `pnpm build`
7. `pm2 reload ecosystem.config.js --update-env` (env vars from `.env`)
8. Local health check with retries
9. **On failure**: automatic rollback to previous `dist/` + PM2 reload

### Manual deploy:
```bash
cd /var/www/vendinhas/backend
./scripts/deploy.sh main
```

## Environment Variables

PM2 receives environment variables from the shell. The `deploy.sh` script sources `.env` before reloading PM2 with `--update-env`.

**Never hardcode secrets in `ecosystem.config.js`.**

Required variables are documented in `.env.example`. Key production values:
- `NODE_ENV=production`
- `PORT=3001`
- `DATABASE_URL=postgresql://vendapp_user:<YOUR_PASSWORD>@localhost:5432/vendapp_db` (no schema param — uses `public`)
- `APP_URL=https://api.vendinhas.app`
- `FRONTEND_URL=https://vendinhas.app`
- `JWT_KEYS_DIR=./keys`

## Common Operations

### Check service status
```bash
pm2 status
docker ps
```

### View logs
```bash
pm2 logs vendinhas-api --lines 50
docker logs vendinhas-postgres --tail 50
docker logs vendinhas-redis --tail 50
```

### Restart services
```bash
# Reload API (zero-downtime)
cd /var/www/vendinhas/backend
set -a && source .env && set +a
pm2 reload ecosystem.config.js --update-env

# Restart Docker containers
docker compose --env-file .env.docker up -d
```

### Access database
```bash
docker exec -it vendinhas-postgres psql -U vendapp_user -d vendapp_db
```

### Run migrations manually
```bash
cd /var/www/vendinhas/backend
source .env
pnpm prisma migrate deploy
```

### Renew SSL certificate
```bash
sudo certbot renew
# or force renew:
sudo certbot --nginx -d vendinhas.app -d www.vendinhas.app -d api.vendinhas.app
```

### Update Nginx config
```bash
sudo cp /var/www/vendinhas/backend/nginx/vendinhas.conf /etc/nginx/sites-available/vendinhas.conf
sudo nginx -t
sudo systemctl reload nginx
```

## Rollback

`deploy.sh` handles rollback automatically on failure. For manual rollback:

```bash
cd /var/www/vendinhas/backend
cp -r /var/www/vendinhas/backups/dist ./dist
set -a && source .env && set +a
pm2 reload ecosystem.config.js --update-env
```

## GitHub Actions Secrets

Configure at: https://github.com/rafascerqueira/v-backend/settings/secrets/actions

| Secret | Description |
|--------|-------------|
| `VPS_HOST` | VPS IP address or hostname |
| `VPS_USER` | SSH username on the VPS |
| `VPS_SSH_KEY` | Full private SSH key (`-----BEGIN ... END-----`) |

## Known Constraints

- **Schema**: Always use PostgreSQL `public` schema. The `@prisma/adapter-pg 7.x` has bugs with custom schemas.
- **PM2 + .env**: PM2 does not load `.env` files natively. Always source `.env` before `pm2 reload --update-env`.
- **Docker Compose .env**: Use `docker compose --env-file .env.docker up -d` (not plain `docker compose up`).

## DNS Records

| Type | Name | Value |
|------|------|-------|
| A | @ | VPS_IP |
| A | www | VPS_IP |
| A | api | VPS_IP |
| A | mail | VPS_IP |
| TXT | @ | `v=spf1 ip4:VPS_IP ~all` |
| TXT | _dmarc | `v=DMARC1; p=none` |
| MX | @ | `mail.vendinhas.app` (priority 10) |
