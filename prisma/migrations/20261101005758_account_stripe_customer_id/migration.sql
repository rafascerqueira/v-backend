-- One Stripe Customer per account.
--
-- Checkout used `customer_email`, so Stripe created a new Customer on every session.
-- Stripe could not see that an account already had a subscription, and two open
-- sessions could both be paid (AUDIT-001). From now on every checkout reuses the
-- account's Customer, stored here.

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "stripe_customer_id" VARCHAR(255);

-- CreateIndex
CREATE UNIQUE INDEX "uq_accounts_stripe_customer_id" ON "accounts"("stripe_customer_id");

-- Backfill: adopt the Customer of each account's Stripe subscription row, preferring a
-- LIVE subscription (active/trialing/past_due/paused) over a newer but abandoned or
-- canceled attempt, then the most recent. Otherwise a legacy account with an active
-- subscription on one Customer and a later abandoned attempt on another would adopt the
-- wrong one.
-- Only Customers that belong to exactly one account are adopted. A Customer seen on two
-- accounts would violate the unique index and fail the deploy, so that account is left
-- NULL and simply gets a fresh Customer on its next checkout. Idempotent: it only fills
-- NULLs.
UPDATE "accounts" a
SET "stripe_customer_id" = latest.provider_customer_id
FROM (
  SELECT DISTINCT ON (s.account_id) s.account_id, s.provider_customer_id
  FROM "subscriptions" s
  WHERE s.payment_provider = 'stripe'
    AND s.provider_customer_id IS NOT NULL
  ORDER BY s.account_id,
           (s.status IN ('active', 'trialing', 'past_due', 'paused')) DESC,
           s."createdAt" DESC,
           s.id DESC
) latest
WHERE a.id = latest.account_id
  AND a."stripe_customer_id" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "subscriptions" other
    WHERE other.provider_customer_id = latest.provider_customer_id
      AND other.account_id <> latest.account_id
  );
