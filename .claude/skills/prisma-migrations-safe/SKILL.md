---
name: prisma-migrations-safe
description: >
  Safely author and apply Prisma migrations in v-backend (Prisma 7.3 +
  @prisma/adapter-pg, PostgreSQL 17). Use when creating, editing, applying,
  resolving, or debugging migrations: `prisma migrate dev/deploy/resolve`,
  schema.prisma changes, _prisma_migrations, migration drift, stuck/failed
  migrations, "table does not exist", wrong/custom schema, search_path,
  backfill/data-correction migrations, subscription_triggers.sql, deploy
  migration step on the VPS. Keywords: migration, drift, public schema,
  P3009, P3005, migrate resolve, _prisma_migrations.
---

# Prisma migrations — safe authoring & recovery

Complements `.devin/skills/create-prisma-repository/SKILL.md` (that one is for
repository code; this one is for the migration/SQL/deploy layer). Do **not**
edit anything under `.devin/`.

## When to use

- Adding/altering a model or enum in `prisma/schema.prisma`.
- Writing a data-correction / backfill migration.
- Diagnosing a failed `prisma migrate deploy` or a deploy aborted by the
  migration-drift guard.
- Recovering a migration stuck mid-flight (`finished_at = NULL`).

## Non-negotiable rules

1. **`public` schema only.** `@prisma/adapter-pg 7.x` mishandles custom
   schemas. Never `CREATE SCHEMA`, never add `?schema=` to `DATABASE_URL`,
   never `ALTER ROLE ... SET search_path`. All objects live in `public`.
2. **Migrate via the CLI, not by hand.** New migration = `pnpm prisma migrate
   dev`. Production applies with `pnpm prisma migrate deploy` (the pipeline runs
   this). Never edit applied migration SQL after it has shipped.
3. **One migration dir = one applied row.** The deploy guard asserts
   `count(dirs on disk, excluding manual/) == count(_prisma_migrations rows
   where finished_at IS NOT NULL AND rolled_back_at IS NULL)`. Anything that
   breaks that parity aborts the deploy *before* nginx/PM2 reload.
4. **Money is integers (cents).** Backfill/UPDATE SQL must never produce floats
   for monetary columns.
5. **`manual/` is VPS-only.** `prisma/migrations/manual/subscription_triggers.sql`
   is excluded from the `--delete` rsync and applied separately on deploy. It is
   not a tracked migration and must not get a `_prisma_migrations` row.
6. **Backfills are pure data** — no DDL mixed in unless the schema change and the
   data fix genuinely belong to the same unit. Document *why* in a leading
   comment (see the `per_sale` backfill).

## Playbook

1. **Author a schema migration**
   - Edit `prisma/schema.prisma`, then `docker compose up -d` + `pnpm prisma
     migrate dev --name <snake_case_name>`.
   - Review the generated `prisma/migrations/<ts>_<name>/migration.sql`. Confirm
     every object is unqualified (resolves to `public`) — no `vendinhas.` or any
     schema prefix.
   - `pnpm prisma generate`, then `pnpm build` + `pnpm test`.

2. **Author a backfill / data-correction migration**
   - `pnpm prisma migrate dev --create-only --name backfill_<thing>` to get an
     empty dir without auto-DDL.
   - Write idempotent SQL (scope with a `WHERE`, e.g. `... IS NULL`), lead with a
     comment explaining the data bug and the fix. Pattern:
     `prisma/migrations/20260613120000_backfill_per_sale_billing_due_date/migration.sql`.
   - Keep timezone/money semantics consistent with how the app writes the column.

3. **Apply in production** — handled by the pipeline `Activate on VPS` step:
   `source .env` → `prisma generate` → `prisma migrate deploy` → drift guard →
   apply `subscription_triggers.sql` if present → nginx → PM2. To run by hand on
   the box: `cd /var/www/vendinhas/backend && source .env && pnpm prisma migrate
   deploy`.

4. **Recover a stuck/failed migration** (the 2026-04-20 recipe)
   - Inspect state:
     ```bash
     docker exec -i vendinhas-postgres psql -U vendapp_user -d vendapp_db -c \
       "SELECT migration_name, finished_at IS NOT NULL AS applied, rolled_back_at \
        FROM _prisma_migrations ORDER BY started_at;"
     ```
   - If a row has `started_at` but `finished_at = NULL`, deploy is blocked.
     **Backup first**: `pg_dump` to `/var/www/vendinhas/backups/...`.
   - Bring the DB to the migration's intended end-state by hand (only the *missing*
     objects), then mark it resolved:
     ```bash
     pnpm prisma migrate resolve --applied <migration_name>
     ```
     Use `--rolled-back <name>` instead if you fully reverted it.
   - Re-run `pnpm prisma migrate deploy`, then re-check drift parity.

5. **Verify schema sanity after any recovery**
   ```bash
   docker exec -i vendinhas-postgres psql -U vendapp_user -d vendapp_db -c \
     "SELECT rolname, rolconfig FROM pg_roles WHERE rolname='vendapp_user';"
   docker exec -i vendinhas-postgres psql -U vendapp_user -d vendapp_db -c \
     "SELECT nspname FROM pg_namespace \
      WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema';"
   ```
   `rolconfig` must be NULL/default (no `search_path`); the only app schema must
   be `public`.

## Checklist

- [ ] schema.prisma + generated migration.sql reviewed; all objects in `public`.
- [ ] No `search_path` / `CREATE SCHEMA` / `?schema=` introduced.
- [ ] Backfills are idempotent, scoped by `WHERE`, money stays integer cents.
- [ ] `pnpm prisma generate` + `pnpm build` + `pnpm test` pass locally.
- [ ] Dirs on disk (excluding `manual/`) will equal applied rows after deploy.
- [ ] If touching triggers, edited the VPS `manual/subscription_triggers.sql`
      idempotently — not added a tracked migration.

## Gotchas — the 2026-04-20 incident

`GET /suppliers` returned 500 (`public.suppliers does not exist`) from three
compounding causes:

1. A leftover `ALTER ROLE vendapp_user SET search_path = vendinhas, public` (no
   trace in any repo script) — relic of an abandoned custom-schema attempt.
2. Migration `20260308043600_add_store_fields_and_notifications` stuck with
   `finished_at = NULL` (had failed months earlier: `42701 column ... already
   exists` because DDL was applied manually first). Prisma then refused every
   later migration.
3. When the stuck one was resolved and `migrate deploy` ran, the 8 pending
   migrations created `suppliers`, `promotions`, `bundles`, a view and three
   enums **in schema `vendinhas`** (because of the role `search_path`), while the
   app queries unqualified names → resolved to `public` → "does not exist".

A cross-schema dependency (`public.customers.billing_mode` referencing
`vendinhas.BillingMode`) blocked a naive `DROP SCHEMA vendinhas CASCADE`.
Resolution: backup → resolve the stuck migration → migrate deploy → one atomic
transaction cloning enums/tables/view back into `public` → `DROP SCHEMA vendinhas
CASCADE` → `ALTER ROLE vendapp_user RESET search_path`. Lesson: **always verify
the role has no `search_path` and only `public` exists** after any DB surgery.

Other traps:
- `migrate dev` is dev-only; production uses `migrate deploy` (never `dev` on the
  VPS).
- Hand-applying DDL before the migration runs causes the `42701 already exists`
  failure that wedges the chain — don't.
- `.env.docker` still ships an inert `POSTGRES_SCHEMA=vendinhas` (orphan, nothing
  reads it). Do not wire it into anything.

## References

- `prisma/schema.prisma`, `prisma/migrations/`, `prisma/migrations/migration_lock.toml`
- Backfill pattern: `prisma/migrations/20260613120000_backfill_per_sale_billing_due_date/migration.sql`
- Drift guard + manual trigger apply: `.github/workflows/pipeline.yml` (`Activate on VPS`)
- Incident + psql recipes: `docs/VPS_RUNBOOK.md` (2026-04-20; "Known Constraints")
- Schema/transaction rules: `CLAUDE.md`, `.devin/rules/core-rules.md` ("Prisma & Transactions")
- Repository code: `.devin/skills/create-prisma-repository/SKILL.md`
