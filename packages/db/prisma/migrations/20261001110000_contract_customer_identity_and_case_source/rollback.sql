-- Rollback for 20261001110000_contract_customer_identity_and_case_source.
-- Not run by `prisma migrate`: apply it by hand, then deploy the previous
-- release. It re-expands: the legacy Customer columns are re-added and
-- repopulated from customer_identities, and the source-less Case key returns.
-- The new key can fail if two ticket sources have since reused an external id
-- inside one organization; resolve those cases first (the previous release
-- cannot represent them).

ALTER TABLE "customers" ADD COLUMN "zendeskOrgId" TEXT;
ALTER TABLE "customers" ADD COLUMN "intercomCompanyId" TEXT;
ALTER TABLE "customers" ADD COLUMN "intercomContactId" TEXT;

UPDATE "customers" c SET "zendeskOrgId" = i."externalId"
FROM "customer_identities" i
WHERE i."customerId" = c."id" AND i."provider" = 'zendesk' AND i."kind" = 'organization';

UPDATE "customers" c SET "intercomCompanyId" = i."externalId"
FROM "customer_identities" i
WHERE i."customerId" = c."id" AND i."provider" = 'intercom' AND i."kind" = 'company';

UPDATE "customers" c SET "intercomContactId" = i."externalId"
FROM "customer_identities" i
WHERE i."customerId" = c."id" AND i."provider" = 'intercom' AND i."kind" = 'contact';

CREATE UNIQUE INDEX "customers_organizationId_zendeskOrgId_key" ON "customers"("organizationId", "zendeskOrgId");
CREATE UNIQUE INDEX "customers_organizationId_intercomCompanyId_key" ON "customers"("organizationId", "intercomCompanyId");
CREATE UNIQUE INDEX "customers_organizationId_intercomContactId_key" ON "customers"("organizationId", "intercomContactId");

CREATE UNIQUE INDEX "cases_organizationId_externalId_key" ON "cases"("organizationId", "externalId");
ALTER TABLE "cases" ALTER COLUMN "sourceIntegrationId" DROP NOT NULL;
ALTER TABLE "cases" DROP CONSTRAINT "cases_sourceIntegrationId_fkey";
ALTER TABLE "cases"
    ADD CONSTRAINT "cases_sourceIntegrationId_fkey"
    FOREIGN KEY ("sourceIntegrationId") REFERENCES "integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
