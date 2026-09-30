/**
 * Multi-worker benchmark / soak harness. Runs REAL worker processes
 * (`apps/worker/src/index.ts`) against a disposable Postgres database, with
 * the Linear API replaced by an in-process fake that adds latency
 * (`fake-linear-preload.mjs`), then measures what actually happened from the
 * workers' own structured logs, the fake provider's request log and sampled
 * `pg_stat_activity` / `pg_locks`.
 *
 *   DATABASE_URL=postgresql://.../sla_bench pnpm tsx scripts/bench/run.ts \
 *     --scenario=throughput --workers=2 --duration=60
 *
 * Scenarios:
 *   throughput  N workers for --duration seconds; cadence, overlap, concurrency,
 *               connections, lock waits, cursor monotonicity
 *   crash       2 workers; the first is SIGKILLed mid-run; measures recovery
 *   pause       2 workers; the first is SIGSTOPped past its lease TTL, then resumed (a GC pause / VM stall):
 *               the second takes over and the resumed worker must stop without publishing
 *   restart     reconciliations overdue by hours; one worker starts and must run them first
 *
 * Refuses to run unless the database name contains "bench": it wipes every
 * organization in it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureOrganizationWorkStates, getPrismaClient } from "@sla/db";

const here = dirname(fileURLToPath(import.meta.url));
const workerDir = join(here, "..", "..");

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key!, value ?? "true"] as const;
  }),
);
const num = (key: string, fallback: number) => (args.has(key) ? Number(args.get(key)) : fallback);

const scenario = args.get("scenario") ?? "throughput";
const workers = num("workers", 1);
const durationS = num("duration", 60);
const orgCount = num("orgs", 48);
const latencyMs = num("latency", 150);
const concurrency = num("concurrency", 3);
const activeMs = num("active", 10_000);
const reconMs = num("recon", 45_000);
const leaseTtlMs = num("lease-ttl", 10_000);
const outDir = join(here, "out", `${scenario}-w${workers}`);

const databaseUrl = process.env.DATABASE_URL!;
const dbName = new URL(databaseUrl).pathname.replace(/^\//, "");
if (!/bench/i.test(dbName)) throw new Error(`DATABASE_URL points at "${dbName}"; this harness wipes organizations and only runs against a *bench* database.`);

process.env.DATABASE_POOL_MAX = "4";
const prisma = getPrismaClient();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- setup ----------

async function seed(): Promise<string[]> {
  await prisma.organization.deleteMany();
  await prisma.workerSettings.deleteMany();
  await prisma.workerSettings.create({
    data: { id: "singleton", activePollIntervalMs: activeMs, reconciliationIntervalMs: reconMs },
  });
  const ids: string[] = [];
  for (let i = 0; i < orgCount; i += 1) {
    const org = await prisma.organization.create({ data: { name: `Bench Org ${i}` } });
    await prisma.integration.create({
      data: {
        organizationId: org.id,
        provider: "linear",
        credentials: { accessToken: `tok-${i}`, tokenType: "Bearer", scope: "read" },
      },
    });
    ids.push(org.id);
  }
  // Active work is due immediately; each first reconciliation lands at a random point within one interval,
  // which is exactly how a fleet of freshly created organizations is scheduled.
  await ensureOrganizationWorkStates(prisma, { reconciliationIntervalMs: reconMs });
  return ids;
}

interface Worker {
  id: string;
  child: ChildProcess;
  logFile: string;
  exited: Promise<number | null>;
}

function startWorker(index: number, extraEnv: Record<string, string> = {}): Worker {
  const id = `bench-w${index}`;
  const logFile = join(outDir, `${id}.log`);
  const out = createWriteStream(logFile, { flags: "a" });
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--import", join(here, "fake-linear-preload.mjs"), "src/index.ts"],
    {
      cwd: workerDir,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        PGAPPNAME: id,
        NEXTAUTH_URL: "http://localhost:3000",
        INTEGRATION_CONFIG_ENCRYPTION_KEY: "bench-config-key",
        INTEGRATION_TOKEN_ENCRYPTION_KEY: "bench-token-key",
        SMTP_ENCRYPTION_KEY: "bench-smtp-key",
        WORKER_ID: id,
        WORKER_HEALTH_PORT: String(8100 + index),
        ORGANIZATION_CONCURRENCY: String(concurrency),
        WORKER_LEASE_TTL_MS: String(leaseTtlMs),
        WORKER_SHUTDOWN_GRACE_MS: "15000",
        WORKER_LOCK_RETRY_MS: "1000",
        BENCH_PROVIDER_LATENCY_MS: String(latencyMs),
        BENCH_PROVIDER_LOG: join(outDir, "provider.log"),
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout!.pipe(out);
  child.stderr!.pipe(out);
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return { id, child, logFile, exited };
}

async function stopWorker(worker: Worker, signal: NodeJS.Signals = "SIGTERM"): Promise<number | null> {
  if (worker.child.exitCode !== null) return worker.child.exitCode;
  worker.child.kill(signal);
  return worker.exited;
}

// ---------- sampling ----------

interface Sample {
  t: number;
  connections: number;
  perApp: Record<string, number>;
  lockWaiters: number;
  activeQueries: number;
}

function startSampler(): { stop: () => Sample[] } {
  const samples: Sample[] = [];
  let running = true;
  void (async () => {
    while (running) {
      try {
        const rows = await prisma.$queryRaw<{ app: string; n: bigint; waiting: bigint; active: bigint }[]>`
          SELECT application_name AS app, count(*) AS n,
                 count(*) FILTER (WHERE wait_event_type = 'Lock') AS waiting,
                 count(*) FILTER (WHERE state = 'active') AS active
          FROM pg_stat_activity
          WHERE datname = current_database() AND application_name LIKE 'bench-w%'
          GROUP BY application_name`;
        samples.push({
          t: Date.now(),
          connections: rows.reduce((sum, r) => sum + Number(r.n), 0),
          perApp: Object.fromEntries(rows.map((r) => [r.app, Number(r.n)])),
          lockWaiters: rows.reduce((sum, r) => sum + Number(r.waiting), 0),
          activeQueries: rows.reduce((sum, r) => sum + Number(r.active), 0),
        });
      } catch {
        /* sampling is best-effort */
      }
      await sleep(250);
    }
  })();
  return {
    stop: () => {
      running = false;
      return samples;
    },
  };
}

// ---------- analysis ----------

interface LogLine {
  event?: string;
  time?: string;
  organizationId?: string;
  kind?: string;
  leaseToken?: string;
  leaseOwner?: string;
  previousOwner?: string;
  durationMs?: number;
  failures?: number;
  reason?: string;
  [key: string]: unknown;
}

interface Run {
  worker: string;
  organizationId: string;
  kind: string;
  leaseToken: string;
  start: number;
  end: number | null;
}

function parseLog(file: string): LogLine[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as LogLine];
      } catch {
        return [];
      }
    });
}

function collectRuns(workerList: Worker[]): { runs: Run[]; lines: Map<string, LogLine[]> } {
  const runs: Run[] = [];
  const lines = new Map<string, LogLine[]>();
  for (const worker of workerList) {
    const entries = parseLog(worker.logFile);
    lines.set(worker.id, entries);
    const open = new Map<string, Run>();
    for (const entry of entries) {
      if (!entry.organizationId || !entry.leaseToken) continue;
      const key = `${entry.organizationId}:${entry.leaseToken}`;
      const at = Date.parse(entry.time!);
      if (entry.event === "work_started") {
        const run: Run = { worker: worker.id, organizationId: entry.organizationId, kind: entry.kind!, leaseToken: entry.leaseToken, start: at, end: null };
        open.set(key, run);
        runs.push(run);
      } else if (entry.event === "work_processed") {
        const run = open.get(key);
        if (run) run.end = at;
      }
    }
  }
  return { runs, lines };
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : NaN);
const fmt = (n: number, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : "n/a");

function peakConcurrency(intervals: { start: number; end: number }[]): number {
  const edges = intervals.flatMap((i) => [
    [i.start, 1],
    [i.end, -1],
  ]) as [number, number][];
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let max = 0;
  for (const [, d] of edges) {
    cur += d;
    max = Math.max(max, cur);
  }
  return max;
}

function overlapsByKey<T extends { start: number; end: number }>(items: T[], key: (item: T) => string): number {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  let overlaps = 0;
  for (const list of groups.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i += 1) if (list[i]!.start < list[i - 1]!.end) overlaps += 1;
  }
  return overlaps;
}

function gaps(runs: Run[], kind: string | null): number[] {
  const byOrg = new Map<string, number[]>();
  for (const run of runs) {
    if (kind && run.kind !== kind) continue;
    byOrg.set(run.organizationId, [...(byOrg.get(run.organizationId) ?? []), run.start]);
  }
  const out: number[] = [];
  for (const starts of byOrg.values()) {
    starts.sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i += 1) out.push(starts[i]! - starts[i - 1]!);
  }
  return out.sort((a, b) => a - b);
}

interface ProviderEntry {
  t: number;
  pid: number;
  token: string;
  op: string;
  phase: "start" | "end";
  id: string;
  updatedSince?: string;
}

function analyzeProvider() {
  const file = join(outDir, "provider.log");
  const entries = existsSync(file)
    ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as ProviderEntry)
    : [];
  const starts = entries.filter((e) => e.phase === "start");
  const requests = new Map<string, { token: string; pid: number; start: number; end: number; updatedSince?: string; op: string }>();
  for (const e of entries) {
    if (e.phase === "start") requests.set(e.id, { token: e.token, pid: e.pid, start: e.t, end: e.t, updatedSince: e.updatedSince, op: e.op });
    else if (requests.has(e.id)) requests.get(e.id)!.end = e.t;
  }
  const all = [...requests.values()];
  // Two requests for one organization (token) in flight at once: only possible if two runs overlapped.
  const concurrentSameOrg = overlapsByKey(all, (r) => r.token);
  const crossProcessSameOrg = (() => {
    const byToken = new Map<string, typeof all>();
    for (const r of all) byToken.set(r.token, [...(byToken.get(r.token) ?? []), r]);
    let n = 0;
    for (const list of byToken.values()) {
      list.sort((a, b) => a.start - b.start);
      for (let i = 1; i < list.length; i += 1) if (list[i]!.start < list[i - 1]!.end && list[i]!.pid !== list[i - 1]!.pid) n += 1;
    }
    return n;
  })();
  // Cursor monotonicity: each issues-query's `updatedSince` (the persisted cursor it read) must never be older
  // than the previous one for that organization — a stale-cursor writer would make it go backwards.
  let cursorRegressions = 0;
  const lastSince = new Map<string, string>();
  for (const r of all.filter((x) => x.op === "issues").sort((a, b) => a.start - b.start)) {
    const prev = lastSince.get(r.token);
    if (prev && r.updatedSince && r.updatedSince < prev) cursorRegressions += 1;
    if (r.updatedSince) lastSince.set(r.token, r.updatedSince);
  }
  const elapsedS = entries.length ? (Math.max(...entries.map((e) => e.t)) - Math.min(...entries.map((e) => e.t))) / 1000 : 0;
  return { requests: starts.length, concurrentSameOrg, crossProcessSameOrg, cursorRegressions, peakInFlight: peakConcurrency(all), elapsedS };
}

// ---------- scenarios ----------

async function runThroughput(): Promise<void> {
  const orgIds = await seed();
  const workerList: Worker[] = [];
  const sampler = startSampler();
  const t0 = Date.now();
  for (let i = 1; i <= workers; i += 1) workerList.push(startWorker(i));
  await sleep(durationS * 1000);
  const exitCodes = await Promise.all(workerList.map((w) => stopWorker(w)));
  const wallS = (Date.now() - t0) / 1000;
  const samples = sampler.stop();
  await report({ label: `throughput, ${workers} worker(s)`, workerList, orgIds, samples, exitCodes, t0, wallS });
}

async function runCrash(): Promise<void> {
  const orgIds = await seed();
  await prisma.$executeRaw`UPDATE "organization_work_states" SET "reconciliationNextDueAt" = now() + interval '1 hour'`;
  const workerList = [startWorker(1), startWorker(2)];
  const sampler = startSampler();
  const t0 = Date.now();
  await sleep(Math.max(12, durationS / 3) * 1000);

  // Kill -9 the first worker while it is mid-run (it has leases).
  const leased = await prisma.organizationWorkState.findMany({ where: { leaseOwner: "bench-w1" } });
  const killedAt = Date.now();
  await stopWorker(workerList[0]!, "SIGKILL");
  console.log(`SIGKILL bench-w1 at +${((killedAt - t0) / 1000).toFixed(1)}s while holding ${leased.length} lease(s)`);

  await sleep(Math.max(20, (durationS * 2) / 3) * 1000);
  const exitCodes = [null, await stopWorker(workerList[1]!)];
  const wallS = (Date.now() - t0) / 1000;
  const samples = sampler.stop();

  const { runs } = collectRuns(workerList);
  const orphaned = new Set(leased.map((l) => l.organizationId));
  const recovery = [...orphaned].map((orgId) => {
    const next = runs.filter((r) => r.worker === "bench-w2" && r.organizationId === orgId && r.start > killedAt).sort((a, b) => a.start - b.start)[0];
    return next ? (next.start - killedAt) / 1000 : Number.NaN;
  });
  const valid = recovery.filter(Number.isFinite).sort((a, b) => a - b);
  console.log(`\n=== crash recovery ===`);
  console.log(`organizations leased by the killed worker: ${orphaned.size}`);
  console.log(`re-processed by bench-w2: ${valid.length}/${orphaned.size}`);
  console.log(`time from kill to re-processing: min ${fmt(valid[0] ?? NaN)}s, median ${fmt(pct(valid, 0.5))}s, max ${fmt(valid[valid.length - 1] ?? NaN)}s (lease TTL ${leaseTtlMs / 1000}s, active interval ${activeMs / 1000}s)`);
  const recoveredLogs = (parseLog(workerList[1]!.logFile)).filter((l) => l.event === "lease_recovered");
  console.log(`lease_recovered events on bench-w2: ${recoveredLogs.length} (previousOwner=bench-w1: ${recoveredLogs.filter((l) => l.previousOwner === "bench-w1").length})`);
  await report({ label: "crash", workerList, orgIds, samples, exitCodes, t0, wallS });
}

async function runPause(): Promise<void> {
  const orgIds = await seed();
  await prisma.$executeRaw`UPDATE "organization_work_states" SET "reconciliationNextDueAt" = now() + interval '1 hour'`;
  const workerList = [startWorker(1), startWorker(2)];
  const sampler = startSampler();
  const t0 = Date.now();
  await sleep(15_000);

  const held = await prisma.organizationWorkState.findMany({ where: { leaseOwner: "bench-w1" } });
  const pausedAt = Date.now();
  workerList[0]!.child.kill("SIGSTOP");
  const pauseMs = leaseTtlMs + 6_000;
  console.log(`SIGSTOP bench-w1 at +${((pausedAt - t0) / 1000).toFixed(1)}s for ${pauseMs / 1000}s (lease TTL ${leaseTtlMs / 1000}s) while it held ${held.length} lease(s)`);
  await sleep(pauseMs);
  const cursorOf = async () =>
    Object.fromEntries(
      (await prisma.integration.findMany({ where: { organizationId: { in: held.map((h) => h.organizationId) } } })).map((i) => [
        i.organizationId,
        ((i.cursor as { issues?: { updatedSince?: string } } | null)?.issues?.updatedSince) ?? null,
      ]),
    ) as Record<string, string | null>;
  const cursorsBeforeResume = await cursorOf();
  const resumedAt = Date.now();
  workerList[0]!.child.kill("SIGCONT");
  await sleep(2_000);
  const cursorsAfterResume = await cursorOf();
  const regressed = Object.keys(cursorsBeforeResume).filter((org) => (cursorsAfterResume[org] ?? "") < (cursorsBeforeResume[org] ?? ""));
  console.log(`integration cursors of the paused organizations that moved BACKWARDS within 2s of resume (stale write): ${regressed.length}/${held.length}`);
  await sleep(18_000);
  const exitCodes = await Promise.all(workerList.map((w) => stopWorker(w)));
  const wallS = (Date.now() - t0) / 1000;
  const samples = sampler.stop();

  const { runs, lines } = collectRuns(workerList);
  const w1 = lines.get("bench-w1")!;
  const afterResume = (entry: LogLine) => Date.parse(entry.time!) >= resumedAt;
  const heldOrgs = new Set(held.map((h) => h.organizationId));
  console.log(`\n=== pause / resume ===`);
  console.log(`after SIGCONT, bench-w1 logged: lease_lost=${w1.filter((l) => l.event === "lease_lost" && afterResume(l)).length}, work_abandoned=${w1.filter((l) => l.event === "work_abandoned" && afterResume(l)).length}, work_result_fenced=${w1.filter((l) => l.event === "work_result_fenced").length}`);
  const staleRecorded = w1.filter((l) => l.event === "work_finished" && heldOrgs.has(l.organizationId!) && Date.parse(l.time!) >= resumedAt && Date.parse(l.time!) < resumedAt + 1500);
  console.log(`results recorded by the resumed worker for organizations it had lost (within 1.5s of resuming): ${staleRecorded.length}`);
  const takeovers = [...heldOrgs].map((orgId) => {
    const next = runs.filter((r) => r.worker === "bench-w2" && r.organizationId === orgId && r.start > pausedAt).sort((a, b) => a.start - b.start)[0];
    return next ? (next.start - pausedAt) / 1000 : Number.NaN;
  });
  console.log(`bench-w2 took over ${takeovers.filter(Number.isFinite).length}/${heldOrgs.size} paused organizations after ${takeovers.filter(Number.isFinite).map((x) => x.toFixed(1)).join("s, ")}s`);
  const postResumeRuns = runs.filter((r) => r.worker === "bench-w1" && r.start >= resumedAt && r.end !== null);
  console.log(`bench-w1 resumed claiming normally afterwards: ${postResumeRuns.length} run(s) after SIGCONT`);
  await report({ label: "pause", workerList, orgIds, samples, exitCodes, t0, wallS });
}

async function runRestart(): Promise<void> {
  const orgIds = await seed();
  // Downtime: every reconciliation has been overdue for hours; active work is also due.
  await prisma.$executeRaw`UPDATE "organization_work_states" SET "reconciliationNextDueAt" = now() - interval '3 hours', "activeNextDueAt" = now() - interval '3 hours'`;
  const workerList = [startWorker(1)];
  const sampler = startSampler();
  const t0 = Date.now();
  await sleep(durationS * 1000);
  const exitCodes = [await stopWorker(workerList[0]!)];
  const wallS = (Date.now() - t0) / 1000;
  const samples = sampler.stop();
  const { runs } = collectRuns(workerList);
  const firstByOrg = new Map<string, Run>();
  for (const run of runs.sort((a, b) => a.start - b.start)) if (!firstByOrg.has(run.organizationId)) firstByOrg.set(run.organizationId, run);
  const firstRuns = [...firstByOrg.values()];
  console.log(`\n=== restart with overdue work ===`);
  console.log(`organizations whose very first run was a reconciliation: ${firstRuns.filter((r) => r.kind === "reconciliation").length}/${orgIds.length}`);
  const first = Math.min(...runs.map((r) => r.start));
  const lastFirst = Math.max(...firstRuns.map((r) => r.start));
  console.log(`first run began ${fmt((first - t0) / 1000)}s after worker spawn; every organization had been reconciled by +${fmt((lastFirst - first) / 1000)}s after that`);
  await report({ label: "restart", workerList, orgIds, samples, exitCodes, t0, wallS });
}

interface ReportInput {
  label: string;
  workerList: Worker[];
  orgIds: string[];
  samples: Sample[];
  exitCodes: (number | null)[];
  t0: number;
  wallS: number;
}

async function report({ label, workerList, orgIds, samples, exitCodes, wallS }: ReportInput): Promise<void> {
  const { runs, lines } = collectRuns(workerList);
  const finished = runs.filter((r) => r.end !== null) as (Run & { end: number })[];
  const first = Math.min(...runs.map((r) => r.start));
  const last = Math.max(...finished.map((r) => r.end));
  const steadyS = (last - first) / 1000;
  // Any completed run counts toward an organization's freshness: a reconciliation does everything an active poll does.
  const cadence = gaps(runs, null);
  const reconGaps = gaps(runs, "reconciliation");
  const provider = analyzeProvider();

  console.log(`\n=== ${label} ===`);
  console.log(`workers: ${workerList.length}, organizations: ${orgIds.length}, concurrency/worker: ${concurrency}, provider latency: ~${latencyMs}ms/request, active interval ${activeMs / 1000}s, recon interval ${reconMs / 1000}s`);
  console.log(`wall time ${fmt(wallS)}s; exit codes: ${JSON.stringify(exitCodes)}`);
  console.log(`organization runs finished: ${finished.length} (active ${finished.filter((r) => r.kind === "active").length}, reconciliation ${finished.filter((r) => r.kind === "reconciliation").length}) over ${fmt(steadyS)}s = ${fmt(finished.length / steadyS, 2)} runs/s`);
  for (const worker of workerList) {
    const mine = finished.filter((r) => r.worker === worker.id);
    console.log(`  ${worker.id}: ${mine.length} runs, peak concurrency ${peakConcurrency(mine)}`);
  }
  console.log(`peak concurrent organizations across all workers: ${peakConcurrency(finished)}`);
  console.log(`per-organization overlap (same org running in two places at once): ${overlapsByKey(finished, (r) => r.organizationId)}  <- duplicate processing`);
  console.log(`start-to-start per organization (any run kind): n=${cadence.length}, median ${fmt(pct(cadence, 0.5) / 1000)}s, p95 ${fmt(pct(cadence, 0.95) / 1000)}s, max ${fmt((cadence[cadence.length - 1] ?? NaN) / 1000)}s (target ${activeMs / 1000}s)`);
  if (reconGaps.length) {
    console.log(`reconciliation start-to-start per organization: n=${reconGaps.length}, median ${fmt(pct(reconGaps, 0.5) / 1000)}s, max ${fmt(reconGaps[reconGaps.length - 1]! / 1000)}s (limit ${reconMs / 1000}s)`);
  }
  console.log(`provider: ${provider.requests} requests (${fmt(provider.requests / Math.max(1, provider.elapsedS), 1)}/s), peak in flight ${provider.peakInFlight}, same-organization concurrent requests: ${provider.concurrentSameOrg} (across processes: ${provider.crossProcessSameOrg}), cursor regressions: ${provider.cursorRegressions}`);
  const maxConn = Math.max(0, ...samples.map((s) => s.connections));
  const perApp: Record<string, number> = {};
  for (const s of samples) for (const [app, n] of Object.entries(s.perApp)) perApp[app] = Math.max(perApp[app] ?? 0, n);
  console.log(`db connections (workers only): peak total ${maxConn}, peak per worker ${JSON.stringify(perApp)}`);
  console.log(`db lock waiters: peak ${Math.max(0, ...samples.map((s) => s.lockWaiters))}, samples with any waiter ${samples.filter((s) => s.lockWaiters > 0).length}/${samples.length}; peak concurrently-active queries ${Math.max(0, ...samples.map((s) => s.activeQueries))}`);
  const all = [...lines.values()].flat();
  const count = (event: string) => all.filter((l) => l.event === event).length;
  console.log(`events: lease_lost=${count("lease_lost")}, work_abandoned=${count("work_abandoned")}, lease_recovered=${count("lease_recovered")}, work_failed=${count("work_failed")}, work_result_fenced=${count("work_result_fenced")}, work_loop_error=${count("work_loop_error")}, worker_drained=${count("worker_drained")}`);

  const states = await prisma.organizationWorkState.findMany();
  console.log(`work state after run: leases still held=${states.filter((s) => s.leaseOwner).length}, organizations with failures=${states.filter((s) => s.consecutiveFailures > 0).length}, max leaseToken=${states.reduce((m, s) => (s.leaseToken > m ? s.leaseToken : m), 0n)}`);
  writeFileSync(join(outDir, "summary.json"), JSON.stringify({ label, runs: finished.length, runsPerSecond: finished.length / steadyS, maxConn, perApp }, null, 2));
}

// ---------- main ----------

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const scenarios: Record<string, () => Promise<void>> = { throughput: runThroughput, crash: runCrash, pause: runPause, restart: runRestart };
const run = scenarios[scenario];
if (!run) throw new Error(`unknown scenario "${scenario}"`);
run()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
