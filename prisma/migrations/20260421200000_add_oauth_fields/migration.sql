-- AlterTable: make password and salt nullable, add OAuth provider ID columns
ALTER TABLE "accounts"
  ALTER COLUMN "password" DROP NOT NULL,
  ALTER COLUMN "salt" DROP NOT NULL,
  ADD COLUMN "google_id" VARCHAR(255),
  ADD COLUMN "facebook_id" VARCHAR(255);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_google_id_key" ON "accounts"("google_id");
CREATE UNIQUE INDEX "accounts_facebook_id_key" ON "accounts"("facebook_id");
