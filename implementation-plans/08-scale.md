# N8 — Scale (Trigger-Based): Implementation Plan

> **Roadmap phase:** [N8 in `ROADMAP_Product.md`](ROADMAP_Product.md#phase-n8--scale). Task status lives in the roadmap. This file explains **how**.
> **Depends on:** [N3](03-provider-isolation-and-freshness.md) for tick and duration metrics. It is last in the roadmap chain.
> **Trigger-based (roadmap D21).** Each item below starts only when its trigger metric fires. Nothing here is built speculatively.
> **Source:** `plans/03-Product-and-MVP.md` Phase 10b ("Known scale limits" and "Scale work, in order"), plus roadmap backlog items R-7 and S-7. **Estimate:** per item, when triggered. **Branch:** `phase/n8-<item>` per triggered item.

---

## 1. Objective

Keep freshness and correctness intact as tenant count and data volume grow, by fixing the limit that is **measured** to bite next, in the order it bites.

## 2. Principles (from `plans/03` Phase 10b)

1. Snapshots for reading, live evaluation for looking. Do not regress this.
2. Bound the work per tick, then parallelise.
3. Never hard-stop monitoring for a tenant.
4. Measure before indexing (`EXPLAIN ANALYZE`, `PERF_METRICS=1`).
5. The engine stays pure. Scale work never adds I/O to `@sla/core`.
6. Scale the business before the system.
7. **Additional:** every change to the evaluation scope must pass L1 replay (N1 harness) with 0 class-A differences.

## 3. Measurement tooling (already in the repo)

- `pnpm --filter @sla/web perf:baseline` (`apps/web/scripts/perf-baseline-capture.ts`)
- `pnpm --filter @sla/worker perf:baseline` (`apps/worker/scripts/perf-baseline-cycle.ts`), scoped with `PERF_ORG_ID`
- `pnpm db:seed:perf-baseline` (`packages/db/src/scripts/seed-perf-baseline.ts`)
- `PERF_METRICS=1` counters (`packages/db/src/perf-metrics.ts`); lock wait/hold logging (`packages/db/src/organization-lock.ts`)
- Tick and integration durations from N3.6
- Performance history: [`plans/performance-plan.md`](../plans/performance-plan.md) and roadmap task 7.7

## 4. Items, each with its trigger

| # | Limit | Trigger | Work | Verify |
|---|---|---|---|---|
| S1 | Single worker, all tenants serial | Active-poll tick p95 > 50% of the interval for 7 days, or one tenant > 25% of the tick | Per-org time budget and round-robin fairness in `apps/worker/src/cycle.ts`, **before** adding workers | Worker perf baseline with a multi-org seed; tick p95 back under 50% |
| S2 | Provider rate limits on large backfills | A customer backfill taking > 4 h, or repeated 429s in logs | Resumable, rate-aware backfill with live counts (also serves N5 onboarding) | Backfill resumes after a worker restart without re-fetching |
| S3 | Evaluation loads every event of every active commitment | Org sweep > 30 s, or org lock hold > 10 s (`organization-lock.ts` logs) | Evaluate only commitments whose events, policy or calendar changed since the last tick (deferred follow-up recorded in 7.7 Phase 3) | **L1 replay 0 differences** at several `asOf` points; perf baseline |
| S4 | Org-level SLA lock held for the whole sweep | Webhook latency p95 > 30 s for large tenants | Per-chunk lock in the sweep | `organization-lock.test.ts`; `scoped-pipelines.test.ts` |
| S5 | Web is single-instance (per-instance rate limiting) | Sustained traffic, or an availability commitment to a customer | Shared rate limiting (`lib/rate-limit.ts`, `auth-rate-limit.ts`) in Postgres, then 2+ web instances behind `apps/nginx` (R-7) | Rate-limit tests across two instances |
| S6 | Unbounded `RawEvent` / `NormalizedEvent` / `Evaluation` growth | Backup or restore time > 30 min (`docs/restore-drills.log`), or analytics query p95 regressions | Retention policy (depends on H-5), time partitioning of `Evaluation` and `RawEvent`, archive raw events past the **replay horizon** (decided with H-5; replay needs raw events) | Restore drill timing; replay still possible within the horizon |
| S7 | Encryption keys cannot rotate without downtime | First security questionnaire requiring rotation, or a suspected key exposure | Dual-key read during rotation (S-7), extending `packages/db/src/crypto.ts` and `scripts/rotate-secrets.sh` | Rotation drill without downtime |
| S8 | Postgres as queue, lock manager and store | Contention visible after S1–S4 | Read replica for analytics first; a real queue is a last resort | Measured contention drop |

## 5. Process per triggered item

1. Record the trigger evidence (metric, date) in the roadmap's N8 row.
2. Capture a perf baseline and, for S3/S4, a replay baseline.
3. Implement on `phase/n8-<item>`.
4. Re-run the baseline and replay; attach numbers to the PR.
5. Update `plans/performance-plan.md` with the new measurements.

## 6. Verification commands

```bash
pnpm db:seed:perf-baseline
PERF_ORG_ID=<org> pnpm --filter @sla/worker perf:baseline
pnpm --filter @sla/web perf:baseline
pnpm --filter @sla/commitments replay:compare -- <baseline.jsonl> <after.jsonl>
scripts/restore-drill.sh
pnpm test
```

## 7. Acceptance criteria (per item)

- The trigger metric is back under its threshold.
- Replay is clean where evaluation is touched.
- No regression in the other perf-baseline surfaces.

## 8. Out of scope until measured

- Horizontal worker scaling.
- A queue system.
- Sharding.
- Caching layers.
- Indexes without `EXPLAIN ANALYZE` evidence.
