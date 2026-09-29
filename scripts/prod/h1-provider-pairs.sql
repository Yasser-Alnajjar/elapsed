-- H-1: provider pair and integration status per live tenant, as COUNTS ONLY.
-- Read-only (SELECT only). Prints no organization name, id, email or ticket
-- content. Paste the two result tables into the roadmap Status Board.
--
-- Run (on the host, in a read-only transaction):
--   docker compose -f docker-compose.yml exec -T postgres \
--     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
--     -c 'BEGIN READ ONLY;' -f - < scripts/prod/h1-provider-pairs.sql
-- (or simply: psql ... -f scripts/prod/h1-provider-pairs.sql; every statement
-- below is a SELECT.)

-- Table 1: tenants per (ticket source, engineering tool) pair.
-- ticket source  = zendesk | intercom   (where cases come from)
-- engineering    = jira | linear | github
-- A tenant with no connected integration of a kind shows "none".
-- Only integrations that are not soft-disconnected count as "in use";
-- the status columns show the health of those that are.
WITH per_org AS (
  SELECT
    o.id AS org_id,
    coalesce(string_agg(DISTINCT i.provider::text, '+')
      FILTER (WHERE i.provider IN ('zendesk','intercom') AND i.status <> 'disconnected'), 'none') AS ticket_source,
    coalesce(string_agg(DISTINCT i.provider::text, '+')
      FILTER (WHERE i.provider IN ('jira','linear','github') AND i.status <> 'disconnected'), 'none') AS engineering,
    bool_or(i.status IN ('reauth_required','permission_denied')) AS any_unhealthy,
    bool_or(i.status = 'connected') AS any_connected
  FROM organizations o
  LEFT JOIN integrations i ON i."organizationId" = o.id
  GROUP BY o.id
)
SELECT ticket_source, engineering,
       count(*) AS tenants,
       count(*) FILTER (WHERE any_unhealthy) AS with_unhealthy_integration,
       count(*) FILTER (WHERE NOT coalesce(any_connected, false)) AS with_no_connected_integration
FROM per_org
GROUP BY 1, 2
ORDER BY tenants DESC, 1, 2;

-- Table 2: integration rows by provider and status (all tenants).
SELECT provider, status, count(*) AS integrations
FROM integrations
GROUP BY 1, 2
ORDER BY 1, 2;

-- Table 3: size distribution per tenant (no identifiers) - feeds H-7 and N1.2.
SELECT
  count(*) AS tenants,
  min(n) AS min_cases, percentile_disc(0.5) WITHIN GROUP (ORDER BY n) AS median_cases,
  max(n) AS max_cases, sum(n) AS total_cases
FROM (
  SELECT o.id, count(c.id) AS n
  FROM organizations o LEFT JOIN cases c ON c."organizationId" = o.id AND c."deletedAt" IS NULL
  GROUP BY o.id
) t;
