-- AlterTable
ALTER TABLE "billings" ALTER COLUMN "due_date" DROP NOT NULL,
ALTER COLUMN "due_date" DROP DEFAULT;
