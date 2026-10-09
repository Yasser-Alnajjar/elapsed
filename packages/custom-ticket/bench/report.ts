/**
 * Renders the Markdown tables of the §6.10 benchmark report from one or more
 * `run.ts` result files: `pnpm --filter @sla/custom-ticket exec tsx bench/report.ts results/<file>.json …`.
 * It formats; it never edits a figure.
 */
import { readFileSync } from "node:fs";
import { FIRST_IMPORT_LOCK_HOLD_BOUND_MS, ORGANIZATION_SWEEP_LIMIT_MS, RECURRING_LOCK_HOLD_LIMIT_MS } from "../src/pass-class";

interface Cell {
  median: number;
  p95: number;
}
interface Summary {
  runs: number;
  wallMs: Cell;
  lockHoldMs: Cell;
  queryCount: Cell;
  peakRssMb: number;
  peakHeapMb: number;
  stages: Record<string, { durationMs: Cell; queryCount: number }>;
  failures: string[];
  heapAfterGcMb?: number[];
  passClasses?: (string | null)[];
  alertsClaimed?: number;
}
interface Pass {
  wallMs: number;
  lockHoldMs: number | null;
  passClass?: string | null;
  alertsClaimed?: number;
  cold?: boolean;
  seed?: number;
  kind?: string;
  queryCount: number;
  peakRssMb: number;
  stages: Record<string, { durationMs: number; queryCount: number }>;
}
type Tier = Record<string, unknown> & {
  rawRows: number;
  rawPayloadBytes: number;
  firstPass: Pass;
  afterFirstPass: { cases: number; events: number };
  deriveAlone: { loadMs: number; deriveMs: number; events: number };
  dryRunDiff: { ms: Cell; peakRssMb: number; casesChanged: number };
  concurrency: { sweepLockHoldMs: number; webhookBlockedMs: number; neighbourAloneMs: number; neighbourConcurrentMs: number }[];
  guardAbort: Summary & { unchanged: boolean; ticketsClosedAtSource: number };
};

const s = (ms: number) => (ms / 1000).toFixed(1);
const cell = (c: Cell) => `${s(c.median)} / ${s(c.p95)}`;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] ?? 0;

for (const file of process.argv.slice(2)) {
  const report = JSON.parse(readFileSync(file, "utf8")) as { profile: { name: string }; environment: Record<string, unknown>; tiers: Record<string, Tier> };
  const tiers = Object.entries(report.tiers).filter(([, t]) => t.guardAbort);
  console.log(`\n### Profile \`${report.profile.name}\` (${file.split("/").pop()})\n`);
  console.log("| Live cases | Raw rows | Raw payload | Events | First pass: lock hold (s) | Sweep: lock hold median / p95 (s) | Poll: lock hold median / p95 (s) | Poll queries | Peak RSS (MB) |");
  console.log("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const [n, t] of tiers) {
    const sweep = t.steady_reconciliation_sweep as Summary;
    const poll = t.steady_active_set_poll as Summary;
    console.log(
      `| ${Number(n).toLocaleString("en")} | ${t.rawRows.toLocaleString("en")} | ${(t.rawPayloadBytes / 1048576).toFixed(1)} MB | ${t.afterFirstPass.events.toLocaleString("en")} | ${s(t.firstPass.lockHoldMs ?? 0)} | ${cell(sweep.lockHoldMs)} | ${cell(poll.lockHoldMs)} | ${poll.queryCount.median.toLocaleString("en")} | ${Math.max(sweep.peakRssMb, poll.peakRssMb)} |`,
    );
  }

  console.log("\n**Stages of the steady sweep (median ms; queries)**\n");
  const stageNames = ["worker_normalize", "worker_commitment", "worker_re_resolution", "worker_next_reply", "worker_evaluate", "worker_notify_claim", "worker_notify"];
  console.log(`| Live cases | load raw (ms) | deriveBatch (ms) | ${stageNames.map((n) => n.replace("worker_", "")).join(" | ")} |`);
  console.log(`| ---: | ---: | ---: | ${stageNames.map(() => "---:").join(" | ")} |`);
  for (const [n, t] of tiers) {
    const sweep = t.steady_reconciliation_sweep as Summary;
    console.log(
      `| ${Number(n).toLocaleString("en")} | ${t.deriveAlone.loadMs} | ${t.deriveAlone.deriveMs} | ${stageNames.map((name) => (sweep.stages[name] ? `${sweep.stages[name]!.durationMs.median} (${sweep.stages[name]!.queryCount})` : "—")).join(" | ")} |`,
    );
  }

  console.log("\n**Incremental activity, abort path, dry run, concurrency (lock hold median / p95, s)**\n");
  console.log("| Live cases | 1% changed | 5% changed | 25% changed | Guard abort (writes nothing?) | Dry-run diff (s) | Webhook blocked (median ms) | Neighbour org poll alone / concurrent (median ms) | Heap after GC across reps (MB) |");
  console.log("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const [n, t] of tiers) {
    const c = t.concurrency;
    const heap = (t.steady_reconciliation_sweep as Summary).heapAfterGcMb ?? [];
    console.log(
      `| ${Number(n).toLocaleString("en")} | ${cell((t.changed_1pct as Summary).lockHoldMs)} | ${cell((t.changed_5pct as Summary).lockHoldMs)} | ${cell((t.changed_25pct as Summary).lockHoldMs)} | ${cell(t.guardAbort.lockHoldMs)} (${t.guardAbort.unchanged ? "yes" : "NO"}) | ${cell(t.dryRunDiff.ms)} | ${median(c.map((x) => x.webhookBlockedMs))} | ${median(c.map((x) => x.neighbourAloneMs))} / ${median(c.map((x) => x.neighbourConcurrentMs))} | ${heap.join(", ")} |`,
    );
  }
  // N9.7-F1 sections exist only in runs made with the first-import harness.
  const fiTiers = tiers.filter(([, t]) => t.firstImport);
  if (fiTiers.length > 0) {
    console.log("\n**First import (initial projection), lock hold (s); each run on its own freshly seeded organization**\n");
    console.log("| Live cases | Sweep tick: warm runs (s) | Sweep tick: median / p95 (s) | Poll tick: median / p95 (s) | Cold run, sweep tick (s) | Wall, slowest run (s) | Two-run import: first / second pass p95 (s) | Alerts claimed per run (sweep tick) | Pass class |");
    console.log("| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |");
    for (const [n, t] of fiTiers) {
      const fi = t.firstImport as Summary;
      const fiPoll = t.firstImportPoll as Summary | undefined;
      const all = t.firstImportRuns as Pass[];
      const runs = all.filter((r) => !r.cold && (r.kind ?? "reconciliation_sweep") === "reconciliation_sweep");
      const cold = t.firstImportCold as Pass | null;
      const split = t.splitImport as { first: Summary; second: Summary } | undefined;
      const classes = [...new Set([...(t.firstImportRuns as Pass[]).map((r) => r.passClass), ...(split ? [...(split.first.passClasses ?? []), ...(split.second.passClasses ?? [])] : [])])];
      console.log(
        `| ${Number(n).toLocaleString("en")} | ${runs.map((r) => s(r.lockHoldMs ?? 0)).join(", ")} | ${cell(fi.lockHoldMs)} | ${fiPoll ? cell(fiPoll.lockHoldMs) : "not run"} | ${cold ? s(cold.lockHoldMs ?? 0) : "not run"} | ${s(Math.max(...all.map((r) => r.wallMs)))} | ${split ? `${s(split.first.lockHoldMs.p95)} / ${s(split.second.lockHoldMs.p95)}` : "not run"} | ${runs.map((r) => r.alertsClaimed ?? 0).join(", ")} | ${classes.join(", ")} |`,
      );
    }

    console.log("\n**Forced re-projections of existing cases (lock hold median / p95, s)**\n");
    console.log("| Live cases | Operator re-normalization | Version activation / rollback (every case changes) | Pass class |");
    console.log("| ---: | ---: | ---: | --- |");
    for (const [n, t] of fiTiers) {
      const renorm = t.forcedRenormalize as Summary;
      const act = t.forcedActivation as Summary;
      console.log(`| ${Number(n).toLocaleString("en")} | ${cell(renorm.lockHoldMs)} | ${cell(act.lockHoldMs)} | ${[...new Set([...(renorm.passClasses ?? []), ...(act.passClasses ?? [])])].join(", ")} |`);
    }

    console.log(`\n**Acceptance (N9.7-F1): recurring lock hold ≤ ${RECURRING_LOCK_HOLD_LIMIT_MS / 1000} s p95, first import ≤ ${FIRST_IMPORT_LOCK_HOLD_BOUND_MS / 1000} s (slowest of warm and cold runs), organization sweep ≤ ${ORGANIZATION_SWEEP_LIMIT_MS / 1000} s p95**\n`);
    console.log("| Live cases | Slowest recurring p95 (s), pass | First import, slowest run (s) | Slowest sweep wall p95 (s) | Every pass classified as expected | Verdict |");
    console.log("| ---: | ---: | ---: | ---: | --- | --- |");
    for (const [n, t] of fiTiers) {
      const recurring: [string, Summary][] = [
        ["sweep", t.steady_reconciliation_sweep as Summary],
        ["poll", t.steady_active_set_poll as Summary],
        ["1% changed", t.changed_1pct as Summary],
        ["5% changed", t.changed_5pct as Summary],
        ["25% changed", t.changed_25pct as Summary],
        ["re-normalization", t.forcedRenormalize as Summary],
        ["activation / rollback", t.forcedActivation as Summary],
        ["guard abort", t.guardAbort],
      ];
      const [worstName, worst] = recurring.reduce((a, b) => (b[1].lockHoldMs.p95 > a[1].lockHoldMs.p95 ? b : a));
      const firstRuns = t.firstImportRuns as Pass[];
      const split = t.splitImport as { first: Summary; second: Summary } | undefined;
      const firstSlowest = Math.max(...firstRuns.map((r) => r.lockHoldMs ?? Infinity), split ? Math.max(split.first.lockHoldMs.p95, split.second.lockHoldMs.p95) : 0);
      const sweepWall = Math.max(...recurring.map(([, r]) => r.wallMs.p95), ...firstRuns.map((r) => r.wallMs));
      const classesOk =
        firstRuns.every((r) => r.passClass === "initial_projection") &&
        (!split || [...(split.first.passClasses ?? []), ...(split.second.passClasses ?? [])].every((c) => c === "initial_projection")) &&
        recurring.every(([, r]) => (r.passClasses ?? []).every((c) => c === "recurring"));
      const pass = worst.lockHoldMs.p95 <= RECURRING_LOCK_HOLD_LIMIT_MS && firstSlowest <= FIRST_IMPORT_LOCK_HOLD_BOUND_MS && sweepWall <= ORGANIZATION_SWEEP_LIMIT_MS && classesOk;
      console.log(`| ${Number(n).toLocaleString("en")} | ${s(worst.lockHoldMs.p95)} (${worstName}) | ${s(firstSlowest)} | ${s(sweepWall)} | ${classesOk ? "yes" : "NO"} | **${pass ? "pass" : "FAIL"}** |`);
    }
  }
  console.log(`\nEnvironment: \`${JSON.stringify(report.environment)}\``);
}
