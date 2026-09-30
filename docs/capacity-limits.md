# Capacity limits (H-7)

**Measured:** 2026-09-29 · **Tooling:** `pnpm db:seed:perf-baseline`, `pnpm --filter @sla/web perf:baseline <orgId>`, `PERF_ORG_ID=<orgId> pnpm --filter @sla/worker perf:baseline` (work counters via `PERF_METRICS=1`; see [`plans/performance-plan.md`](../plans/performance-plan.md)).

**Where.** Apple M4, 16 GB, Postgres 16 in Docker (8 CPUs / 12 GB to Docker), the disposable `sla_test` database, web loaders and the worker cycle called in-process (no HTTP, no network, no nginx). Three fresh single-organization datasets, 40 events per case. **These are not production-host numbers.** The EC2 instance size is not recorded in the repo, so treat every figure as "on a fast laptop, one org, warm cache". Absolute times on the production host will differ; the **scaling shape** (how each figure grows with cases) should hold. Confirm on the host with the same commands if the number matters.

## Web page loaders (one organization, warm second run)

| Cases / events | `/dashboard` | `/cases` (page 1) | `/at-risk` (page 1) | `/cases/[id]` |
| --- | --- | --- | --- | --- |
| 1,000 / ~40k | 893 ms | 28 ms | 62 ms | 47 ms |
| 5,000 / 199k | 1,884–2,591 ms | 25 ms | 60–66 ms | 115–231 ms |
| 10,000 / ~400k | 3,547 ms | 34 ms | 85 ms | 264 ms |

- `/cases`, `/at-risk` and `/cases/[id]` are effectively flat: they read persisted status, paginate first and live-evaluate at most one page (50 evaluations at most).
- **`/dashboard` is the one surface that still grows linearly with the organization**: 185k NormalizedEvents loaded at 5k cases and 370k at 10k, and 5,229 / 10,425 `deriveLegSpans` calls (the by-stage breakdown in `dashboard-data.ts`, which loads the events of every case with a commitment in the period). Roughly 0.35 ms per case. Phase 2 of the performance plan expected this page to load 0 events; **it does not**, and the roadmap's Phase 2 notes did not record a post-Phase-2 baseline that would have shown it. This is a known limit, not fixed here.

## Worker cycle (one organization, sequential stages)

| Cases | poll: next-reply | poll: evaluate | poll: org lock held | sweep: next-reply | sweep: evaluate | sweep: org lock held |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 572 ms | 440 ms | 1.3 s | 440 ms | 743 ms | 1.3 s |
| 5,000 | 2,017 ms | 4,371 ms | 6.9 s | 1,724 ms | 3,340 ms | 5.5 s |
| 10,000 | 4,660 ms | 3,964 ms | 10.4 s | 8,041 ms | 7,977 ms | 17.6 s |

- Query counts stay tiny (8–17 per stage) after the Phase 3 batching; the cost is loading and evaluating events: 199k NormalizedEvents scanned by next-reply on every poll at 5k cases, and 4,710 of 10,000 commitments re-evaluated in the poll.
- The poll's "active" scope narrows little on this seed (about 80% of seeded cases are open). A real tenant with a lower open ratio will do less; a tenant whose cases mostly stay open will not.
- **The organization SLA lock is held for the whole tick** (evaluate included): 6.9 s at 5k cases, 17.6 s at 10k (sweep). While it is held, webhooks for that organization wait for it.
- The default poll interval is 5 minutes and the sweep runs every 30 minutes at most (`packages/db/src/worker-settings.ts`), so a single 10k-case organization uses roughly 3.5% of each poll window and about 1% of the half hour in sweeps, on this hardware. At a 10-second poll interval this organization's poll (10 s at 10k cases) would run back to back; with per-organization leases that only ever occupies one worker slot and no longer delays any other organization.

## Many organizations (10 organizations × 500 cases, ~40 events per case)

The shape of today's 10 live tenants if each were small. One worker run scoped to 10 seeded organizations (`PERF_ORG_ID=<id1>,<id2>,…`), both cycle kinds back to back:

| | Total wall (both cycles, incl. process start) | Org lock held per org, poll | Org lock held per org, sweep |
| --- | --- | --- | --- |
| 10 orgs × 500 cases | 14.8 s | 0.5 s avg (max 0.75 s), 5.3 s total | 0.74 s avg (max 0.97 s), 7.4 s total |

Those numbers are from one process cycling the organizations one after another, so tick time was the sum over organizations: about 0.5 s of poll work per 500-case organization here. Workers now process organizations independently (up to `ORGANIZATION_CONCURRENCY` at once per worker, and as many workers as you run), so that sum is the total work to spread rather than the time any one organization waits. The lock is per organization, so a large tenant does not block a small one's webhooks; it does lengthen the total tick.

## Stated limits (what the numbers support, and no more)

| Dimension | Comfortable | Degrading | Basis |
| --- | --- | --- | --- |
| Cases per organization | up to ~5,000 (dashboard under ~3 s, lock hold under ~7 s) | 10,000 (dashboard 3.5 s, sweep lock 17.6 s) | measured above |
| Cases per organization, beyond 10,000 | not measured | — | extrapolating the linear trend gives a dashboard of about 7 s at 20k, not verified |
| Number of organizations | 10 organizations of 500 cases: poll pass 5.3 s of lock time in total, sweep 7.4 s | not measured beyond 10 | multi-org run above; tick time is the sum over organizations |
| Concurrent web users | **not measured** | — | the loaders were run one at a time in-process; no load test was run and no throughput claim is made |
| Web pages other than the dashboard | flat to 10k cases | — | measured above |

Nothing here has been checked against the 10 live tenants' real sizes: their case and event counts are not recorded in the repo (see H-1).

## Not done

- `EXPLAIN ANALYZE` on the new snapshot queries beyond what the roadmap's 7.7 notes record. Nothing measured here pointed at a missing index (query counts are constant and case-list/at-risk/case-detail are flat), so none was added.
- A load test with concurrent HTTP users. The roadmap's H-7 asks for the `perf:baseline` re-run and documented limits; concurrency is listed above as unmeasured rather than guessed.
- Fixing the dashboard's event load. Proposed follow-up (not added to the roadmap): compute the by-stage leg breakdown for the dashboard from persisted data or bound it to the breached cases only.

## Reproducing

```bash
set -a; . ./.env; set +a
export DATABASE_URL="$TEST_DATABASE_URL"        # disposable database only
pnpm db:seed:perf-baseline -- --cases=5000 --events-per-case=40 --org-name="Perf Baseline"
PERF_METRICS=1 pnpm --filter @sla/web perf:baseline <organizationId>
PERF_METRICS=1 PERF_ORG_ID=<organizationId> pnpm --filter @sla/worker perf:baseline
```

Always set `PERF_ORG_ID` for the worker script: an unscoped run cycles every organization in the database, including any with live integrations.
