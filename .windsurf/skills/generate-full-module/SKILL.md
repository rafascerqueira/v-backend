---
name: generate-full-module
description: Creates a complete production-ready module (controller + service + repository + Zod DTOs + module.ts + Swagger + tests) matching v-backend standards. Includes tests by default — skip step 8 if tests are not requested.
---

## Steps

### 1. Scaffold folder structure

```
src/modules/{feature}/
├── controllers/
├── services/
├── repositories/
└── dto/
```

### 2. Repository interface

Create `src/shared/repositories/{entity}.repository.ts`:

```typescript
export interface {Entity} {
  // fields matching Prisma model — no Prisma types, plain TypeScript
}

export interface Create{Entity}Data { ... }
export interface Update{Entity}Data { ... }

export const {ENTITY}_REPOSITORY = Symbol('{Entity}Repository')

export interface {Entity}Repository {
  findById(id: number): Promise<{Entity} | null>
  findAll(sellerId?: string): Promise<{Entity}[]>
  create(data: Create{Entity}Data): Promise<{Entity}>
  update(id: number, data: Update{Entity}Data): Promise<{Entity}>
  delete(id: number): Promise<void>
}
```

Reference: `src/shared/repositories/product.repository.ts`, `customer.repository.ts`.

### 3. Prisma implementation

Create `src/modules/{feature}/repositories/prisma-{entity}.repository.ts`:

```typescript
@Injectable()
export class Prisma{Entity}Repository implements {Entity}Repository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,  // required for tenant-scoped data
  ) {}

  private getTenantFilter() {
    if (this.tenantContext.isAdmin()) return {}
    return { seller_id: this.tenantContext.requireSellerId() }
  }

  // implement interface methods using this.prisma.{model}.*
  // wrap multi-model operations in this.prisma.$transaction()
}
```

> Omit `TenantContext` only for entities that are genuinely not tenant-scoped (e.g., system-wide settings).

Reference: `src/modules/products/repositories/prisma-product.repository.ts`.

### 4. DTOs

Create `src/modules/{feature}/dto/create-{entity}.dto.ts` and `update-{entity}.dto.ts`:

```typescript
import { z } from 'zod'

export const create{Entity}Schema = z.object({
  // fields
})

export type Create{Entity}Dto = z.infer<typeof create{Entity}Schema>
```

Add `@ApiProperty()` wrappers if Swagger visibility is needed.

### 5. Service

Create `src/modules/{feature}/services/{feature}.service.ts`:

```typescript
@Injectable()
export class {Feature}Service {
  constructor(
    @Inject({ENTITY}_REPOSITORY)
    private readonly repo: {Entity}Repository,
  ) {}

  // business logic only — no PrismaService, no HTTP concerns
}
```

### 6. Controller

Create `src/modules/{feature}/controllers/{feature}.controller.ts`:

```typescript
@ApiTags('{feature}')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('{feature}')
export class {Feature}Controller {
  constructor(private readonly service: {Feature}Service) {}

  @Post()
  @UseGuards(PlanLimitsGuard)   // quota enforcement — add @CheckPlanLimit('product'|'customer'|'order')
  @CheckPlanLimit('{limitType}')
  @ApiOperation({ summary: '...' })
  @ApiResponse({ status: 201, description: '...' })
  async create(@Body(new ZodValidationPipe(create{Entity}Schema)) dto: Create{Entity}Dto) {
    return this.service.create(dto)
  }
}
```

Use `PlanGuard` + `@RequiredPlan(...)` or `@RequiredFeature(...)` for plan-tier restrictions.
Only add `PlanLimitsGuard` / `PlanGuard` where the endpoint actually needs enforcement.

### 7. Module

Create `src/modules/{feature}/{feature}.module.ts`:

```typescript
@Module({
  imports: [PrismaModule, TenantModule],  // omit TenantModule if not tenant-scoped
  controllers: [{Feature}Controller],
  providers: [
    {Feature}Service,
    { provide: {ENTITY}_REPOSITORY, useClass: Prisma{Entity}Repository },
  ],
  exports: [{Feature}Service],  // only if consumed by other modules
})
export class {Feature}Module {}
```

### 8. Register in AppModule

Add `{Feature}Module` to the `imports` array in `src/app.module.ts`.

### 9. Tests (skip if not requested)

**Service spec** — `services/{feature}.service.spec.ts`:
```typescript
const repoMock = { findAll: jest.fn(), create: jest.fn(), ... }
const tenantMock = { requireSellerId: jest.fn().mockReturnValue('test-seller'), isAdmin: jest.fn().mockReturnValue(false) }

providers: [
  {Feature}Service,
  { provide: {ENTITY}_REPOSITORY, useValue: repoMock },
  { provide: TenantContext, useValue: tenantMock },
]
```

**Controller spec** — `controllers/{feature}.controller.spec.ts`:
```typescript
.overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
.overrideGuard(PlanLimitsGuard).useValue({ canActivate: () => true })
.overrideGuard(PlanGuard).useValue({ canActivate: () => true })
// Provide PlanLimitsService mock if PlanLimitsGuard or PlanGuard is used
```

### 10. Verify

```bash
pnpm biome ci . && pnpm build && pnpm test
```

All three must pass before the task is complete.