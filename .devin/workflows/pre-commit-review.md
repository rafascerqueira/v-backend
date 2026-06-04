---
description: Mandatory checklist before every commit or PR
---

# Pre-Commit Review

Run all steps in order. Fix any failure before committing.

---

## 1. Linter + formatter

```bash
pnpm biome ci .
```
Must exit 0 with no errors.

## 2. Build

```bash
pnpm build
```
Must compile with 0 TypeScript errors.

## 3. Tests

```bash
pnpm test
```
All suites must pass (0 failures).

## 4. Repository pattern — no direct Prisma in services

```bash
grep -rn "PrismaService" src/modules/*/services/ --include="*.ts"
```
Must return empty. Any hit → move to repository.

## 5. Tenant isolation — repositories for scoped entities must use TenantContext

```bash
grep -rL "TenantContext" src/modules/*/repositories/prisma-*.repository.ts
```
Review each result. If the entity has a `seller_id` column and `TenantContext` is absent → add it.

## 6. Security invariants

- No `bcrypt` imports anywhere (must use `argon2`)
- No `HS256` in JWT config (must use `RS256`)
- Redis blacklist check not disabled in `JwtAuthGuard`

## 7. Endpoint completeness

Every new or changed endpoint must have:
- `@ApiOperation` + `@ApiResponse` + `@ApiBearerAuth`
- `ZodValidationPipe` on request bodies
- `PlanLimitsGuard` + `@CheckPlanLimit(...)` on resource-creation endpoints (products, customers, orders)
- `PlanGuard` + `@RequiredPlan(...)` or `@RequiredFeature(...)` where plan-tier restriction applies

## 8. Controller test guard mocks

Every controller spec must mock all guards applied to the controller:

```typescript
.overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
.overrideGuard(PlanLimitsGuard).useValue({ canActivate: () => true })
.overrideGuard(PlanGuard).useValue({ canActivate: () => true })
```

When `PlanLimitsGuard` or `PlanGuard` is present, provide a `PlanLimitsService` mock in the test module.

## 9. If anything fails

Propose exact fixes before committing. Do not commit a broken build.