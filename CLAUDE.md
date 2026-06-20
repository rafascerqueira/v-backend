# v-backend

NestJS 11 + Fastify 5 API for Vendinhas — multi-tenant SaaS for sales management.

## Stack

| | |
|---|---|
| Runtime | Node.js 22 |
| Package manager | pnpm 9.15.0 — **never npm or yarn** |
| Framework | NestJS 11 + FastifyAdapter 5 — **never Express** |
| ORM | Prisma 7.3 + @prisma/adapter-pg |
| Database | PostgreSQL 17 — schema `public` only |
| Cache / blacklist | Redis 7 via ioredis 5 |
| Auth | JWT RS256 (jsonwebtoken) + Argon2id — **never bcrypt, never HS256** |
| Validation | Zod 4 — **never class-validator** |
| Queue | BullMQ via @nestjs/bullmq |
| Linting | Biome 2 — **never ESLint** |
| Testing | Jest 30 + ts-jest + supertest |

## Commands

```bash
# Dev
docker compose up -d          # start PostgreSQL + Redis
pnpm install
pnpm prisma generate
pnpm prisma migrate dev
pnpm start:dev                # runs dev-prestart.js then nest start --watch

# Verify before committing
pnpm biome ci .
pnpm build
pnpm test

# Database
pnpm prisma migrate dev       # new migration
pnpm prisma migrate deploy    # apply in production
pnpm db:seed

# E2E
pnpm test:db:up
pnpm test:e2e
pnpm test:db:down
```

## Module structure

```
src/modules/{feature}/
├── {feature}.module.ts
├── controllers/
├── services/         # business logic — no PrismaService here
├── repositories/     # PrismaService lives here only
└── dto/              # Zod schemas + z.infer<> types
```

```
src/shared/
├── prisma/           # PrismaService singleton
├── redis/            # RedisService (ioredis)
├── queue/            # BullMQ — QueueModule + QueueProducer + processors
├── repositories/     # Repository interfaces + DI symbols
├── tenant/           # TenantContext (AsyncLocalStorage)
├── crypto/           # Argon2id hashing
├── email/            # EmailService (nodemailer)
├── filters/          # GlobalExceptionFilter + ZodExceptionFilter
└── websocket/        # NotificationsGateway + NotificationService
```

## Architecture rules

- **Repository Pattern** — services never import PrismaService directly. **All DB access lives in the repository, including `$transaction` and multi-table writes** — a service must stay Prisma-free even when logic needs a transaction (move the whole unit of work into a repository method).
- **TenantContext** — inject in every repository that has a `seller_id` column; use `requireSellerId()` for writes, `isAdmin()` to bypass filters. Enforce ownership in the repo for point mutations (`update`/`delete` by id), not only in the service.
- **Exceptions** — services *and repositories* throw Nest `HttpException`s (`NotFoundException`, `BadRequestException`, `ForbiddenException`, …), never raw `throw new Error()`, so the response carries the correct HTTP status (a raw `Error` surfaces as **500** via `GlobalExceptionFilter`). Cross-tenant rows should 404 (don't leak existence).
- **QueueProducer** — use for any operation with side effects (email, notifications, PDF); never call EmailService directly from a service or controller
- Controllers are HTTP boundary only — validate input, call service, return
- Use `ConfigService` for env vars — never raw `process.env` in constructors
- Always register new modules in `AppModule`

## Path aliases

```
@/...            → src/
@infrastructure/ → src/shared/
```

## Auth

- All routes require `JwtAuthGuard` by default
- `@Public()` to bypass
- `@CurrentUser()` to extract user — never access `request.user` directly
- `PlanLimitsGuard` + `@CheckPlanLimit('product'|'customer'|'order')` on creation endpoints (usage limits)
- Plan **feature**-gating: `FeatureGuard` + `@RequiredFeature('reports'|'exportData'|'multipleImages'|'customBranding'|...)` enforces the `PLAN_LIMITS[plan].features` matrix (403 with a pt-BR upgrade message; admins bypass; resolves the **effective** plan — admin grants + promo window). Use it for endpoint-level gates; for value-based gates (e.g. image count) call `PlanLimitsService.hasFeature(sellerId, planType, feature)` inside the service. A raw `@RequiredPlan(tier)` guard is intentionally **not** used — gating is feature-flag based.

## Testing

Mock all guards in controller specs:
```typescript
.overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
.overrideGuard(PlanLimitsGuard).useValue({ canActivate: () => true })
.overrideGuard(FeatureGuard).useValue({ canActivate: () => true }) // on reports/export controllers
```

Mock repositories via DI token in service specs — never use real PrismaService in unit tests.

## Skills

Read the relevant skill file before starting these tasks:

| Task | File |
|---|---|
| New feature module (CRUD + tests) | `.devin/skills/generate-full-module/SKILL.md` |
| Repository interface + Prisma implementation | `.devin/skills/create-prisma-repository/SKILL.md` |

Extended context when needed:

| Topic | File |
|---|---|
| Full architecture & conventions | `.devin/rules/core-rules.md` |
| Refactoring an existing module | `.devin/rules/refactoring-rules.md` |
| Pre-commit checklist | `.devin/workflows/pre-commit-review.md` |

## Keeping context in sync

`CLAUDE.md` is a subset of `.devin/rules/core-rules.md`. When a task introduces a new architecture rule, package, or convention, flag it at task end — do not update either file unilaterally. The user decides what to propagate to both.

## Never

- Direct Prisma in services — including `$transaction`; put transactional/multi-table logic in the repository
- Raw `throw new Error()` for user-facing conditions — use a Nest `HttpException` so the status code is correct (raw `Error` → 500)
- Express / class-validator / ESLint / bcrypt / HS256
- Raw `process.env` in constructors
- Float values for monetary amounts (integers/cents only)
- Non-null assertions (`!`) — use proper null checks
- `parseInt()` without radix
- Instantiate PrismaClient or ioredis directly
- Call EmailService directly from services — enqueue via QueueProducer