---
name: tenant-isolation
description: >
  Enforce multi-tenant (per-seller) data isolation in v-backend repositories.
  Use when writing/reviewing any repository or query touching a `seller_id`
  column, point mutations (update/delete by id), or admin bypass. Covers
  TenantContext.requireSellerId() on writes, isAdmin() bypass, repository-level
  ownership checks, returning 404 (not 403) on cross-tenant access so existence
  isn't leaked, and the Jest spec pattern that proves seller A can't touch
  seller B's rows. Keywords: tenant, multi-tenant, isolation, seller_id,
  TenantContext, cross-tenant, ownership check, 404 not 403, getTenantFilter.
---

# Tenant isolation — per-seller data boundaries

Complements `.devin/skills/create-prisma-repository/SKILL.md` (scaffolding) by
codifying the *isolation invariants* every tenant-scoped repository must hold.
Do **not** edit anything under `.devin/`.

## When to use

- Adding/reviewing a repository for any model with a `seller_id` column.
- Implementing point mutations (`update`/`delete`/`findById` by id).
- Adding an admin (`role === 'admin'`) read/write path.
- Writing the test that proves cross-tenant access is impossible.

## Non-negotiable rules

1. **Inject `TenantContext` in every tenant-scoped repository** (alongside
   `PrismaService`). Source: `src/shared/tenant/tenant.context.ts`.
2. **Scope every list/read with the tenant filter.** Use the canonical helper:
   ```typescript
   private getTenantFilter() {
     if (this.tenantContext.isAdmin()) return {}
     return { seller_id: this.tenantContext.requireSellerId() }
   }
   ```
   Admins (and only admins) bypass the filter.
3. **`requireSellerId()` on writes**, never `getSellerId()`. A missing tenant on
   a mutation must throw, not silently write a row with `seller_id = undefined`.
4. **Ownership check on every point mutation.** `update`/`delete`/`softDelete` by
   id must first confirm the row belongs to the caller (re-use `findById`, which
   already applies the tenant check), then mutate. Never `prisma.x.update({ where:
   { id } })` directly without that gate — a bare id lets seller A write seller
   B's row.
5. **404 on cross-tenant, never 403.** A row owned by another seller must look
   *non-existent*. `findById` returns `null` for foreign rows; point mutations
   throw `NotFoundException` ("not found or access denied"). A `403`/`Forbidden`
   leaks that the id exists. (Throw Nest `HttpException`s — a raw `Error` → 500.)
6. **Don't trust client-supplied `seller_id`.** Derive ownership from
   `TenantContext`, not from the request body. On `create`, the seller id comes
   from the authenticated context, validated upstream.

## Playbook

1. **List / read-many** — spread `...this.getTenantFilter()` into the `where`:
   ```typescript
   this.prisma.supplier.findMany({ where: { active: true, ...this.getTenantFilter() } })
   ```
   (Ref: `src/modules/suppliers/repositories/prisma-supplier.repository.ts`.)

2. **`findById`** — fetch, then null out foreign rows so callers get a clean 404:
   ```typescript
   async findById(id: number): Promise<Product | null> {
     const row = await this.prisma.product.findUnique({ where: { id } })
     if (!row) return null
     if (!this.tenantContext.isAdmin() &&
         row.seller_id !== this.tenantContext.getSellerId()) return null
     return row as unknown as Product
   }
   ```
   (`getSellerId()` is fine here — read path; admins pass through.)

3. **Point mutation (`update`/`softDelete`/`delete`)** — gate on `findById`:
   ```typescript
   async update(id: number, data: UpdateProductData): Promise<Product> {
     const existing = await this.findById(id)
     if (!existing) throw new NotFoundException('Product not found or access denied')
     return this.prisma.product.update({ where: { id }, data }) as unknown as Product
   }
   ```
   (Ref: `prisma-product.repository.ts` `update` / `softDelete`.)

4. **Multi-model writes** stay inside the repository in a `$transaction`; apply
   the same ownership gate to every tenant-scoped row touched before writing.

5. **Prove isolation with a spec** — mock `TenantContext` and `PrismaService`,
   assert: owned row returns, foreign row → `null` (read) / `NotFoundException`
   (mutation) with the underlying `update` **not called**, admin bypasses, and
   `findAll` injects `seller_id` for sellers but omits it for admins. Mirror
   `prisma-product.repository.spec.ts`:
   ```typescript
   const tenant = { isAdmin: jest.fn(), getSellerId: jest.fn(), requireSellerId: jest.fn() }
   beforeEach(() => {
     tenant.isAdmin.mockReturnValue(false)
     tenant.getSellerId.mockReturnValue('seller-A')
     tenant.requireSellerId.mockReturnValue('seller-A')
   })

   it('update throws NotFound for a cross-tenant row', async () => {
     prisma.product.findUnique.mockResolvedValue({ id: 1, seller_id: 'seller-B' })
     await expect(repo.update(1, { name: 'x' } as any)).rejects.toBeInstanceOf(NotFoundException)
     expect(prisma.product.update).not.toHaveBeenCalled()
   })

   it('admin bypasses the seller filter', async () => {
     tenant.isAdmin.mockReturnValue(true)
     await repo.findAll()
     expect(prisma.product.findMany.mock.calls[0][0].where.seller_id).toBeUndefined()
   })
   ```

## Checklist

- [ ] Repository injects `TenantContext`; `getTenantFilter()` used on all reads.
- [ ] Writes use `requireSellerId()` (throws when tenant missing).
- [ ] `findById` returns `null` for foreign rows (admin bypass intact).
- [ ] Every `update`/`delete` by id gates on `findById` → `NotFoundException`.
- [ ] Cross-tenant access yields **404, never 403** (no existence leak).
- [ ] `seller_id` comes from context, never from the request body.
- [ ] Spec proves: owned✓, foreign→404 + no write, admin bypass, findAll scoping.

## Gotchas

- **`getSellerId()` vs `requireSellerId()`**: reads tolerate `undefined`
  (admin/optional); mutations must `requireSellerId()` or you risk a row with no
  tenant. Don't swap them.
- **403 leaks existence.** Returning `ForbiddenException` on a foreign id tells an
  attacker the id is real. Always 404 for cross-tenant.
- **Bare `prisma.x.update({ where: { id } })`** in a mutation skips isolation —
  this is the classic IDOR hole. Always go through `findById` first.
- **Admin bypass is role-gated**, not a wildcard: `isAdmin()` checks
  `role === 'admin'` from `TenantContext`. Don't reproduce the bypass by reading
  `request.user` directly.
- Tenant isolation is a *defense-in-depth* sibling of the DB hygiene in
  `prisma-migrations-safe` — both assume a clean `public` schema; a mis-scoped
  query and a mis-scoped schema fail the same way (rows "not found").

## References

- `src/shared/tenant/tenant.context.ts` — `requireSellerId()`, `getSellerId()`, `isAdmin()`
- `src/modules/products/repositories/prisma-product.repository.ts` — ownership gate on update/softDelete
- `src/modules/suppliers/repositories/prisma-supplier.repository.ts` — `getTenantFilter()` on reads
- `src/modules/products/repositories/prisma-product.repository.spec.ts` — isolation spec pattern
- Rules: `CLAUDE.md` ("TenantContext", "Exceptions"), `.devin/rules/core-rules.md` ("Architecture rules")
- Scaffolding: `.devin/skills/create-prisma-repository/SKILL.md`
