-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('per_sale', 'weekly', 'biweekly', 'monthly', 'custom');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "billing_mode" "BillingMode" NOT NULL DEFAULT 'per_sale';
