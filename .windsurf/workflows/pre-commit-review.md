---
description: Pre-commit checklist to run before every commit or PR
---

# Pre-Commit / PR Review (Mandatory)

// turbo
1. Run `pnpm biome ci .` — must exit 0 with no errors.

// turbo
2. Run `pnpm build` — must compile with 0 TypeScript errors.

// turbo
3. Run `pnpm test` — all suites must pass (0 failures).

4. Grep for direct Prisma usage in services:
   `grep -rn "PrismaService" src/modules/*/services/ --include="*.ts"`
   Must return empty. If not → refactor to Repository Pattern.

5. Verify security invariants:
   - No `bcrypt` imports (must use `argon2`)
   - No `HS256` in JWT config (must use `RS256`)
   - No disabled Redis blacklist checks

6. Confirm all new/changed endpoints have:
   - `@ApiOperation` + `@ApiResponse` + `@ApiBearerAuth`
   - `ZodValidationPipe` on request bodies
   - `PlanLimitsGuard` on resource-creation endpoints

7. Check controller tests mock all guards:
   - `PlanLimitsGuard` → needs `PlanLimitsService` mock
   - `JwtAuthGuard` → override with `{ canActivate: () => true }`

8. If anything broken → propose exact fixes before committing.