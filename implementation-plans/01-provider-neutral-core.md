# N1 — Provider-Neutral Core: Implementation Plan

> **Roadmap phase:** [N1 in `ROADMAP_Product.md`](ROADMAP_Product.md#phase-n1--provider-neutral-core). Task status lives in the roadmap. This file explains **how**.
> **Depends on:** existing production baseline (historical Phases 0–7) and Production Hygiene tasks **H-1** (provider pairs recorded) and **H-4** (engine spot-check). **Unblocks:** [N2](02-provider-contract-and-projector.md).
> **Estimate:** 5–6 weeks at 10–15 h/week. **Branch (when the phase starts):** `phase/n1-provider-neutral-core`.

---

## 1. Objective

Move the provider decisions that currently leak into the domain back to the adapter boundary. Prove it with a replay/diff harness and the `{Zendesk, Intercom} × {Jira, Linear}` matrix, **without changing any existing customer's SLA results**.

This is **not** a rewrite of the core. The engine math (`foldClockIntervals`, `evaluateCommitment`, calendars, policy versioning) stays exactly as it is. Only the places where the core, the commitments layer, or one adapter *decides something by provider name* change.

## 2. Why this phase exists

The 2026-09-29 architecture audit found that the engine math is provider-independent, but the system around it is Zendesk-centred:

- `@sla/core` decides ticket-source vs. tracker by provider name.
- Jira and Linear can only correlate to **Zendesk** ticket URLs. An Intercom + Jira customer therefore gets no engineering leg at all.
- Onboarding requires Zendesk.
- Customer identity lives in Zendesk- and Intercom-specific columns.

The product has 10 live customers. Every later phase (contract, freshness, admin, entitlements) reads integration roles and customer identity, so they must be neutral before more code builds on them.

## 3. Non-negotiable constraints

- **Store events, never computed time.** `RawEvent` stays append-only and replayable; `NormalizedEvent` stays derived.
- **Evaluations stay immutable.** The engine stays pure and deterministic: `@sla/core` has no I/O, no clock, and no dependencies.
- **Provider knowledge belongs at the adapter boundary.** No generic connector SDK, no dynamic plugin loading, no provider-specific SLA engine, no abstraction a current requirement doesn't need (roadmap D16).
- Customer ≠ Requester. Conversation ≠ Activity Timeline. No blame-oriented language.
- **Multi-tenant isolation.** Every new query is scoped by `organizationId`, and new models get tenant-isolation coverage.
- **Existing customer behaviour must not silently change** (roadmap D24, §5 below).

## 4. Current implementation relevant to this phase

| ID | Violation | Location |
|---|---|---|
| V1 | `SourceSystem` is a union of five provider names inside the core domain type, used by `NormalizedEvent.system` and `EvaluationEventRef.system` | [`packages/core/src/types.ts:24`](../packages/core/src/types.ts) |
| V2 *(fixed in N1.6: `isTicketSourceEvent`, a `sourceRole` check)* | `TICKET_SOURCE_SYSTEMS = {"zendesk","intercom"}` decided which events anchor a case's lifecycle | [`packages/core/src/ticket-source.ts:12`](../packages/core/src/ticket-source.ts); used in `evaluate.ts:120,176,220,227`, `reply-cycles.ts:78`, `clock-rules.ts:63` |
| V3 | Leg ownership decided by `event.system === "zendesk" \|\| "intercom"` / `"jira" \|\| "linear" \|\| "github"`; variable named `zendeskState` | [`packages/core/src/legs.ts:54,62,77,138-139`](../packages/core/src/legs.ts) |
| V4 | `SYSTEM_RANK` orders same-instant events by provider name | [`packages/core/src/ordering.ts:9-15`](../packages/core/src/ordering.ts) |
| V5 | Zendesk's priority vocabulary is the core's comparison order (`PRIORITY_ORDER`); `priority_changed` carries raw provider strings in `fromState`/`toState` | [`packages/core/src/commitments.ts:73`](../packages/core/src/commitments.ts), [`types.ts:44-70`](../packages/core/src/types.ts) |
| V6 | `toCaseAttributes` adds Zendesk filter-field aliases (`current_tags`, `via_id`, `current_via_id`) | [`packages/commitments/src/pipeline.ts:58-72`](../packages/commitments/src/pipeline.ts) |
| V7 | Imported (Zendesk) policies are candidates for **every** case in the org, including Intercom cases | `matchPolicyVersion` [`packages/core/src/commitments.ts:269`](../packages/core/src/commitments.ts); `SLAPolicy` has no source-provider field |
| V8 | The adapter depends on the orchestration package: `@sla/zendesk` imports `DEFAULT_CALENDAR_NAME` and `ensureDefaultCalendarVersion` from `@sla/commitments` | [`packages/zendesk/src/policies.ts:10`](../packages/zendesk/src/policies.ts), `packages/zendesk/package.json` |
| V9 | Jira and Linear correlate only `{subdomain}.zendesk.com` URLs and read the Zendesk integration's credentials directly | [`packages/jira/src/correlate.ts:10-17,224-263`](../packages/jira/src/correlate.ts), [`packages/linear/src/correlate.ts:12-19,123-145`](../packages/linear/src/correlate.ts) |
| V10 | Provider identity stored as columns of a core entity: `Customer.zendeskOrgId`, `intercomCompanyId`, `intercomContactId`, plus three provider-specific unique keys | [`packages/db/prisma/schema.prisma:289-334`](../packages/db/prisma/schema.prisma); writers `zendesk/normalize.ts:656`, `intercom/normalize.ts:429,542`; reader `zendesk/policies.ts:160,465` |
| V11 | `Case` is unique on `(organizationId, externalId)` with no source; `system @default(zendesk)` | [`schema.prisma:338-415`](../packages/db/prisma/schema.prisma); lookups via `organizationId_externalId` in `zendesk/normalize.ts`, `zendesk/correlate.ts`, `intercom/normalize.ts`, `jira/correlate.ts`, `linear/correlate.ts` |
| V12 | Onboarding step 1 requires Zendesk; the Intercom card is a static placeholder; connect-time projection runs only for Zendesk and Jira | [`OnboardingFlow.tsx:159,458,478`](../apps/web/src/modules/onboarding/onboarding/csr/OnboardingFlow.tsx), [`lib/types/onboarding.ts:13-31`](../apps/web/src/lib/types/onboarding.ts), [`lib/source-sync.ts:37,92-115`](../apps/web/src/lib/source-sync.ts) |
| V13 | No provider-neutral golden suite: the golden scenarios use Zendesk fixtures and real Postgres | [`apps/web/test/sla-golden-scenarios.test.ts:22`](../apps/web/test/sla-golden-scenarios.test.ts) |
| V14 | Nothing prevents regressions: no import-boundary or provider-literal test | — |

**Deferred to N2 (do not fix here):**
- Worker `if/else` dispatch and the 10 provider error classes (`apps/worker/src/cycle.ts`).
- Adapters writing domain tables directly.
- Web-layer provider branches (`case-detail-data.ts`, `report-data.ts`, `dashboard-data.ts`, `at-risk-data.ts`).
- `SlaImportSummary` generalisation.
- **Contract** (drop) migrations for the columns replaced in N1.

**Already neutral (keep as-is):** `@sla/notifications`; `@sla/core`'s package dependencies (none); `NormalizedState` semantic mapping in every adapter; per-system pause tracking in `elapsed.ts` (keyed by an opaque value); `CaseLink.method`/`confidence`.

## 5. Safety contract: replay/diff comes first

**No task after N1.2 may merge until the replay/diff harness exists and a baseline has been captured.**

```text
existing stored events (restored backup, read-only)
        ↓
re-evaluate with CURRENT code  → baseline snapshot
        ↓
apply provider-neutral change
        ↓
re-evaluate the SAME stored events at the SAME asOf with NEW code
        ↓
diff per commitment / case
        ↓
zero unintended status / breachedAt differences
```

**What is compared, per commitment:**
- `status`, `breachedAt` (the `effectiveDueAt` when breached), `effectiveDueAt`
- `elapsedSeconds`, `remainingSeconds`
- `clock.state`, `clock.pauseCause`
- `warnThresholdCrossed`
- `inputs.policyVersionId`, `inputs.calendarVersionId`, and the evaluation `id` (a hash of its inputs)

**What is compared, per case:**
- The policy version `matchPolicyVersion` selects for each commitment kind.
- The Next Reply cycle plan (`deriveNextReplyCycles` keys).
- `deriveLegSpans` output: legs, confidence, boundaries.
- The count of `certain` CaseLinks (for tasks that touch correlation).

**Two replay levels:**
- **L1 — evaluation replay.** Uses the stored `NormalizedEvent`, `Commitment`, policy and calendar rows and runs the pure engine. Required for every task touching `@sla/core` or `@sla/commitments`.
- **L2 — normalization replay.** Uses a restored scratch DB and re-runs normalization and correlation from `RawEvent`, then L1. Required for tasks touching adapters, correlation, `Customer` or `Case` keys (N1.12–N1.15).

**Where it runs:**
- Only against a **scratch database restored from the latest backup** (`scripts/restore-drill.sh` creates `sla_restore_drill` next to the live DB).
- L1 is strictly read-only: it opens a `READ ONLY` transaction and writes its output to the scratch directory.
- L2 writes only to the scratch DB.
- Never run either level against the live database.

**Diff classification.** Every difference is one of:

| Class | Meaning | Required action |
|---|---|---|
| **A — unintended** | Caused by the change, not approved | Fix the change. The task cannot merge. |
| **B — intentional** | A behaviour change the task sets out to make | Record it in §13 *Approved intentional differences* with: decision ID, count of commitments, count of tenants, before → after, customer-facing effect, and owner approval date. |
| **C — pre-existing drift** | The baseline code's recomputation already disagrees with the persisted `Commitment.status` / `Evaluation.breachedAt` | Not caused by this change. Log the count and open a correctness task. It does not block the task, but it must be reported. |

**Customer data rule.** Diff reports stay in the scratch directory, never in git. Only aggregate counts and classifications are copied into §13.

**Production effect of approved (class B) differences.** Once deployed, the reconciliation sweep recomputes affected commitments. Finalized commitments may have their status corrected but raise no new alert (`canRaiseAlert`, `packages/commitments/src/evaluate-pipeline.ts:132`). State this explicitly in the approval entry.

## 6. Tasks, in implementation order

Each task is one reviewable commit or a small group of commits, and each ends with its own verification step.

### N1.0 — Entry check (≤2 h)
- Confirm H-1 is done: the provider pair of each of the 10 tenants is recorded (roadmap D15). Specifically, record whether **any** tenant has both a Zendesk and an Intercom integration, because it decides whether N1.10 and N1.11 can produce class-B differences.
- Confirm a fresh backup has been restored into the scratch DB with `scripts/restore-drill.sh`.
- **Verify:** the roadmap's H-1 row is ticked, and the drill log (`DRILL_LOG`, default `docs/restore-drills.log`, written on the host by `scripts/restore-drill.sh`) has today's line.

### N1.1 — Replay/diff harness, L1 (V14 safety net)
- Add `packages/commitments/src/scripts/replay-capture.ts` and `replay-compare.ts`, next to the existing `backfill-breached-at.ts`. Register them as `replay:capture` and `replay:compare` in `packages/commitments/package.json` (same `dotenv -e ../../.env -- tsx …` pattern).
- **Capture:**
  - Arguments: `--as-of <ISO>`, optional `--org <id>` (repeatable), `--out <file.jsonl>`.
  - Per org, load the rows with the same readers the pipelines use: `toNormalizedEventDomain`, `toCommitmentDomain` (`evaluate-pipeline.ts:47,64`), `loadPolicyContext` (`tick-context.ts:39`).
  - Compute everything listed in §5 and write one JSON line per commitment and per case, **sorted deterministically**.
  - Record the git SHA and `asOf` in a header line.
- **Compare:** reads two captures and prints class counts plus a per-field breakdown. Exits non-zero if there are any differences not listed in an `--approved <file>` allowlist.
- **Also report C-class drift:** in capture mode, compare the recomputed `status` and `breachedAt` with the persisted `Commitment.status` and latest `Evaluation.breachedAt`.
- **Verify:**
  - Unit tests in `packages/commitments/test/replay.test.ts`: determinism (two captures of the same data are byte-identical) and classification (a synthetic status flip is reported).
  - Run capture twice on the scratch DB; the compare reports 0 differences.

### N1.2 — Baseline capture on production data
- Run `replay:capture` against the scratch DB for all tenants with a fixed `asOf`. Keep the file for the whole phase.
- Record C-class drift counts in §13. If drift is non-zero, open a Production Hygiene correctness task (it does not block N1).
- **Verify:** the baseline exists; drift counts are recorded in the roadmap's N1 status line.

### N1.3 — Provider-neutral golden scenarios in `@sla/core` (V13)
- New `packages/core/test/golden-provider-neutral.test.ts`: pure, no DB, no provider fixtures.
- **Helpers:** `ticketEvent(...)`, `trackerEvent(...)`, `codeHostEvent(...)` are the **only** place a source identity is set. Before N1.5 they set today's provider strings; after N1.5 they set `sourceRole` plus opaque `system` values like `"ticket-a"` / `"tracker-a"`. **The test bodies do not change.**
- Port the seven golden scenarios from roadmap 7.10 (normal→high, high→normal, breached then target increase, Next Reply cycles, Resolution pause/resume, reopen, calendar change). Add:
  - a two-trackers-on-one-case leg scenario;
  - a tracker `resolved` that must not stop Resolution (`clock-rules.ts:63`);
  - same-instant ordering between the ticket source and a tracker.
- **Verify:** `npx vitest run packages/core/test/golden-provider-neutral.test.ts` passes on unchanged code; the existing `apps/web/test/sla-golden-scenarios.test.ts` still passes.

### N1.4 — Architecture / import-boundary tests (V14), as a ratchet
- New `packages/core/test/provider-boundary.test.ts` (reads files and `package.json`; no DB). It asserts:
  1. `packages/core`, `packages/commitments` and `packages/notifications` have no dependency on `@sla/zendesk`, `@sla/jira`, `@sla/intercom`, `@sla/linear` or `@sla/github`.
  2. No provider package depends on `@sla/commitments` (V8).
  3. Non-comment string literals in `packages/core/src`, `packages/commitments/src` and `packages/notifications/src` do not match `/"(zendesk|jira|intercom|linear|github)"/`. Comments are stripped before matching.
  4. `packages/jira/src`, `packages/linear/src` and `packages/github/src` contain no `zendesk.com` or `intercom.com` host literal, and no `provider: "zendesk"` / `"intercom"` lookup (V9).
- Start with an explicit **allowlist of today's violations** (file + rule). The test fails if a *new* violation appears **or** if an allowlisted entry no longer violates, which forces the allowlist to shrink. **N1 exit requires an empty allowlist**, except entries explicitly deferred to N2 in §4.
- **Verify:** the test passes with the allowlist; deliberately adding `"zendesk"` to `packages/core/src/util.ts` in a scratch branch makes it fail.

### N1.5 — `sourceRole` on normalized events; `system` becomes opaque (V1)
- **Core** (`types.ts`):
  - Add `export type SourceRole = "ticket_source" | "work_tracker" | "code_host"`.
  - Add `sourceRole: SourceRole` to `NormalizedEvent`.
  - Change `system` (and `EvaluationEventRef.system`) from `SourceSystem` to `string`, documented as *opaque provenance: used only to key per-source state and break ties, never to decide behaviour*.
  - Delete `SourceSystem`.
- **Schema:**
  - Add `NormalizedEvent.sourceRole String` (nullable at first).
  - In the migration SQL, backfill it from `system`: `zendesk`, `intercom` → `ticket_source`; `jira`, `linear` → `work_tracker`; `github` → `code_host`. Provider names in migration SQL are data, not domain logic.
  - A second migration makes the column `NOT NULL` after the writers are deployed.
  - `NormalizedEvent` is a derived table, so a backfill is equivalent to re-derivation.
- **Writers:** each adapter sets `sourceRole` on every `normalizedEvent.create` / `createMany`. Each provider package exports its role as a constant (for example `export const ZENDESK_SOURCE_ROLE = "ticket_source"`); N2 moves it into the adapter record. Also update `packages/zendesk`'s `diffNormalizedEvents` key and `packages/db/src/scripts/seed-perf-baseline.ts`.
- **Readers:** `toNormalizedEventDomain` (`evaluate-pipeline.ts:64`) and every other row→domain mapper (`grep -rn "sourceSequence" packages/*/src apps/web/src`: `cycle-pipeline.ts`, `analytics-data.ts`, `case-detail-data.ts`, `report-data.ts`, `backfill-breached-at.ts`) map the column through.
- **Verify:** `pnpm --filter @sla/db validate`; `pnpm type-check`; the migration applies to the scratch DB with 0 null `sourceRole` rows; L1 replay shows **0 differences**.

### N1.6 — Replace `TICKET_SOURCE_SYSTEMS` with a role check (V2)
- Replace `ticket-source.ts` with `export const isTicketSourceEvent = (e: NormalizedEvent) => e.sourceRole === "ticket_source"` (keep the file name so the doc references stay valid).
- Switch the call sites: `evaluate.ts:120,176,220,227`, `reply-cycles.ts:78`, `clock-rules.ts:63`.
- **Verify:** golden suites pass; boundary allowlist shrinks; L1 replay shows 0 differences.

### N1.7 — Role-based leg derivation (V3)
- In `legs.ts`: rename `zendeskState` → `ticketSourceState`, and replace the provider checks at `:138-139` with `sourceRole === "ticket_source"` / `sourceRole !== "ticket_source"`. **Preserve today's behaviour exactly:** `code_host` events feed `engineeringState` just like `work_tracker` events do. Update the comments at `:50-58`.
- **Verify:** `packages/core/test/legs.test.ts` and the golden suites pass; L1 replay leg-span comparison shows 0 differences.

### N1.8 — Role-based event ordering (V4)
- In `ordering.ts`: replace `SYSTEM_RANK` with `ROLE_RANK` (`ticket_source: 0`, `work_tracker: 1`, `code_host: 2`), then compare `system` as a string, then keep the existing tiebreakers unchanged.
- **Why this is order-preserving:**
  - Cross-role order is unchanged: ticket sources came first, then trackers, then GitHub.
  - Within the tracker role, `"jira" < "linear"` alphabetically, matching the old rank.
  - Two ticket sources on one case (`zendesk` vs `intercom`) only happens through the externalId collision accepted in the `Case.system` schema comment. Under the old rank Zendesk came first; alphabetically Intercom comes first. **This is the only possible difference.** Replay reports it, and N1.15 removes the collision.
- Add a unit test in `packages/core/test/ordering.test.ts` that enumerates every co-occurring role pair.
- **Verify:** L1 replay shows 0 differences (any class-B entry must be exactly the collision case above).

### N1.9 — Canonical priority vocabulary (V5)
- In core, name what is already true: `export type CanonicalPriority = "low" | "normal" | "high" | "urgent"`. `PRIORITY_ORDER` becomes the ordering of Elapsed's **own** vocabulary; reword the comment at `commitments.ts:73`.
- The adapter contract rule: **adapters map provider priorities to `CanonicalPriority` before they reach `Case.priority`.** Zendesk is already the identity mapping. Intercom already maps `priority` → `high` and `not_priority` → `normal` (`packages/intercom/src/normalize.ts:252-263`); move its doc comment to reference `CanonicalPriority` instead of "the Zendesk vocabulary". Jira and Linear never set `Case.priority`.
- Type `priority_changed`'s `fromState` / `toState` as `CanonicalPriority | null` for that event type, and map in the Zendesk normalizer. Values are identical, so there is no data change.
- **Verify:** type-check; L1 replay shows 0 differences (policy-match comparison included).

### N1.10 — Move the Zendesk condition aliases into the Zendesk adapter (V6)
- `toCaseAttributes` keeps only canonical fields: `priority`, `customerId`, `tier`, `tags`, `channel`.
- The Zendesk normalizer adds `current_tags`, `via_id` and `current_via_id` to the `Case.attributes` it already writes (`zendeskConditionAttributes`, `packages/zendesk/src/normalize.ts`).
- **Data migration:** a SQL migration adds the three keys to existing Zendesk cases' `attributes` from `tags` and `channel`: `attributes = coalesce(attributes,'{}') || jsonb_build_object(...)` where `system = 'zendesk'`. This avoids waiting for a renormalize.
- **Verify:** `apps/web/test/zendesk-sla-condition-fields.test.ts` and `zendesk-ticket-tags.test.ts` pass; L1 replay policy-match comparison shows 0 differences on the backfilled scratch DB.

### N1.11 — Scope imported policies to their source (V7)
- **Schema:** `SLAPolicy.sourceProvider IntegrationProvider?`. Backfill `'zendesk'` where the policy is imported (`externalId` non-null and source imported); leave it null for native policies.
- **Core:**
  - `SLAPolicyVersion.sourceKey?: string | null` and `CaseAttributes.sourceKey?: string`.
  - In `matchPolicyVersion`, an imported candidate is eligible only when `candidate.sourceKey === case.sourceKey`. Native policies stay eligible for every case.
  - The core compares opaque strings; `@sla/commitments` fills them from `SLAPolicy.sourceProvider` and `Case.system`.
- **Writers:** the Zendesk policy importer sets `sourceProvider`.
- **Expected replay result:**
  - 0 differences for tenants with a single ticket source.
  - For any tenant with both Zendesk and Intercom (known from H-1), Intercom cases that previously matched a Zendesk policy become class **B**, under decision D19. Record them in §13 and get owner approval before merging.
- **Verify:** new core unit tests for source scoping; `native-policy-calendar-resolution.test.ts` and `zendesk-sla-policy-position.test.ts` pass; L1 replay classified.

### N1.12 — Reverse the `@sla/zendesk → @sla/commitments` dependency (V8)
- `runZendeskSlaPolicyImport` and `runZendeskBusinessCalendarImport` take a `defaultCalendarVersionId` (or an `ensureDefaultCalendar` callback) parameter instead of importing `ensureDefaultCalendarVersion`.
- Callers resolve it first with `@sla/commitments`: `apps/worker/src/cycle.ts` (normalize stage, `:345-363`) and `apps/web/src/lib/source-sync.ts:104-115`. These are the only two callers today; confirm with `grep -rn runZendeskSlaPolicyImport apps`.
- Remove `@sla/commitments` from `packages/zendesk/package.json`.
- **Verify:** boundary rule 2 passes with no allowlist entry; `packages/zendesk/test/policies.test.ts` and `policy-override-survives-import.test.ts` pass; `pnpm type-check`.

### N1.13 — Generic link resolution for Jira and Linear (V9), the core of the Intercom proof
- **Ticket-source recognizers, in their own adapters:**
  - `@sla/zendesk`: `recognizeZendeskTicketUrl(url, credentials) → externalId | null`. Move `parseZendeskTicketId` here from `packages/jira/src/correlate.ts:10` and `packages/linear/src/correlate.ts:12`; the host check against `{subdomain}.zendesk.com` is unchanged.
  - `@sla/intercom`: `recognizeIntercomConversationUrl(url, credentials) → externalId | null`.
  - **Do not guess Intercom's URL formats.** Capture real remote links from a live Intercom → Jira and Intercom → Linear integration first (the conversation URL built in `packages/intercom/src/client.ts:139` is one shape; inbox URLs may differ). Store them as fixtures in `packages/intercom/test/`. Accept only the org's own Intercom workspace id, the same way Zendesk accepts only the org's own subdomain.
- **Trackers stop knowing about ticket sources.**
  - `runJiraCorrelation` and `runLinearCorrelation` take a `resolveCaseRef: (url) => Promise<{ caseId } | null>` parameter.
  - Remove their reads of the Zendesk integration (`jira/correlate.ts:224-227`, `linear/correlate.ts:123-126`).
  - Rename the result counter `unmatchedNotZendeskUrl` → `unmatchedUnrecognizedUrl`; update the readers in web and worker.
- **Composition:**
  - `resolveCaseRef` is built per org from the org's connected ticket-source integrations by a small function in `@sla/commitments`. It takes recognizer functions as arguments and imports no providers.
  - The caller assembles it: `apps/worker/src/cycle.ts`, `apps/web/src/lib/source-sync.ts`, and the Jira webhook route `apps/web/src/app/api/webhooks/jira/[integrationId]/route.ts`. The worker holds a two-entry static map `{ zendesk: recognizeZendeskTicketUrl, intercom: recognizeIntercomConversationUrl }`, which N2 replaces with the registry.
- **Case lookup:** until N1.15 lands, look up by `organizationId_externalId` **and** check `case.system` equals the recognizer's provider. After N1.15, use the new source-aware key.
- **Unchanged:** Zendesk's official-link correlation (`runZendeskJiraLinkCorrelation`) is a Zendesk-adapter capability and stays where it is. GitHub keeps correlating through Jira/Linear links (roadmap D18: frozen).
- **Verify:**
  - `packages/jira/test/correlate.test.ts` and `packages/linear/test/correlate.test.ts` updated; new Intercom-URL cases pass.
  - `apps/web/test/jira-correlation-scope.test.ts`, `official-link-correlation.test.ts` and `jira-remote-link-unlink.test.ts` pass.
  - **L2 replay:** Zendesk tenants' `certain` link counts are identical (0 differences); legs are identical.
  - Boundary rule 4 passes with no allowlist entry.

### N1.14 — `CustomerIdentity` table (V10), expand phase only
- **Schema:**
  ```prisma
  model CustomerIdentity {
    id             String              @id @default(cuid())
    organizationId String
    customerId     String
    provider       IntegrationProvider
    kind           String   // adapter-defined, e.g. "organization", "company", "contact"
    externalId     String
    createdAt      DateTime            @default(now())
    customer       Customer            @relation(fields: [customerId], references: [id], onDelete: Cascade)
    @@unique([organizationId, provider, kind, externalId])
    @@index([customerId])
  }
  ```
- **Migration:** create the table and backfill one row per non-null `zendeskOrgId` (`zendesk`/`organization`), `intercomCompanyId` (`intercom`/`company`) and `intercomContactId` (`intercom`/`contact`).
- **Writers dual-write:**
  - `zendesk/normalize.ts:656` and `intercom/normalize.ts:429,542` resolve customers **through `CustomerIdentity`**.
  - They keep writing the legacy columns for one release so a code rollback still works.
  - `zendesk/policies.ts:465` (org → customer map) reads from `CustomerIdentity`.
- **Contract phase:** the legacy columns and their three unique keys are dropped in N2 (N2.10), after at least one production release on dual-write and a clean L2 replay.
- **Tenant isolation:** add `CustomerIdentity` to `apps/web/test/tenant-isolation.test.ts`.
- **Verify:** `pnpm --filter @sla/db validate`; the migration on the scratch DB produces identity rows equal to the non-null legacy column count; **L2 replay shows identical `Case.customerId` for every case**; `apps/web/test/zendesk-requester-name.test.ts` passes (Customer ≠ Requester unchanged).

### N1.15 — Source-aware Case uniqueness (V11), expand phase only
- **Schema:**
  - Add `Case.sourceIntegrationId String?` (FK to `Integration`). Integration rows are never deleted (soft disconnect) and are unique per `(organizationId, provider)`, so the FK is stable across reconnects.
  - Backfill it from `(organizationId, system)` → `Integration.id`.
  - Add `@@unique([organizationId, sourceIntegrationId, externalId])`.
  - Remove `@default(zendesk)` from `Case.system`; every writer already sets it explicitly (verify with grep before removing).
- **Precondition check:** before adding the new key, confirm there are no two cases with the same `(organizationId, sourceIntegrationId, externalId)` (a SQL query on the scratch DB). The old key guarantees this.
- **Writers and lookups:** move every `organizationId_externalId` lookup listed in V11 to the new compound key. The old unique key stays until N2 (N2.10), so a rollback is safe.
- **Verify:** L2 replay shows 0 differences; `apps/web/test/event-ordering-persistence.test.ts`, `zendesk-normalization-scope.test.ts` and `jira-normalization-scope.test.ts` pass; tenant isolation still passes.

### N1.16 — Intercom as an onboarding ticket source (V12)
- `lib/types/onboarding.ts` and `lib/onboarding-data.ts`: the status gains `intercom`. "Step 1 complete" means **a ticket source** (Zendesk or Intercom) is connected and its backfill is complete.
- `OnboardingFlow.tsx`:
  - Replace the static Intercom card (`:159`) with the real connect flow already used in settings (`modules/settings/integrations/csr/IntercomCard.tsx`, `app/api/integrations/intercom/*`).
  - Step 3 offers Jira **or** Linear as the tracker.
  - Keep the Beta label on Intercom and Linear (roadmap D17 — no production promotion in this phase).
- `lib/source-sync.ts`: extend the connect-time projection to Intercom (`runIntercomNormalization`, then the commitment/evaluation tail), and to Linear correlation when a Linear integration exists.
- Review step: Intercom has no importable SLA policies (D9), so for an Intercom org the policy-review step becomes "create your first native policy", linking to the existing native policy editor under `modules/settings/sla-configuration`.
- **Verify:**
  - New or updated `apps/web/test` suites for onboarding status with an Intercom-only org.
  - A browser walk-through of the flow with a stubbed Intercom integration in local dev.
  - Existing Zendesk onboarding tests unchanged.

### N1.17 — 2×2 provider matrix smoke tests
- New `apps/web/test/provider-matrix-smoke.test.ts` (real Postgres; register it in `vitest.config.ts`'s `realDatabaseSuites`), modelled on `smoke-signup-to-alert.test.ts`.
- One scenario per pair. Webhook routes exist only for Zendesk and Jira, so the Intercom and Linear legs drive their pipeline functions directly with a stubbed `fetch`, as 7.9 already does for evaluation.

  | Pair | Role in the matrix |
  |---|---|
  | Zendesk + Jira | existing production baseline (regression) |
  | Zendesk + Linear | matrix validation |
  | Intercom + Jira | provider-boundary proof |
  | Intercom + Linear | provider-boundary proof |

- **Assertions per pair:**
  - The case is created with the correct `sourceIntegrationId`.
  - The customer is resolved through `CustomerIdentity`.
  - A `certain` `CaseLink` to the tracker issue exists.
  - An `engineering` `LegSpan` exists.
  - First Response / Resolution commitments are evaluated.
  - One deduplicated alert is claimed.
- **Verify:** `npx vitest run apps/web/test/provider-matrix-smoke.test.ts` passes for all four pairs. Passing this does **not** promote any pair to production (D17).

### N1.18 — Close-out
- Final L1 + L2 replay on a **freshly restored** backup against the N1.2 baseline (re-captured at the same `asOf` if the backup is newer). Result: 0 class-A differences; all class-B differences approved in §13.
- Boundary allowlist is empty except the N2-deferred entries.
- Update the roadmap:
  - N1 status.
  - Appendix D invariants ("case source of truth = the case's ticket-source integration", D19).
  - `docs/customer-guide.md`, only if a class-B difference is customer-visible.
- **Verify:** every command in §10 passes; the roadmap's N1 status line records the replay result counts.

## 7. Data / schema changes (summary)

| Change | Task | Kind | Contract step |
|---|---|---|---|
| `NormalizedEvent.sourceRole` (+ backfill, then NOT NULL) | N1.5 | expand | — |
| Zendesk alias keys in `Case.attributes` (data backfill) | N1.10 | data | — |
| `SLAPolicy.sourceProvider` (+ backfill) | N1.11 | expand | — |
| `CustomerIdentity` (+ backfill, dual-write) | N1.14 | expand | drop `Customer.zendeskOrgId/intercomCompanyId/intercomContactId` in N2.10 |
| `Case.sourceIntegrationId` + new unique key; remove `system` default | N1.15 | expand | drop `@@unique([organizationId, externalId])` in N2.10 |

All migrations go in `packages/db/prisma/migrations/` and run automatically through the one-shot `migrate` service (roadmap 7.1). Take a verified backup before each production deploy (`scripts/backup.sh`).

## 8. API / web / worker / core changes (summary)

- **Core:** `types.ts` (`SourceRole`, opaque `system`, `CanonicalPriority`, `sourceKey`), `ticket-source.ts`, `legs.ts`, `ordering.ts`, `commitments.ts`, `evaluate.ts`, `reply-cycles.ts`, `clock-rules.ts`. **No change** to `elapsed.ts` math, `calendar.ts`, or evaluation ids.
- **Commitments:** `pipeline.ts` (`toCaseAttributes`, source keys), `evaluate-pipeline.ts` mapper, new replay scripts, `resolveCaseRef` builder.
- **Adapters:** `zendesk/{normalize,policies,calendars,correlate}.ts`, `intercom/normalize.ts` (+ URL recognizer), `jira/correlate.ts`, `linear/correlate.ts`, `github/normalize.ts` (sourceRole only).
- **Worker:** `apps/worker/src/cycle.ts`, limited to passing `defaultCalendarVersionId` and `resolveCaseRef`. The dispatch refactor is N2.
- **Web:** onboarding modules, `lib/onboarding-data.ts`, `lib/types/onboarding.ts`, `lib/source-sync.ts`, `app/api/webhooks/jira/[integrationId]/route.ts`, readers of the renamed correlation counter.

## 9. Backward compatibility

- Every schema change is expand-only in N1, so a code rollback never needs a database rollback.
- The evaluation id hash (`evaluate.ts:440`) does not include `system`, so evaluation ids are unchanged.
- `EvaluationEventRef.system` values already persisted in `Evaluation.inputs` stay valid strings.
- Integration rows, OAuth credentials and webhook secrets are untouched.
- Customer-visible numbers must not change unless they are approved class-B differences (§13).

## 10. Verification commands

```bash
pnpm install --frozen-lockfile
pnpm --filter @sla/db generate
pnpm --filter @sla/db validate
pnpm type-check
pnpm test
pnpm test:db:prepare
npx vitest run packages/core/test/provider-boundary.test.ts packages/core/test/golden-provider-neutral.test.ts
npx vitest run apps/web/test/sla-golden-scenarios.test.ts apps/web/test/sla-e2e-matrix.test.ts
npx vitest run apps/web/test/provider-matrix-smoke.test.ts apps/web/test/tenant-isolation.test.ts
grep -rnE '"(zendesk|jira|intercom|linear|github)"' packages/core/src packages/commitments/src packages/notifications/src
scripts/restore-drill.sh
pnpm --filter @sla/commitments replay:capture -- --as-of <ISO> --out <scratchpad>/n1-baseline.jsonl
pnpm --filter @sla/commitments replay:compare -- <scratchpad>/n1-baseline.jsonl <scratchpad>/n1-after.jsonl --approved <scratchpad>/n1-approved.json
```

`replay:*` are added in N1.1. Point `DATABASE_URL` at the `sla_restore_drill` scratch database for replay, never at the live one. The `grep` must print nothing once N1 is complete (comments aside, which the boundary test strips).

## 11. Acceptance criteria (N1 exit)

1. `@sla/core`, `@sla/commitments` and `@sla/notifications` contain zero provider-name string literals outside comments, and depend on no provider package.
2. No provider package depends on `@sla/commitments`. Jira, Linear and GitHub contain no Zendesk or Intercom host knowledge.
3. Leg derivation, lifecycle anchoring and ordering are decided by `sourceRole`; `SourceSystem` no longer exists.
4. L1 and L2 replay against a freshly restored backup: **0 class-A differences**; every class-B difference is approved in §13; C-class drift is reported.
5. Provider-neutral golden suite passes; the existing Zendesk golden and e2e-matrix suites pass unchanged.
6. All four matrix pairs pass `provider-matrix-smoke.test.ts`.
7. An Intercom-only org can complete onboarding and reach monitoring with a Jira or Linear tracker.
8. `CustomerIdentity` and `Case.sourceIntegrationId` are live, and tenant isolation covers them.
9. Roadmap D24 holds: no N1 change merged without a recorded replay result.

## 12. Rollback

- **Code:** revert the phase's commits. Expand-only schema changes are ignored by the old code: nullable columns, a new table, extra JSON keys. `sourceRole` NOT NULL is the one exception — ship that migration last and only after the writers have been live for a release, so rolling back beyond it also needs a migration that makes the column nullable again.
- **Data:** the legacy customer columns are still dual-written, and the old Case unique key is still present, so the old code keeps working.
- **Incident rule:** if production evaluations diverge after deploy (operator view, customer report), restore customer trust first. Revert, run the replay comparison on the restored backup to find the class, then fix forward.

## 13. Approved intentional differences and drift log

_Filled in during the phase. Only aggregate counts; never customer data._

| Date | Task | Class | Decision | Commitments | Tenants | Before → after | Customer-facing effect | Approved by |
|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — |

### Drift log (class C)

| Date | Task | Backup | `asOf` | Commitments | Status drift | `breachedAt` drift | Follow-up |
|---|---|---|---|---|---|---|---|
| 2026-09-30 | N1.2 | `sla-20260929T213644Z.dump` | 2026-09-29T21:36:44Z | 3,921 (12 orgs, 1,508 cases) | 0 | 10 | Roadmap H-13 (does not block N1) |

## 14. Out of scope for N1

- Worker registry and dispatch, shared error types, shared projector, web rendering through adapters (→ N2).
- Dropping legacy columns and keys (→ N2.10).
- Webhooks for Intercom or Linear; freshness (→ N3).
- Promoting Intercom, Linear or any pair out of Beta (a separate decision, D17).
- GitHub changes beyond `sourceRole` (D18). Any third ticket source (→ N7).
- New `NormalizedState` values or any change to engine semantics (D1–D7 stay frozen).
