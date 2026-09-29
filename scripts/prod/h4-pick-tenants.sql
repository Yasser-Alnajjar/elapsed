-- H-4: choose which live tenants to spot-check. Read-only (SELECT only).
-- HOST ONLY: this prints organization ids (needed for h4-live-export.ts).
-- Do not paste the output anywhere; it is not for the roadmap.
--
-- Prefer tenants that (a) have a connected Zendesk, (b) have open commitments,
-- and (c) use a business-hours calendar, because the dev-sandbox check covered
-- none of those.
SELECT
  o.id AS organization_id,
  count(DISTINCT c.id) FILTER (WHERE c."deletedAt" IS NULL) AS cases,
  count(DISTINCT m.id) FILTER (WHERE m."closedAt" IS NULL) AS open_commitments,
  count(DISTINCT m.id) FILTER (WHERE m."closedAt" IS NOT NULL) AS finished_commitments,
  bool_or(NOT cal."alwaysOpen") AS uses_business_hours,
  bool_or(cardinality(pv."pauseOnStates") > 0) AS policy_pauses_on_a_state
FROM organizations o
JOIN integrations i ON i."organizationId" = o.id AND i.provider = 'zendesk' AND i.status = 'connected'
LEFT JOIN cases c ON c."organizationId" = o.id AND c.system = 'zendesk'
LEFT JOIN commitments m ON m."caseId" = c.id
LEFT JOIN sla_policy_versions pv ON pv.id = m."policyVersionId"
LEFT JOIN business_calendar_versions cal ON cal.id = m."calendarVersionId"
GROUP BY o.id
ORDER BY uses_business_hours DESC NULLS LAST, open_commitments DESC;
