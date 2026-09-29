-- H-12: Zendesk does not pause Resolution while a ticket is Pending, so imported
-- policies must not either. Clears the fixed `pending_customer` pause that the
-- importer used to stamp on every imported version, for versions of imported
-- policies (their manual overrides copy it from the imported version). There is
-- no UI to edit pauseOnStates, so an exact ['pending_customer'] value is always
-- the old default. Native policies are untouched. Commitments already finished
-- keep their stored evaluations; open ones use the corrected rule on their next
-- evaluation.
UPDATE "sla_policy_versions" AS v
SET "pauseOnStates" = ARRAY[]::TEXT[]
FROM "sla_policies" AS p
WHERE v."policyId" = p."id"
  AND p."source" = 'imported'
  AND v."pauseOnStates" = ARRAY['pending_customer']::TEXT[];
