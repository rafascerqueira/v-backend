---
name: phase1-orders-outbox-review
description: 2026-11-02 static review of v-backend#5 (1B outbox) + #6 (1A orders, branch claude/phase1-1a-orders) — open findings to re-verify, and verified non-issues not to re-flag
metadata:
  type: project
---

Static review (Phase 2 only) of stacked PRs v-backend#5/#6 on 2026-11-02. The user said they would fix the findings themselves. Re-check these on later audits:

- **H (pre-existing, carried forward):** the anonymous `POST /catalog/loja/:slug/orders` response echoes the DB customer (id, full name, email, phone). Because `findCustomerByContact` matches on email OR phone OR document, this lets anyone enumerate a store's customers by phone number or CPF. It contradicts the minimisation already done in `getCustomerInStore` and `lookupCustomer`, which return only the first name.
- **M:** `POST /orders` now returns `findById` with `customer: true`, which leaks `password_hash`. `GET /orders/:id` had the same leak before. Suggested fix: Prisma global `omit`.
- **M:** anonymous DoS: `items` arrays have no `.max()`, duplicate product ids are allowed, the repo runs per-item queries inside a 5 s interactive tx, the pg pool holds 10 connections, and the storefront order route has no route-specific `@Throttle`.
- **M (API6):** the storefront path now decrements stock, creates per-sale charges (default `billing_mode` is `per_sale`) and emails the seller on every anonymous order.
- **L:** migration `billings.seller_id` is NOT NULL with no default, so old code (during the deploy window or after a rollback) can't insert billings. A `(seller_id, order_number)` collision is sticky because a rollback hands the same sequence value back. The HAS_PAYMENTS check-then-delete is racy. The Idempotency-Key minimum length is 1, while storefront keys share one namespace per store.

**Verified non-issues (don't re-flag):** the raw SQL in claim/sequence/relay uses tagged templates. `domain_events` payloads carry no PII. The events endpoint is tenant-checked. The effect worker takes the tenant from the DB `seller_id`. The storefront `tenantContext.run` uses role 'seller', which overrides the ambient context. `source`, `metadata` and `tracking_token` are server-set. The tracking regex `^PED-\d+$` can't be bypassed (JS `$`, exact varchar match). The CI uses `pull_request`, not `_target`.

**Why:** these findings were handed to the user to fix. The non-issues took real analysis to clear.
**How to apply:** on the next orders/catalog/outbox audit, check these first. This supersedes the "order-number entropy" P3 in [[open-followups-2fa-tracking]]: tracking now uses 128-bit tokens, and only the legacy random-number branch remains.
