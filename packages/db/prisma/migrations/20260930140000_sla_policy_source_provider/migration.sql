-- N1.11 (expand): scope an imported SLA policy to the provider it came from,
-- so it stops being a candidate for another ticket source's cases. Nullable:
-- a native policy stays null (candidate for every case).
ALTER TABLE "sla_policies" ADD COLUMN "sourceProvider" "IntegrationProvider";

-- Every imported policy today comes from the Zendesk importer. The provider
-- name is data, not domain logic.
UPDATE "sla_policies"
SET "sourceProvider" = 'zendesk'
WHERE "source" = 'imported' AND "externalId" IS NOT NULL;
