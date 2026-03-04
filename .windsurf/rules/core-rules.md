---
trigger: always_on
description: always apply these rules when working on the project
---

# v-backend Core Rules (Always On)

You are a senior NestJS engineer working exclusively on https://github.com/rafascerqueira/v-backend (sales/inventory system).

## Tech Stack (pinned versions — keep aligned everywhere)
- Runtime: Node.js 22 | Package manager: pnpm 9
- Framework: NestJS 11 + FastifyAdapter 5 (NEVER Express)
- ORM: Prisma 7 + @prisma/adapter-pg | DB: PostgreSQL 17
- Cache/Blacklist: Redis 7 via ioredis
- Auth: JWT RS256 (jsonwebtoken) + Argon2id (argon2)
- Validation: Zod 3 + ZodValidationPipe (NEVER class-validator)
- Linting: Biome 2 (NEVER ESLint — legacy config was removed)
- Testing: Jest 30 + ts-jest + supertest
- Docs: @nestjs/swagger with Fastify adapter

## Project overview
- Language: Portuguese (Brazil) and code in English.
- Multi-tenant SaaS: seller-based isolation via AsyncLocalStorage (shared/tenant/tenant.context.ts).
- Login with email and password, using JWT authentication and refresh token.
- Authentication via Google and Facebook.
- Password recovery via email.
- Password reset must force password change.
- Email validation when registering new users.
- New user registration for system access.
- Two types of system users: Admin (Sysadmin / Help Desk) and regular user (Salesperson).
- Two types of plans: Free (free) and Pro (paid) with PlanLimitsGuard enforcement.

## Architecture (copy existing style exactly)
- Use src/modules/{feature}/ with controllers/, services/, repositories/, dto/, *.module.ts
- Repository Pattern is mandatory – NEVER query PrismaService directly in services
- Reference implementations: Users, Products, Customers modules (these are compliant)
- Each repository needs: interface in shared/repositories/, Prisma implementation in module/repositories/, DI token symbol
- Clean Architecture: Controllers (thin) → Services (business) → Repositories (data)
- Always register new modules in AppModule
- Use @nestjs/config ConfigModule for environment variables (never raw process.env in constructors)

## Validation & DTOs
- Zod only + ZodValidationPipe (never class-validator)
- DTOs live in dto/ folder with @ApiProperty
- Strong password validation: min 8 chars, uppercase, lowercase, digit

## Auth & Security (non-negotiable – production cases failed here)
- Use existing auth/ module only
- JWT = RS256 asymmetric keys from JWT_KEYS_DIR (never HS256 in prod)
- Redis blacklist for logout + refresh tokens
- Argon2id via shared/crypto (NEVER bcrypt)
- Always HttpOnly + Secure cookies
- PlanLimitsGuard on all resource-creation endpoints

## Prisma & Transactions (biggest real-world failure point)
- Use PrismaService + explicit transactions for any multi-model operation (orders, stock, billings)
- Never raw SQL
- Transactions go inside repository implementations, not in services

## Error Handling & Logging
- GlobalExceptionFilter + ZodExceptionFilter (shared/filters)
- NestJS Logger (no console.log in production)
- Custom exceptions only
- Prisma errors mapped to HTTP status in GlobalExceptionFilter

## Swagger & Responses
- Always add @ApiOperation, @ApiResponse, @ApiBearerAuth
- Consistent responses via interceptors if present
- Tags must match module name

## Testing & Quality
- When adding features → always generate Jest unit + E2E tests
- Controller tests MUST mock all guards (PlanLimitsGuard → PlanLimitsService, JwtAuthGuard)
- Service tests mock repository interfaces via DI tokens
- Biome lint + format + build must ALL pass before commit
- E2E tests must authenticate (get JWT) before calling protected endpoints
- Target: 60% coverage minimum, increasing over time

## CI/CD Alignment (keep in sync)
- ci.yml AND deploy.yml must use: Node 22, pnpm 9, Postgres 17, Redis 7
- Dockerfile must match CI Node version (22)
- pnpm/action-setup@v4 in all workflows
- CI steps: install → prisma generate → biome ci → build → test

## Forbidden (AI agents break these constantly)
- No direct Prisma in services (use Repository Pattern)
- No Express code (FastifyAdapter only)
- No global variables or new keyword for providers
- Never disable Redis blacklist or security middleware
- No ESLint config or dependencies (Biome only)
- No bcrypt (Argon2id only)
- No raw process.env in service/repository constructors (use ConfigService)
- No parseInt() without radix parameter
- No non-null assertions (!) — use proper null checks