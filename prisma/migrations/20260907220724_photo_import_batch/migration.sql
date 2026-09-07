-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "importBatchId" TEXT;

-- AlterTable
ALTER TABLE "Photo" ADD COLUMN     "importBatchId" TEXT,
ALTER COLUMN "itemId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Item_importBatchId_idx" ON "Item"("importBatchId");

-- CreateIndex
CREATE INDEX "Photo_importBatchId_idx" ON "Photo"("importBatchId");
