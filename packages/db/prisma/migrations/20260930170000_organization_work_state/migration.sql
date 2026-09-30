-- Per-organization scheduling state + lease (multi-worker). Additive: a
-- worker that predates this table ignores it, and nothing else reads it.
CREATE TYPE "OrganizationWorkKind" AS ENUM ('active', 'reconciliation');

CREATE TABLE "organization_work_states" (
    "organizationId" TEXT NOT NULL,
    "activeNextDueAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconciliationNextDueAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseKind" "OrganizationWorkKind",
    "leaseToken" BIGINT NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "lastStartedAt" TIMESTAMPTZ(3),
    "lastFinishedAt" TIMESTAMPTZ(3),
    "lastActiveFinishedAt" TIMESTAMPTZ(3),
    "lastReconciliationFinishedAt" TIMESTAMPTZ(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastFailureAt" TIMESTAMPTZ(3),
    "lastError" TEXT,

    CONSTRAINT "organization_work_states_pkey" PRIMARY KEY ("organizationId")
);

CREATE INDEX "organization_work_states_activeNextDueAt_idx" ON "organization_work_states"("activeNextDueAt");
CREATE INDEX "organization_work_states_reconciliationNextDueAt_idx" ON "organization_work_states"("reconciliationNextDueAt");
CREATE INDEX "organization_work_states_leaseExpiresAt_idx" ON "organization_work_states"("leaseExpiresAt");

ALTER TABLE "organization_work_states"
    ADD CONSTRAINT "organization_work_states_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One row per existing organization, carrying the schedule the single-lane
-- worker was already on: active is due now; reconciliation is due at the last
-- recorded pass + the configured interval (capped at the 30-minute ceiling),
-- so an overdue one runs immediately and a recent one isn't repeated. No
-- recorded pass means it has never run -> due now. A saved interval above
-- 30 minutes is capped here for the same reason the application caps it, and
-- the due time carries the same safety margin the worker applies when it
-- schedules one (the lesser of 60 s and 10% of the interval).
INSERT INTO "organization_work_states" ("organizationId", "reconciliationNextDueAt")
SELECT o."id",
       COALESCE(
         ws."lastReconciliationAt" + make_interval(
           secs => (LEAST(ws."reconciliationIntervalMs", 1800000) - LEAST(60000, LEAST(ws."reconciliationIntervalMs", 1800000) / 10)) / 1000.0
         ),
         CURRENT_TIMESTAMP
       )
FROM "organizations" o
LEFT JOIN "worker_settings" ws ON ws."id" = 'singleton';
