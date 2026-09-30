-- N1.5 (contract): every writer now sets "sourceRole", so enforce it.
-- Deploy only after the N1.5 writers are running in production. The UPDATE
-- repeats the N1.5 backfill for rows an older writer created since then, so
-- SET NOT NULL cannot fail on them. It matches nothing when there are none.
UPDATE "normalized_events" SET "sourceRole" = CASE "system"::text
  WHEN 'zendesk'  THEN 'ticket_source'
  WHEN 'intercom' THEN 'ticket_source'
  WHEN 'jira'     THEN 'work_tracker'
  WHEN 'linear'   THEN 'work_tracker'
  WHEN 'github'   THEN 'code_host'
END
WHERE "sourceRole" IS NULL;

ALTER TABLE "normalized_events" ALTER COLUMN "sourceRole" SET NOT NULL;
