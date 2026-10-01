/**
 * L2 normalization replay for the provider-contract phase (N2). Fingerprints a
 * restored scratch database, re-runs normalization and correlation for every
 * integration through the worker's provider registry (the real adapters and
 * the shared projector, in the worker's own role order), fingerprints again and
 * diffs. Any difference is printed and fails the run.
 *
 *   DATABASE_URL=<…/sla_restore_drill> pnpm --filter @sla/worker exec tsx scripts/l2-replay.ts --out-dir <dir>
 *
 * Writes only to the scratch database; refuses any other database. The
 * fingerprints hold customer data: keep `--out-dir` in the scratch directory,
 * never in git. It does not run policy or calendar import (the N1 L2 did not).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { getPrismaClient, type PrismaClient } from "@sla/db";
import { correlateAndProject, normalizeAndProject } from "@sla/ingestion";
import { caseRefResolverFor } from "../src/case-ref";
import { PROVIDERS } from "../src/providers";

const SCRATCH_DATABASE = "sla_restore_drill";
const ROLE_ORDER = { ticket_source: 0, work_tracker: 1, code_host: 2 } as const;

/** Everything the engine and the UI read, keyed by source provider and external id. Event ids and `createdAt` are deliberately excluded; their stability is checked separately. */
const FINGERPRINT_QUERIES: Record<string, string> = {
  cases: `
    SELECT 'case|' || coalesce(i.provider::text, c.system::text) || '|' || c."externalId" || '|' || coalesce(c.subject,'') || '|' || coalesce(c.priority,'')
      || '|' || coalesce(c.channel,'') || '|' || coalesce(c."closedAt"::text,'') || '|' || coalesce(c."deletedAt"::text,'') || '|' || coalesce(c."requesterName",'')
      || '|' || coalesce(c."assigneeName",'') || '|' || coalesce(array_to_string(c.tags,','),'') || '|' || coalesce(c.attributes::text,'')
      || '|' || coalesce(cu.name,'') || '|' || coalesce(c.tier,'') AS line
    FROM cases c LEFT JOIN integrations i ON i.id = c."sourceIntegrationId" LEFT JOIN customers cu ON cu.id = c."customerId" ORDER BY 1`,
  events: `
    SELECT 'events|' || coalesce(i.provider::text, c.system::text) || '|' || c."externalId" || '|' || count(*) || '|' ||
      md5(string_agg(e.type || e."occurredAt"::text || e.actor || e.system || coalesce(e."sourceRole",'') || coalesce(e."fromState",'') || coalesce(e."toState",'') || e."sourceSequence"::text,
          ',' ORDER BY e."occurredAt", e."sourceSequence", e.type, e.system, e.actor, coalesce(e."toState",''))) AS line
    FROM normalized_events e JOIN cases c ON c.id = e."caseId" LEFT JOIN integrations i ON i.id = c."sourceIntegrationId"
    GROUP BY coalesce(i.provider::text, c.system::text), c."externalId" ORDER BY 1`,
  links: `
    SELECT 'link|' || coalesce(i.provider::text, c.system::text) || '|' || c."externalId" || '|' || l.system || '|' || l."externalId" || '|' || l.method || '|' || l.confidence
      || '|' || coalesce(l."unlinkedAt"::text,'') || '|' || md5(coalesce(l.evidence::text,'')) AS line
    FROM case_links l JOIN cases c ON c.id = l."caseId" LEFT JOIN integrations i ON i.id = c."sourceIntegrationId" ORDER BY 1`,
  customers: `
    SELECT 'customer|' || cu."organizationId" || '|' || cu.name || '|' || coalesce((SELECT string_agg(ci.provider || '/' || ci.kind || '/' || ci."externalId", ',' ORDER BY ci.provider, ci.kind, ci."externalId")
      FROM customer_identities ci WHERE ci."customerId" = cu.id),'') AS line
    FROM customers cu ORDER BY 1`,
  commitments: `
    SELECT 'commitment|' || coalesce(i.provider::text, c.system::text) || '|' || c."externalId" || '|' || m.kind || '|' || m."cycleKey" || '|' || m.status || '|' || coalesce(m."closedAt"::text,'') AS line
    FROM commitments m JOIN cases c ON c.id = m."caseId" LEFT JOIN integrations i ON i.id = c."sourceIntegrationId" ORDER BY 1`,
};

const EVENT_IDS_QUERY = `SELECT md5(coalesce(string_agg(id, ',' ORDER BY id), '')) AS h, count(*)::int AS n FROM normalized_events`;

async function fingerprint(prisma: PrismaClient): Promise<{ lines: string[]; eventIds: { h: string; n: number } }> {
  const lines: string[] = [];
  for (const sql of Object.values(FINGERPRINT_QUERIES)) {
    lines.push(...(await prisma.$queryRawUnsafe<{ line: string }[]>(sql)).map((r) => r.line));
  }
  const [eventIds] = await prisma.$queryRawUnsafe<{ h: string; n: number }[]>(EVENT_IDS_QUERY);
  return { lines, eventIds: eventIds! };
}

async function main() {
  const { values } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== "--"), options: { "out-dir": { type: "string" } } });
  const outDir = values["out-dir"];
  if (!outDir) {
    console.error("usage: l2-replay --out-dir <dir>   (DATABASE_URL must name the sla_restore_drill scratch database)");
    process.exit(2);
  }
  const db = decodeURIComponent(new URL(process.env.DATABASE_URL ?? "postgres://x/").pathname.replace(/^\//, ""));
  if (db !== SCRATCH_DATABASE) {
    console.error(`l2-replay refuses to run against database "${db}". Point DATABASE_URL at ${SCRATCH_DATABASE}.`);
    process.exit(2);
  }
  mkdirSync(outDir, { recursive: true });

  const prisma = getPrismaClient();
  const before = await fingerprint(prisma);

  const orgs = await prisma.organization.findMany({
    select: { id: true, integrations: { where: { status: { not: "disconnected" } }, select: { id: true, provider: true, status: true } } },
    orderBy: { id: "asc" },
  });
  let casesProjected = 0;
  const failures: string[] = [];
  for (const org of orgs) {
    const ordered = [...org.integrations].sort((a, b) => ROLE_ORDER[PROVIDERS[a.provider].role] - ROLE_ORDER[PROVIDERS[b.provider].role]);
    for (const i of ordered) {
      const adapter = PROVIDERS[i.provider];
      const integration = { id: i.id, organizationId: org.id, provider: i.provider, status: i.status };
      const resolveCaseRef = adapter.role === "work_tracker" ? await caseRefResolverFor(prisma, org.id) : null;
      const correlate = () => correlateAndProject(adapter, { prisma, integration, resolveCaseRef });
      const normalize = async () => {
        const r = await normalizeAndProject(adapter, { prisma, integration, mode: "full" });
        casesProjected += r.casesUpserted;
        for (const f of r.failures) failures.push(`${i.provider}/${f.id}: ${f.error}`);
      };
      // The worker's own order: a ticket source has its cases before anything links onto them.
      if (adapter.role === "ticket_source") {
        await normalize();
        await correlate();
      } else {
        await correlate();
        await normalize();
      }
    }
  }

  const after = await fingerprint(prisma);
  writeFileSync(join(outDir, "l2-before.txt"), before.lines.join("\n") + "\n");
  writeFileSync(join(outDir, "l2-after.txt"), after.lines.join("\n") + "\n");

  const beforeSet = new Set(before.lines);
  const afterSet = new Set(after.lines);
  const removed = before.lines.filter((l) => !afterSet.has(l));
  const added = after.lines.filter((l) => !beforeSet.has(l));
  const eventIdsStable = before.eventIds.h === after.eventIds.h && before.eventIds.n === after.eventIds.n;
  console.log(
    JSON.stringify({
      organizations: orgs.length,
      casesProjected,
      recordFailures: failures.length,
      records: before.lines.length,
      differences: removed.length + added.length,
      normalizedEventIds: { before: before.eventIds.n, after: after.eventIds.n, identical: eventIdsStable },
    }),
  );
  for (const f of failures.slice(0, 20)) console.log("record failure:", f);
  for (const l of removed.slice(0, 20)) console.log("- ", l.slice(0, 240));
  for (const l of added.slice(0, 20)) console.log("+ ", l.slice(0, 240));
  await prisma.$disconnect();
  process.exit(removed.length + added.length > 0 || failures.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("l2-replay failed:", error);
  process.exit(1);
});
