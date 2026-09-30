-- N1.5 (expand): record what role each event's source plays in the case.
-- Nullable until every writer sets it; a later migration adds NOT NULL.
-- normalized_events is derived from raw_events, so this backfill equals
-- re-derivation. The provider names below are data, not domain logic.
ALTER TABLE "normalized_events" ADD COLUMN "sourceRole" TEXT;

UPDATE "normalized_events" SET "sourceRole" = CASE "system"::text
  WHEN 'zendesk'  THEN 'ticket_source'
  WHEN 'intercom' THEN 'ticket_source'
  WHEN 'jira'     THEN 'work_tracker'
  WHEN 'linear'   THEN 'work_tracker'
  WHEN 'github'   THEN 'code_host'
END;
