-- N10-F1 (contract step): the Custom REST Beta flag lives in
-- "integration_beta_allowlist" since N10 (D33). The N10 migration copied every
-- flagged organization into it, and no code has read this column since. Run
-- only after N10 is deployed everywhere.
ALTER TABLE "organizations" DROP COLUMN "customProviderEnabled";
