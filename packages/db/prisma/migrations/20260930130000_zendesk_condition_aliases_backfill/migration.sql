-- N1.10 (data): the Zendesk-only condition aliases `current_tags`, `via_id`
-- and `current_via_id` used to be added to every case's match input at read
-- time by `toCaseAttributes`. They are now written by the Zendesk adapter
-- into `cases.attributes`, so existing Zendesk cases are backfilled here
-- instead of waiting for a renormalize. Values come from the canonical
-- columns, exactly as `toCaseAttributes` derived them before: `tags` always
-- (an empty array included), `channel` only when it is not null.
-- The provider name below is data, not domain logic. Idempotent.
UPDATE "cases"
SET "attributes" =
  COALESCE("attributes", '{}'::jsonb)
  || jsonb_build_object('current_tags', to_jsonb("tags"))
  || CASE
       WHEN "channel" IS NOT NULL
       THEN jsonb_build_object('via_id', "channel", 'current_via_id', "channel")
       ELSE '{}'::jsonb
     END
WHERE "system" = 'zendesk';
