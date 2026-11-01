-- One row per provider subscription.
--
-- The Stripe webhook did "find by provider_subscription_id, else create" without a
-- unique constraint, so customer.subscription.created/updated processed concurrently
-- could both miss and insert two rows for the same Stripe subscription. Later updates
-- then hit whichever row findFirst returned, leaving the other with a stale status.
-- The webhook now upserts on this key, which needs the unique index below.
--
-- Data fix first, in the same unit: if duplicates already exist, CREATE UNIQUE INDEX
-- would fail and wedge the migration chain (finished_at = NULL). Keep the most
-- recently written row per provider id (updatedAt, then id) and delete the rest. The
-- survivor is re-synced from Stripe by the next webhook or the daily reconcile, so no
-- state is lost. NULL provider ids are untouched (they stay distinct under UNIQUE).
--
-- The lock blocks concurrent writes (the old app keeps serving webhooks during the
-- deploy) so no new duplicate can land between the DELETE and the index creation.
-- It is held only for this migration's transaction; reads are not blocked.
LOCK TABLE "subscriptions" IN SHARE ROW EXCLUSIVE MODE;

DELETE FROM "subscriptions" s
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY provider_subscription_id
           ORDER BY "updatedAt" DESC, id DESC
         ) AS rn
  FROM "subscriptions"
  WHERE provider_subscription_id IS NOT NULL
) d
WHERE s.id = d.id
  AND d.rn > 1;

-- DropIndex
DROP INDEX "idx_subscriptions_provider";

-- CreateIndex
CREATE UNIQUE INDEX "uq_subscriptions_provider_subscription_id" ON "subscriptions"("provider_subscription_id");
