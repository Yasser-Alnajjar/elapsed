-- N9.7 (plan 09, 6.11): durable record of safety-guard overrides. Additive.

-- CreateTable
CREATE TABLE "guard_overrides" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "guard" TEXT NOT NULL,
    "previewHash" TEXT NOT NULL,
    "counts" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "authorizedByUserId" TEXT,
    "operatorEmail" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guard_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guard_overrides_integrationId_guard_consumedAt_idx" ON "guard_overrides"("integrationId", "guard", "consumedAt");

-- CreateIndex
CREATE INDEX "guard_overrides_organizationId_createdAt_idx" ON "guard_overrides"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "guard_overrides" ADD CONSTRAINT "guard_overrides_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guard_overrides" ADD CONSTRAINT "guard_overrides_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

