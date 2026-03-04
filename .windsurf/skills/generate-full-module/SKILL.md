---
name: generate-full-module
description: Creates a complete production-ready module (controller + service + repository + Zod DTOs + module.ts + Swagger + tests) matching v-backend style
---

## Steps

1. **Scaffold folder** `src/modules/{feature}/` with subdirs: `controllers/`, `services/`, `repositories/`, `dto/`

2. **Repository layer** (use `create-prisma-repository` skill):
   - Interface in `src/shared/repositories/{entity}.repository.ts` with DI Symbol
   - Implementation in `repositories/prisma-{entity}.repository.ts`
   - Reference: Users, Products, Customers modules (compliant examples)

3. **DTOs** in `dto/` folder:
   - Zod schemas for create/update with `z.object({})`
   - Export inferred types: `type CreateDto = z.infer<typeof createSchema>`
   - Add `@ApiProperty()` class wrappers for Swagger visibility
   - Strong password validation where applicable (min 8, upper, lower, digit)

4. **Service** in `services/{feature}.service.ts`:
   - Inject repository via DI token (NEVER PrismaService)
   - Business logic only — no HTTP concerns
   - Use TenantContext.requireSellerId() for multi-tenant filtering

5. **Controller** in `controllers/{feature}.controller.ts`:
   - Thin — delegates to service immediately
   - `@UseGuards(JwtAuthGuard)` + `@UseGuards(PlanLimitsGuard)` on creation endpoints
   - `@UsePipes(new ZodValidationPipe(schema))` on body params
   - Full Swagger: `@ApiTags`, `@ApiBearerAuth`, `@ApiOperation`, `@ApiResponse`

6. **Module** in `{feature}.module.ts`:
   - Import PrismaModule
   - Provide repository binding + service
   - Export service if needed by other modules

7. **Register** in `src/app.module.ts`

8. **Unit Tests**:
   - `services/{feature}.service.spec.ts` — mock repository via DI token
   - `controllers/{feature}.controller.spec.ts` — mock service + ALL guards:
     ```typescript
     .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
     .overrideGuard(PlanLimitsGuard).useValue({ canActivate: () => true })
     ```
   - MUST provide PlanLimitsService mock if PlanLimitsGuard is used

9. **Verify**: `pnpm biome ci . && pnpm build && pnpm test` must all pass