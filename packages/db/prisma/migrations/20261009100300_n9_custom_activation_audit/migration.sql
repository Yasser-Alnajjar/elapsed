-- N9.8a (plan 09, 5.5 and 5.6): audit of custom configuration activations and rollbacks. Additive.

-- CreateTable
CREATE TABLE "custom_activation_audits" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromVersion" INTEGER,
    "toVersion" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_activation_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_activation_audits_integrationId_createdAt_idx" ON "custom_activation_audits"("integrationId", "createdAt");

-- AddForeignKey
ALTER TABLE "custom_activation_audits" ADD CONSTRAINT "custom_activation_audits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_activation_audits" ADD CONSTRAINT "custom_activation_audits_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

