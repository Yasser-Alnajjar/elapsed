-- N2.8 (expand): say which provider's policy import a summary describes, so the
-- row is no longer implicitly Zendesk's. Nullable: a row from before this
-- column is refreshed (and stamped) by the next import.
ALTER TABLE "sla_import_summaries" ADD COLUMN "provider" "IntegrationProvider";

-- Every summary written so far came from the Zendesk importer. The provider
-- name is data, not domain logic.
UPDATE "sla_import_summaries" SET "provider" = 'zendesk' WHERE "provider" IS NULL;
