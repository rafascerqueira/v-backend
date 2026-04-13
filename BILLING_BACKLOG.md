# Billing Flow Backlog

## Current Status

The billing module has structural bugs and missing features that prevent it from being usable. This document tracks everything that needs to be fixed or built.

---

## Root Cause Analysis

| # | Bug | Status |
|---|-----|--------|
| 1 | `BillingsModule` never imported `TenantModule` → all billing queries fail silently (empty array always returned) | ✅ Fixed |
| 2 | `findUnbilledPerSaleOrders` used billing-shaped tenant filter `{ order: { seller_id } }` on `Order` model → Prisma threw, swallowed by `.catch(() => null)` | ✅ Fixed |
| 3 | `due_date DateTime @default(now())` → every billing is born already due; overdue detection `due_date < new Date()` fires immediately for everything | ❌ Open |
| 4 | `updateStatus('delivered')` auto-sets billing to `paid` → billing is closed before the seller can charge the customer | ❌ Open |
| 5 | Billing creation for periodic modes (weekly/biweekly/monthly) is not implemented; sync only handles `per_sale` | ❌ Open |

---

## Backlog

### BIL-01 — Fix `due_date` schema default `[CRITICAL]`

**Problem**: `Billing.due_date DateTime @default(now())` means every billing created without an explicit due date is already overdue the instant it's saved.

**Fix**:
- Change to `due_date DateTime?` (nullable, no default)
- `applyOverdue()` in the repository should only trigger when `due_date IS NOT NULL`
- New migration required

**Acceptance**: A newly synced billing with no explicit due_date shows as `pending`, not `overdue`.

---

### BIL-02 — Auto-calculate `due_date` based on `billing_mode` `[CRITICAL]`

When a billing is created (sync or automatic), compute `due_date` from the customer's `billing_mode` and `billing_day`:

| Mode | Rule |
|------|------|
| `per_sale` | `due_date = null` (collect at next visit) or configurable grace period |
| `weekly` | `due_date = next occurrence of customer's billing_day (0–6, day of week)` |
| `biweekly` | `due_date = in 14 days from order date` |
| `monthly` | `due_date = next month's billing_day (1–31)` — if billing_day=5 and today is the 3rd, due on the 5th; if today is the 7th, due on the 5th of next month |
| `custom` | `due_date = null` (seller sets manually) |

**Where this logic lives**: A `BillingScheduler` helper in `src/shared/billing/` that takes `(billing_mode, billing_day, reference_date)` and returns a `Date | null`. Used by both the sync and the automatic creation path.

---

### BIL-03 — Remove automatic paid status on order delivery `[CRITICAL]`

**Problem**: In `orders.service.ts → updateStatus()`, when order status becomes `delivered`, the billing is auto-updated to `{ status: 'paid', payment_status: 'confirmed', paid_amount: order.total }`. This assumes cash-on-delivery and prevents the seller from managing the billing.

**Fix**: Remove the billing status map from `updateStatus()` entirely. Billing lifecycle is managed exclusively through the billing page.

**Note**: The order payment fields (`payment_method`, `payment_status` on the `Order` model) are separate from `Billing` and can stay as-is for cash-sale tracking. Only the propagation to `Billing` should be removed.

---

### BIL-04 — Reliable per-sale billing creation on order save `[HIGH]`

**Current**: `OrdersService.create()` calls `createBillingIfPerSale()` which goes through `BillingsService.create()` → `verifyOrderAccess()`. This is fragile and duplicates access-control logic.

**Fix**: Call `billingRepository.create()` directly from `OrdersService`, bypassing the HTTP-boundary service. Guard with an existence check (`Billing: { none: {} }`) to ensure idempotency.

```
OrdersService.create()
  └─ if customer.billing_mode === 'per_sale'
       └─ billingRepository.createForOrder(orderId, total, dueDate)
```

The `createForOrder` method on the repository should:
1. Check no billing exists for this order yet
2. Compute `due_date` via `BillingScheduler`
3. Create with `status: 'pending'`, `paid_amount: 0`

---

### BIL-05 — Periodic billing: scheduled creation for weekly/biweekly/monthly `[HIGH]`

**Current**: Only `per_sale` orders are synced. Customers with `weekly`, `biweekly`, or `monthly` mode never get billings.

**Design**:
- One billing per order even in periodic mode. `due_date` indicates when the seller should collect for that order.
- A BullMQ cron job (`BillingSchedulerProcessor`) runs daily at 07:00 and:
  1. Finds all orders for periodic customers where `due_date` falls today (no existing billing)
  2. Creates billings for each such order

**Alternative (aggregate billing)**: Create one billing that covers all orders in the period — requires adding a `billing_period_start` / `billing_period_end` to `Billing` and a join table `billing_orders`. Start with the simpler per-order approach; migrate to aggregate later if needed.

**Scope for this ticket**: Per-order billing with cron. The `POST /billings/sync` endpoint extends to cover all modes, not just `per_sale`.

---

### BIL-06 — Order page: billing status & next charge date `[MEDIUM]`

On the order detail/list page, for each order show:

- **Billing badge**: `Não cobrado` / `Cobrança pendente` / `Pago` / `Vencido`
- **Next charge date**: derived from `customer.billing_mode` + `customer.billing_day` relative to order date
- **Link to billing**: if a billing exists for this order, clicking the badge opens it in the billing page

**Backend**: `GET /orders/:id` response should include the billing for that order (already has `Billing[]` on the schema but not in the select). Extend `findById` to include `Billing { id, status, due_date, paid_amount, total_amount }`.

---

### BIL-07 — Billing page: summary cards and period filter `[MEDIUM]`

Add three summary cards at the top of the billing page:

| Card | Value |
|------|-------|
| **Vencido** | Sum of `(total_amount - paid_amount)` for overdue billings |
| **A vencer (este mês)** | Sum of `total_amount` for pending billings with `due_date` in the current month |
| **Recebido (este mês)** | Sum of `paid_amount` for paid billings with `payment_date` in the current month |

**Backend**: New endpoint `GET /billings/summary` returns `{ overdue_amount, due_this_month, collected_this_month }`.

Add a date-range filter to `GET /billings`: `?from=YYYY-MM-DD&to=YYYY-MM-DD` for filtering by `due_date`.

---

### BIL-08 — Billing page: customer filter `[MEDIUM]`

Add a customer selector to the billing page so the seller can view all billings for a single customer at once. Useful when collecting payment in person.

**Backend**: `GET /billings?customer_id=<uuid>` — filter `order.customer_id`.

---

### BIL-09 — Overdue notification via queue `[LOW]`

When a billing becomes overdue (detected by the daily cron or on-read by `applyOverdue`), enqueue a notification:
- Push notification / in-app alert to the seller
- Optionally, future SMS/WhatsApp integration point

**Scope**: Queue job only. No external provider yet.

---

## Implementation Order

```
BIL-01  due_date nullable migration
BIL-03  remove auto-paid on delivery
BIL-02  BillingScheduler helper
BIL-04  reliable per_sale creation using repository directly
BIL-05  periodic billing cron (weekly/biweekly/monthly)
BIL-06  order page billing status
BIL-07  billing summary cards + period filter
BIL-08  customer filter
BIL-09  overdue notifications
```

---

## Schema Changes Required

### Migration: `due_date` nullable

```sql
ALTER TABLE "billings" ALTER COLUMN "due_date" DROP NOT NULL;
ALTER TABLE "billings" ALTER COLUMN "due_date" DROP DEFAULT;
```

### Prisma schema diff

```prisma
model Billing {
  // before:
  due_date DateTime  @default(now()) @db.Timestamptz()
  // after:
  due_date DateTime? @db.Timestamptz()
}
```

### No other schema changes needed for BIL-01 through BIL-08.
### BIL-05 aggregate variant would require:
```prisma
model Billing {
  billing_period_start DateTime? @db.Timestamptz()
  billing_period_end   DateTime? @db.Timestamptz()
  // order_id becomes nullable, add join table
}
```
Start with per-order approach and revisit only if the seller explicitly needs aggregate invoices.
