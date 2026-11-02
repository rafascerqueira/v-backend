-- Phase 1A: server-side order numbering, storefront tracking tokens, per-seller
-- billing numbers.
--
-- Orders are now numbered by the server from a per-seller counter (PED-000123, and
-- COB-000123 for the per-sale charge). Two consequences handled here:
--
-- 1. billings.billing_number was unique GLOBALLY, so every seller's first charge
--    (COB-000001) would collide. Billings get the owning seller (backfilled from the
--    order; order_id is NOT NULL so every row resolves) and the unique becomes
--    (seller_id, billing_number). No pre-check: a globally unique column is also
--    unique per seller.
--
-- 2. Storefront tracking used the order number as the secret (timestamp + random).
--    Sequential numbers are guessable, so storefront orders get an unguessable
--    tracking_token; existing storefront orders (metadata.source = 'catalog') are
--    backfilled so links built from now on work for them too. Legacy links that
--    carry the old random number keep working (resolved in the app).
--
-- seller_sequences starts each seller after the highest number already in the new
-- format, from orders (PED-n) or hand-typed billings (COB-n), so the first
-- generated numbers can't collide with a row typed by hand. Only 1-9 digit numbers
-- count, which keeps the counter inside INTEGER range.

-- 1. Billings: owning seller + per-seller unique number
ALTER TABLE "billings" ADD COLUMN "seller_id" TEXT;

UPDATE "billings" b
SET "seller_id" = o."seller_id"
FROM "orders" o
WHERE o."id" = b."order_id"
  AND b."seller_id" IS NULL;

ALTER TABLE "billings" ALTER COLUMN "seller_id" SET NOT NULL;

DROP INDEX "billings_billing_number_key";
CREATE UNIQUE INDEX "uq_billings_seller_number" ON "billings"("seller_id", "billing_number");

ALTER TABLE "billings" ADD CONSTRAINT "billings_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Orders: storefront tracking token (backfilled) + customer index
ALTER TABLE "orders" ADD COLUMN "tracking_token" VARCHAR(32);

UPDATE "orders"
SET "tracking_token" = replace(gen_random_uuid()::text, '-', '')
WHERE "metadata"->>'source' = 'catalog'
  AND "tracking_token" IS NULL;

CREATE UNIQUE INDEX "uq_orders_tracking_token" ON "orders"("tracking_token");
CREATE INDEX "idx_orders_customer" ON "orders"("customer_id");

-- 3. Per-seller counters, initialised past any number already in the new format
CREATE TABLE "seller_sequences" (
    "seller_id" TEXT NOT NULL,
    "name" VARCHAR(30) NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "seller_sequences_pkey" PRIMARY KEY ("seller_id","name")
);

ALTER TABLE "seller_sequences" ADD CONSTRAINT "seller_sequences_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "seller_sequences" ("seller_id", "name", "value")
SELECT "seller_id", 'order', MAX(n)::INTEGER
FROM (
  SELECT "seller_id", substring("order_number" FROM 5)::BIGINT AS n
  FROM "orders"
  WHERE "order_number" ~ '^PED-[0-9]{1,9}$'
  UNION ALL
  SELECT "seller_id", substring("billing_number" FROM 5)::BIGINT AS n
  FROM "billings"
  WHERE "billing_number" ~ '^COB-[0-9]{1,9}$'
) used
GROUP BY "seller_id"
ON CONFLICT ("seller_id", "name") DO NOTHING;
