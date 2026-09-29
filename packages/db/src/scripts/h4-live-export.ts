/**
 * H-4 live-tenant spot check, step 1 (READ-ONLY): for one organization, exports
 * Elapsed's stored SLA state and Zendesk's own SLA view for a sample of tickets
 * into one JSON file that `scripts/h4-compare/compare-live.py` reads offline.
 *
 * Reads: Elapsed database (SELECT only) and Zendesk (GET only). Writes: the one
 * output file. Never writes to Zendesk or to the database.
 *
 * Privacy: the file holds ticket ids, timestamps, states, priorities, policy
 * titles and SLA numbers. It holds NO ticket subject, description, comment,
 * requester, or customer name (the Zendesk ticket object is reduced to an
 * allow-list of fields before it is stored). Ticket ids are still customer
 * data: keep the file on the host, and do not commit it.
 *
 * Sample (per organization): every ticket with an open commitment (capped by
 * --open-limit), plus the most recent tickets by open date up to --limit in
 * total. Open tickets are what the dev-sandbox check never covered.
 *
 * Usage (on the host, inside the worker image, which has tsx and the keys):
 *   pnpm --filter @sla/db exec tsx src/scripts/h4-live-export.ts \
 *     <organizationId> <outFile> [--limit=150] [--open-limit=60]
 */
import { writeFileSync } from "node:fs";
import pg from "pg";
import { decryptCredentials } from "../integration-credentials";

const args = process.argv.slice(2);
const flag = (name: string, dflt: number) => {
  const raw = args.find((a) => a.startsWith(`--${name}=`));
  return raw ? Number(raw.split("=")[1]) : dflt;
};
const [orgId, outFile] = args.filter((a) => !a.startsWith("--"));
if (!orgId || !outFile) {
  throw new Error("usage: <organizationId> <outFile> [--limit=150] [--open-limit=60]");
}
const LIMIT = flag("limit", 150);
const OPEN_LIMIT = flag("open-limit", 60);

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await db.query("BEGIN READ ONLY");

const integration = (
  await db.query(
    `select credentials from integrations where "organizationId"=$1 and provider='zendesk' and status='connected'`,
    [orgId],
  )
).rows[0];
if (!integration) throw new Error("no connected Zendesk integration for this organization");
const creds = decryptCredentials(integration.credentials as never) as {
  subdomain: string;
  accessToken: string;
};
const base = `https://${creds.subdomain}.zendesk.com`;

async function get(path: string): Promise<any> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(path.startsWith("http") ? path : base + path, {
      method: "GET",
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after")) || 5) * 1000));
      continue;
    }
    if (!res.ok) return { __error: res.status };
    return res.json();
  }
  return { __error: 429 };
}

// --- Sample selection -------------------------------------------------------
const openIds = (
  await db.query(
    `select distinct c."externalId", c."openedAt"
       from cases c join commitments m on m."caseId"=c.id
      where c."organizationId"=$1 and c.system='zendesk' and c."deletedAt" is null and m."closedAt" is null
      order by c."openedAt" desc limit $2`,
    [orgId, OPEN_LIMIT],
  )
).rows.map((r) => r.externalId as string);
const recentIds = (
  await db.query(
    `select "externalId" from cases
      where "organizationId"=$1 and system='zendesk' and "deletedAt" is null
      order by "openedAt" desc limit $2`,
    [orgId, LIMIT],
  )
).rows.map((r) => r.externalId as string);
const sample = [...new Set([...openIds, ...recentIds])].slice(0, Math.max(LIMIT, openIds.length));

// --- Elapsed side -----------------------------------------------------------
const elapsedCommitments = (
  await db.query(
    `select c."externalId" as ticket, c.priority::text as priority, m.kind::text as kind, m."cycleKey",
            m."startedAt", m."targetMinutes", m."dueAt", m.status::text as status, m."closedAt",
            pv."policyId", pv."pauseOnStates", pv."calendarVersionId",
            (select e."elapsedSeconds" from evaluations e where e."commitmentId"=m.id order by e."evaluatedAt" desc, e.id desc limit 1) as "elapsedSeconds",
            (select e."breachedAt" from evaluations e where e."commitmentId"=m.id and e."breachedAt" is not null order by e."evaluatedAt" asc limit 1) as "breachedAt",
            cal."timezone" as timezone, cal.definition as calendar
       from commitments m
       join cases c on c.id=m."caseId"
       join sla_policy_versions pv on pv.id=m."policyVersionId"
       join business_calendar_versions cal on cal.id=m."calendarVersionId"
      where c."organizationId"=$1 and c.system='zendesk' and c."externalId" = any($2)`,
    [orgId, sample],
  )
).rows;
const elapsedEvents = (
  await db.query(
    `select c."externalId" as ticket, e."occurredAt", e.type, e."fromState", e."toState", e.actor
       from normalized_events e join cases c on c.id=e."caseId"
      where c."organizationId"=$1 and c.system='zendesk' and c."externalId" = any($2)
      order by e."occurredAt", e."sourceSequence"`,
    [orgId, sample],
  )
).rows;

// --- Zendesk side (allow-listed fields only) ---------------------------------
const TICKET_FIELDS = ["id", "created_at", "solved_at", "updated_at", "status", "priority", "type", "submitter_id", "requester_id", "via"];
const pickTicket = (t: any) =>
  Object.fromEntries(TICKET_FIELDS.filter((k) => k in (t ?? {})).map((k) => [k, k === "via" ? { channel: t.via?.channel } : t[k]]));
const zd: Record<string, any> = {};
for (const id of sample) {
  const t = await get(`/api/v2/tickets/${id}.json?include=slas`);
  const events = await get(`/api/v2/tickets/${id}/metric_events.json`);
  zd[id] = {
    ticket: pickTicket(t.ticket),
    slas: t.ticket?.slas ?? t.slas ?? null,
    events: events.__error ? events : events.metric_events ?? events,
  };
  process.stderr.write(".");
}
const policies = await get("/api/v2/slas/policies.json");
const schedules = await get("/api/v2/business_hours/schedules.json");
const holidays: Record<string, any> = {};
for (const s of schedules.schedules ?? []) {
  holidays[s.id] = await get(`/api/v2/business_hours/schedules/${s.id}/holidays.json`);
}

writeFileSync(
  outFile,
  JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      sample: { total: sample.length, openWithCommitments: openIds.length, limit: LIMIT },
      zendesk: { policies, schedules, holidays, tickets: zd },
      elapsed: { commitments: elapsedCommitments, events: elapsedEvents },
    },
    null,
    1,
  ),
);
console.error(`\nwrote ${outFile} (${sample.length} tickets, ${openIds.length} with open commitments)`);
await db.query("ROLLBACK");
await db.end();
