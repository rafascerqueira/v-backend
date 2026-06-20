---
name: e2e-supertest-harness
description: "Writing robust backend e2e (supertest) tests: harness boot, ports, RS256 keys, tenant isolation, cents assertions. Trigger keywords: e2e, supertest, integration test, tenant isolation, createE2EApp, seedTestSeller, realAuth, cross-tenant, cents, NestFastifyApplication"
---

## When to use

Use this skill when writing or reviewing any `test/*.e2e-spec.ts` file in `v-backend`: new feature coverage, tenant-isolation proofs, money-value assertions, or any test that hits the full HTTP stack. Read this before touching `test/helpers/`.

## Non-negotiable rules

- **Money is integer cents** — assert exact `number` values, never `4000.0`, never strings. If a field comes back as a float, that is a bug — fail the test, do not convert.
- **Tenant isolation** — every spec that owns data must also prove another seller cannot read or mutate it (pattern: seed a second seller directly via Prisma, attempt cross-tenant access through the HTTP surface, assert 404 or 403).
- **No real time/randomness in assertions** — use fixed amounts and stable IDs; use `Date.now()` only in unique-index fields (SKU, email, billing_number) where you need collision avoidance, not in assertions.
- **Each test is independent** — `afterEach` tears down all rows it owns; never rely on order between `it` blocks.
- **Never weaken an assertion** — a red test that found a real defect is correct. Fix the code, not the assertion.

## Harness boot

### Infrastructure ports (local vs CI)

| Resource | Local (docker-compose.test.yml) | CI (GitHub service container) |
|---|---|---|
| PostgreSQL | `localhost:5433` | `localhost:5433` (mapped 5433→5432) |
| Redis | `localhost:6380` | `localhost:6380` (mapped 6380→6379) |

`test/test-setup.ts` sets env vars via `||=` so CI values injected by the pipeline take precedence.

### RS256 JWT keys

`TokenService` reads `keys/private.pem` + `keys/public.pem` at boot. This directory is gitignored. In CI, the pipeline generates ephemeral 2048-bit keys:

```bash
mkdir -p keys
openssl genpkey -algorithm RSA -out keys/private.pem -pkeyopt rsa_keygen_bits:2048
openssl rsa -in keys/private.pem -pubout -out keys/public.pem
```

Locally, run `pnpm test:db:up` before `pnpm test:e2e`; `test/global-setup.ts` skips the compose dance under `CI=true` and only runs `prisma migrate deploy`.

### `createE2EApp` — two modes

```typescript
import { createE2EApp, seedTestSeller, TEST_SELLER } from './helpers/e2e'

// Default: TokenService stubbed, every request auto-carries Bearer e2e as TEST_SELLER.
// Use for all non-auth feature specs.
const { app, prisma, module } = await createE2EApp()

// realAuth: real TokenService + real JWT guard. Use only for auth flow specs.
const { app, prisma } = await createE2EApp({ realAuth: true })
```

`TEST_SELLER` is `{ id: 'e2e-seller-000000000000001', role: 'seller', plan_type: 'enterprise' }`. The `enterprise` plan ensures `PlanLimitsGuard` never blocks create endpoints during tests.

`seedTestSeller(prisma)` upserts the account record so FK constraints from products/customers/orders resolve. Call it in `beforeEach` for any spec that creates tenant-scoped rows.

## Deterministic setup/teardown

```typescript
let app: NestFastifyApplication
let prisma: PrismaService

beforeEach(async () => {
  ;({ app, prisma } = await createE2EApp())
  await seedTestSeller(prisma)
})

afterEach(async () => {
  // Delete in FK order — deepest dependents first.
  await prisma.order_item.deleteMany()
  await prisma.billing.deleteMany()
  await prisma.order.deleteMany()
  await prisma.product.deleteMany()
  await prisma.customer.deleteMany()
  // Only delete extra seeded accounts (never delete TEST_SELLER mid-suite;
  // deleteMany with a where-filter is safe).
  await prisma.account.deleteMany({ where: { id: OTHER_SELLER } })
  await app.close()
})
```

Do not call `prisma.account.deleteMany()` without a `where` filter unless you explicitly need to wipe everything including `TEST_SELLER`.

## Authenticated requests

Default mode: no auth setup needed — the harness injects the `Bearer e2e` header automatically.

```typescript
await request(app.getHttpServer()).post('/products').send(payload).expect(201)
```

`realAuth` mode: obtain a token via `POST /auth/login`, then set the `Authorization` header explicitly.

## Playbook — writing a new spec

1. Pick the mode: `createE2EApp()` for feature specs; `createE2EApp({ realAuth: true })` for auth flow specs.
2. Call `seedTestSeller(prisma)` in `beforeEach` if your entity has a `seller_id` FK.
3. Write the happy path first with exact expected values.
4. Add boundary cases: zero quantities, empty lists, max field lengths.
5. Add error paths: missing required fields → 400, not found → 404, duplicate unique fields → 409.
6. **Add tenant isolation** (see pattern below) — this is not optional for any spec on a tenant-scoped entity.
7. Tear down in FK-safe order in `afterEach`; call `app.close()` last.
8. Run: `pnpm test:e2e --testPathPattern=<feature>`

## Tenant isolation pattern

```typescript
const OTHER_SELLER = 'e2e-other-seller-00000000001'

it("never exposes another seller's data", async () => {
  // 1. Seed a record owned by a different seller directly in the DB (bypass HTTP).
  await prisma.account.upsert({
    where: { id: OTHER_SELLER },
    update: {},
    create: { id: OTHER_SELLER, name: 'Other', email: `other-${Date.now()}@example.com`,
               role: 'seller', plan_type: 'free' },
  })
  const otherRow = await prisma.<entity>.create({
    data: { seller_id: OTHER_SELLER, /* ... */ },
  })

  // 2. Try to reach it through the HTTP surface as TEST_SELLER.
  // Must be 404 (not 403 — don't leak existence).
  await request(app.getHttpServer())
    .get(`/<resource>/${otherRow.id}`)
    .expect(404)

  // 3. Try to mutate it — also 404.
  await request(app.getHttpServer())
    .patch(`/<resource>/${otherRow.id}`)
    .send({ /* ... */ })
    .expect(404)
})
```

Clean up the other seller account in `afterEach`: `await prisma.account.deleteMany({ where: { id: OTHER_SELLER } })`.

## Cents assertions

```typescript
// Correct — exact integer
expect(response.body.total_amount).toBe(10000)     // R$ 100,00
expect(response.body.paid_amount).toBe(4000)       // R$ 40,00

// Wrong — never do these
expect(response.body.total_amount).toBe(100.00)    // float: bug
expect(response.body.total_amount).toBeGreaterThan(0)  // too loose
expect(typeof response.body.total_amount).toBe('number') // only type, not value

// Assert no float crept in (add to money fields in billing/order/price specs)
expect(Number.isInteger(response.body.total_amount)).toBe(true)
```

## Checklist

- [ ] `beforeEach` calls `createE2EApp()` and `seedTestSeller(prisma)` (if tenant data)
- [ ] `afterEach` deletes rows in FK order and calls `app.close()`
- [ ] Happy path asserts exact response values, not just `.toBeDefined()`
- [ ] Money fields asserted as exact integers; `Number.isInteger(...)` where critical
- [ ] Tenant isolation test present for any entity with `seller_id`
- [ ] Other-seller cleanup in `afterEach` uses a `where` filter
- [ ] No `sleep()`, no real-network calls, no `Math.random()` in assertions
- [ ] File lives in `test/` and named `<feature>.e2e-spec.ts`

## Gotchas

- `overrideGuard` does NOT override `APP_GUARD`-registered global guards in this Nest version. The harness neutralizes `JwtAuthGuard` by stubbing `TokenService.verifyAccessToken`, not via `.overrideGuard()`. Do not add `.overrideGuard(JwtAuthGuard)` — it will silently have no effect.
- `PlanLimitsGuard` is active in e2e. `TEST_SELLER.plan_type = 'enterprise'` bypasses limits. If you create a fixture with `plan_type: 'free'` and hit a create endpoint, you may get 403.
- `ThrottlerStorage` is always replaced with a no-op in `createE2EApp`. Do not add explicit throttler overrides.
- BullMQ connects to Redis at boot. If `REDIS_HOST`/`REDIS_PORT` are wrong, the app hangs. `test/test-setup.ts` sets them; verify they're loaded before the module compiles.
- `--runInBand` is set in `pnpm test:e2e`. Do not parallelize e2e suites — they share the test DB.

## References

- `test/helpers/e2e.ts` — `createE2EApp`, `seedTestSeller`, `TEST_SELLER`
- `test/helpers/e2e-test.module.ts` — test module wiring
- `test/test-setup.ts` — env var defaults (ports, JWT keys dir)
- `test/global-setup.ts` — compose vs CI branch, `prisma migrate deploy`
- `test/billings.e2e-spec.ts` — canonical tenant-isolation pattern + cents assertions
- `test/admin-authz.e2e-spec.ts` — role elevation via DB, not token claims
- `test/auth.e2e-spec.ts` — `realAuth: true` pattern, cookie/CSRF assertions
