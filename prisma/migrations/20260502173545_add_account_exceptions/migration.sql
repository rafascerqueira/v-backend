-- CreateEnum
CREATE TYPE "AccountExceptionType" AS ENUM ('unlimited_window', 'custom_limits', 'billing_adjustment', 'plan_grant');

-- CreateEnum
CREATE TYPE "AccountExceptionStatus" AS ENUM ('active', 'expired', 'revoked');

-- CreateTable
CREATE TABLE "account_exceptions" (
    "id" UUID NOT NULL,
    "account_id" TEXT NOT NULL,
    "type" "AccountExceptionType" NOT NULL,
    "status" "AccountExceptionStatus" NOT NULL DEFAULT 'active',
    "effective_from" TIMESTAMPTZ NOT NULL,
    "effective_until" TIMESTAMPTZ,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "revoked_by" TEXT,
    "revoked_at" TIMESTAMPTZ,
    "revoke_reason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "account_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_account_exceptions_account_status" ON "account_exceptions"("account_id", "status");

-- CreateIndex
CREATE INDEX "idx_account_exceptions_type_status" ON "account_exceptions"("type", "status");

-- AddForeignKey
ALTER TABLE "account_exceptions" ADD CONSTRAINT "account_exceptions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_exceptions" ADD CONSTRAINT "account_exceptions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
