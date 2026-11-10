-- Phase 1B: transactional outbox + idempotency ledger.
--
-- domain_events: repositories append rows inside the same transaction as the business
-- write, so an event exists iff that write committed. The outbox relay publishes rows
-- with published_at IS NULL to BullMQ (at-least-once) and stamps published_at; failures
-- bump attempts/last_error. Rows are kept as history (no deletion).
--
-- idempotency_keys: Idempotency-Key ledger for retried POSTs (used from Phase 1A),
-- written in the resource's transaction and purged after 7 days by a daily job.
--
-- notifications.dedupe_key: domain-event consumers set it so a redelivered effect job
-- can't notify twice. Existing rows stay NULL, which UNIQUE allows any number of, so
-- the index can't fail on current data.
--
-- Additive only: new tables, a nullable column and indexes. No backfill.

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "dedupe_key" VARCHAR(150);

-- CreateTable
CREATE TABLE "domain_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seller_id" TEXT,
    "aggregate_type" VARCHAR(50) NOT NULL,
    "aggregate_id" VARCHAR(64) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "seller_id" TEXT NOT NULL,
    "scope" VARCHAR(50) NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "resource_type" VARCHAR(50) NOT NULL,
    "resource_id" VARCHAR(64) NOT NULL,
    "status_code" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("seller_id","scope","key")
);

-- CreateIndex
CREATE INDEX "idx_domain_events_unpublished" ON "domain_events"("published_at", "occurred_at");

-- CreateIndex
CREATE INDEX "idx_domain_events_aggregate" ON "domain_events"("aggregate_type", "aggregate_id", "occurred_at");

-- CreateIndex
CREATE INDEX "idx_domain_events_seller" ON "domain_events"("seller_id");

-- CreateIndex
CREATE INDEX "idx_idempotency_keys_created" ON "idempotency_keys"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_notifications_dedupe_key" ON "notifications"("dedupe_key");

-- AddForeignKey
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

