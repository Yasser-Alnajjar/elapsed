-- D32 (plan 09, 6.7): the last time a sync actually changed data, kept apart from
-- `lastSuccessfulSyncAt` (the last successful check) now that a no-change sync is
-- not stored as a sync run. Additive and nullable; no backfill (null = none recorded yet).
ALTER TABLE "integrations" ADD COLUMN "lastDataChangedAt" TIMESTAMP(3);
