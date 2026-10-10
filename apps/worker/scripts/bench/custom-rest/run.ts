/**
 * Plan 09 §6.10 benchmark harness for the Custom REST source (D-01, N9.7-F1).
 *
 *   DATABASE_URL=postgresql://…/sla_custom_bench?schema=public \
 *   pnpm --filter @sla/worker exec tsx scripts/bench/custom-rest/run.ts \
 *     --tiers=1000,5000,10000,20000 --runs=5 --snapshots=1 --comments=5 --out=/path/report.json
 *
 * What it does: for each tier it seeds a fresh organization with synthetic
 * custom-shaped raw events (the form `buildTicketEvents` stores), then runs the
 * REAL worker cycle (`runCycle`: `normalizeCustom` with `deriveBatch` and the
 * guards, the projector, then the commitment, cycle, evaluation and
 * notification stages) in a fresh child process per run, with the integration's
 * polling paused so provider HTTP ingestion is excluded, as §6.10 defines the
 * 30 s sweep and 10 s lock figures. It never inserts NormalizedEvent rows.
 *
 * Measured per run: wall time of the cycle, the organization-lock hold
 * (`organization_lock_duration`), per-stage `PERF_METRICS` scopes (duration and
 * query count), and the child's peak RSS. Passes: first full pass (everything
 * is new), steady full pass (reconciliation sweep), poll pass, and a
 * lifecycle-guard abort that must write nothing.
 *
 * Safety: the database name must contain "bench"; organizations are created and
 * deleted by this script only. Run it against a disposable database.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPrismaClient } from "@sla/db";
import { addClosingSnapshots, loadConfig, seedOrganization } from "./seed";

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string]));
const tiers = (args.get("tiers") ?? "1000,5000,10000,20000").split(",").map(Number);
const runs = Number(args.get("runs") ?? 5);
const firstRuns = Number(args.get("first-runs") ?? 1);
const snapshots = Number(args.get("snapshots") ?? 1);
const comments = Number(args.get("comments") ?? 5);
const cpus = args.get("cpus") ?? ""; // e.g. "0,1" to pin the worker to two cores (production is a 2 vCPU host)
const heapMb = args.get("max-old-space-mb") ?? "";
const secondOrg = Number(args.get("second-org-cases") ?? 0);
const outPath = args.get("out") ?? "";
const only = (args.get("passes") ?? "first,steady,poll,abort").split(",");

const dbName = decodeURIComponent(new URL(process.env.DATABASE_URL ?? "postgresql://x/none").pathname.replace(/^\//, ""));
if (!/bench/i.test(dbName)) throw new Error(`DATABASE_URL names "${dbName}"; this harness needs a database whose name contains "bench".`);

const here = fileURLToPath(new URL(".", import.meta.url));
const childPath = `${here}cycle-child.ts`;

interface RunMetrics {
  wallMs: number;
  lockHoldMs: number | null;
  lockWaitMs: number | null;
  queries: number;
  queryMs: number;
  stages: Record<string, { durationMs: number; queries: number }>;
  maxRssMb: number;
  heapUsedMb: number;
  failures: number;
  failureSummary: string[];
  outcome: string | null;
}

function runChild(kind: string, organizationIds: string[], targetOrganizationId: string): Promise<RunMetrics> {
  return new Promise((resolve, reject) => {
    const nodeArgs = [...(heapMb ? [`--max-old-space-size=${heapMb}`] : []), "--import", "tsx", childPath, kind];
    const cmd = cpus ? "taskset" : "node";
    const cmdArgs = cpus ? ["-c", cpus, "node", ...nodeArgs] : nodeArgs;
    const child = spawn(cmd, cmdArgs, { cwd: process.cwd(), env: { ...process.env, PERF_METRICS: "1", PERF_ORG_ID: organizationIds.join(",") } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`child exited ${code}: ${err.slice(-800)}`));
      const metrics: RunMetrics = { wallMs: 0, lockHoldMs: null, lockWaitMs: null, queries: 0, queryMs: 0, stages: {}, maxRssMb: 0, heapUsedMb: 0, failures: 0, failureSummary: [], outcome: null };
      for (const line of out.split("\n")) {
        if (line.startsWith("BENCH_RESULT ")) {
          const r = JSON.parse(line.slice("BENCH_RESULT ".length));
          Object.assign(metrics, { wallMs: r.wallMs, maxRssMb: r.maxRssMb, heapUsedMb: r.heapUsedMb, failures: r.failures, failureSummary: r.failureSummary ?? [] });
          continue;
        }
        if (!line.startsWith("{")) continue;
        let entry: Record<string, any>;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        const event = entry.event ?? entry.message ?? entry.msg;
        if (event === "organization_lock_duration" && entry.organizationId === targetOrganizationId) {
          metrics.lockHoldMs = (metrics.lockHoldMs ?? 0) + Number(entry.holdMs);
          metrics.lockWaitMs = (metrics.lockWaitMs ?? 0) + Number(entry.waitMs);
        } else if (event === "perf_scope" && (entry.organizationId === undefined || entry.organizationId === targetOrganizationId)) {
          const label = String(entry.perfScope ?? "scope");
          const stage = (metrics.stages[label] ??= { durationMs: 0, queries: 0 });
          stage.durationMs += Number(entry.durationMs ?? 0);
          stage.queries += Number(entry.queryCount ?? 0);
          metrics.queries += Number(entry.queryCount ?? 0);
          metrics.queryMs += Number(entry.queryMs ?? 0);
        }
      }
      resolve(metrics);
    });
  });
}

const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
const median = (values: number[]) => {
  const s = sorted(values);
  return s.length === 0 ? NaN : s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const p95 = (values: number[]) => {
  const s = sorted(values);
  return s.length === 0 ? NaN : s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
};
const summarize = (values: number[]) => ({ n: values.length, median: Math.round(median(values)), p95: Math.round(p95(values)), max: Math.round(Math.max(...values)), values: values.map(Math.round) });

/** Least-squares slope of y against x, and the log-log exponent (1.0 = linear). */
function slope(points: [number, number][]) {
  const n = points.length;
  if (n < 2) return { perCase: NaN, exponent: NaN };
  const mx = points.reduce((a, p) => a + p[0], 0) / n;
  const my = points.reduce((a, p) => a + p[1], 0) / n;
  const perCase = points.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / points.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  const lx = points.map((p) => Math.log(p[0]));
  const ly = points.map((p) => Math.log(Math.max(p[1], 1e-9)));
  const mlx = lx.reduce((a, b) => a + b, 0) / n;
  const mly = ly.reduce((a, b) => a + b, 0) / n;
  const exponent = lx.reduce((a, v, i) => a + (v - mlx) * (ly[i]! - mly), 0) / lx.reduce((a, v) => a + (v - mlx) ** 2, 0);
  return { perCase, exponent };
}

async function counts(prisma: ReturnType<typeof getPrismaClient>, organizationId: string) {
  const [cases, events, commitments, evaluations, raw] = await Promise.all([
    prisma.case.count({ where: { organizationId, deletedAt: null } }),
    prisma.normalizedEvent.count({ where: { case: { organizationId } } }),
    prisma.commitment.count({ where: { case: { organizationId } } }),
    prisma.evaluation.count({ where: { commitment: { case: { organizationId } } } }),
    prisma.rawEvent.count({ where: { integration: { organizationId } } }),
  ]);
  return { cases, events, commitments, evaluations, raw };
}

async function contentFingerprint(prisma: ReturnType<typeof getPrismaClient>, organizationId: string): Promise<string> {
  // Content only: updatedAt is rewritten by every cycle, so it is excluded.
  const rows = await prisma.$queryRaw<{ h: string }[]>`
    select md5(coalesce(string_agg(c."externalId" || coalesce(c."closedAt"::text, '') || coalesce(c.subject, ''), '|' order by c."externalId"), '')) as h
    from cases c where c."organizationId" = ${organizationId} and c."deletedAt" is null`;
  const events = await prisma.$queryRaw<{ h: string }[]>`
    select md5(coalesce(string_agg(n.id, '|' order by n.id), '')) as h from normalized_events n join cases c on c.id = n."caseId" where c."organizationId" = ${organizationId}`;
  const commitments = await prisma.$queryRaw<{ h: string }[]>`
    select md5(coalesce(string_agg(m.id || m.status, '|' order by m.id), '')) as h from commitments m join cases c on c.id = m."caseId" where c."organizationId" = ${organizationId}`;
  return `${rows[0]!.h}:${events[0]!.h}:${commitments[0]!.h}`;
}

async function main() {
  const prisma = getPrismaClient();
  const config = loadConfig();
  const report: Record<string, any> = {
    generatedAt: new Date().toISOString(),
    database: dbName,
    options: { tiers, runs, firstRuns, snapshots, comments, cpus: cpus || "unpinned", maxOldSpaceMb: heapMb || "default", secondOrgCases: secondOrg },
    tiers: {} as Record<string, any>,
  };

  for (const tickets of tiers) {
    console.error(`\n=== tier ${tickets} ===`);
    await prisma.organization.deleteMany({});
    const started = Date.now();
    const target = await seedOrganization(prisma, config, { tickets, snapshots, comments, name: `Bench ${tickets}` });
    const others = secondOrg > 0 ? await seedOrganization(prisma, config, { tickets: secondOrg, snapshots, comments, name: "Bench second" }) : null;
    const organizationIds = [target.organizationId, ...(others ? [others.organizationId] : [])];
    console.error(`seeded in ${Math.round((Date.now() - started) / 1000)}s, ${JSON.stringify(await counts(prisma, target.organizationId))}`);
    const tier: Record<string, any> = { tickets, snapshots, comments, seed: await counts(prisma, target.organizationId) };

    const collect = async (label: string, kind: string, n: number) => {
      const metrics: RunMetrics[] = [];
      for (let r = 0; r < n; r += 1) {
        const m = await runChild(kind, organizationIds, target.organizationId);
        metrics.push(m);
        console.error(`  ${label} run ${r + 1}/${n}: wall ${m.wallMs} ms, lock ${m.lockHoldMs} ms, queries ${m.queries}, rss ${m.maxRssMb} MB, failures ${m.failures}`);
      }
      const lock = metrics.map((m) => m.lockHoldMs).filter((v): v is number => v !== null);
      return {
        wallMs: summarize(metrics.map((m) => m.wallMs)),
        lockHoldMs: lock.length ? summarize(lock) : null,
        queries: summarize(metrics.map((m) => m.queries)),
        maxRssMb: summarize(metrics.map((m) => m.maxRssMb)),
        heapUsedMb: summarize(metrics.map((m) => m.heapUsedMb)),
        stagesMedianMs: Object.fromEntries(Object.keys(metrics[0]!.stages).map((k) => [k, Math.round(median(metrics.map((m) => m.stages[k]?.durationMs ?? 0)))])),
        failures: metrics.reduce((a, m) => a + m.failures, 0),
      };
    };

    if (only.includes("first")) {
      // The first pass over unseen data creates every case, event and commitment. It is repeatable only by reseeding, so it runs `firstRuns` times.
      const first: RunMetrics[] = [];
      for (let r = 0; r < firstRuns; r += 1) {
        if (r > 0) {
          await prisma.organization.deleteMany({});
          const again = await seedOrganization(prisma, config, { tickets, snapshots, comments, name: `Bench ${tickets}` });
          target.organizationId = again.organizationId;
          target.integrationId = again.integrationId;
          organizationIds[0] = again.organizationId;
        }
        const m = await runChild("reconciliation_sweep", organizationIds, target.organizationId);
        first.push(m);
        console.error(`  first pass ${r + 1}/${firstRuns}: wall ${m.wallMs} ms, lock ${m.lockHoldMs} ms, queries ${m.queries}, rss ${m.maxRssMb} MB, failures ${m.failures}`);
      }
      tier.firstFullPass = {
        wallMs: summarize(first.map((m) => m.wallMs)),
        lockHoldMs: summarize(first.map((m) => m.lockHoldMs ?? NaN)),
        queries: summarize(first.map((m) => m.queries)),
        maxRssMb: summarize(first.map((m) => m.maxRssMb)),
        stagesMs: first[0]!.stages,
        failures: first.reduce((a, m) => a + m.failures, 0),
      };
      tier.afterFirstPass = await counts(prisma, target.organizationId);
    }
    if (only.includes("steady")) tier.steadyFullPass = await collect("steady full (sweep)", "reconciliation_sweep", runs);
    if (only.includes("poll")) tier.pollPass = await collect("poll", "active_set_poll", runs);

    if (only.includes("abort")) {
      const before = await contentFingerprint(prisma, target.organizationId);
      const countsBefore = await counts(prisma, target.organizationId);
      const flipped = Math.ceil(tickets * 0.35); // R > 0.25 x L, R >= 10
      const indexes = Array.from({ length: tickets }, (_, i) => i).filter((i) => i % 3 !== 0).slice(0, flipped); // open tickets that become solved
      await addClosingSnapshots(prisma, config, target.integrationId, indexes);
      const metrics: RunMetrics[] = [];
      for (let r = 0; r < Math.min(runs, 3); r += 1) metrics.push(await runChild("reconciliation_sweep", organizationIds, target.organizationId));
      const after = await contentFingerprint(prisma, target.organizationId);
      const countsAfter = await counts(prisma, target.organizationId);
      tier.guardAbort = {
        flippedTickets: indexes.length,
        abortFailures: metrics.map((m) => m.failures),
        abortReported: metrics[0]?.failureSummary ?? [],
        wallMs: summarize(metrics.map((m) => m.wallMs)),
        lockHoldMs: summarize(metrics.map((m) => m.lockHoldMs ?? NaN)),
        writesNothing: before === after && JSON.stringify({ ...countsBefore, raw: 0 }) === JSON.stringify({ ...countsAfter, raw: 0 }),
        contentBefore: before,
        contentAfter: after,
      };
    }
    report.tiers[String(tickets)] = tier;
    if (outPath) {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, JSON.stringify(report, null, 2));
    }
  }

  // Scaling: slope of the p95 lock hold and wall time against live cases, and the log-log exponent.
  const series = (pick: (t: any) => number | undefined) => Object.values<any>(report.tiers).flatMap((t) => (pick(t) !== undefined && Number.isFinite(pick(t)) ? [[t.tickets, pick(t)] as [number, number]] : []));
  report.scaling = {
    steadyLockP95: slope(series((t) => t.steadyFullPass?.lockHoldMs?.p95)),
    steadyWallP95: slope(series((t) => t.steadyFullPass?.wallMs?.p95)),
    steadyQueriesMedian: slope(series((t) => t.steadyFullPass?.queries?.median)),
  };
  if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await prisma.organization.deleteMany({});
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
