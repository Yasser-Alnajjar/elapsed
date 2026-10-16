-- Rollback for 20261011120000_n10_f1_drop_custom_provider_enabled.
-- Not run by `prisma migrate`: apply it by hand (after the N2.10 rollback.sql
-- when both are rolled back), then delete both rows from "_prisma_migrations"
-- and deploy the previous release. It re-adds the column exactly as N9 created
-- it and refills it from the Custom REST Beta allowlist, the column's
-- replacement since N10 (D33). The allowlist itself is untouched.

ALTER TABLE "organizations" ADD COLUMN "customProviderEnabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "organizations" o SET "customProviderEnabled" = true
WHERE EXISTS (
  SELECT 1 FROM "integration_beta_allowlist" a
  WHERE a."organizationId" = o."id" AND a."provider" = 'custom');
