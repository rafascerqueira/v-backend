# VPS Runbook — Vendinhas Backend

> Backend-focused operations + incident history. The **canonical** end-to-end
> deploy, bootstrap, and disaster-recovery guide is `DEPLOY.md` at the monorepo
> root — when the two disagree, `DEPLOY.md` and the live pipeline win. Keep this
> file in sync with it.

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
│   PM2 fork, 1 inst.   │   │   PM2 fork, 1 inst.   │
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
- **App runtime**: Node.js 22 + PM2 (fork mode, 1 instance per app)
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
│   ├── dist/             # Compiled JS (built on the CI runner, rsynced in)
│   ├── keys/             # RSA keys for JWT (NOT in git)
│   ├── ecosystem.config.js  # PM2 config (from repo)
│   └── nginx/vendinhas.conf # Canonical Nginx config
├── frontend/             # v-frontend repo (Next.js)
├── uploads/              # User-uploaded files
│   ├── products/
│   ├── profiles/
│   └── temp/
└── backups/              # Nightly DB dumps (cron) + rollback artifacts (manual deploy.sh)
    ├── dist/             # Previous compiled output
    ├── package.json
    └── pnpm-lock.yaml
```

## Deploy Flow

Deploys are triggered automatically by GitHub Actions on push to `main`. The VPS
**does not build** — artifacts are compiled on the GitHub runner and rsynced in.
(Full guide: `DEPLOY.md` at the monorepo root.)

1. **CI jobs** (GitHub-hosted runners): lint (`biome ci`) → build → unit tests,
   plus a separate **E2E** job (supertest against ephemeral Postgres + Redis) and
   a `pnpm audit` CVE gate that fails on CRITICAL advisories.
2. **Deploy job** (gated on CI + E2E, `main` only): builds on the runner, then
   rsyncs `dist/`, `prisma/`, `package.json`, `pnpm-lock.yaml`,
   `ecosystem.config.js`, and `nginx/` into `/var/www/vendinhas/backend/`.
3. **Activate over SSH** — inlined in the workflow; it does **not** call
   `deploy.sh`:
   1. `pnpm install --frozen-lockfile`
   2. `source .env` → `pnpm prisma generate`
   3. `pnpm prisma migrate deploy`
   4. **Migration-drift guard**: aborts before any reload if the migration
      directories on disk ≠ applied rows in `_prisma_migrations`.
   5. Apply `prisma/migrations/manual/subscription_triggers.sql` if present.
   6. Copy `nginx/vendinhas.conf` → `nginx -t` → reload nginx.
   7. `pm2 reload ecosystem.config.js --update-env`.
4. **Health check** (on the VPS): `curl http://localhost:3001/health/liveness`,
   5 retries 15s apart. The CI deploy does **not** auto-roll-back — to recover
   from a bad deploy, re-run the last green workflow.

### Manual deploy fallback — `scripts/deploy.sh`

`scripts/deploy.sh` is **not** what CI runs; it's a manual, on-box fallback for
when GitHub Actions is down or the pipeline is broken. Unlike the pipeline it
**builds on the VPS**: backs up the current `dist/` + manifests → `git pull` →
`pnpm install --frozen-lockfile` → `prisma generate` → `prisma migrate deploy` →
`pnpm build` → `pm2 reload --update-env` → health check, and its `trap`
**auto-rolls-back** to the previous `dist/` on failure.

```bash
cd /var/www/vendinhas/backend
./scripts/deploy.sh main
```

> The script's header comment still reads "Called by GitHub Actions deploy
> workflow" — that's **stale**. The workflow inlines its own activation steps
> (above) and never invokes `deploy.sh`.

## Environment Variables

PM2 receives environment variables from the shell. Both the deploy pipeline and `deploy.sh` source `.env` before `pm2 reload --update-env`.

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

The manual `scripts/deploy.sh` auto-rolls-back on a failed health check. The
**GitHub Actions deploy does not** — to recover from a bad CI deploy, re-run the
last green workflow (on the prior commit's run page). For a manual rollback to
the previous build (the backup only exists if `deploy.sh` has run):

```bash
cd /var/www/vendinhas/backend
cp -r /var/www/vendinhas/backups/dist ./dist
set -a && source .env && set +a
pm2 reload ecosystem.config.js --update-env
```

## GitHub Actions Secrets

Configured under **Settings → Environments → production** (the deploy job runs
with `environment: production`):

| Secret | Description |
|--------|-------------|
| `VPS_HOST` | VPS IP address or hostname |
| `VPS_USER` | SSH username on the VPS (owns `/var/www/vendinhas`, runs PM2) |
| `VPS_SSH_KEY` | Full private SSH key (`-----BEGIN ... END-----`) |
| `VPS_KNOWN_HOSTS` | *(optional)* pinned SSH host key; if unset the deploy falls back to `ssh-keyscan` with retries |

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
  `vendinhas.conf`. Automated deploys rsync build artifacts from the GitHub
  Actions pipeline (not a manual on-box build), so these shouldn't reappear.

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
