ALTER TABLE "integrations"
  ADD COLUMN "lastSuccessfulSyncAt" TIMESTAMP(3),
  ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failingSince" TIMESTAMP(3),
  ADD COLUMN "lastSyncDurationMs" INTEGER;

-- A pre-N3 clean attempt is the best available evidence of a successful
-- sync. Failed attempts deliberately remain unknown rather than guessed.
UPDATE "integrations"
SET "lastSuccessfulSyncAt" = "lastSyncAt"
WHERE "lastSyncAt" IS NOT NULL AND "lastSyncError" IS NULL;

ALTER TABLE "evaluations" ADD COLUMN "sourceStaleSince" TIMESTAMP(3);

ALTER TABLE "worker_settings"
  ADD COLUMN "freshnessGraceFactor" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "lastActivePollDurationMs" INTEGER,
  ADD COLUMN "lastReconciliationDurationMs" INTEGER;
