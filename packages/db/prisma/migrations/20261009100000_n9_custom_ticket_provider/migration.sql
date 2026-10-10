-- N9 (plan 09, 9.3): additive and expand-only. The `custom` IntegrationProvider value is added by the N9.8 migration, with the registries that need it.

-- CreateEnum
CREATE TYPE "SyncRunOutcome" AS ENUM ('ok', 'partial', 'failed', 'aborted');

-- CreateEnum
CREATE TYPE "SyncRunTrigger" AS ENUM ('worker', 'manual', 'connect', 'webhook');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "customProviderEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "integrations" ADD COLUMN     "activeConfigVersion" INTEGER,
ADD COLUMN     "slaSupport" JSONB;

-- CreateTable
CREATE TABLE "integration_sync_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "trigger" "SyncRunTrigger" NOT NULL DEFAULT 'worker',
    "outcome" "SyncRunOutcome" NOT NULL,
    "reasonCode" TEXT,
    "secondaryReason" TEXT,
    "configVersion" INTEGER,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "recordsFetched" INTEGER NOT NULL DEFAULT 0,
    "casesWritten" INTEGER NOT NULL DEFAULT 0,
    "eventsWritten" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "failures" JSONB,
    "progress" JSONB,

    CONSTRAINT "integration_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_provider_drafts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "secrets" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_provider_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_provider_config_versions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "configHash" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "custom_provider_config_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_sync_runs_integrationId_startedAt_idx" ON "integration_sync_runs"("integrationId", "startedAt");

-- CreateIndex
CREATE INDEX "integration_sync_runs_organizationId_startedAt_idx" ON "integration_sync_runs"("organizationId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "custom_provider_drafts_organizationId_key" ON "custom_provider_drafts"("organizationId");

-- CreateIndex
CREATE INDEX "custom_provider_drafts_expiresAt_idx" ON "custom_provider_drafts"("expiresAt");

-- CreateIndex
CREATE INDEX "custom_provider_config_versions_organizationId_idx" ON "custom_provider_config_versions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "custom_provider_config_versions_integrationId_version_key" ON "custom_provider_config_versions"("integrationId", "version");

-- AddForeignKey
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_provider_drafts" ADD CONSTRAINT "custom_provider_drafts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_provider_config_versions" ADD CONSTRAINT "custom_provider_config_versions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_provider_config_versions" ADD CONSTRAINT "custom_provider_config_versions_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

