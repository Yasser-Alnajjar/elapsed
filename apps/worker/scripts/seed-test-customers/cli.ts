/**
 * `pnpm db:seed:test-customers [--reset] [--anchor=now|<ISO>] [--tenants=halcyon,nimbus]`
 * `pnpm db:seed:test-customers:validate [--org=halcyon] [--tenants=...] [--json]`
 *
 * Seeds 11 independent organizations (tenants), each with the full Zendesk <-> Jira fixture. Runs
 * against whatever DATABASE_URL points at (the root `.env` when run through the package scripts).
 * Only ever writes to / deletes the fixed seed organizations.
 */
import { getPrismaClient } from "@sla/db";
import { checkAll, collectAll, formatAll } from "./validate";
import { currentHourAnchor, defaultAnchor, seedTestCustomers, selectTenants } from "./seed";

function parseAnchor(value: string | undefined): Date {
  if (value === undefined) return defaultAnchor();
  if (value === "now") return currentHourAnchor();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`--anchor must be "now" or an ISO timestamp, got "${value}"`);
  return parsed;
}

const list = (value: string | undefined): string[] | undefined =>
  value === undefined || value === "" ? undefined : value.split(",").map((v) => v.trim()).filter(Boolean);

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = new Map(
    rest
      .filter((arg) => arg.startsWith("--") && arg !== "--")
      .map((arg) => {
        const [key, value] = arg.replace(/^--/, "").split("=");
        return [key!, value] as const;
      }),
  );
  const prisma = getPrismaClient();
  const tenantKeys = list(flags.get("tenants"));

  if (command === "seed") {
    const run = await seedTestCustomers(prisma, {
      reset: flags.has("reset"),
      anchor: parseAnchor(flags.get("anchor")),
      tenants: tenantKeys,
      onProgress: (message) => console.log(message),
    });
    console.log(`\nSeed complete: ${run.tenants.length} organization(s), anchor ${run.anchor.toISOString()}`);
    for (const t of run.tenants) {
      console.log(
        `  ${t.tenantKey.padEnd(12)} ${t.organizationId}: raw ${t.rawEventsWritten}, commitments ${t.commitmentsCreated}, evaluations ${t.evaluationsCreated}, notifications ${t.notificationsRecorded}+${t.notificationFailuresRecorded} failed`,
      );
    }
  } else if (command === "validate") {
    const tenants = selectTenants(tenantKeys);
    const all = await collectAll(prisma, tenants);
    const checks = checkAll(all, tenants.length);
    const failed = checks.global.some((c) => !c.ok) || checks.tenants.some((t) => t.checks.some((c) => !c.ok));
    if (flags.has("json")) console.log(JSON.stringify({ all, checks }, null, 2));
    else console.log(formatAll(all, checks, { detail: list(flags.get("org")) }));
    if (failed) process.exitCode = 1;
  } else {
    throw new Error("Usage: cli.ts <seed|validate> [--reset] [--anchor=now|ISO] [--tenants=a,b] [--org=a] [--json]");
  }
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
