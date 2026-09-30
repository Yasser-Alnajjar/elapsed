-- N1.15 (expand): a Case is named by (organization, source integration,
-- externalId), so two ticket sources may reuse an id. The old
-- (organizationId, externalId) unique key stays until N2.10, so a code
-- rollback keeps working.
ALTER TABLE "cases" ADD COLUMN "sourceIntegrationId" TEXT;

-- Backfill from (organizationId, system). Integrations are unique per
-- (organizationId, provider) and never deleted, so this is exact. Idempotent:
-- re-run it to repair rows written by pre-N1.15 code after a rollback.
UPDATE "cases" c
SET "sourceIntegrationId" = i."id"
FROM "integrations" i
WHERE i."organizationId" = c."organizationId"
  AND i."provider" = c."system"
  AND c."sourceIntegrationId" IS NULL;

ALTER TABLE "cases"
    ADD CONSTRAINT "cases_sourceIntegrationId_fkey"
    FOREIGN KEY ("sourceIntegrationId") REFERENCES "integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Postgres treats NULLs as distinct, so rows with no source are unconstrained
-- here; the old unique key still covers them.
CREATE UNIQUE INDEX "cases_organizationId_sourceIntegrationId_externalId_key"
    ON "cases"("organizationId", "sourceIntegrationId", "externalId");

-- Every writer sets `system` explicitly.
ALTER TABLE "cases" ALTER COLUMN "system" DROP DEFAULT;
