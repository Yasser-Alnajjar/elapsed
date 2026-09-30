-- N1.14 (expand): provider identity of a Customer as rows instead of one
-- column per provider. The legacy Customer columns stay and are dual-written
-- until N2.10, so a code rollback keeps working.
CREATE TABLE "customer_identities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_identities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_identities_organizationId_provider_kind_externalId_key"
    ON "customer_identities"("organizationId", "provider", "kind", "externalId");

CREATE INDEX "customer_identities_customerId_idx" ON "customer_identities"("customerId");

ALTER TABLE "customer_identities"
    ADD CONSTRAINT "customer_identities_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill one identity per non-null legacy column. The provider and kind
-- names are data recorded here, not domain logic.
INSERT INTO "customer_identities" ("id", "organizationId", "customerId", "provider", "kind", "externalId")
SELECT 'ci_' || md5(random()::text || clock_timestamp()::text || c."id" || 'zd'),
       c."organizationId", c."id", 'zendesk', 'organization', c."zendeskOrgId"
FROM "customers" c WHERE c."zendeskOrgId" IS NOT NULL;

INSERT INTO "customer_identities" ("id", "organizationId", "customerId", "provider", "kind", "externalId")
SELECT 'ci_' || md5(random()::text || clock_timestamp()::text || c."id" || 'ic'),
       c."organizationId", c."id", 'intercom', 'company', c."intercomCompanyId"
FROM "customers" c WHERE c."intercomCompanyId" IS NOT NULL;

INSERT INTO "customer_identities" ("id", "organizationId", "customerId", "provider", "kind", "externalId")
SELECT 'ci_' || md5(random()::text || clock_timestamp()::text || c."id" || 'ct'),
       c."organizationId", c."id", 'intercom', 'contact', c."intercomContactId"
FROM "customers" c WHERE c."intercomContactId" IS NOT NULL;
