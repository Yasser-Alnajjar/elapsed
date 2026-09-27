-- CreateTable
CREATE TABLE "notification_failures" (
    "id" TEXT NOT NULL,
    "commitmentId" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "firstFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_failures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_failures_commitmentId_threshold_key" ON "notification_failures"("commitmentId", "threshold");

-- AddForeignKey
ALTER TABLE "notification_failures" ADD CONSTRAINT "notification_failures_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
