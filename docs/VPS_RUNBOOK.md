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

## Incidents

### 2026-04-20 — `GET /suppliers` returning HTTP 500 in production

**Symptom**
```
GET https://api.vendinhas.app/suppliers → 500
[GlobalExceptionFilter] Invalid `prisma.supplier.findMany()` invocation:
  The table `public.suppliers` does not exist in the current database.
```

**Root cause — three compounding factors**

1. **Stale `search_path` on the DB role.** Someone had manually run
   `ALTER ROLE vendapp_user SET search_path = vendinhas, public` at some point
   (not in any repo script, no trace in `.github/`, `scripts/` or
   `init-db.sql`). This was leftover from an early attempt to use a custom
   schema, later abandoned in favor of the `public`-only policy (see
   `Known Constraints` — `@prisma/adapter-pg` 7.x bug).
2. **A migration stuck mid-flight.** Migration
   `20260308043600_add_store_fields_and_notifications` was recorded with
   `started_at` but `finished_at = NULL`. It had failed months earlier with
   `42701: column "store_banner" of relation "accounts" already exists`
   because the DDL had been applied manually beforehand. Prisma refused to
   apply any subsequent migration until this one was resolved.
3. **All subsequent migrations silently created objects in the wrong schema.**
   When the stuck migration was eventually resolved and
   `prisma migrate deploy` ran, the 8 pending migrations created
   `suppliers`, `supplier_debts`, `promotions`, `bundles`, `bundle_items`,
   the view `v_seller_stats`, and three enums in schema `vendinhas`
   (because of the role's `search_path`). The application, which queries
   unqualified table names, kept resolving them against `public` and hit
   the "table does not exist" error.

Additional detail: `public.customers.billing_mode` was created referencing
the enum `vendinhas.BillingMode`, creating a cross-schema dependency that
prevented a naive `DROP SCHEMA vendinhas CASCADE` (would have dropped the
column in `public.customers`).

**Resolution**

1. Full `pg_dump` backup at
   `/var/www/vendinhas/backups/vendapp_db_20260420_010658_pre_migrate_fix.sql.gz`.
2. Created the one missing index from the stuck migration
   (`idx_accounts_store_slug`) manually, then
   `pnpm prisma migrate resolve --applied 20260308043600_add_store_fields_and_notifications`.
3. `pnpm prisma migrate deploy` — applied the 8 pending migrations (into the
   wrong schema, as it turned out).
4. Single atomic transaction to migrate everything back to `public`:
   - Cloned the three enums (`BillingMode`, `PromotionStatus`,
     `SupplierDebtStatus`) into `public`.
   - `ALTER TABLE public.customers ALTER COLUMN billing_mode TYPE public."BillingMode" USING billing_mode::text::public."BillingMode"`.
   - Recreated the 5 tables + FKs + indexes + the `v_seller_stats` view in
     `public` (SQL copied verbatim from the migration files — all tables
     were empty, so no data migration needed).
   - `DROP SCHEMA vendinhas CASCADE`.
   - `ALTER ROLE vendapp_user RESET search_path`.
5. `pm2 reload vendinhas-api --update-env`.
6. Verified: `GET /suppliers` → `401` (auth required, endpoint working),
   `GET /health` → `200`.

**Preventive actions applied**

- `search_path` reset on `vendapp_user` (back to the default
  `"$user", public`).
- Schema `vendinhas` dropped. Only `public` remains.
- `POSTGRES_SCHEMA=vendinhas` removed from `/var/www/vendinhas/backend/.env`.
  It was an orphan variable — not read by `DATABASE_URL` nor by
  `prisma.config.ts`.
- Removed leftover untracked files under `backend/` that were a stale
  manual deploy: `migrations/`, `schema.prisma`, `seed.ts`,
  `vendinhas.conf`. Deploys happen via `scripts/deploy.sh` triggered by
  GitHub Actions.

**Open follow-ups (not addressed in this incident)**

- `.env.docker` (versioned) still contains `POSTGRES_SCHEMA=vendinhas`.
  It's inert today (nothing reads it), but it's a documentation
  landmine — future readers may assume a custom schema is in use.
- `.env.docker` contains the Postgres password in plaintext and is
  pushed to GitHub. That credential should be considered compromised
  and rotated; `.env.docker` should either be gitignored with a
  `.env.docker.example` placeholder, or use dummy values safe for
  public exposure.
- `scripts/setup-vps.sh` provisions a fresh VPS with a clean database,
  so this specific failure mode wouldn't reproduce automatically. But
  if anyone ever re-introduces a `CREATE SCHEMA` + `ALTER ROLE ... SET search_path`
  pattern, guard against it by asserting the role config on startup.

**Debugging recipes (re-usable)**

Check current state of the DB role and schemas:
```bash
docker exec -i vendinhas-postgres psql -U vendapp_user -d vendapp_db -c \
  "SELECT rolname, rolconfig FROM pg_roles WHERE rolname='vendapp_user';"

docker exec -i vendinhas-postgres psql -U vendapp_user -d vendapp_db -c \
  "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema';"
```

Check for migrations stuck mid-apply:
```bash
docker exec -i vendinhas-postgres psql -U vendapp_user -d vendapp_db -c \
  "SELECT migration_name, finished_at IS NOT NULL AS applied, rolled_back_at FROM _prisma_migrations ORDER BY started_at;"
```
