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

- **Repository Pattern** — services never import PrismaService directly
- **TenantContext** — inject in every repository that has a `seller_id` column; use `requireSellerId()` for writes, `isAdmin()` to bypass filters
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
- `PlanLimitsGuard` + `@CheckPlanLimit('product'|'customer'|'order')` on creation endpoints
- `PlanGuard` + `@RequiredPlan(...)` for plan-tier restrictions

## Testing

Mock all guards in controller specs:
```typescript
.overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
.overrideGuard(PlanLimitsGuard).useValue({ canActivate: () => true })
.overrideGuard(PlanGuard).useValue({ canActivate: () => true })
```

Mock repositories via DI token in service specs — never use real PrismaService in unit tests.

## Skills

Read the relevant skill file before starting these tasks:

| Task | File |
|---|---|
| New feature module (CRUD + tests) | `.windsurf/skills/generate-full-module/SKILL.md` |
| Repository interface + Prisma implementation | `.windsurf/skills/create-prisma-repository/SKILL.md` |

Extended context when needed:

| Topic | File |
|---|---|
| Full architecture & conventions | `.windsurf/rules/core-rules.md` |
| Refactoring an existing module | `.windsurf/rules/refactoring-rules.md` |
| Pre-commit checklist | `.windsurf/workflows/pre-commit-review.md` |

## Keeping context in sync

`CLAUDE.md` is a subset of `.windsurf/rules/core-rules.md`. When a task introduces a new architecture rule, package, or convention, flag it at task end — do not update either file unilaterally. The user decides what to propagate to both.

## Never

- Direct Prisma in services
- Express / class-validator / ESLint / bcrypt / HS256
- Raw `process.env` in constructors
- Float values for monetary amounts (integers/cents only)
- Non-null assertions (`!`) — use proper null checks
- `parseInt()` without radix
- Instantiate PrismaClient or ioredis directly
- Call EmailService directly from services — enqueue via QueueProducer