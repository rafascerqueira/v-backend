-- Phase 1C: append-only payment ledger for billings.
--
-- billings.paid_amount used to be overwritten by PATCH (the frontend sent the new
-- absolute total), so a stale screen or two tabs could erase a payment, and nobody
-- could tell who paid how much and when. From now on every money movement is a
-- row in billing_payments (a payment, or a reversal pointing at the payment it
-- cancels), and paid_amount is its running balance, maintained in the same
-- transaction under a row lock.
--
-- Pre-checks: the deploy stops here, with nothing applied (the file runs as one
-- transaction), if the data would violate the new constraints:
--   SELECT order_id, count(*) FROM billings GROUP BY order_id HAVING count(*) > 1;
--   SELECT id, total_amount, paid_amount FROM billings
--    WHERE paid_amount > total_amount OR paid_amount < 0 OR total_amount < 0;
-- Prisma then records this migration as failed (P3018). Recovery: fix the rows
-- (back up first), run
--   pnpm prisma migrate resolve --rolled-back 20261103100000_phase1c_billing_ledger
-- and redeploy. Run the SELECTs BEFORE deploying to avoid the round trip.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "billings" GROUP BY "order_id" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Phase 1C pre-check failed: some orders have more than one billing (see the SELECT at the top of this migration).';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "billings"
    WHERE "paid_amount" > "total_amount" OR "paid_amount" < 0 OR "total_amount" < 0
  ) THEN
    RAISE EXCEPTION 'Phase 1C pre-check failed: billings with paid_amount > total_amount or negative amounts (see the SELECT at the top of this migration).';
  END IF;
END $$;

-- 1. payment_date becomes timestamptz. Prisma wrote UTC into the old
--    timestamp-without-zone column, so interpret it as UTC (not the session zone).
ALTER TABLE "billings"
  ALTER COLUMN "payment_date" SET DATA TYPE TIMESTAMPTZ USING "payment_date" AT TIME ZONE 'UTC';

-- 2. One charge per order (the unique index replaces the plain one).
DROP INDEX "idx_billings_order_id";
CREATE UNIQUE INDEX "uq_billings_order_id" ON "billings"("order_id");

-- 3. Money invariants on billings. NOT VALID + VALIDATE: validation takes a weaker
--    lock than adding a validated constraint in one step.
ALTER TABLE "billings" ADD CONSTRAINT "chk_billings_total_nonneg" CHECK ("total_amount" >= 0) NOT VALID;
ALTER TABLE "billings" ADD CONSTRAINT "chk_billings_paid_nonneg" CHECK ("paid_amount" >= 0) NOT VALID;
ALTER TABLE "billings" ADD CONSTRAINT "chk_billings_paid_le_total" CHECK ("paid_amount" <= "total_amount") NOT VALID;
ALTER TABLE "billings" VALIDATE CONSTRAINT "chk_billings_total_nonneg";
ALTER TABLE "billings" VALIDATE CONSTRAINT "chk_billings_paid_nonneg";
ALTER TABLE "billings" VALIDATE CONSTRAINT "chk_billings_paid_le_total";

-- 4. The ledger.
CREATE TYPE "BillingPaymentKind" AS ENUM ('payment', 'reversal');

CREATE TABLE "billing_payments" (
    "id" SERIAL NOT NULL,
    "billing_id" INTEGER NOT NULL,
    "seller_id" TEXT NOT NULL,
    "kind" "BillingPaymentKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "paid_at" TIMESTAMPTZ NOT NULL,
    "note" VARCHAR(500),
    "created_by" VARCHAR(50),
    "reversal_of_id" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_billing_payments_amount_positive" CHECK ("amount" > 0),
    -- A reversal always points at a payment; a payment never points anywhere.
    CONSTRAINT "chk_billing_payments_reversal_link" CHECK (("kind" = 'reversal') = ("reversal_of_id" IS NOT NULL))
);

CREATE UNIQUE INDEX "uq_billing_payments_reversal_of" ON "billing_payments"("reversal_of_id");
CREATE INDEX "idx_billing_payments_billing" ON "billing_payments"("billing_id", "paid_at");
CREATE INDEX "idx_billing_payments_seller" ON "billing_payments"("seller_id");

-- NO ACTION is checked at the end of the statement: deleting a charge (or its order
-- or customer) that has entries fails, while deleting the account still works
-- because the same statement also cascades the entries through seller_id.
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_billing_id_fkey" FOREIGN KEY ("billing_id") REFERENCES "billings"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "billing_payments"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- 5. Backfill: what was already paid becomes one opening entry per charge, so the
--    ledger balance equals paid_amount from day one. Idempotent: only charges
--    without entries. Money stays in integer cents.
INSERT INTO "billing_payments" ("billing_id", "seller_id", "kind", "amount", "method", "paid_at", "note", "created_by")
SELECT b."id", b."seller_id", 'payment', b."paid_amount", b."payment_method",
       COALESCE(b."payment_date", b."updatedAt"), 'Saldo anterior ao histórico', NULL
FROM "billings" b
WHERE b."paid_amount" > 0
  AND NOT EXISTS (SELECT 1 FROM "billing_payments" p WHERE p."billing_id" = b."id");
