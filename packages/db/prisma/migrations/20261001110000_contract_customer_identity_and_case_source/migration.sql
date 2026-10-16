-- N2.10 (contract): the expand steps of N1.14 and N1.15 are done, so drop what
-- they kept for a code rollback.
--   * Customer.zendeskOrgId / intercomCompanyId / intercomContactId and their
--     three unique keys (the provider identity lives in customer_identities).
--   * The source-less Case unique key (organizationId, externalId), and let
--     Case.sourceIntegrationId be NOT NULL.
-- Not expand-only: rolling back needs rollback.sql in this directory first.
-- Take a verified backup before applying this, and deploy it alone.

-- Preconditions. Both repairs are idempotent copies of the expand steps'
-- backfills, so rows written by pre-expand code after a rollback are healed
-- instead of lost; whatever they cannot heal aborts the migration.
INSERT INTO "customer_identities" ("id", "organizationId", "customerId", "provider", "kind", "externalId")
SELECT 'ci_' || md5(random()::text || clock_timestamp()::text || c."id" || 'zd'),
       c."organizationId", c."id", 'zendesk', 'organization', c."zendeskOrgId"
FROM "customers" c
WHERE c."zendeskOrgId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "customer_identities" i
    WHERE i."organizationId" = c."organizationId" AND i."provider" = 'zendesk'
      AND i."kind" = 'organization' AND i."externalId" = c."zendeskOrgId");

INSERT INTO "customer_identities" ("id", "organizationId", "customerId", "provider", "kind", "externalId")
SELECT 'ci_' || md5(random()::text || clock_timestamp()::text || c."id" || 'ic'),
       c."organizationId", c."id", 'intercom', 'company', c."intercomCompanyId"
FROM "customers" c
WHERE c."intercomCompanyId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "customer_identities" i
    WHERE i."organizationId" = c."organizationId" AND i."provider" = 'intercom'
      AND i."kind" = 'company' AND i."externalId" = c."intercomCompanyId");

INSERT INTO "customer_identities" ("id", "organizationId", "customerId", "provider", "kind", "externalId")
SELECT 'ci_' || md5(random()::text || clock_timestamp()::text || c."id" || 'ct'),
       c."organizationId", c."id", 'intercom', 'contact', c."intercomContactId"
FROM "customers" c
WHERE c."intercomContactId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "customer_identities" i
    WHERE i."organizationId" = c."organizationId" AND i."provider" = 'intercom'
      AND i."kind" = 'contact' AND i."externalId" = c."intercomContactId");

UPDATE "cases" c
SET "sourceIntegrationId" = i."id"
FROM "integrations" i
WHERE i."organizationId" = c."organizationId"
  AND i."provider" = c."system"
  AND c."sourceIntegrationId" IS NULL;

DO $$
DECLARE orphaned integer;
BEGIN
  SELECT count(*) INTO orphaned FROM "cases" WHERE "sourceIntegrationId" IS NULL;
  IF orphaned > 0 THEN
    RAISE EXCEPTION 'N2.10 precondition failed: % case(s) have no source integration (no integration matches their organization and system)', orphaned;
  END IF;
END $$;

-- Customer: provider identity columns and their keys.
DROP INDEX "customers_organizationId_zendeskOrgId_key";
DROP INDEX "customers_organizationId_intercomCompanyId_key";
DROP INDEX "customers_organizationId_intercomContactId_key";
ALTER TABLE "customers" DROP COLUMN "zendeskOrgId";
ALTER TABLE "customers" DROP COLUMN "intercomCompanyId";
ALTER TABLE "customers" DROP COLUMN "intercomContactId";

-- Case: the source is part of the name now.
DROP INDEX "cases_organizationId_externalId_key";
ALTER TABLE "cases" ALTER COLUMN "sourceIntegrationId" SET NOT NULL;

-- Integrations are never deleted, so SET NULL no longer makes sense. NO ACTION
-- (checked at the end of the statement) lets an organization delete cascade to
-- its integrations and its cases in either order.
ALTER TABLE "cases" DROP CONSTRAINT "cases_sourceIntegrationId_fkey";
ALTER TABLE "cases"
    ADD CONSTRAINT "cases_sourceIntegrationId_fkey"
    FOREIGN KEY ("sourceIntegrationId") REFERENCES "integrations"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
