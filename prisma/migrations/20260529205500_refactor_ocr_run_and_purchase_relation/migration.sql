-- AlterTable
ALTER TABLE "OcrRun" ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "fileSizeBytes" INTEGER,
ADD COLUMN     "fileUrl" TEXT NOT NULL,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "originalFileName" TEXT,
ADD COLUMN     "processingCompletedAt" TIMESTAMP(3),
ADD COLUMN     "processingStartedAt" TIMESTAMP(3),
ADD COLUMN     "purchaseId" TEXT,
ADD COLUMN     "rawLlmResponse" TEXT,
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending',
ALTER COLUMN "source" SET DEFAULT '',
ALTER COLUMN "fields" SET DEFAULT '{}',
ALTER COLUMN "confidence" SET DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "OcrRun_purchaseId_key" ON "OcrRun"("purchaseId");

-- CreateIndex
CREATE INDEX "OcrRun_tenantId_status_idx" ON "OcrRun"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "OcrRun" ADD CONSTRAINT "OcrRun_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
