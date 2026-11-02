---
name: stripe-billing
description: >
  Robust Stripe subscription billing in v-backend (NestJS 11 + Fastify, card-only
  recurring, Pro R$14,90/mês). Use when touching the `subscriptions` module:
  Stripe webhooks, signature verification, webhook idempotency, idempotency keys
  on subscription mutations, checkout/portal sessions, subscription lifecycle
  (created/active/past_due/canceled) → account plan state, plan gating with
  PlanLimitsGuard / @CheckPlanLimit (and aspirational PlanGuard / @RequiredPlan),
  STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_* env vars, and where
  subscription_triggers.sql fits. Keywords: stripe, webhook, whsec, checkout
  session, billing portal, subscription, plan upgrade, MRR, ROI, cents.
---

# Stripe billing — robust subscription integration

The billing engine lives in `src/modules/subscriptions/` (NOT `src/modules/billings/`
— that is per-sale customer invoicing, an unrelated feature). For amount handling
defer to the root `money-cents` skill; for migrations/`subscription_triggers.sql`
defer to `prisma-migrations-safe`. Do **not** edit anything under `.devin/`.

## When to use

- Adding/changing Stripe webhook handling, checkout, or billing-portal sessions.
- Mapping a Stripe subscription lifecycle event to account `plan_type`.
- Gating an endpoint or feature behind a plan tier or a per-plan usage limit.
- Adding a new `STRIPE_PRICE_*` / plan, or wiring the `STRIPE_*` env vars.

## Non-negotiable rules

1. **Verify every webhook signature against the raw body.** The endpoint is
   `POST /webhooks/stripe`, `@Public()`, `@HttpCode(200)`. Read the unparsed body
   via `RawBodyRequest<FastifyRequest>.rawBody` (enabled by `rawBody: true` in
   `main.ts`) and `stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)`.
   A missing `stripe-signature` header → 400; a failed construct → 400. **Never**
   parse/trust the JSON body before verification. `stripe-signature` is already in
   the CORS `allowedHeaders`.
2. **Idempotent event handling.** Stripe retries; the same `event.id` arrives more
   than once. Persist it first (`webhookRepository.upsertWebhookEvent`), short-circuit
   if `existing.processed`, then `markWebhookProcessed` / `markWebhookError`. Handlers
   must be safe to re-run (upsert/`updateBy...ProviderId`, not blind insert).
3. **Idempotency keys on subscription mutations.** Any state-changing Stripe call
   should pass `{ idempotencyKey }` as the second arg so a retried request can't
   double-charge or duplicate a subscription. Stripe compares the **whole request body**
   for a reused key and answers `idempotency_error` if anything differs. So a key
   must never be shared by two requests whose bodies can differ, and a body with a
   volatile field like `expires_at` always differs between attempts.
   - Checkout session: `checkout_${accountId}_${attemptId}`. The attempt id is the
     per-account lock token, so the key only dedupes the SDK's own network retries of
     that request. Duplicates across attempts are prevented by the lock and by
     expiring older open sessions, not by the key. A time-bucketed or params-hash
     key breaks every retry within the bucket (AUDIT-010).
   - Customer: `customer_${accountId}_${purpose}_${hash(params)}`, where `purpose` is
     `initial`, or `replace_<staleId>` when the stored Customer was deleted, so a
     replacement never replays the deleted one.
4. **Card-only recurring.** `mode: 'subscription'`, `payment_method_types: ['card']`.
   No boleto/Pix/one-off here.
5. **All amounts are integer cents.** `PLAN_PRICES.pro = 1490` (R$ 14,90). Stripe
   amounts (`unit_amount`, invoice totals) are already in the smallest currency unit
   — pass/read cents directly, never `/100` server-side. See `money-cents`.
6. **Repository pattern holds.** Services never import `PrismaService`; all DB writes
   go through `SUBSCRIPTION_REPOSITORY` / `WEBHOOK_REPOSITORY`. Use `ConfigService`
   (`stripe.secretKey`, `stripe.webhookSecret`, `stripe.priceIds.*`) — never raw
   `process.env`. Stripe degrades gracefully when unconfigured (`isConfigured()`
   false → handlers no-op).

## Playbook

1. **Webhook path (the security boundary)**
   - `WebhookController.handleStripeWebhook` → `StripeService.constructWebhookEvent`
     (verify) → `WebhookService.processStripeWebhook` (idempotency gate) →
     `handleStripeEvent` (switch on `event.type`).
   - Handled types: `checkout.session.completed`, `customer.subscription.created`/
     `updated`/`deleted`, `invoice.payment_succeeded`/`payment_failed`. Unknown
     types are logged and acknowledged with 200 (don't 4xx — Stripe will retry forever).

2. **Lifecycle → plan state mapping** (`mapStripeStatus` + `WebhookService`)

   | Stripe status | internal status | account `plan_type` |
   |---|---|---|
   | `active` / `trialing` | `active` / `trialing` | paid tier from the **billed price** (`StripeService.resolvePlanType`) |
   | `past_due` / `unpaid` / `incomplete` | `past_due` | unchanged: keeps a plan already held (dunning), **never grants** one |
   | `canceled` / `incomplete_expired` | `canceled` | `free` on `subscription.deleted` (`handleSubscriptionEnded`), unless another active sub exists |
   | `paused` | `paused` | per product call |

   - **Grant only on a paying status** (`isPayingStatus` in `constants/plan-limits.ts`)
     — in the webhook and the reconcile. Persisting a row never upgrades by itself.
   - **Tier = price, not metadata.** `items.data[0].price.id` is reverse-mapped through
     `stripe.priceIds.*`; a Billing Portal plan switch changes the price, never the
     metadata. Metadata is only a fallback and always goes through `toPaidPlanType`
     (an unknown string reaching the `PlanType` enum throws and wedges the webhook).
   - **Live state, not the payload.** `customer.subscription.*` handlers re-read the
     subscription (`StripeService.retrieveSubscription`) before writing, so a delayed
     or out-of-order event can't roll the status back. Writes go through
     `upsertSubscriptionFromStripe` (unique `provider_subscription_id`, race-safe on
     P2002) — the same path the reconcile uses.

   `account_id` rides on `metadata.account_id` (set at checkout + on `subscription_data`).
   No metadata → log and return; never guess the tenant.

3. **Checkout & portal** (`CheckoutService` + `StripeService` + `SubscriptionController`)
   - **One paid subscription per account, enforced from Stripe's live state**, never
     from local rows alone (rows only exist once a webhook lands; AUDIT-001).
     `POST /subscriptions/checkout { planId }`:
     1. body validated by `checkoutSchema` (`z.enum(PAID_PLANS)`: `planId` doubles as
        a ConfigService path resolved with lodash `get`, so `'[pro]'` would otherwise
        find the Pro price); unconfigured price/Stripe → 400;
     2. per-account Redis lock `checkout-lock:{accountId}`
        (`RedisService.acquireLock`/`releaseLock`); busy → 409 `CHECKOUT_IN_PROGRESS`;
     3. local `hasBlockingSubscription` → 409 `SUBSCRIPTION_EXISTS`;
     4. **one Stripe Customer per account**: `accounts.stripe_customer_id`, created
        once by `getOrCreateCustomer`. Checkout passes `customer`, **never
        `customer_email`**, which spawned a Customer per session and hid existing
        subscriptions from Stripe. A stored Customer that was deleted in Stripe (or
        is from the other mode) is replaced with a compare-and-swap;
     5. `expireOpenCheckoutSessions` **first**, so a session paid in the meantime
        shows up as a live subscription in the next step instead of slipping
        between the two;
     6. live `listLiveSubscriptions` over that Customer plus legacy
        `provider_customer_id`s:
        - active/trialing/past_due/unpaid/paused → 409 `SUBSCRIPTION_EXISTS` (the
          way forward is the portal);
        - this account's `incomplete` (never paid) is canceled; one younger than
          10 min may still be in 3-D Secure → 409 `CHECKOUT_IN_PROGRESS`;
     7. create the card-only session (`expires_at` = +35 min, above Stripe's 30 min
        minimum), then **re-check the lock is still ours** (`isLockHeld`). If a slow
        call outlived it, expire the new session and return 409. Stripe calls are
        bounded (20 s timeout, 1 retry) and the lock TTL is 60 s.
     Any Stripe error **fails closed**: 500, no session. 409 bodies carry a `code`
     (SCREAMING_SNAKE_CASE only) that `GlobalExceptionFilter` forwards. Optional
     promo coupon via `SettingsService.getPromotionalPeriod()`.
   - **Backstop:** a second paying subscription that slips through is logged as
     `[DUPLICATE_SUBSCRIPTION]`, by the webhook and by the reconcile
     (`duplicateSubscriptionAccounts`). There is no automatic cancel or refund: handle
     it in the Dashboard. Also keep Checkout's "Limit customers to one subscription"
     setting on, with the portal login link enabled.
   - `POST /subscriptions/portal` → Billing Portal session for the Customer that owns
     the account's manageable (live) subscription, falling back to
     `accounts.stripe_customer_id` (`getPortalCustomerId`). The fallback covers a
     legacy account with several Customers, the time before any webhook has landed,
     and a free account that still owes an unpaid invoice. No Customer → 400. The
     portal configuration must allow paying open invoices and canceling.

4. **Plan gating**
   - Per-resource usage caps: `@UseGuards(PlanLimitsGuard)` + `@CheckPlanLimit('product'|'customer'|'order')`
     on creation endpoints (see `create-product.controller.ts`, `orders.controller.ts`).
     Admins and missing limit-type bypass; over limit → `ForbiddenException` (pt-BR message).
   - Limits/prices/feature flags are the single source of truth in
     `constants/plan-limits.ts` (`PLAN_LIMITS`, `PLAN_PRICES`, `PLAN_NAMES`). `GET
     /subscriptions/plans` serves them to the frontend. Change a limit/price there only.
   - **Tier gating (`PlanGuard` + `@RequiredPlan(...)`)** is named in `CLAUDE.md` but
     **not implemented yet** — only `PlanLimitsGuard` exists. If you need feature-tier
     gating, build it on the same `Reflector` + metadata pattern (read `user.plan_type`,
     compare to `PLAN_LIMITS[plan].features`), and flag the new convention at task end.

5. **`subscription_triggers.sql`** — DB-side subscription/plan triggers live at
   `prisma/migrations/manual/subscription_triggers.sql` (VPS-only, NOT a tracked
   migration, no `_prisma_migrations` row). The deploy pipeline applies it *after*
   `prisma migrate deploy` + the drift guard, "if present". Edit it idempotently.
   See `prisma-migrations-safe`.

6. **ROI/MRR.** Measure ROI via the **Stripe Dashboard** now (MRR, churn, failed
   payments). An in-app MRR view in the admin panel is a later step — don't compute
   revenue from local rows until that ticket lands; cents only when it does.

## Checklist

- [ ] Webhook verifies signature on `req.rawBody`; missing sig → 400, bad sig → 400.
- [ ] Event handled idempotently (gate on `event.id` + `processed`; handlers re-runnable).
- [ ] Subscription-mutating Stripe calls pass an `idempotencyKey`.
- [ ] Sessions are `mode: 'subscription'`, `payment_method_types: ['card']`, carry
      `metadata.account_id`.
- [ ] Lifecycle status mapped to the right `plan_type` (no plan loss on `past_due`).
- [ ] Amounts are integer cents; price/limits read from `plan-limits.ts`.
- [ ] No `PrismaService` in services; `STRIPE_*` read via `ConfigService`.
- [ ] Unknown event types acknowledged with 200, not rejected.

## Gotchas

- **Period fields need `* 1000`.** Stripe sends UNIX seconds
  (`current_period_start/end`); convert to `new Date(sec * 1000)`. They're read via
  `(subscription as any)` because the SDK types don't surface them on the top level.
- **Two `account_id` carriers.** Set metadata on *both* the Checkout session and
  `subscription_data.metadata` — later `customer.subscription.*` events only carry
  the subscription's own metadata.
- **`checkout.session.completed` is not the source of truth.** It upgrades the plan
  eagerly; the full subscription row is written by the `customer.subscription.created`
  event that fires right after. Keep both idempotent.
- **Pinned API version** `'2026-03-25.dahlia'` in `StripeService` — match it in the
  Stripe Dashboard webhook config so payload shapes line up (period fields on the
  subscription item, invoice→sub link under `parent.subscription_details`).
- **PagSeguro is dead.** `POST /webhooks/pagseguro` returns 410 Gone (it never verified
  signatures). Don't revive it; billing is Stripe-only.
- **Don't add CORS headers in nginx** for `/webhooks/*` — NestJS owns CORS (DEPLOY.md).

## References

- Stripe client + handlers: `src/modules/subscriptions/services/stripe.service.ts`
- Idempotent event store: `src/modules/subscriptions/services/webhook.service.ts`,
  `src/shared/repositories/webhook.repository.ts`
- Raw-body webhook endpoint: `src/modules/subscriptions/controllers/webhook.controller.ts`
- Checkout/portal/plans API: `src/modules/subscriptions/controllers/subscription.controller.ts`
- Plan limits + prices: `src/modules/subscriptions/constants/plan-limits.ts`
- Usage guard: `src/modules/subscriptions/guards/plan-limits.guard.ts`
- Env vars (`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_PRICE_*`):
  `src/config/configuration.ts` (`stripe.*`), `DEPLOY.md`, `.env.example`
- `rawBody: true` + `stripe-signature` CORS header: `src/main.ts`
- `subscription_triggers.sql` placement/apply: `prisma-migrations-safe`,
  `.github/workflows/pipeline.yml`
- Amounts/cents: root `money-cents` skill
