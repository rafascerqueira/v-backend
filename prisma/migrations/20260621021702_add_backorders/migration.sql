-- CreateEnum
CREATE TYPE "BackorderStatus" AS ENUM ('pending', 'fulfilled', 'canceled');

-- CreateTable
CREATE TABLE "backorders" (
    "id" SERIAL NOT NULL,
    "seller_id" TEXT NOT NULL,
    "order_id" INTEGER NOT NULL,
    "order_item_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "fulfilled_quantity" INTEGER NOT NULL DEFAULT 0,
    "status" "BackorderStatus" NOT NULL DEFAULT 'pending',
    "fulfilledAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "backorders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "backorders_order_item_id_key" ON "backorders"("order_item_id");

-- CreateIndex
CREATE INDEX "idx_backorders_seller" ON "backorders"("seller_id");

-- CreateIndex
CREATE INDEX "idx_backorders_product_status" ON "backorders"("product_id", "status");

-- CreateIndex
CREATE INDEX "idx_backorders_order" ON "backorders"("order_id");

-- AddForeignKey
ALTER TABLE "backorders" ADD CONSTRAINT "backorders_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backorders" ADD CONSTRAINT "backorders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backorders" ADD CONSTRAINT "backorders_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backorders" ADD CONSTRAINT "backorders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
