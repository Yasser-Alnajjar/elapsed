-- N10 (D33, plan 10 §4.3): platform-level integration availability. Additive.
-- Seeded from today's state so the deploy changes no behavior (plan 10 §4.3).
-- CreateEnum
CREATE TYPE "IntegrationReleaseStage" AS ENUM ('stable', 'beta', 'coming_soon');

-- CreateEnum
CREATE TYPE "IntegrationBetaAccess" AS ENUM ('all_organizations', 'allowlist');

-- CreateTable
CREATE TABLE "integration_availability" (
    "provider" "IntegrationProvider" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "releaseStage" "IntegrationReleaseStage" NOT NULL,
    "betaAccess" "IntegrationBetaAccess" NOT NULL DEFAULT 'allowlist',
    "statusMessage" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByEmail" TEXT,

    CONSTRAINT "integration_availability_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "integration_beta_allowlist" (
    "provider" "IntegrationProvider" NOT NULL,
    "organizationId" TEXT NOT NULL,
    "addedByEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_beta_allowlist_pkey" PRIMARY KEY ("provider","organizationId")
);

-- CreateIndex
CREATE INDEX "integration_beta_allowlist_organizationId_idx" ON "integration_beta_allowlist"("organizationId");

-- AddForeignKey
ALTER TABLE "integration_beta_allowlist" ADD CONSTRAINT "integration_beta_allowlist_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Seed: one row per provider (D33 rulings 1 and 3). Zendesk, Jira and Linear
-- Stable (D17 amendment of 2026-10-05); Intercom and GitHub Beta, open to
-- every organization as they are today; Custom REST Beta, allowlist only.
INSERT INTO "integration_availability" ("provider", "enabled", "releaseStage", "betaAccess", "version", "updatedAt", "updatedByEmail") VALUES
    ('zendesk',  true, 'stable', 'allowlist',         0, CURRENT_TIMESTAMP, NULL),
    ('jira',     true, 'stable', 'allowlist',         0, CURRENT_TIMESTAMP, NULL),
    ('linear',   true, 'stable', 'allowlist',         0, CURRENT_TIMESTAMP, NULL),
    ('intercom', true, 'beta',   'all_organizations', 0, CURRENT_TIMESTAMP, NULL),
    ('github',   true, 'beta',   'all_organizations', 0, CURRENT_TIMESTAMP, NULL),
    ('custom',   true, 'beta',   'allowlist',         0, CURRENT_TIMESTAMP, NULL);

-- Fold the Custom REST Beta flag into the allowlist (D33 ruling 3). The
-- column stays (unread) until N10-F1.
INSERT INTO "integration_beta_allowlist" ("provider", "organizationId", "addedByEmail", "createdAt")
SELECT 'custom', "id", 'migration:n10', CURRENT_TIMESTAMP FROM "organizations" WHERE "customProviderEnabled" = true;
