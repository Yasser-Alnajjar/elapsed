/**
 * The plan 09 §6.10 benchmark gate for the `custom` provider (N9.7-F1).
 *
 *   PERF_METRICS=1 CUSTOM_PROVIDER_LIVE_CASE_CEILING=100000 \
 *   DATABASE_URL=postgresql://…/sla_bench_<name> \
 *   node --expose-gc --import tsx packages/custom-ticket/bench/run.ts \
 *     --tiers=1000,5000,10000,20000 --profile=base --reps=5 --first-import-reps=5 \
 *     --cold-cmd="docker restart <bench-postgres> && …" --out=packages/custom-ticket/bench/results
 *
 * Runs the worker's real `processOrganization` (normalize with the real
 * `deriveBatch` and guards, the real projector, commitments, next reply,
 * evaluation, notifications) under the real organization lock, against
 * synthetic custom-shaped raw events (`seed.ts`). Ingest is skipped by an
 * operator pause, so every figure is the DB-side "organization sweep" and
 * "organization-lock hold" of §6.10, never provider HTTP time.
 *
 * The initial projection (the first import) is measured on
 * `--first-import-reps` independently seeded organizations, each with its own
 * data, plus one cold-cache run when `--cold-cmd` is given (a shell command
 * that empties the database's caches, run after seeding and before the pass).
 * Every pass records the class `normalizeCustom` assigned it
 * (`custom_projection_pass`: initial projection or recurring), so each is read
 * against its own limit (plan 09 §6.10, N9.7-F1).
 *
 * Refuses any database whose name lacks `bench` or `test`: it creates and
 * deletes organizations. Writes one JSON file per run to `--out`.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, createWriteStream } from "node:fs";
import { cpus, totalmem, platform, release } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { encryptSmtpPassword, getPrismaClient, withOrganizationSlaLock, type PrismaClient } from "@sla/db";
import { createLogger } from "@sla/logger";
import { loadWorkerConfig } from "../../../apps/worker/src/config";
import { ORGANIZATION_TO_PROCESS_SELECT, emptyCycleResult, processOrganization, type CycleKind } from "../../../apps/worker/src/cycle";
import { computeConfigDiff } from "../../../apps/web/src/lib/custom-provider/config-diff";
import { deriveBatch, loadRawRows, parseConfig } from "../src";
import benchConfigJson from "./bench-config.json" with { type: "json" };
import { PROFILES, benchConfig, commentItem, commentRow, importState, insertRaw, seedTier, snapshotRow, ticketItem, type Profile, type SeededTier } from "./seed";

const { values } = parseArgs({
  options: {
    tiers: { type: "string", default: "1000,5000,10000,20000" },
    profile: { type: "string", default: "base" },
    reps: { type: "string", default: "5" },
    "first-import-reps": { type: "string", default: "5" },
    "split-reps": { type: "string", default: "3" },
    "cold-cmd": { type: "string" },
    out: { type: "string", default: "packages/custom-ticket/bench/results" },
    "keep-data": { type: "boolean", default: false },
  },
});

const databaseUrl = process.env.DATABASE_URL ?? "";
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!/bench|test/.test(databaseName)) throw new Error(`refusing to run against "${databaseName}": the name must contain "bench" or "test"`);
if (process.env.PERF_METRICS !== "1") throw new Error("set PERF_METRICS=1 (stage timings and query counts come from the perf scopes)");
if (typeof globalThis.gc !== "function") throw new Error("run node with --expose-gc (the leak check needs it)");
const gc = globalThis.gc as () => void;

const profile: Profile = PROFILES[values.profile as Profile["name"]] ?? (() => { throw new Error(`unknown profile ${values.profile}`); })();
const tiers = values.tiers!.split(",").map(Number);
const reps = Number(values.reps);
const firstImportReps = Number(values["first-import-reps"]);
const splitReps = Number(values["split-reps"]);
const coldCmd = values["cold-cmd"];
if (!(firstImportReps >= 1)) throw new Error("--first-import-reps must be at least 1");
mkdirSync(values.out!, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const logFile = createWriteStream(join(values.out!, `${stamp}-${profile.name}.log`));

// Every log line goes to the log file; perf scopes and lock durations are also kept for the pass that emitted them.
type LogRecord = Record<string, unknown> & { event?: string };
let captured: LogRecord[] = [];
const sink = (line: unknown) => {
  const text = typeof line === "string" ? line : JSON.stringify(line);
  logFile.write(`${text}\n`);
  if (text.startsWith("{")) {
    try {
      const record = JSON.parse(text) as LogRecord;
      if (record.event === "perf_scope" || record.event === "organization_lock_duration" || record.event === "custom_projection_pass") captured.push(record);
    } catch {
      // not JSON
    }
  }
};
const progress = (message: string) => process.stdout.write(`[bench ${new Date().toISOString().slice(11, 19)}] ${message}\n`);
console.log = sink;
console.warn = sink;
console.error = sink;

const prisma = getPrismaClient();
const workerConfig = loadWorkerConfig();
const logger = createLogger({ scope: "bench" });

interface MemorySampler {
  stop(): { peakRssMb: number; peakHeapMb: number };
}
function sampleMemory(): MemorySampler {
  let peakRss = 0;
  let peakHeap = 0;
  const tick = () => {
    const m = process.memoryUsage();
    peakRss = Math.max(peakRss, m.rss);
    peakHeap = Math.max(peakHeap, m.heapUsed);
  };
  tick();
  const timer = setInterval(tick, 20);
  return {
    stop() {
      clearInterval(timer);
      tick();
      return { peakRssMb: Math.round(peakRss / 1048576), peakHeapMb: Math.round(peakHeap / 1048576) };
    },
  };
}

interface StageFigures {
  durationMs: number;
  queryCount: number;
  queryMs: number;
  rowsByModel: Record<string, number>;
}
interface PassResult {
  wallMs: number;
  lockHoldMs: number | null;
  lockWaitMs: number | null;
  stages: Record<string, StageFigures>;
  queryCount: number;
  failures: string[];
  peakRssMb: number;
  peakHeapMb: number;
  heapAfterGcMb?: number;
  /** The class `normalizeCustom` gave the pass (null when it did not reach the guards). */
  passClass: string | null;
  liveCases: number | null;
  newCases: number | null;
  /** Alerts claimed for delivery in this pass (each then fails delivery on purpose, leaving one failure row). */
  alertsClaimed: number;
  /** Deliveries refused on purpose (loopback SMTP); counted here instead of listed under `failures`. */
  deliveriesRefused: number;
}

/** The benchmark's own alert channel refuses every delivery; those are expected, not failures of the pass. */
const DELIVERY_REFUSED = "non-public address";

async function pass(organizationId: string, kind: CycleKind): Promise<PassResult> {
  captured = [];
  const failuresBefore = await prisma.notificationFailure.count({ where: { commitment: { case: { organizationId } } } });
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: ORGANIZATION_TO_PROCESS_SELECT });
  const result = emptyCycleResult(kind);
  const memory = sampleMemory();
  const started = performance.now();
  await processOrganization(prisma, workerConfig, organization as never, {
    kind,
    logger,
    result,
    position: "1/1",
    inFlight: () => 1,
    activePollMs: 300_000,
  });
  const wallMs = Math.round(performance.now() - started);
  const peak = memory.stop();
  const stages: Record<string, StageFigures> = {};
  let queryCount = 0;
  for (const record of captured) {
    if (record.event !== "perf_scope" || record.organizationId !== undefined && record.organizationId !== organizationId) continue;
    const label = String(record.perfScope);
    stages[label] = {
      durationMs: Number(record.durationMs),
      queryCount: Number(record.queryCount),
      queryMs: Number(record.queryMs),
      rowsByModel: (record.rowsByModel as Record<string, number>) ?? {},
    };
    queryCount += Number(record.queryCount);
  }
  const lock = captured.find((r) => r.event === "organization_lock_duration" && r.organizationId === organizationId);
  const classified = captured.find((r) => r.event === "custom_projection_pass" && r.organizationId === organizationId);
  const failuresAfter = await prisma.notificationFailure.count({ where: { commitment: { case: { organizationId } } } });
  return {
    wallMs,
    lockHoldMs: lock ? Number(lock.holdMs) : null,
    lockWaitMs: lock ? Number(lock.waitMs) : null,
    stages,
    queryCount,
    failures: result.failures.filter((f) => !f.error.includes(DELIVERY_REFUSED)).map((f) => `${f.stage}: ${f.error}`.slice(0, 300)),
    deliveriesRefused: result.failures.filter((f) => f.error.includes(DELIVERY_REFUSED)).length,
    ...peak,
    passClass: classified ? String(classified.passClass) : null,
    liveCases: classified ? Number(classified.liveCases) : null,
    newCases: classified ? Number(classified.newCases) : null,
    alertsClaimed: failuresAfter - failuresBefore,
  };
}

/**
 * Alert channels for a benchmarked organization, so the first import claims its
 * real breach alerts inside the lock as production would. Delivery cannot reach
 * anyone: the SMTP host is loopback and alert email is sent to public
 * destinations only, so every send is refused before connecting, and the claim
 * is released with a failure row (counted as `alertsClaimed`).
 */
async function enableAlerting(organizationId: string) {
  await prisma.user.create({ data: { organizationId, email: `owner+${organizationId}@bench.example.test`, passwordHash: "x", role: "owner" } });
  await prisma.organizationEmailSettings.create({
    data: { organizationId, host: "127.0.0.1", port: 9, security: "none", username: "bench", password: encryptSmtpPassword("bench"), fromEmail: "alerts@bench.example.test" },
  });
}

/** After the first import: a later successful pass is recorded, so every following pass is recurring and the source is fresh. */
async function markSynced(integrationId: string) {
  await prisma.integration.update({ where: { id: integrationId }, data: { lastSuccessfulSyncAt: new Date() } });
}

/**
 * One first-import measurement on its own freshly seeded organization. The
 * import can complete on either tick, so it is measured on both kinds; the
 * reconciliation sweep evaluates every commitment (scope `all`) and is the
 * slower one.
 */
async function firstImport(tier: number, seed: number, label: string, cold: boolean, kind: CycleKind) {
  const seeded = await seedTier(prisma, tier, profile, `${label}-${stamp}`, seed);
  await enableAlerting(seeded.organizationId);
  if (cold) {
    await prisma.$disconnect();
    execSync(coldCmd!, { stdio: "ignore" });
    await prisma.$connect();
  }
  gc();
  const r = await pass(seeded.organizationId, kind);
  return { seeded, run: { ...r, seed, cold, kind, seedRawRows: seeded.rawRows } };
}

/**
 * The same import read over two runs: half of the tickets first (import in
 * progress, never synced: stale, breach alerts held), then the rest with the
 * import completed (fresh: alerts claimed). Each pass creates about half.
 */
async function splitImport(tier: number, seed: number, label: string) {
  const seeded = await seedTier(prisma, tier, profile, `${label}-${stamp}`, seed, { deferShare: 0.5, importState: "in_progress" });
  await enableAlerting(seeded.organizationId);
  gc();
  const first = await pass(seeded.organizationId, "reconciliation_sweep");
  await insertRaw(prisma, seeded.deferred);
  await prisma.integration.update({ where: { id: seeded.integrationId }, data: importState("completed") });
  gc();
  const second = await pass(seeded.organizationId, "reconciliation_sweep");
  await prisma.organization.delete({ where: { id: seeded.organizationId } });
  return { seed, first, second };
}

/** Load and derive alone (outside the lock), to split normalization into reading, deriving and the rest. */
async function deriveAlone(integrationId: string) {
  const config = benchConfig();
  const t0 = performance.now();
  const rows = await loadRawRows(prisma, integrationId);
  const t1 = performance.now();
  const derived = deriveBatch(config, rows);
  const t2 = performance.now();
  const events = derived.eventGroups.reduce((n, g) => n + g.events.length, 0);
  return { rawRows: rows.length, loadMs: Math.round(t1 - t0), deriveMs: Math.round(t2 - t1), cases: derived.cases.length, events, failures: derived.failures.length };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s.length % 2 ? s[(s.length - 1) / 2]! : Math.round((s[s.length / 2 - 1]! + s[s.length / 2]!) / 2);
};
/** Nearest-rank p95; with five runs it is the slowest run. */
const p95 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
};
function summarize(runs: PassResult[]) {
  const pick = (f: (r: PassResult) => number | null) => runs.map(f).filter((x): x is number => x !== null);
  const stageNames = [...new Set(runs.flatMap((r) => Object.keys(r.stages)))];
  return {
    runs: runs.length,
    passClasses: [...new Set(runs.map((r) => r.passClass))],
    alertsClaimed: runs.reduce((n, r) => n + r.alertsClaimed, 0),
    wallMs: { median: median(pick((r) => r.wallMs)), p95: p95(pick((r) => r.wallMs)) },
    lockHoldMs: { median: median(pick((r) => r.lockHoldMs)), p95: p95(pick((r) => r.lockHoldMs)) },
    queryCount: { median: median(pick((r) => r.queryCount)), p95: p95(pick((r) => r.queryCount)) },
    peakRssMb: Math.max(...pick((r) => r.peakRssMb)),
    peakHeapMb: Math.max(...pick((r) => r.peakHeapMb)),
    stages: Object.fromEntries(
      stageNames.map((name) => [
        name,
        {
          durationMs: { median: median(pick((r) => r.stages[name]?.durationMs ?? null)), p95: p95(pick((r) => r.stages[name]?.durationMs ?? null)) },
          queryCount: median(pick((r) => r.stages[name]?.queryCount ?? null)),
        },
      ]),
    ),
    failures: [...new Set(runs.flatMap((r) => r.failures))],
  };
}

/** Footprint that an aborted pass must leave untouched: cases, closures, events. */
async function footprint(organizationId: string, integrationId: string) {
  const [cases, closed, events, lastCaseUpdate, lastEvent] = await Promise.all([
    prisma.case.count({ where: { organizationId, sourceIntegrationId: integrationId } }),
    prisma.case.count({ where: { organizationId, sourceIntegrationId: integrationId, closedAt: { not: null } } }),
    prisma.normalizedEvent.count({ where: { case: { organizationId, sourceIntegrationId: integrationId } } }),
    prisma.case.aggregate({ where: { organizationId, sourceIntegrationId: integrationId }, _max: { updatedAt: true } }),
    prisma.normalizedEvent.aggregate({ where: { case: { organizationId, sourceIntegrationId: integrationId } }, _max: { createdAt: true } }),
  ]);
  return { cases, closed, events, lastCaseUpdate: lastCaseUpdate._max.updatedAt?.toISOString() ?? null, lastEvent: lastEvent._max.createdAt?.toISOString() ?? null };
}

let changeSeq = 0;
/** New source activity on `share` of the tickets: an agent reply (a new comment row) on each. */
async function addReplies(seeded: SeededTier, share: number) {
  const config = benchConfig();
  const count = Math.max(1, Math.round(seeded.tickets.length * share));
  const now = new Date();
  changeSeq += 1;
  const rows = seeded.tickets.slice(0, count).map((t) => {
    const comment = { ...commentItem(t, 1, `reply ${changeSeq}`), id: `${t.id}-r${changeSeq}`, at: new Date(now.getTime() - 60_000).toISOString(), author: { type: "agent", name: "Agent" }, public: true };
    return commentRow(config, seeded.integrationId, t.id, comment, now);
  });
  await insertRaw(prisma, rows);
  return count;
}

/** Closes every open ticket at the source (more than 25% of live cases), which the lifecycle guard must reject. */
async function closeOpenTickets(seeded: SeededTier) {
  const config = benchConfig();
  const now = Date.now();
  const open = seeded.tickets.filter((t) => t.closedAt === null);
  await insertRaw(prisma, open.map((t) => snapshotRow(config, seeded.integrationId, ticketItem(t, 99, "solved", now - 60_000), new Date(now))));
  return open.length;
}

/** The proposed-version dry run (N9.12-F1): a priority map change touches every case. */
async function dryRun(organizationId: string) {
  const changed = structuredClone(benchConfigJson) as typeof benchConfigJson;
  changed.valueMaps.priority = { p1: "urgent", p2: "urgent", p3: "high", p4: "normal" };
  const parsed = parseConfig(changed);
  if (!parsed.ok) throw new Error("dry-run config invalid");
  const memory = sampleMemory();
  const t0 = performance.now();
  const diff = await computeConfigDiff(prisma, organizationId, parsed.config);
  return { ms: Math.round(performance.now() - t0), ...memory.stop(), casesChanged: diff.summary.casesChanged, guard: diff.guard };
}

async function concurrency(seeded: SeededTier, neighbour: SeededTier) {
  // Alone: the neighbour organization's poll.
  const alone = await pass(neighbour.organizationId, "active_set_poll");
  // Together: the benchmarked sweep, a webhook-shaped lock wait 200 ms in, and the neighbour's poll in parallel.
  const sweep = pass(seeded.organizationId, "reconciliation_sweep");
  await new Promise((resolve) => setTimeout(resolve, 200));
  const t0 = performance.now();
  const webhook = withOrganizationSlaLock(prisma, seeded.organizationId, async () => undefined).then(() => Math.round(performance.now() - t0));
  const neighbourStarted = performance.now();
  // `pass` resets the shared capture, so the neighbour is timed by wall clock only.
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: neighbour.organizationId }, select: ORGANIZATION_TO_PROCESS_SELECT });
  await processOrganization(prisma, workerConfig, organization as never, { kind: "active_set_poll", logger, result: emptyCycleResult("active_set_poll"), position: "2/2", inFlight: () => 2, activePollMs: 300_000 });
  const neighbourMs = Math.round(performance.now() - neighbourStarted);
  const [sweepResult, webhookWaitMs] = await Promise.all([sweep, webhook]);
  return { sweepWallMs: sweepResult.wallMs, sweepLockHoldMs: sweepResult.lockHoldMs, webhookBlockedMs: webhookWaitMs, neighbourAloneMs: alone.wallMs, neighbourConcurrentMs: neighbourMs };
}

/** A second configuration version whose priority map moves every case (as the dry run's proposal does). */
async function addChangedVersion(seeded: SeededTier) {
  const changed = structuredClone(benchConfigJson) as typeof benchConfigJson;
  changed.valueMaps.priority = { p1: "urgent", p2: "urgent", p3: "high", p4: "normal" };
  await prisma.customProviderConfigVersion.create({
    data: { organizationId: seeded.organizationId, integrationId: seeded.integrationId, version: 2, schemaVersion: changed.schemaVersion, config: changed as never, configHash: "bench-v2", validatedAt: new Date(), note: "benchmark: changed priority map" },
  });
}

async function rawBytes(integrationId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ bytes: bigint | null }[]>(`SELECT sum(pg_column_size(payload))::bigint AS bytes FROM raw_events WHERE "integrationId" = $1`, integrationId);
  return Number(rows[0]?.bytes ?? 0);
}

async function environment(db: PrismaClient) {
  const [version] = await db.$queryRawUnsafe<{ version: string }[]>("SELECT version()");
  const settings = await db.$queryRawUnsafe<{ name: string; setting: string; unit: string | null }[]>(
    "SELECT name, setting, unit FROM pg_settings WHERE name IN ('shared_buffers','work_mem','effective_cache_size','max_connections','synchronous_commit')",
  );
  return {
    node: process.version,
    platform: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    cpuCount: cpus().length,
    memoryGb: Math.round(totalmem() / 1073741824),
    postgres: version?.version ?? "unknown",
    // `setting` is in multiples of `unit` (shared_buffers: 16384 × 8kB = 128 MB), never the two run together.
    postgresSettings: Object.fromEntries(settings.map((s) => [s.name, s.unit ? `${s.setting} x ${s.unit}` : s.setting])),
    coldCacheCommand: coldCmd ?? null,
    database: databaseName,
    liveCaseCeilingConfigured: process.env.CUSTOM_PROVIDER_LIVE_CASE_CEILING ?? null,
  };
}

async function main() {
  const report: Record<string, unknown> = { startedAt: new Date().toISOString(), profile, reps, firstImportReps, splitReps, environment: await environment(prisma), tiers: {} };
  const out = join(values.out!, `${stamp}-${profile.name}.json`);
  const save = () => writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  for (const tier of tiers) {
    const t: Record<string, unknown> = {};
    (report.tiers as Record<string, unknown>)[tier] = t;

    // The first import, measured on independently seeded organizations (each its own data),
    // on the reconciliation sweep (the slower kind; the cold run too) and on the active poll.
    const firstImports: (PassResult & { seed: number; cold: boolean; kind: CycleKind; seedRawRows: number })[] = [];
    if (coldCmd) {
      progress(`tier ${tier}: first import, cold cache (reconciliation_sweep)`);
      const cold = await firstImport(tier, 101, `${profile.name}-${tier}-cold`, true, "reconciliation_sweep");
      firstImports.push(cold.run);
      await prisma.organization.delete({ where: { id: cold.seeded.organizationId } });
      t.firstImportRuns = firstImports;
      save();
    }
    for (let i = 0; i < firstImportReps; i += 1) {
      progress(`tier ${tier}: first import ${i + 1}/${firstImportReps} (fresh seed, active_set_poll)`);
      const warm = await firstImport(tier, 51 + i, `${profile.name}-${tier}-fip${i + 1}`, false, "active_set_poll");
      firstImports.push(warm.run);
      await prisma.organization.delete({ where: { id: warm.seeded.organizationId } });
      t.firstImportRuns = firstImports;
      save();
    }
    let seeded: SeededTier | null = null;
    for (let i = 0; i < firstImportReps; i += 1) {
      progress(`tier ${tier}: first import ${i + 1}/${firstImportReps} (fresh seed, reconciliation_sweep)`);
      const warm = await firstImport(tier, i + 1, `${profile.name}-${tier}-fis${i + 1}`, false, "reconciliation_sweep");
      firstImports.push(warm.run);
      // The last one stays: it is the organization every later pass runs on.
      if (i < firstImportReps - 1) await prisma.organization.delete({ where: { id: warm.seeded.organizationId } });
      else seeded = warm.seeded;
      t.firstImportRuns = firstImports;
      save();
    }
    if (!seeded) throw new Error("no first import ran");
    const warmSweep = firstImports.filter((r) => !r.cold && r.kind === "reconciliation_sweep");
    const warmPoll = firstImports.filter((r) => !r.cold && r.kind === "active_set_poll");
    t.firstImport = { ...summarize(warmSweep), alertsClaimedPerRun: warmSweep.map((r) => r.alertsClaimed) };
    t.firstImportPoll = { ...summarize(warmPoll), alertsClaimedPerRun: warmPoll.map((r) => r.alertsClaimed) };
    t.firstImportCold = firstImports.find((r) => r.cold) ?? null;
    // Kept for the earlier report's tables: the first pass of the organization the tier continues on.
    t.firstPass = firstImports[firstImports.length - 1];
    t.rawRows = seeded.rawRows;
    t.rawPayloadBytes = await rawBytes(seeded.integrationId);
    t.afterFirstPass = await footprint(seeded.organizationId, seeded.integrationId);
    // Steady state: alerts already went out with the import, so the later passes run without channels, as before.
    await prisma.organizationEmailSettings.deleteMany({ where: { organizationId: seeded.organizationId } });
    save();

    if (splitReps > 0) {
      const split = [];
      for (let i = 0; i < splitReps; i += 1) {
        progress(`tier ${tier}: import over two runs ${i + 1}/${splitReps}`);
        split.push(await splitImport(tier, 201 + i, `${profile.name}-${tier}-split${i + 1}`));
      }
      t.splitImport = { first: summarize(split.map((x) => x.first)), second: summarize(split.map((x) => x.second)), runs: split };
      save();
    }

    const neighbour = await seedTier(prisma, 500, PROFILES.base, `neighbour-${tier}-${stamp}`, 2);
    await markSynced(neighbour.integrationId);
    await markSynced(seeded.integrationId);

    for (const kind of ["reconciliation_sweep", "active_set_poll"] as const) {
      progress(`tier ${tier}: steady ${kind} x${reps}`);
      const runs: PassResult[] = [];
      for (let i = 0; i < reps; i += 1) {
        await markSynced(seeded.integrationId);
        const r = await pass(seeded.organizationId, kind);
        gc();
        r.heapAfterGcMb = Math.round(process.memoryUsage().heapUsed / 1048576);
        runs.push(r);
      }
      t[`steady_${kind}`] = { ...summarize(runs), heapAfterGcMb: runs.map((r) => r.heapAfterGcMb) };
      save();
    }

    progress(`tier ${tier}: load + derive alone x3`);
    const alone = [];
    for (let i = 0; i < 3; i += 1) alone.push(await deriveAlone(seeded.integrationId));
    t.deriveAlone = { loadMs: median(alone.map((a) => a.loadMs)), deriveMs: median(alone.map((a) => a.deriveMs)), rawRows: alone[0]!.rawRows, cases: alone[0]!.cases, events: alone[0]!.events, failures: alone[0]!.failures };
    save();

    for (const share of [0.01, 0.05, 0.25]) {
      progress(`tier ${tier}: ${share * 100}% changed x${reps}`);
      const runs: PassResult[] = [];
      for (let i = 0; i < reps; i += 1) {
        await addReplies(seeded, share);
        await markSynced(seeded.integrationId);
        runs.push(await pass(seeded.organizationId, "active_set_poll"));
      }
      t[`changed_${share * 100}pct`] = summarize(runs);
      save();
    }

    // Forced re-projections of existing cases: recurring passes, held to the recurring limit (N9.7-F1).
    progress(`tier ${tier}: operator re-normalization x${reps}`);
    {
      const runs: PassResult[] = [];
      for (let i = 0; i < reps; i += 1) {
        await prisma.integration.update({ where: { id: seeded.integrationId }, data: { renormalizeRequestedAt: new Date(), lastSuccessfulSyncAt: new Date() } });
        runs.push(await pass(seeded.organizationId, "active_set_poll"));
      }
      t.forcedRenormalize = summarize(runs);
      save();
    }
    progress(`tier ${tier}: version activation / rollback x${reps} (every case changes)`);
    {
      await addChangedVersion(seeded);
      const runs: PassResult[] = [];
      for (let i = 0; i < reps; i += 1) {
        // Alternate 2, 1, 2, …: an activation then a rollback, each moving every case's priority.
        await prisma.integration.update({ where: { id: seeded.integrationId }, data: { activeConfigVersion: i % 2 === 0 ? 2 : 1, lastSuccessfulSyncAt: new Date() } });
        // On the sweep, the slower kind: every case changes and every commitment is evaluated.
        runs.push(await pass(seeded.organizationId, "reconciliation_sweep"));
      }
      await prisma.integration.update({ where: { id: seeded.integrationId }, data: { activeConfigVersion: 1 } });
      if (reps % 2 === 1) {
        await markSynced(seeded.integrationId);
        await pass(seeded.organizationId, "active_set_poll"); // back on version 1 before the next scenario (not measured)
      }
      t.forcedActivation = summarize(runs);
      save();
    }

    progress(`tier ${tier}: dry-run diff x3`);
    const dry = [];
    for (let i = 0; i < 3; i += 1) dry.push(await dryRun(seeded.organizationId));
    t.dryRunDiff = { ms: { median: median(dry.map((d) => d.ms)), p95: p95(dry.map((d) => d.ms)) }, peakRssMb: Math.max(...dry.map((d) => d.peakRssMb)), peakHeapMb: Math.max(...dry.map((d) => d.peakHeapMb)), casesChanged: dry[0]!.casesChanged, guard: dry[0]!.guard };
    save();

    progress(`tier ${tier}: concurrency x3`);
    const conc = [];
    for (let i = 0; i < 3; i += 1) {
      await markSynced(seeded.integrationId);
      conc.push(await concurrency(seeded, neighbour));
    }
    t.concurrency = conc;
    save();

    progress(`tier ${tier}: guard abort x${reps}`);
    const closing = await closeOpenTickets(seeded);
    const before = await footprint(seeded.organizationId, seeded.integrationId);
    const runs: PassResult[] = [];
    for (let i = 0; i < reps; i += 1) {
      await markSynced(seeded.integrationId);
      runs.push(await pass(seeded.organizationId, "active_set_poll"));
    }
    const after = await footprint(seeded.organizationId, seeded.integrationId);
    t.guardAbort = { ticketsClosedAtSource: closing, ...summarize(runs), footprintBefore: before, footprintAfter: after, unchanged: JSON.stringify(before) === JSON.stringify(after) };
    save();

    if (!values["keep-data"]) {
      progress(`tier ${tier}: removing the benchmark organizations`);
      await prisma.organization.deleteMany({ where: { id: { in: [seeded.organizationId, neighbour.organizationId] } } });
    }
  }
  report.finishedAt = new Date().toISOString();
  save();
  progress(`done: ${out}`);
  await prisma.$disconnect();
  logFile.end();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
