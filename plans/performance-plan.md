# Performance plan — roadmap 7.7 (5k cases / 210k events)

> **Closed (roadmap Rev 6, 2026-10-05).** Roadmap 7.7 was carried to H-7, which is done: the results and the documented capacity limits are in [`docs/capacity-limits.md`](../docs/capacity-limits.md). One follow-up was proposed there and not added to the roadmap: bound the dashboard's by-stage leg load (`/dashboard` is the one surface that still grows linearly). This file is kept as the plan and its method.

## Context
With the perf-baseline seed (`pnpm db:seed:perf-baseline`), the dashboard, case list, case detail and worker are all slow. The root cause is the **amount of work**, not one bad query:
- Almost every web path loads **all** open commitments plus **all** their events and re-runs `evaluateCommitment` in JS, several times per request (layout + page + analytics).
- The worker redoes org-wide work on every 5-min tick.

The goal is to cut rows loaded, evaluations and queries, not only to make the same work faster.

### Ground rules
- **Snapshot vs live.**
  - Dashboard, case list, layout alerts and analytics read persisted worker data: `Commitment.status` / `dueAt` and `Evaluation` history. They never call `evaluateCommitment`.
  - Only the visible At-Risk page and case detail evaluate live.
  - Snapshot surfaces show "as of <`WorkerSettings.lastActivePollAt`>" and are never labelled real-time. The data can be ~5 min old.
- **Scope.** Stay within roadmap 7.7 and make no unrelated architectural changes.
- **Gate after each phase:** `pnpm type-check`, then `pnpm test`, then the perf measurements, then the next phase.
- **Indexes** only with `EXPLAIN ANALYZE` evidence from before and after. Indexes for new queries are finalized once those queries exist, and speculative ones are left out.
- **Git:** commit only on request, never push.

---

## Phase 0 — Instrumentation and baseline
**Work counters.** Add `packages/db/src/perf-metrics.ts`, an `AsyncLocalStorage` store enabled by `PERF_METRICS=1`:
- A Prisma `$extends` query hook in `packages/db/src/index.ts` records **query count**, total query ms, and **rows returned per model**. That gives *events loaded* (`NormalizedEvent` / `RawEvent`) and *commitments loaded*.
- A `perfCount(name, n)` helper for **JS evaluations**, called at the `evaluateCommitment` / `deriveLegSpans` call sites in `apps/web/src/lib/*` and `packages/commitments/src/*`. `packages/core` stays pure.
- `withPerfScope(label, fn)` logs one summary line through `createLogger`.

**Web.** Wrap each page loader in a scope: `getDashboardData`, `getCaseListData`, `getCaseDetailData`, `getAtRiskData`, plus the layout. Log per request: TTFB/duration, query count, events loaded, commitments loaded, evaluations.

**Worker.** Per-stage scopes in `apps/worker/src/cycle.ts` (normalize, commitment, re-resolution, next-reply, evaluate, notify). Log **worker evaluations, worker events loaded, queries and stage ms**.

**Lock duration.** Log wait ms and hold ms in `withOrganizationSlaLock` (`packages/db/src/organization-lock.ts:37-61`).

**Baseline.**
- Seed into the dev org with `pnpm db:seed:perf-baseline -- --user-email=<dev user>`.
- Capture all counters for `/dashboard`, `/cases`, `/cases/[id]`, `/at-risk`, one poll cycle and one reconciliation cycle.
- `EXPLAIN ANALYZE` the slowest queries.
- Record the numbers under 7.7 in `implementation-plans/ROADMAP_Product.md`.

## Phase 1 — Web quick wins
1. **Centralized request context** (`React.cache`). Add one `getRequestContext = cache(async () => { session, userId, organizationId, role })`, built on `getServerSession` + `assertSessionStillValid` (`lib/auth.ts:155`, `lib/session-validity.ts:41`).
   - All `Actions.*` read through it instead of calling the session each time (today up to 8 user lookups per request).
   - Every other cached loader takes `organizationId` (and `userId` where relevant) as an **explicit argument**, so tenant context is part of the cache key. `React.cache` is request-scoped only, with no cross-request caching.
2. **Layout alerts** (`app/(main)/layout.tsx:36`): replace `Actions.AtRisk.getData()` with a snapshot `getAlertSummary(orgId)`.
   - The query: `commitment.findMany` with `closedAt: null, status in [at_risk, breached]`, ordered by `dueAt, id`, `take: 20`, narrow `select`, plus a `count`.
   - No events and no evaluation. `AlertsPopover` already renders only 20 rows.
3. **`WorkerSettings` read path** (`packages/db/src/worker-settings.ts:70-82`): use `findUnique` with defaults instead of an `upsert` on every read, and route it through `React.cache`. Do the same for `Integrations.getData`, which runs twice per request, adding a `select` that excludes `credentials`.
4. **Case list mock data bug** (`modules/cases/case-list/ssr/CaseList.tsx:12-820`): remove the hard-coded literal and pass the real `data`.
5. **Dashboard** (`lib/dashboard-data.ts`):
   - Unmatched cases and notification failures: `take: 10` plus `count` (`:146`, `:158`).
   - Run `getProjectAnalytics` inside the first `Promise.all` (`:446`).
   - Drop the unused `otherOpenCommitments` from the payload, and send `breachedThisPeriod` as counts only.
6. **Case detail** (`lib/case-detail-data.ts`):
   - Collapse the 4 sequential await rounds into 2.
   - Add a narrow `select` on the integrations.
   - Load `WorkerSettings` in parallel (`CaseDetail.tsx:13`).
7. **Prisma pool** (`packages/db/src/index.ts:121`): `max` from `DATABASE_POOL_MAX` (default 20), a `statement_timeout`, and the singleton stored on `globalThis`.

## Phase 2 — Snapshot-based web reads
1. **Case list: server-side pagination** (`lib/case-list-data.ts`, `modules/cases/case-list/*`).
   - `searchParams` (page, size, sort, filters, `q`) become Prisma `where` / `orderBy` (always with an `id` tie-breaker) / `skip` / `take`.
   - Row status comes from persisted `Commitment.status`, and filter-chip counts from one `groupBy`.
   - No event loads and no evaluation.
   - Debounced server search on subject, externalId and customer name, replacing the `JSON.stringify` per row in `csr/list-view.tsx:133`.
   - `DataTable` in `manualPagination` / `manualSorting` mode for this page.
2. **Dashboard and analytics** (`lib/dashboard-data.ts`, `lib/analytics-data.ts`):
   - Health-by-kind and open counts come from `groupBy` on persisted status.
   - **`breachedAt`** is the first persisted breached Evaluation per commitment. It is historical and immutable:
     - Query: `SELECT DISTINCT ON ("commitmentId") … WHERE status='breached' ORDER BY "commitmentId", "evaluatedAt" ASC, id ASC`.
     - Fallback for breached commitments that have no breached evaluation: `dueAt`, documented.
     - Confirm that the evaluate pipeline only appends Evaluations (id from `stableHash`, `skipDuplicates`) and never updates or deletes them, so re-evaluation cannot move that timestamp. Add a test for this.
   - The charts (breaches over time, compliance trend, by-stage) become SQL aggregations (`$queryRaw` with `date_trunc` in the org timezone) over commitments closed or breached in the period.
   - Remove `computeBreachedAt`, the re-fetch of open commitments and events, and all `evaluateCommitment` calls from these files.
   - Leg spans (by-stage) load only the breached cases' events, with a narrow `select`.
3. **Anomalies** (`lib/anomaly-data.ts:33-79`): bound the query to the period, and get the terminal evaluation per commitment with `DISTINCT ON … ORDER BY evaluatedAt DESC, id DESC`.
4. **At-risk page** (`lib/at-risk-data.ts`, `modules/dashboard/at-risk/*`):
   - Paginate the **persisted** candidate set first: open commitments ordered by `dueAt, id` with `skip` / `take` 50, filtered by snapshot status.
   - Then load events (narrow `select`) and live-evaluate **only that page**. Never evaluate the whole open set to sort it.
   - The UI says it is ordered by due time. Live status and countdowns apply to the rows shown.
   - `CountdownClock` uses one shared 1s ticker instead of a `setInterval` per clock.
   - `Reveal` animation only on the first ~10 cards.
5. **CSV export** (`lib/report-data.ts:52-83`):
   - Keyset pagination whose cursor tuple equals the `ORDER BY` tuple, e.g. `(openedAt, id)` or `id`, with `take: 1000`. Stream the output.
   - Narrow `select`. Per batch, load only that batch's events and evaluations.
   - Test: the output with batch sizes 1, 7 and 1000 must be identical to the unbatched output, with no duplicated or skipped rows.

## Phase 3 — Worker: bounded per-tick work
1. **Next-reply cycle** (`packages/commitments/src/cycle-pipeline.ts:95-178`, `cycle-commitments.ts:105`):
   - Pass the active/all scope from `apps/worker/src/cycle.ts:87`. The poll covers only open cases and cases with new events. Reconciliation still covers everything.
   - Diff in memory, and open a transaction only for cases whose commitments change.
2. **Incremental Zendesk normalization** (`packages/zendesk/src/normalize.ts:447-586`, called from `cycle.ts:267`):
   - **Watermark:** a new `Integration.normalizedThroughFetchedAt` + `normalizedThroughId` (migration), a deterministic `(fetchedAt, id)` cursor.
   - **Why an overlap window:** RawEvents are insert-only (`createMany`), but webhook and backfill can commit out of `fetchedAt` order.
     - Each poll processes rows with `(fetchedAt, id) > (watermark - overlap window, e.g. 10 min)`.
     - It then advances the watermark to the max `(fetchedAt, id)` seen.
     - Normalization must be idempotent, so re-processed rows are harmless.
   - The hourly reconciliation keeps the full pass as a backstop.
   - Process only the tickets touched by those rows.
   - Upsert changed NormalizedEvents instead of deleting and recreating them per ticket.
3. **Commitment pipeline** (`packages/commitments/src/pipeline.ts:254-297, 418`): fetch only cases missing a commitment kind (`NOT EXISTS`), and use `createMany`.
4. **Evaluation pipeline** (`packages/commitments/src/evaluate-pipeline.ts`):
   - Latest evaluation per commitment via `DISTINCT ON` (`:307`).
   - Narrow event `select`.
   - `IN` lists chunked at 1000.
   - Status/dueAt changes batched as `UPDATE … FROM (VALUES …)` per chunk (`:470`).
5. **Shared per-tick reads:** load the policy, calendar and customer overrides once and pass them to the three pipelines (`pipeline.ts:188`, `re-resolution-pipeline.ts:131`, `cycle-pipeline.ts:65`).
6. **Webhook and source sync** (`apps/web/src/lib/webhook-pipeline.ts:51`, `source-sync.ts:128`): scope the pipelines to the affected case ids, shortening lock hold time.
7. **Notifications outside the lock** (`packages/notifications/src/dispatch.ts:100-206`):
   - Inside the lock, compute candidates and **insert the claim rows**: the existing `Notification` rows with `CLAIMED_CHANNEL`, which the `@@unique([commitmentId, threshold])` constraint makes idempotent.
   - After the lock is released, send only the claimed candidates. Then finalize: update the channel, or delete the claim and upsert `NotificationFailure`, exactly as today.
   - A concurrent cycle's insert hits the unique constraint and skips.
   - Stale claims (still `CLAIMED_CHANNEL` after N minutes, e.g. a crash mid-send) are released on the next cycle so the alert is retried, not lost.

## Indexes — added only where EXPLAIN justifies them
- **Candidates for existing queries, checked in Phase 0/1:**
  - `RawEvent (integrationId, providerEventId text_pattern_ops)` for the `startsWith` lookups (`case-detail-data.ts:708`, `normalize.ts`).
  - `Commitment` open-set / `(status, dueAt)` for the alert summary and the at-risk page.
  - `Case (organizationId, closedAt)`.
- **Finalized after Phases 2/3** against the new queries: e.g. a breached-evaluation lookup (`Evaluation (commitmentId, evaluatedAt) WHERE status='breached'`), `NormalizedEvent (caseId, occurredAt, sourceSequence)`, and a watermark index on `RawEvent (integrationId, fetchedAt, id)`.
- Each one ships with before/after `EXPLAIN ANALYZE` in the phase notes.
- Partial and opclass indexes use raw SQL in the migration if Prisma 7 can't express them. Then confirm `prisma migrate diff` reports no drift.

---

## Verification (per phase)
- `pnpm type-check`, then `pnpm test` (real-Postgres vitest). New tests:
  - Case-list query: filters, sort and paging.
  - `breachedAt` stays immutable across re-evaluation.
  - At-risk paging.
  - CSV keyset completeness.
  - The watermark doesn't miss out-of-order commits.
  - Notification claim idempotency across two concurrent dispatches.
  - Scoped pipelines never skip a changed case.
- Re-run the Phase 0 counters on the seeded DB and compare against the baseline for:
  - **work per request:** queries, events loaded, commitments loaded, JS evaluations
  - **work per worker tick:** worker evaluations, events loaded, stage ms, lock hold ms
  - TTFB
- Expected direction:
  - Snapshot pages go to 0 JS evaluations and 0 events loaded.
  - At-risk evaluates ≤ page size.
  - The poll tick loads events only for changed/open cases.
- Browser preview: dashboard, case list (paginate, filter, search), case detail and at-risk. No console errors, and snapshot pages show their "as of" time.
- Update roadmap 7.7 with the before/after numbers.
