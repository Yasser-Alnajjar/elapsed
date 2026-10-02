-- N4: platform admin + plan records. Additive only; every new column is
-- nullable or has a default, so the previous release keeps running unchanged
-- against this schema and reverting the code leaves these columns inert.

-- N4.3: manual plan record per organization. Existing organizations start on
-- `trial` with no plan recorded; the operator fills them in from /admin.
CREATE TYPE "PlanStatus" AS ENUM ('trial', 'active', 'past_due', 'cancelled', 'internal');

ALTER TABLE "organizations"
  ADD COLUMN "plan" TEXT,
  ADD COLUMN "planStatus" "PlanStatus" NOT NULL DEFAULT 'trial',
  ADD COLUMN "trialEndsAt" TIMESTAMP(3),
  ADD COLUMN "billingReference" TEXT;

-- N4.5: operator controls, both inert while null.
ALTER TABLE "integrations"
  ADD COLUMN "pollingPausedAt" TIMESTAMP(3),
  ADD COLUMN "renormalizeRequestedAt" TIMESTAMP(3);

-- N4.2: append-only admin audit log. No foreign keys on purpose.
CREATE TABLE "admin_audit_logs" (
  "id" TEXT NOT NULL,
  "actorEmail" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "organizationId" TEXT,
  "integrationId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_logs_createdAt_idx" ON "admin_audit_logs"("createdAt");
CREATE INDEX "admin_audit_logs_organizationId_createdAt_idx" ON "admin_audit_logs"("organizationId", "createdAt");
