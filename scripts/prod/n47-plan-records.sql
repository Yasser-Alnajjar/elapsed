-- N4.7: how many tenants have a plan record, as COUNTS ONLY.
-- Read-only (SELECT only). Prints no organization name, id, email or billing
-- reference. Paste the result tables into the roadmap Status Board once the
-- plan records have been entered in /admin/tenants/[organizationId].
--
-- `seed-org-*` organizations are the `seed-test-customers` fixtures (H-1); they
-- are counted apart so they are never mistaken for customers.
--
-- Run (on the host):
--   docker compose -f docker-compose.yml exec -T postgres \
--     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
--     -f - < scripts/prod/n47-plan-records.sql
-- (on this host the application database is `elapsed_db`, see H-1.)

-- Table 1: tenants per recorded plan and status. A NULL plan is "not recorded"
-- (the admin tenants list flags the same rows).
SELECT
  (id LIKE 'seed-org-%') AS fixture,
  coalesce(plan, '(not recorded)') AS plan,
  "planStatus" AS plan_status,
  count(*) AS tenants
FROM organizations
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- Table 2: what is still missing on real (non-fixture) tenants.
SELECT
  count(*) AS tenants,
  count(*) FILTER (WHERE plan IS NULL) AS plan_not_recorded,
  count(*) FILTER (WHERE "planStatus" = 'trial' AND "trialEndsAt" IS NULL) AS trial_without_end_date,
  count(*) FILTER (WHERE "planStatus" = 'trial' AND "trialEndsAt" < now()) AS trial_already_ended,
  count(*) FILTER (WHERE "planStatus" IN ('active', 'past_due') AND "billingReference" IS NULL) AS paying_without_billing_reference
FROM organizations
WHERE id NOT LIKE 'seed-org-%';
