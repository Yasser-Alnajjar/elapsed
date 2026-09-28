import { AsyncLocalStorage } from "node:async_hooks";
import { createLogger } from "@sla/logger";

/**
 * Work counters for roadmap 7.7 (performance-plan.md Phase 0). Gated by
 * `PERF_METRICS=1` so instrumentation never runs in normal dev/prod — every
 * function here is a no-op otherwise, including the Prisma query hook
 * installed in `index.ts`.
 */
const enabled = process.env.PERF_METRICS === "1";

interface PerfCounters {
  queryCount: number;
  queryMs: number;
  rowsByModel: Record<string, number>;
  evaluationsByName: Record<string, number>;
}

interface PerfStore {
  label: string;
  startedAt: number;
  counters: PerfCounters;
}

const storage = new AsyncLocalStorage<PerfStore>();

function emptyCounters(): PerfCounters {
  return { queryCount: 0, queryMs: 0, rowsByModel: {}, evaluationsByName: {} };
}

export function isPerfMetricsEnabled(): boolean {
  return enabled;
}

/**
 * Records one Prisma query's duration and row count against the model it
 * hit. Called from the `$extends` query hook installed on the shared client
 * in `index.ts` — never called directly by application code.
 */
export function recordPerfQuery(
  model: string | undefined,
  durationMs: number,
  rows: number,
): void {
  if (!enabled) return;
  const store = storage.getStore();
  if (!store) return;
  store.counters.queryCount += 1;
  store.counters.queryMs += durationMs;
  if (model)
    store.counters.rowsByModel[model] =
      (store.counters.rowsByModel[model] ?? 0) + rows;
}

/**
 * Records `n` JS evaluations under `name` (e.g. `evaluateCommitment`,
 * `deriveLegSpans`). Called at web/worker call sites — never inside
 * `packages/core`, which stays pure and knows nothing about metrics.
 */
export function perfCount(name: string, n = 1): void {
  if (!enabled) return;
  const store = storage.getStore();
  if (!store) return;
  store.counters.evaluationsByName[name] =
    (store.counters.evaluationsByName[name] ?? 0) + n;
}

/**
 * Runs `fn` inside a fresh, isolated counters scope and logs one summary
 * line through `createLogger` when it settles. A pass-through no-op when
 * `PERF_METRICS` isn't set, so call sites don't need their own guard.
 * Scopes don't nest their counters — a scope started inside another only
 * reports its own work, which matches how this phase's scopes are placed
 * (one per page loader, one per worker stage) rather than aggregated.
 */
export async function withPerfScope<T>(
  label: string,
  fn: () => Promise<T>,
  fields: Record<string, unknown> = {},
): Promise<T> {
  if (!enabled) return fn();
  const store: PerfStore = {
    label,
    startedAt: performance.now(),
    counters: emptyCounters(),
  };
  return storage.run(store, async () => {
    try {
      return await fn();
    } finally {
      const durationMs = Math.round(performance.now() - store.startedAt);
      createLogger({ perfScope: label, ...fields }).info("perf_scope", {
        durationMs,
        queryCount: store.counters.queryCount,
        queryMs: Math.round(store.counters.queryMs),
        rowsByModel: store.counters.rowsByModel,
        evaluations: store.counters.evaluationsByName,
      });
    }
  });
}

function countRows(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  if (typeof result === "number") return result;
  if (result && typeof result === "object") return 1;
  return 0;
}

/**
 * Installs the query-counting `$extends` hook on `client` when
 * `PERF_METRICS=1`; returns `client` unchanged otherwise. Applied once, to
 * the shared singleton, in `getPrismaClient()`. Typed loosely (`any` in,
 * `any` out) because the precise return type of `$extends` is an opaque
 * client-extension type that the caller immediately casts back to
 * `PrismaClient` — this function only ever wraps that one singleton.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withPerfMetrics(client: any): any {
  if (!enabled) return client;
  return client.$extends({
    name: "perf-metrics",
    query: {
      $allModels: {
        async $allOperations({
          model,
          query,
          args,
        }: {
          model?: string;
          operation: string;
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) {
          const startedAt = performance.now();
          const result = await query(args);
          recordPerfQuery(
            model,
            performance.now() - startedAt,
            countRows(result),
          );
          return result;
        },
      },
    },
  });
}
