/**
 * H-4 spot check (read-only): pulls Zendesk's own SLA view for every synced
 * ticket of one organization — `ticket.slas.policy_metrics`, `metric_events`,
 * the SLA policy list and the business-hours schedules — and writes it to a
 * JSON file. Only GET requests; never writes to Zendesk or to the database.
 *
 * Usage: dotenv -e ../../.env -- tsx src/scripts/h4-zendesk-fetch.ts <orgId> <outFile>
 */
import { writeFileSync } from "node:fs";
import pg from "pg";
import { decryptCredentials } from "../integration-credentials";

const [orgId, outFile] = process.argv.slice(2);
if (!orgId || !outFile) throw new Error("usage: <orgId> <outFile>");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const integration = (
  await db.query(`select credentials from integrations where "organizationId"=$1 and provider='zendesk'`, [orgId])
).rows[0];
const creds = decryptCredentials(integration.credentials as any);
const base = `https://${creds.subdomain}.zendesk.com`;

async function get(path: string): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(path.startsWith("http") ? path : base + path, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after")) || 5) * 1000));
      continue;
    }
    if (!res.ok) return { __error: res.status, path };
    return res.json();
  }
  return { __error: 429, path };
}

async function pages(path: string, key: string): Promise<any[]> {
  const out: any[] = [];
  let next: string | null = path;
  while (next) {
    const page: any = await get(next);
    if (page.__error) return [page];
    out.push(...(page[key] ?? []));
    next = page.next_page ?? null;
  }
  return out;
}

const cases = (
  await db.query(`select "externalId" from cases where "organizationId"=$1 and system='zendesk' order by "openedAt"`, [orgId])
).rows as { externalId: string }[];

const result: any = {
  subdomain: creds.subdomain,
  scope: creds.scope,
  fetchedAt: new Date().toISOString(),
  policies: await get("/api/v2/slas/policies.json"),
  schedules: await get("/api/v2/business_hours/schedules.json"),
  tickets: {} as Record<string, any>,
};
result.holidays = {} as Record<string, any>;
for (const s of result.schedules.schedules ?? []) {
  result.holidays[s.id] = await get(`/api/v2/business_hours/schedules/${s.id}/holidays.json`);
}

for (const c of cases) {
  const id = c.externalId;
  const t = await get(`/api/v2/tickets/${id}.json?include=slas`);
  const events = await get(`/api/v2/tickets/${id}/metric_events.json`); // keyed by metric name
  const metricSet = await get(`/api/v2/tickets/${id}/metrics.json`);
  result.tickets[id] = { ticket: t.ticket ?? t, events, metrics: metricSet.ticket_metric ?? metricSet };
  process.stderr.write(`.`);
}
writeFileSync(outFile, JSON.stringify(result, null, 1));
console.error(`\nwrote ${outFile}`);
await db.end();
