/*
  Warnings:

  - You are about to drop the column `price` on the `bundles` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "bundles" DROP COLUMN "price",
ADD COLUMN     "discount_percent" INTEGER NOT NULL DEFAULT 0;
