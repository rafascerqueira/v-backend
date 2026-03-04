---
name: generate-nest-module
description: Creates a complete NestJS module following v-backend standards (controller, service, repository, Zod DTOs, module.ts, Swagger)
---

## Steps

1. **Create folder structure**: `src/modules/{feature}/controllers/`, `services/`, `repositories/`, `dto/`

2. **Repository**: Follow `create-prisma-repository` skill exactly.
   - Interface + DI Symbol in `src/shared/repositories/`
   - Prisma implementation in `repositories/prisma-{entity}.repository.ts`

3. **DTO**: Zod schema in `dto/` — export schema + inferred type.

4. **Service**: Inject repository via `@Inject(SYMBOL)`. No PrismaService import.

5. **Controller**: Use guards (`JwtAuthGuard`, `PlanLimitsGuard`), pipes (`ZodValidationPipe`), and full Swagger decorators (`@ApiTags`, `@ApiBearerAuth`, `@ApiOperation`, `@ApiResponse`).

6. **Module**: Import `PrismaModule`, bind repository via `{ provide: SYMBOL, useClass: PrismaImpl }`, declare controllers, provide services.

7. **Register** in `AppModule`.

8. **Tests**: Generate controller + service specs. Mock guards:
   ```typescript
   .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
   .overrideGuard(PlanLimitsGuard).useValue({ canActivate: () => true })
   ```
   Provide `PlanLimitsService` mock when `PlanLimitsGuard` is present.