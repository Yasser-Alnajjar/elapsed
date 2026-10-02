-- N5: customer onboarding + retention. Additive only; every new column is
-- nullable or has a default and both new tables are new, so the previous
-- release keeps running unchanged against this schema and reverting the code
-- leaves everything here inert.

-- N5.7: usage instrumentation, best-effort writes that never block a request.
ALTER TABLE "users" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "notifications" ADD COLUMN "openedAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "firstFindingsViewedAt" TIMESTAMP(3);

-- N5.3: who completed a connection that was not made by a signed-in owner.
ALTER TABLE "integrations" ADD COLUMN "connectedBy" TEXT;

-- N5.6: operator kill switch for the monthly report (on by default).
ALTER TABLE "worker_settings" ADD COLUMN "monthlyReportEnabled" BOOLEAN NOT NULL DEFAULT true;

-- N5.6: one row per (organization, month, channel). The unique key is the
-- idempotency key: claiming a month is an insert.
CREATE TYPE "ReportDeliveryStatus" AS ENUM ('pending', 'sent', 'failed', 'skipped');

CREATE TABLE "report_deliveries" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "status" "ReportDeliveryStatus" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "deliveredAt" TIMESTAMP(3),
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "report_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "report_deliveries_organizationId_period_channel_key"
  ON "report_deliveries"("organizationId", "period", "channel");
CREATE INDEX "report_deliveries_status_updatedAt_idx" ON "report_deliveries"("status", "updatedAt");

ALTER TABLE "report_deliveries"
  ADD CONSTRAINT "report_deliveries_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- N5.3: signed, expiring, single-use connect links (D26). Only the token's hash is stored.
CREATE TABLE "integration_connect_links" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "intendedFor" TEXT,
  "createdByUserId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "integration_connect_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_connect_links_tokenHash_key" ON "integration_connect_links"("tokenHash");
CREATE INDEX "integration_connect_links_organizationId_provider_createdAt_idx"
  ON "integration_connect_links"("organizationId", "provider", "createdAt");

ALTER TABLE "integration_connect_links"
  ADD CONSTRAINT "integration_connect_links_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
