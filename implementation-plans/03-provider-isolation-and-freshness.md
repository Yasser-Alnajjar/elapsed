# N3 — Provider Isolation + Freshness: Implementation Plan

> **Roadmap phase:** [N3 in `ROADMAP_Product.md`](ROADMAP_Product.md#phase-n3--provider-isolation--freshness). Task status lives in the roadmap. This file explains **how**.
> **Depends on:** [N2](02-provider-contract-and-projector.md), for the shared `ProviderUnavailableError` / `ReauthRequiredError` / `PermissionDeniedError` and registry dispatch. **Decision needed:** D13 (stale-source alert behaviour) before N3.5. **Unblocks:** [N4](04-platform-admin-and-plan-records.md).
> **Estimate:** 2–3 weeks. **Branch:** `phase/n3-provider-isolation-and-freshness`.

---

## 1. Objective

- A provider outage degrades **only** the integrations and tenants that use that provider.
- When a case's source data is stale, evaluations and alerts **say so** instead of silently acting on old data.

## 2. Why this phase exists

The 2026-09-29 audit, Scenario A (Zendesk down for 2 hours):

- **Isolation within a tick works.** Each integration's ingest has its own `try/catch`, and evaluation keeps running on stored events (`apps/worker/src/cycle.ts:420-435`).
- **But there is no notion of freshness.**
  - `Integration.lastSyncAt` is written on **every attempt**, successful or not (schema comment on `Integration`). There is no "last successful sync".
  - Evaluations keep advancing time without the replies that happened during the outage, so at-risk and breach alerts can fire on stale data with no caveat.
- **Isolation across tenants is incomplete.** One worker processes every organization serially. `@sla/http-retry` waits up to 60 s per request (`packages/http-retry/src/retry.ts:1-2`, `DEFAULT_MAX_TOTAL_WAIT_MS`), and no provider client sets a per-request timeout (no `AbortSignal` in `packages/*/src/client.ts`). A failing provider therefore stretches the tick for **every** tenant, including tenants that don't use it.

## 3. Constraints

- **Freshness is metadata, not time math.** It never changes `elapsedSeconds`, `status` or `breachedAt`. The engine's pure functions stay unchanged. "Store events, never computed time" holds.
- **Evaluations stay immutable.** Freshness recorded on an Evaluation is a fact about its inputs at evaluation time.
- **Circuit breaking is built only if the measurements in N3.6 justify it** (roadmap D22).
- **Never hard-stop monitoring for a tenant.** Evaluation always runs.

## 4. Current implementation relevant to this phase

- `apps/worker/src/cycle.ts`: ingest outside the org lock, normalize/evaluate inside it; status transitions `:395-450`.
- `apps/worker/src/{index,watchdog,ops-alert,health-server,leader-lock}.ts`: heartbeat, stall alert, single-leader lock.
- `packages/db/prisma/schema.prisma`: `Integration` (`lastSyncAt`, `lastSyncError`, `status`), `WorkerSettings`, `Evaluation`, `Notification`, `NotificationFailure`.
- `packages/commitments/src/evaluate-pipeline.ts` (`runEvaluationPipeline`, `canRaiseAlert`), `packages/notifications/src/{dispatch,format,email-template}.ts`.
- Web: `components/shared/reauth-banner.tsx`, `permission-denied-banner.tsx`, `modules/dashboard/dashboard/csr/BlindSpotsPanel.tsx`, `lib/integrations-data.ts`, `lib/operator-monitoring-data.ts`.
- `packages/logger`, `packages/db/src/perf-metrics.ts` (`PERF_METRICS=1`).

## 5. Tasks, in implementation order

### N3.1 — Record success separately from attempts
- **Schema:** add `Integration.lastSuccessfulSyncAt DateTime?`, `consecutiveFailures Int @default(0)`, `failingSince DateTime?`, `lastSyncDurationMs Int?`.
- `cycle.ts`: on a clean ingest, set `lastSuccessfulSyncAt`, reset `consecutiveFailures` and clear `failingSince`. On failure, increment `consecutiveFailures` and set `failingSince` if it is null. A successfully processed webhook (`app/api/webhooks/*`) also sets `lastSuccessfulSyncAt`.
- **Backfill:** `lastSuccessfulSyncAt = lastSyncAt` where `lastSyncError IS NULL`.
- **Verify:** new worker tests for the three fields across success → failure → success; `pnpm --filter @sla/db validate`.

### N3.2 — A pure freshness function
- Add `packages/core/src/freshness.ts`: `assessFreshness({ lastSuccessfulSyncAt, asOf, expectedIntervalMs, graceFactor }) → { fresh: boolean; staleSince: string | null }`. It is pure and provider-free.
- Default `graceFactor` is 3 × the active-poll interval. Make it configurable in `WorkerSettings` (operator-only).
- **Verify:** unit tests in `packages/core/test/freshness.test.ts`.

### N3.3 — Freshness on evaluations
- **Schema:** `Evaluation.sourceStaleSince DateTime?`.
- `runEvaluationPipeline`:
  - Load freshness per org once per tick.
  - For each commitment, compute `staleSince`. It is the earliest `staleSince` of the case's source integration and of any tracker integration with a `certain` link on the case.
  - Persist it on the Evaluation rows it already writes (it adds no extra rows).
  - A change in freshness alone does **not** create a new Evaluation, keeping "a snapshot worth keeping, not a heartbeat" (`shouldPersistEvaluation`).
- **Verify:**
  - L1 replay with all integrations fresh shows 0 differences in status and `breachedAt`.
  - New `apps/web/test` real-DB test: a stale source sets `sourceStaleSince` and leaves status unchanged.

### N3.4 — D13 (decided: option b)
**Decision (roadmap D13):** when a case's source integration is stale, send at-risk alerts with a clear stale-data marker ("data stale since …") and **hold breach alerts until the source is fresh again**. Once it is fresh, re-evaluate the case and send a breach alert only if the breach is confirmed.

**Options considered:** (a) send both marked stale; (b) mark at-risk and hold breach; (c) hold everything. (b) was chosen because a false "breached" message is the most trust-damaging outcome, while at-risk alerts stay actionable.

### N3.5 — Freshness-aware notifications (per D13)
- `packages/notifications`: add a staleness caveat in `format.ts` and `email-template.ts`, in neutral wording ("Zendesk data last refreshed at …"). The provider name comes from the integration row, not from code branches.
- D13(b) holds breach alerts for stale sources:
  - A held alert must **not** consume its `(commitmentId, threshold)` claim.
  - `claimNotifications` skips held candidates, and they become eligible on the first fresh tick.
  - `canRaiseAlert`'s finalized-commitment rule still applies.
- **Verify:**
  - `notification-claim.test.ts` extended: hold → fresh → exactly one send.
  - Deduplication unchanged for fresh data.

### N3.6 — Bound provider time per tick and measure it
- `@sla/http-retry`: add a per-attempt timeout (`AbortSignal.timeout`, default 30 s), overridable per client. Every provider `client.ts` passes its signal to `fetch`.
- Record ingest duration per integration (`lastSyncDurationMs`) and per-org tick duration, both as structured log fields via `@sla/logger`. Add `lastActivePollDurationMs` / `lastReconciliationDurationMs` to `WorkerSettings`.
- **Outage drill test** (worker test, stubbed `fetch`): two orgs, one Zendesk integration that hangs or returns 503, one Intercom integration that is healthy. Record the healthy org's tick time and whether the tick exceeds 25% of the active-poll interval.
- **Verify:** drill test passes; operator monitoring shows the durations.

### N3.7 — Circuit breaker, only if N3.6 justifies it
- **Trigger:** the drill or production metrics show one failing integration adding more than 25% of the active-poll interval to the tick, or a real outage did.
- **Design:**
  - After `consecutiveFailures ≥ N` (default 3) with `ProviderUnavailableError`, skip that integration's **ingest** until `nextAttemptAt`.
  - `nextAttemptAt` uses exponential backoff, capped at the reconciliation interval. Store `Integration.nextAttemptAt DateTime?`.
  - Normalization and evaluation still run.
  - Reauth and permission-denied states are unchanged: they are not outages.
- If the trigger is not met, **record "not needed, measured at X ms"** in the roadmap and skip this task.
- **Verify:** drill test shows the healthy org's tick time is unaffected within ±10%.

### N3.8 — Customer-visible freshness
- Integration settings and detail: show "last successful sync" and "failing since".
- Dashboard `BlindSpotsPanel`: list stale integrations.
- A stale-data banner in the app shell when any integration is stale (next to `reauth-banner.tsx`).
- Case detail: "source data as of …" when stale.
- **Verify:** `pnpm type-check`; browser check with a stubbed stale integration.

### N3.9 — Operator visibility
- `lib/operator-monitoring-data.ts`: add stale integrations (using `lastSuccessfulSyncAt`), `consecutiveFailures`, and per-integration duration.
- The worker-stall alert (`ops-alert.ts`) is unchanged. Optionally add an ops alert when any integration has been failing for more than a configurable number of hours.
- **Verify:** operator view test updated.

## 6. Data / schema changes

| Change | Task |
|---|---|
| `Integration.lastSuccessfulSyncAt`, `consecutiveFailures`, `failingSince`, `lastSyncDurationMs` (+ backfill) | N3.1 |
| `Evaluation.sourceStaleSince` | N3.3 |
| `WorkerSettings.freshnessGraceFactor`, `lastActivePollDurationMs`, `lastReconciliationDurationMs` | N3.2, N3.6 |
| `Integration.nextAttemptAt` (only if N3.7 is triggered) | N3.7 |

All are additive and nullable or defaulted, so they are safe to roll back.

## 7. Verification commands

```bash
pnpm --filter @sla/db validate
pnpm type-check
pnpm test
npx vitest run packages/core/test/freshness.test.ts apps/web/test/notification-claim.test.ts
npx vitest run apps/worker/test
pnpm --filter @sla/worker perf:baseline
pnpm --filter @sla/commitments replay:compare -- <baseline.jsonl> <after.jsonl>
```

## 8. Acceptance criteria

1. In the simulated 2-hour outage of one provider, other tenants' tick time changes by ≤10%, and no alert for a stale-source case is sent without the D13 treatment.
2. Last successful sync and failing-since are visible to customers (their own org) and to operators (all orgs).
3. L1 replay with fresh data: 0 status and `breachedAt` differences.
4. The circuit breaker is either implemented with its trigger evidence recorded, or explicitly recorded as not needed.

## 9. Rollback

All schema changes are additive. Reverting the notification change restores today's alert behaviour. The circuit breaker, if built, has an operator switch in `WorkerSettings` to disable it without a deploy.

## 10. Out of scope

- Multiple workers, a real queue, or per-tenant worker sharding (→ N8).
- Webhooks for Intercom, Linear or GitHub.
- A per-provider SLA engine. Changing any engine semantics.
- A public status page.
