-- Settings -> Data: a tenant-visible record of each backup and cleanup of one
-- integration's stored data. Additive only: one new table and two new enums.
-- Nothing existing is altered, so the previous release runs unchanged against
-- this schema.

CREATE TYPE "IntegrationDataOperationKind" AS ENUM ('backup', 'cleanup');
CREATE TYPE "IntegrationDataOperationStatus" AS ENUM ('started', 'completed', 'failed');

CREATE TABLE "integration_data_operations" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "kind" "IntegrationDataOperationKind" NOT NULL,
  "status" "IntegrationDataOperationStatus" NOT NULL DEFAULT 'started',
  "actorUserId" TEXT,
  "actorEmail" TEXT NOT NULL,
  "details" JSONB,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),

  CONSTRAINT "integration_data_operations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "integration_data_operations_organizationId_startedAt_idx"
  ON "integration_data_operations"("organizationId", "startedAt");

ALTER TABLE "integration_data_operations"
  ADD CONSTRAINT "integration_data_operations_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
