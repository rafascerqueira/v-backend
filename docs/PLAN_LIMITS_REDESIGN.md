# Plan Limits & Promotional Periods — Redesign

**Status:** Proposed — awaiting approval before Phase 1 implementation.
**Owner:** Backend
**Last updated:** 2026-05-02

---

## 1. Background

The platform exposes three numeric limits for the `free` plan: products, customers, and orders/month. The current implementation has three classes of issue:

1. **`PlanLimitsGuard` is broken in production.** It reads `user.plan_type` from the JWT, but the JWT (`TokenPayload` in `src/modules/auth/dto/auth-response.dto.ts`) never includes `plan_type`. Every authenticated request defaults to `'free'`, so paid `pro` users are silently capped at free limits.
2. **A second, parallel limits system exists but is wired to nothing.** `PlanGuard` + `@CheckLimit`/`@RequiredPlan`/`@RequiredFeature` are registered in `SubscriptionsModule` but no controller applies them. They use plural `LimitType` names and hardcoded constants, conflicting with the singular names in the active guard.
3. **Two admin-configurable values exist but are not consumed anywhere.** `free_period_end_date` and `early_adopter_discount` are settable from the admin UI; no guard, service, or checkout flow reads them. `free_trial_end_date` is mentioned only as an example payload in the settings controller and has no corresponding service method.

There is also a documentation gap: `core-rules.md` still describes both guards as live.

## 2. Goals

- Fix the broken plan-type resolution so paid users are no longer treated as free.
- Collapse the two limits systems into one with consistent vocabulary.
- Introduce two independent, admin-configurable time windows:
  - **Window 1 — Unlimited Period:** all `free` sellers receive the full Pro experience (numeric limits lifted + Pro features unlocked) for the duration of the window.
  - **Window 2 — Promotional Period:** a configurable subscription discount applied to Pro/Enterprise checkout for the duration of the window. Free-tier limits are not affected by Window 2.
- Block all degradable seller actions (mutations, reports, exports) for free sellers who have hit any numeric limit. Reads, auth, profile, and the upgrade flow remain accessible. Public catalog access is never blocked.
- Bypass `PlanLimitsGuard` for users with `role: 'admin'`.
- Add an admin-only mechanism to grant per-seller plan exceptions and adjust billing dates, with mandatory audit trail (reason + actor + timestamps).

## 3. Non-goals

- Redesigning the Stripe integration. Discount application uses Stripe Coupons / promotion codes; we don't change the webhook contract.
- Multi-tenant per-seller promotional campaigns (only one global promo window at a time).
- Migrating to the aspirational DDD layout described in `structure.md`.
- Frontend implementation. This document covers backend only; frontend changes are tracked separately.

## 4. Glossary

| Term | Meaning |
|---|---|
| **Window 1 / Unlimited Period** | Date range during which every `free` seller behaves like a `pro` seller (no caps, all features). Configured globally. |
| **Window 2 / Promotional Period** | Date range during which a configurable discount (percent) is applied to new Pro/Enterprise subscriptions. Does not affect existing subscribers' price or free-tier limits. |
| **Effective start (per seller)** | `max(window.startDate, account.createdAt)`. Used for display and audit only; does not affect guard decisions. |
| **Plan exception** | Audited admin-issued override on a single seller (custom limits, custom unlimited window, gifted plan, billing date adjustment). |

---

## 5. Phased Delivery

Three sequential PRs. Each lands independently and is reviewable in isolation.

| Phase | Scope | Risk | Ships behind a flag? |
|---|---|---|---|
| **1** | Foundation fixes (broken JWT, dead code, vocabulary) | Medium — touches every authenticated request | No — pure correctness |
| **2** | Promotional windows (Window 1 + Window 2) | Medium — new business logic, settings-driven | No — windows are date-bounded and admin-controlled |
| **3** | Admin plan exceptions module | Higher — new table, new endpoints, new audit surface | No — admin-only, gated by `AdminGuard` |

Phase 1 must land before Phase 2 or 3 can be implemented correctly.

---

## 6. Phase 1 — Foundation Fixes

### 6.1 Add `plan_type` to the JWT payload

**Touched files:**

- `src/modules/auth/dto/auth-response.dto.ts` — extend `TokenPayload` with `plan_type: PlanType`.
- `src/modules/auth/services/token.service.ts` — include `plan_type` when calling `signAsync` for both access and refresh tokens, and propagate it through `refreshTokens`.
- `src/modules/auth/controllers/login.controller.ts`, `oauth.controller.ts`, `register.controller.ts` (and any other token-issuing controller) — pass `plan_type` from the loaded `account` into `generateTokens`.
- `src/modules/subscriptions/guards/plan-limits.guard.ts` — keep the `user.plan_type` read; remove the `|| 'free'` fallback once the JWT is guaranteed to carry it (kept temporarily during rollout — see 6.4).
- All test fixtures that build a `mockUser` with `{sub, email, role}` — add `plan_type`.

**Backwards compatibility:** existing access tokens issued before deploy will not have `plan_type`. The guard keeps the `|| 'free'` fallback in Phase 1 (no behavior change for stale tokens), and the cookie-issued refresh tokens will rotate users onto the new payload within the refresh window (7 days).

**Alternative considered:** resolve plan from DB on every request. Rejected — adds a query to the hot path of every limit-checked endpoint when the data already exists in the session.

### 6.2 Stop treating Pro as `unlimited`

**Touched file:** `src/modules/subscriptions/services/plan-limits.service.ts`.

Set `unlimited: false` for `pro` (limits 500 / 1000 / 500). Extend `getFreePeriodLimitsWithOverrides` (currently `getFreeLimitsWithOverrides`) to apply only when `planType === 'free'`. Pro and Enterprise read from the canonical constants. `enterprise` keeps `unlimited: true` because its values are `-1`.

This is the change that actually starts enforcing Pro caps. Combined with 6.1, it's the first time Pro limits are real in production. Verify usage data to confirm no Pro tenant is currently above 500 products / 1000 customers / 500 orders/month before deploy.

### 6.3 Delete the unused parallel system

**Removed:**

- `src/modules/subscriptions/guards/plan.guard.ts` (`PlanGuard`)
- `src/modules/subscriptions/decorators/plan.decorator.ts` (`@RequiredPlan`, `@RequiredFeature`, `@CheckLimit`, plural `LimitType`)
- `SubscriptionService.checkLimit` (relies on hardcoded `PLAN_LIMITS`, never honored admin overrides)
- All references in `SubscriptionsModule` providers/exports
- The `/subscriptions/check-limit/{products|orders|customers}` endpoints — they call the deprecated path. Replace with a single `/subscriptions/usage` endpoint backed by `PlanLimitsService.getUsageSummary` (already exists).

**Kept and extended:** `PlanLimitsService.getUsageSummary` becomes the single source of truth. It will gain `activeWindow` info in Phase 2.

### 6.4 Cleanup of orphan settings

- Remove `free_trial_end_date` from the example payload and `typeMap` in `src/modules/admin/controllers/settings.controller.ts` — orphan with no consumer.
- Rename `free_period_end_date` reads/writes in `SettingsService` to **keep the same key for backward compatibility**, but rename the methods `getFreePeriodEndDate` → `getUnlimitedPeriodEndDate` so the vocabulary matches the new "Unlimited Period" naming. Phase 2 introduces a `_start_date` companion.
- Keep `early_adopter_discount` as-is in Phase 1; it gets wired up in Phase 2.

### 6.5 Documentation updates after Phase 1 lands

The following docs will be flagged with a checklist for the user to apply (I will not edit them unilaterally):

- `.devin/rules/core-rules.md` — remove `PlanGuard` from the "plan enforcement guards" table; rename "Plan limits guard / Plan guard" section.
- `CLAUDE.md` (if it has parallel content).

---

## 7. Phase 2 — Promotional Windows

### 7.1 New settings keys

| Key | Type | Purpose |
|---|---|---|
| `unlimited_period_start_date` | `date` | Window 1 start. New. |
| `unlimited_period_end_date` | `date` | Window 1 end. **Reuses existing `free_period_end_date`** to avoid losing admin-configured value. Old key alias kept readable; writes go to the new key. |
| `promotional_period_start_date` | `date` | Window 2 start. New. |
| `promotional_period_end_date` | `date` | Window 2 end. New. |
| `promotional_period_discount_percent` | `number` | Window 2 discount, 0–100. Replaces standalone `early_adopter_discount`. Old key migrated on first read. |

**Migration approach:** no Prisma migration needed — these are rows in the existing `settings` table. On first request after deploy, a one-shot migration path inside `SettingsService.getUnlimitedPeriodWindow()` will copy `free_period_end_date` → `unlimited_period_end_date` if the new key is absent. Same pattern for `early_adopter_discount` → `promotional_period_discount_percent`. The legacy keys are then deleted to avoid drift.

### 7.2 New service methods on `SettingsService`

- `getUnlimitedPeriodWindow(): Promise<{ startDate: Date | null; endDate: Date | null; isActive: boolean }>`
- `setUnlimitedPeriodWindow({ startDate, endDate }): Promise<void>`
- `getPromotionalPeriod(): Promise<{ startDate: Date | null; endDate: Date | null; discountPercent: number; isActive: boolean }>`
- `setPromotionalPeriod({ startDate, endDate, discountPercent }): Promise<void>`

`isActive` returns `true` iff `startDate <= now < endDate` and both dates are set.

### 7.3 Window 1 effect on `PlanLimitsGuard`

`PlanLimitsService.canCreateProduct/Customer/Order` (and `getUsageSummary`) gain a new branch:

```
if (planType === 'free' && unlimitedPeriod.isActive) {
  return { allowed: true, current, limit: -1, unlimitedReason: 'unlimited_period' }
}
```

`getUsageSummary` returns the active window in its response so the frontend can render banners:

```jsonc
{
  "plan": "free",
  "activeWindow": {
    "type": "unlimited_period",
    "startDate": "2026-01-01T00:00:00Z",   // window's start
    "endDate":   "2026-12-31T23:59:59Z",
    "effectiveStart": "2026-03-15T10:00:00Z" // max(window.start, account.createdAt)
  },
  "limits": { ... },
  "usage": { ... },
  "remaining": { ... }
}
```

When no window is active, `activeWindow: null`.

### 7.4 Window 1 also unlocks Pro features for free sellers

Since Phase 1 deletes `@RequiredFeature`, feature gating during Window 1 is implicit: any code that asks "does this seller have Pro features?" must consult a single helper:

- New helper on `PlanLimitsService`: `isProEffective(sellerId, planType): Promise<boolean>` — returns `true` if `planType === 'pro' || planType === 'enterprise' || (planType === 'free' && unlimitedPeriod.isActive)`.
- Reports, exports, multiple-image upload, and any future Pro-gated feature consult this helper directly inside their service. There is no decorator-based gating in Phase 2; we add it back only if a clear pattern emerges in Phase 3+.

### 7.5 Window 2 effect on subscription checkout

Window 2 is a checkout-time discount, not a runtime limit change. Implementation:

- `SubscriptionService.createCheckoutSession` (Stripe) reads `getPromotionalPeriod()`. If `isActive`, it attaches a Stripe Coupon (`percent_off = discountPercent`, `duration: once`) to the session.
- A single Stripe Coupon ID is provisioned per discount value via lazy creation (`promo_<percent>_off`) — Stripe coupons are idempotent by ID.
- The discount is **only** applied at first subscription creation. Existing subscribers don't get retroactively discounted.

**Edge case:** if a seller starts a checkout while Window 2 is active and completes payment after it ends, Stripe's session honors the coupon attached to the session. Acceptable.

### 7.6 New admin endpoints

- `GET /admin/settings/promotions` → returns both windows + active state.
- `PUT /admin/settings/promotions/unlimited-period` → `{ startDate, endDate }`.
- `PUT /admin/settings/promotions/promotional-period` → `{ startDate, endDate, discountPercent }`.

Existing `GET/PUT /admin/settings/free-period` endpoints become deprecated aliases for one release, then removed.

### 7.7 Validation rules

- `startDate < endDate` (Zod refinement).
- Either both dates are set or both are null (clearing a window requires clearing both).
- `discountPercent` ∈ `[0, 100]`.
- No overlap validation between Window 1 and Window 2 — they are independent (Q3 confirmed). If both are active, Window 1 dominates the user-visible behavior, Window 2 still applies the discount at checkout.

---

## 8. Phase 3 — Admin Plan Exceptions

### 8.1 New Prisma model

```prisma
enum AccountExceptionType {
  unlimited_window      // (a) custom unlimited window for one free seller
  custom_limits         // (b) custom numeric limits for one seller
  billing_adjustment    // (c) defer next_billing_date for Pro/Enterprise
  plan_grant            // (d) gift a plan upgrade without payment
}

enum AccountExceptionStatus {
  active
  expired
  revoked
}

model AccountException {
  id              String                 @id @default(uuid()) @db.Uuid
  account_id      String                 @db.Uuid
  type            AccountExceptionType
  status          AccountExceptionStatus @default(active)
  effective_from  DateTime               @db.Timestamptz()
  effective_until DateTime?              @db.Timestamptz()  // null = open-ended
  metadata        Json                   // shape varies by type — see 8.2
  reason          String                 @db.Text
  created_by      String                 @db.Uuid           // admin account_id
  revoked_by      String?                @db.Uuid
  revoked_at      DateTime?              @db.Timestamptz()
  revoke_reason   String?                @db.Text
  createdAt       DateTime               @default(now()) @db.Timestamptz()
  updatedAt       DateTime               @updatedAt       @db.Timestamptz()

  account         Account                @relation("AccountExceptions", fields: [account_id], references: [id], onDelete: Cascade)
  creator         Account                @relation("AccountExceptionsCreated", fields: [created_by], references: [id])

  @@index([account_id, status])
  @@index([type, status])
}
```

Account model gains a back-reference: `exceptions AccountException[] @relation("AccountExceptions")`. The migration is additive — no data backfill needed.

### 8.2 Metadata shape per type

```ts
// type = 'unlimited_window'
{ } // no extra metadata; just the date range

// type = 'custom_limits'
{ maxProducts?: number; maxCustomers?: number; maxOrdersPerMonth?: number }
// Any field omitted falls back to the seller's plan default.

// type = 'billing_adjustment'
{ nextBillingDate: string /* ISO */, previousNextBillingDate: string /* ISO, captured for audit */ }

// type = 'plan_grant'
{ grantedPlan: 'pro' | 'enterprise', previousPlan: 'free' | 'pro' }
```

Validated by Zod schemas at the controller boundary — DB stores Json, service guarantees the shape via discriminated union.

### 8.3 Effect on `PlanLimitsGuard`

`PlanLimitsService.canCreateX` and `getUsageSummary` consult `AccountExceptionRepository.findActiveExceptions(sellerId)` once per call (cached for the request via NestJS request scope or a small in-memory TTL — to be decided when implementing). Resolution order:

1. `role: 'admin'` → bypass entirely (Q4 + C2).
2. Active `unlimited_window` exception covering `now` → unlimited like Window 1.
3. Active `plan_grant` → treat as the granted plan.
4. Active `custom_limits` → use the override values where present, plan defaults elsewhere.
5. Otherwise → existing logic (Window 1 for free / canonical limits).

`billing_adjustment` does not affect the limit guard; it's read by the billing module when computing the next charge date.

### 8.4 New admin endpoints

All under `AdminGuard`:

- `GET /admin/sellers/:id/exceptions` — list all exceptions (active, expired, revoked) for one seller.
- `POST /admin/sellers/:id/exceptions` — create. Body discriminated by `type`. `reason` required.
- `POST /admin/sellers/:id/exceptions/:exceptionId/revoke` — `{ reason }` required. Sets status `revoked`, captures `revoked_by` and `revoked_at`.
- `GET /admin/exceptions` — paginated, filterable by type/status/account_id, for the audit view.

**No update endpoint** — exceptions are immutable. Mistakes are corrected by revoking and creating a new one. This keeps the audit trail clean.

### 8.5 Effect on billing

`billing_adjustment` exceptions are consumed by the existing billings flow. The current Pro charge date logic (whichever module computes it) reads the latest active `billing_adjustment` for the account and uses its `nextBillingDate` instead of the computed date. Implementation details to be sketched once Phase 1 + 2 are merged.

### 8.6 Effect on `plan_type`

A `plan_grant` exception does **not** mutate `account.plan_type`. The grant is applied at the guard/service level only. This avoids drift between Stripe (which still sees the account as `free`) and our DB. When the grant expires, the account returns to its real `plan_type` automatically.

---

## 9. Testing Strategy

### Phase 1
- Unit: `TokenService` produces tokens with `plan_type`. `PlanLimitsGuard` reads it correctly. `PlanLimitsService` no longer treats `pro` as unlimited.
- Update every existing controller `.spec.ts` mock user to include `plan_type`.
- Regression: at least one E2E flow per limit type confirms a Pro user can exceed 50 products (which the bug currently blocked).

### Phase 2
- Unit: `SettingsService` window helpers (active / inactive / partially-set / inverted dates).
- Unit: `PlanLimitsService` short-circuits when Window 1 is active for free sellers; behaves normally outside windows.
- Unit: `SubscriptionService.createCheckoutSession` attaches a coupon during Window 2, omits it outside.
- E2E: free user creates 60 products while Window 1 is active → 200; same flow with window expired → 403.

### Phase 3
- Unit: each exception type resolves correctly in isolation; exception precedence ordering is deterministic.
- Unit: revoking captures actor + reason; expired exceptions don't apply.
- E2E: admin grants `plan_grant` to free user → free user can create > 50 products; admin revokes → free user blocked again.
- Audit verification: every mutation writes a row visible via `GET /admin/exceptions`.

---

## 10. Rollout

- **Phase 1:** deploy in a quiet window. Monitor for `403 Forbidden` spikes on `POST /products`, `POST /customers`, `POST /orders` from Pro users — would indicate the new Pro caps are biting unexpected tenants.
- **Phase 2:** ship with both windows configured to `null` initially. Admin sets them via the new endpoints when a campaign is ready.
- **Phase 3:** ship the migration, then deploy. No backfill.

Each phase is independently revertible: reverting Phase 1 restores the broken-but-known behavior; reverting Phase 2 leaves the settings rows in place (harmless); reverting Phase 3 leaves the table empty (harmless).

---

## 11. Decisions Captured (from this design conversation)

| ID | Decision |
|---|---|
| **A1** | Add `plan_type` to JWT. |
| **A2** | Pro is no longer `unlimited`; uses real 500/1000/500 caps. |
| **A3** | Delete `PlanGuard` and the plural decorator system. Keep `PlanLimitsGuard` only. |
| **B1** | During Window 1, all free sellers behave like Pro. |
| **B2** | Window 1 affects only free sellers. Window 2 only affects checkout pricing. |
| **B3** | Two independent windows. Window 2 is a discount, not a free unlock. |
| **B4** | Effective start per seller = `max(window.startDate, account.createdAt)` for display only. |
| **B5** | API exposes active window in `getUsageSummary`. |
| **C1** | When a free seller hits a limit: block all mutations + reports + export; allow reads, auth, profile, upgrade flow; public catalog never blocked. |
| **C2** | Admins bypass `PlanLimitsGuard` entirely. New `AccountException` module supports custom unlimited windows, custom limits, billing adjustments, and plan grants — all auditable. |

---

## 12. Open Items Requiring Approval Before Implementation

- [ ] Confirm Phase 1 scope is correct as described in §6.
- [ ] Approve the JWT payload extension approach in §6.1 (vs. DB lookup alternative).
- [ ] Approve removal of `/subscriptions/check-limit/*` in §6.3 (replaced by `/subscriptions/usage`).
- [ ] Approve key migration plan in §7.1 (reuse `free_period_end_date` for `unlimited_period_end_date`, migrate `early_adopter_discount` → `promotional_period_discount_percent`, then delete legacy keys).
- [ ] Approve Prisma schema sketch in §8.1 — especially: enum names, `metadata Json` shape, immutability (no update endpoint), index choices.
- [ ] Confirm `plan_grant` does **not** mutate `account.plan_type` (§8.6) — this is a Stripe-correctness call.
- [ ] Confirm the testing depth in §9 is sufficient (Phase 1 needs the most coverage given it touches every authenticated request).

Once these are approved, I'll start Phase 1 in a single focused PR and stop for review before Phase 2.
