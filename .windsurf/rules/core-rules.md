---
trigger: always_on
description: Always apply these rules when working on the project
---

# v-backend — Core Rules

You are a senior NestJS engineer working on https://github.com/rafascerqueira/v-backend — a multi-tenant SaaS for sales management (Vendinhas).

---

## Stack (pinned — do not suggest alternatives)

| Layer | Package | Version |
|---|---|---|
| Runtime | Node.js | 22 |
| Package manager | pnpm | 9.15.0 |
| Framework | NestJS + FastifyAdapter | 11 (NEVER Express) |
| ORM | Prisma + @prisma/adapter-pg | 7.3.0 |
| Database | PostgreSQL | 17 — schema `public` only |
| Cache / blacklist | ioredis | 5 |
| Auth | jsonwebtoken RS256 + argon2 | — |
| Validation | Zod | 4 (NEVER class-validator) |
| Linter | Biome | 2 (NEVER ESLint) |
| Testing | Jest + ts-jest + supertest | Jest 30 |
| Docs | @nestjs/swagger with Fastify adapter | 11 |

---

## Project overview

- UI language: Portuguese (Brazil). Code identifiers: English.
- Multi-tenant: seller isolation via `TenantContext` (AsyncLocalStorage) at `shared/tenant/tenant.context.ts`.
- Two user roles: `admin` (Sysadmin/Help Desk) and `user` (Salesperson).
- Two plans: `free` and `pro`, enforced via `PlanLimitsGuard` and `PlanGuard`.
- Auth: email/password + Google + Facebook. JWT RS256 access (1d) + refresh (7d) tokens.
- Tokens returned in response body AND set as HttpOnly cookies.
- Password reset forces change. Email verification on registration.

---

## Module structure (actual — not aspirational)

```
src/modules/{feature}/
├── {feature}.module.ts
├── controllers/          # One controller per route group
├── services/             # Business logic, no Prisma
├── repositories/         # Prisma implementation only
└── dto/                  # Zod schemas + inferred types
```

`structure.md` in the repo root describes a DDD layout (`application/`, `domain/`, `infrastructure/`) that is **not yet implemented**. Do not apply it unless explicitly instructed.

---

## Architecture rules

- **Repository Pattern is mandatory.** Services never import or call `PrismaService` directly.
- Each repository needs: interface + DI Symbol in `shared/repositories/`, Prisma implementation in `module/repositories/prisma-{entity}.repository.ts`.
- **TenantContext is required in every repository** that reads or writes tenant-scoped data. Inject it alongside PrismaService. Use `tenantContext.requireSellerId()` for mutations, `tenantContext.isAdmin()` to bypass filters for admin role.
- Controllers are HTTP boundary only — validate input, call service, return result. No business logic.
- Always register new modules in `AppModule`.
- Use `ConfigService` for environment variables. Never use raw `process.env` in constructors.

---

## Path aliases (tsconfig)

```
@/...             → src/
@domain/...       → src/domain/       (not yet in use)
@infrastructure/  → src/shared/
@interfaces/...   → src/interfaces/   (not yet in use)
```

---

## Auth & Security (non-negotiable — production failures have occurred here)

- JWT: RS256 asymmetric keys from `JWT_KEYS_DIR`. Never HS256 in production.
- Password hashing: `shared/crypto/` with explicit `{ type: argon2.argon2id }`. Never bcrypt.
- Every authenticated request checks Redis blacklist before accepting the token.
- All routes require `JwtAuthGuard` by default. Mark public routes with `@Public()`.
- Use `@CurrentUser()` to extract user from request. Never access `request.user` directly.
- No Passport.js — guards are custom `CanActivate` implementations.
- Always HttpOnly + Secure cookies.

---

## Plan enforcement guards (two separate guards — use both correctly)

| Guard | Location | Purpose |
|---|---|---|
| `PlanLimitsGuard` | `subscriptions/guards/plan-limits.guard.ts` | Enforces **quota limits** (max products, customers, orders/month). Use `@CheckPlanLimit('product' \| 'customer' \| 'order')` on creation endpoints. |
| `PlanGuard` | `subscriptions/guards/plan.guard.ts` | Enforces **plan tier and feature flags**. Use `@RequiredPlan(...)` or `@RequiredFeature(...)` decorators. |

Both are exported from `SubscriptionsModule` (global). Import neither — they're already available globally.

---

## Validation & DTOs

- Zod schemas only. No classes, no `class-validator`.
- Declare schemas as `const`, export inferred type via `z.infer<typeof schema>`.
- DTOs live in `dto/` inside the module that owns them.
- Add `@ApiProperty()` wrappers for Swagger visibility.
- Password validation: min 8 chars, uppercase, lowercase, digit.

---

## Prisma & Transactions

- `PrismaService` is injected only in repository implementations.
- Wrap multi-model operations in `this.prisma.$transaction()` inside the repository.
- Never raw SQL. Migrations via `pnpm prisma migrate dev` only.
- Monetary values: integers (cents). Never floats.
- `sales_db_schema.md` in repo root is aspirational SQL. Do not treat it as current state.

---

## Error handling & logging

- Throw NestJS built-in exceptions (`NotFoundException`, `UnauthorizedException`, etc.).
- `GlobalExceptionFilter` + `ZodExceptionFilter` in `shared/filters/` handle formatting.
- Use `NestJS Logger`. Never `console.log` in production code.

---

## Swagger

- Every endpoint needs `@ApiTags`, `@ApiOperation`, `@ApiResponse`, `@ApiBearerAuth`.
- Tags must match module name.

---

## Testing

- Unit tests: `.spec.ts` co-located with the file under test.
- E2E tests: `/test/` directory.
- Controller tests must mock all guards:
  ```typescript
  .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
  .overrideGuard(PlanLimitsGuard).useValue({ canActivate: () => true })
  .overrideGuard(PlanGuard).useValue({ canActivate: () => true })
  ```
- When `PlanLimitsGuard` or `PlanGuard` is present, provide a `PlanLimitsService` mock.
- Service tests mock repository interfaces via DI tokens. Never use real PrismaService in unit tests.
- E2E tests must authenticate (obtain JWT) before calling protected endpoints.
- Coverage target: 60% minimum, collected from `modules/**/controllers/**` and `modules/**/services/**`.
- Biome + build + tests must all pass before any commit.

---

## CI/CD

- `ci.yml` and `deploy.yml`: Node 22, pnpm 9, Postgres 17, Redis 7.
- CI steps: install → prisma generate → biome ci → build → test.
- Deploy: SSH → `scripts/deploy.sh` (backup → pull → install → migrate → build → PM2 reload → health check → rollback on failure).
- VPS: PM2 cluster (2 instances) + Docker (Postgres + Redis) + Nginx.
- Domains: `vendinhas.app` (frontend) / `api.vendinhas.app` (backend).
- Database schema: always `public` (never custom schemas — `@prisma/adapter-pg` constraint).

---

## Ports

```
API (NestJS/Fastify)  → :3001
Frontend (Next.js)    → :3000
PostgreSQL            → :5432
Redis                 → :6379
Swagger UI            → http://localhost:3001/api/docs
Health check          → http://localhost:3001/health
```

---

## Forbidden (agents break these constantly)

- Direct Prisma calls in services
- Express code or middleware
- `class-validator` or `class-transformer`
- ESLint or Prettier config/dependencies
- `bcrypt` (use `argon2`)
- HS256 JWT in production
- Raw `process.env` in constructors (use `ConfigService`)
- Instantiating `PrismaClient` or `ioredis` directly
- `parseInt()` without radix
- Non-null assertions (`!`) — use proper null checks
- Disabling Redis blacklist or security middleware
- Raw SQL migration files
- Float values for monetary amounts