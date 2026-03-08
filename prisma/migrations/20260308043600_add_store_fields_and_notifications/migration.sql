/*
  Warnings:

  - A unique constraint covering the columns `[store_slug]` on the table `accounts` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "store_banner" VARCHAR(255),
ADD COLUMN     "store_description" TEXT,
ADD COLUMN     "store_logo" VARCHAR(255),
ADD COLUMN     "store_name" VARCHAR(100),
ADD COLUMN     "store_phone" VARCHAR(20),
ADD COLUMN     "store_slug" VARCHAR(50),
ADD COLUMN     "store_whatsapp" VARCHAR(20),
ADD COLUMN     "two_factor_backup" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ,
    "email_sent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_notifications_user_read" ON "notifications"("user_id", "read");

-- CreateIndex
CREATE INDEX "idx_notifications_user_date" ON "notifications"("user_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_store_slug_key" ON "accounts"("store_slug");

-- CreateIndex
CREATE INDEX "idx_accounts_store_slug" ON "accounts"("store_slug");
