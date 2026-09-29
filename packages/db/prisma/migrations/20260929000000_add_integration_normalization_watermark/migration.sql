-- AlterTable
ALTER TABLE "integrations" ADD COLUMN     "normalizedThroughFetchedAt" TIMESTAMP(3),
ADD COLUMN     "normalizedThroughId" TEXT;
