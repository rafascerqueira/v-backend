---
name: create-prisma-repository
description: Generates a repository class with PrismaService injection following v-backend repository pattern
---

## Steps

1. **Create the interface** in `src/shared/repositories/{entity}.repository.ts`:
   - Define entity type (matching Prisma model fields)
   - Define CreateData / UpdateData types
   - Define the repository interface with CRUD methods + any domain queries
   - Export a DI token: `export const {ENTITY}_REPOSITORY = Symbol('{Entity}Repository')`
   - Reference: `src/shared/repositories/account.repository.ts`, `product.repository.ts`, `customer.repository.ts`

2. **Create the Prisma implementation** in `src/modules/{feature}/repositories/prisma-{entity}.repository.ts`:
   - `@Injectable()` class implementing the interface
   - Inject `PrismaService` in constructor
   - Use `this.prisma.{model}.create/findUnique/findMany/update/delete`
   - Wrap multi-model operations in `this.prisma.$transaction()`
   - Reference: `src/modules/users/repositories/prisma-account.repository.ts`

3. **Register in the module** (`{feature}.module.ts`):
   ```typescript
   providers: [
     { provide: {ENTITY}_REPOSITORY, useClass: Prisma{Entity}Repository },
   ]
   ```

4. **Inject in the service** via DI token:
   ```typescript
   constructor(@Inject({ENTITY}_REPOSITORY) private readonly repo: {Entity}Repository) {}
   ```

5. **Never** import PrismaService or PrismaModule in the service file.