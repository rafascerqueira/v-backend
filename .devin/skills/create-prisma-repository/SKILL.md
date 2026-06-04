---
name: create-prisma-repository
description: Scaffolds a repository interface + Prisma implementation + DI binding following v-backend patterns
---

## Steps

### 1. Interface in `src/shared/repositories/{entity}.repository.ts`

```typescript
// Plain TypeScript types — no Prisma imports
export interface {Entity} {
  id: number  // or string for Account
  seller_id: string
  // ... remaining fields
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

Reference: `src/shared/repositories/product.repository.ts`, `customer.repository.ts`, `account.repository.ts`.

### 2. Prisma implementation in `src/modules/{feature}/repositories/prisma-{entity}.repository.ts`

```typescript
@Injectable()
export class Prisma{Entity}Repository implements {Entity}Repository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,  // inject for tenant-scoped entities
  ) {}

  private getTenantFilter() {
    if (this.tenantContext.isAdmin()) return {}
    return { seller_id: this.tenantContext.requireSellerId() }
  }

  async create(data: Create{Entity}Data): Promise<{Entity}> {
    return this.prisma.{model}.create({ data }) as unknown as {Entity}
  }

  async findById(id: number): Promise<{Entity} | null> {
    const record = await this.prisma.{model}.findUnique({ where: { id } })
    if (!record) return null
    if (!this.tenantContext.isAdmin() && record.seller_id !== this.tenantContext.getSellerId()) return null
    return record as unknown as {Entity}
  }

  // Wrap multi-model operations in this.prisma.$transaction()
}
```

> Omit `TenantContext` only for entities with no `seller_id` (e.g., `SystemSetting`).

Reference: `src/modules/products/repositories/prisma-product.repository.ts`.

### 3. Register in module

```typescript
// {feature}.module.ts
imports: [PrismaModule, TenantModule],  // add TenantModule when TenantContext is injected
providers: [
  { provide: {ENTITY}_REPOSITORY, useClass: Prisma{Entity}Repository },
  {Feature}Service,
]
```

### 4. Inject in service via DI token

```typescript
constructor(
  @Inject({ENTITY}_REPOSITORY)
  private readonly repo: {Entity}Repository,
) {}
```

Never import `PrismaService` or `PrismaModule` in the service file.