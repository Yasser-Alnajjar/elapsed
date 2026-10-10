/**
 * One worker cycle for the benchmark (plan 09 §6.10). Runs in its own process
 * so the parent can read peak RSS and so each run starts with a cold process
 * (warm database cache). Prints `BENCH_RESULT {json}` as its last line; the
 * `PERF_METRICS=1` scopes and `organization_lock_duration` lines it logs are
 * parsed by `run.ts`.
 */
import { getPrismaClient } from "@sla/db";
import { loadWorkerConfig } from "../../../src/config";
import { runCycle, type CycleKind } from "../../../src/cycle";

const kind = process.argv[2] as CycleKind;
const organizationIds = (process.env.PERF_ORG_ID ?? "").split(",").map((id) => id.trim()).filter(Boolean);
if (!/bench/i.test(new URL(process.env.DATABASE_URL ?? "postgresql://x/none").pathname)) throw new Error("DATABASE_URL must name a *bench* database");
if (organizationIds.length === 0) throw new Error("PERF_ORG_ID is required (an unscoped cycle would touch every organization)");

async function main() {
  const prisma = getPrismaClient();
  const config = loadWorkerConfig();
  const startedAt = performance.now();
  const result = await runCycle(prisma, config, kind, `bench-${kind}`, { organizationIds });
  const wallMs = Math.round(performance.now() - startedAt);
  const usage = process.resourceUsage();
  const mem = process.memoryUsage();
  console.log(
    `BENCH_RESULT ${JSON.stringify({
      kind,
      wallMs,
      maxRssMb: Math.round(usage.maxRSS / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
      failures: (result as { failures?: unknown[] }).failures?.length ?? 0,
      failureSummary: ((result as { failures?: { stage?: string; error?: string }[] }).failures ?? []).slice(0, 2).map((f) => `${f.stage}: ${String(f.error ?? "").slice(0, 120)}`),
    })}`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
