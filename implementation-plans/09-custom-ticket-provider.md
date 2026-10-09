# N9 — Custom Ticket Provider: Implementation Plan

> **Roadmap phase:** [N9 in `ROADMAP_Product.md`](ROADMAP_Product.md#phase-n9--custom-ticket-provider). Task status lives in the roadmap. This file explains **how**.
> **Decision:** [D31](ROADMAP_Product.md) (amends D16). **Depends on:** [N2](02-provider-contract-and-projector.md) (contract, projector, registries) and [N3](03-provider-isolation-and-freshness.md) (freshness applies automatically). **Related, separate track:** [N7](07-third-ticket-source.md) / D29 (Zoho Desk), which this phase does not replace.
> **Estimate:** set after the N9.1 spike. **Branch:** `phase/n9-custom-ticket-provider`, with small, reviewable PRs.

> **State of this document (2026-10-09).** The owner has approved the **decisions** recorded in §2.1 (Q1–Q16, R1–R6, and U1, U3, U4, U5, U6). **The owner has not yet approved this document's final diff or the separate copy-only change; both await the owner's final diff review.** Nothing in this plan has been built, nothing is committed, and **N9.1 is blocked until the owner explicitly approves proceeding.** Every statement uses one of three tags:
>
> - **[approved]**: an owner decision of 2026-10-09, including the Q1–Q16 and R1–R6 rulings in [§2.1](#21-review-decisions-q1q16-and-r1r6). A mechanism written next to an approved rule is tagged separately; only the rule the owner stated is approved.
> - **[verified]**: a fact checked in the repository on 2026-10-09 (path given).
> - **[proposed]**: my proposal, not yet approved; the remaining ones are collected in [§15](#15-unresolved-decisions-and-proposed-details). The incremental-poll / full-sweep design (§6.9) is a proposal until its correctness and performance are demonstrated, and is not an approved implementation decision.

---

## 1. Objective

A customer whose helpdesk Elapsed has no adapter for can connect it through a guided UI, with no code and no request to us, and get correct SLA monitoring **as far as the source's data honestly allows**. The integration is read-only against the external system, tenant-isolated, deterministic, and never executes customer-supplied code. Where a source cannot support a metric, Elapsed says so and does not compute a misleading number.

## 2. What D31 approved

| Area | Decision |
| --- | --- |
| Provider | **[approved]** One statically registered `custom` provider, role `ticket_source`, in the existing registries. A closed-schema, declarative engine interprets validated configuration. Customer-supplied code, scripts, expressions and plugins are never executed. |
| Reuse | **[approved]** Existing ingestion, normalization, projection and SLA pipelines are reused. No unrelated refactoring. Existing provider behavior is preserved. |
| D16 | **[approved]** Narrowed to "no general-purpose connector framework". Every other D16 constraint stays. |
| Multiplicity | **[approved]** One custom integration per organization in V1. `Integration @@unique([organizationId, provider])` is unchanged. Configuration, versioning, adapter and UI are designed so multiple instances can follow without redesign (§9.5). |
| API | **[approved]** JSON only; HTTPS only; `GET`, plus `POST` only for endpoints explicitly designated as read-only search/query; no create, update or delete against the source. |
| Pagination, sync | **[approved]** Page, offset/limit, cursor, same-origin next URL, `Link` header. Incremental sync by updated-since with a configurable look-back. Comments embedded or fetched from a separate endpoint. |
| Authentication | **[approved]** API key in a header, Bearer token, Basic auth, custom auth header. No OAuth. **API keys in query parameters are prohibited.** |
| Fields | **[approved]** Required: external ID, created at, current status. Recommended: title, priority, customer ID and name, updated at, ticket URL template. V1 custom fields: tags and channel. No new canonical fields; no arbitrary attributes in native policy matching. |
| Rollout | **[approved]** Beta. Operator-controlled per-organization enable flag, default off. Counts as a support integration; no plan limit or pricing change. |

### 2.1 Review decisions (Q1–Q16 and R1–R6)

The owner's rulings on the open items of the first three documentation reviews (Q1–Q10, then Q11–Q16, then the R1–R6 details those left open). Each is detailed in the section named.

| # | Ruling | Section |
| --- | --- | --- |
| Q1 | **Approved.** Provider-blind `Integration.slaSupport`. Unsupported commitment kinds are excluded **in the shared commitments pipeline**, not hidden in the UI. Existing providers keep today's behavior. D24 replay and regression required. | §5.4 |
| Q2 | **Approved with an exact rule:** keep 25%, add an explicit minimum count so one failed record in a tiny batch never aborts a usable sync. | §6.4 |
| Q3 | **Approved, amended by Q11.** Abort before any projection if more than 25% of existing live cases would undergo a lifecycle-state change, subject to the Q11 minimum count; record reason and counts; never partially apply. | §6.4 |
| Q4 | **Approved.** 120 s total ingest-run wall-clock budget; every request bounded by the remaining budget; safe stop on expiry. | §6.3 |
| Q5 | **Approved.** Turning the Beta flag off prevents new outbound requests and retries, keeps data and keeps it visible; in-flight and re-sync behavior defined. | §8.7 |
| Q6 | **Provisionally approved, superseded by Q13:** 20,000 live cases was a provisional figure only. **Verified: it is not supported by any measurement, and processing the whole stored set on every pass is not acceptable as a standing design.** It is no longer an approved ceiling; see Q13. | §6.9 |
| Q7 | **Approved.** Without a reliable public/private field, Full SLA needs an explicit owner acknowledgement that all returned comments are customer-visible; never assumed. | §5.2 |
| Q8 | **Approved with security verification; made strict by Q16.** Reuse `INTEGRATION_TOKEN_ENCRYPTION_KEY` through a per-value helper only after compatibility and security verification. | §8.4 |
| Q9 | **Deferred.** Pre-merge verification policy stays separate. No CI trigger changes in N9. | §13 |
| Q10 | **Approved (the approach)** as a **separate, copy-only source change** to the five public `/docs/integrations/*` pages. It is not part of the Markdown diff. The prepared five-file diff itself awaits the owner's review. | §11 |
| Q11 | **Approved.** Mass-lifecycle guard aborts before projection only when **both** `R ≥ 10` **and** `R > 0.25 × L`. The abort stays atomic and auditable; the batch is never partially projected. | §6.4 |
| Q12 | **Approved.** A run that exhausts its 120 s budget is **partial, not successful**. Progress is kept only through the last fully completed page; the successful-sync watermark does not advance and full freshness is never claimed; status and reason appear in sync history; resumption never duplicates events or commitments; D13(b) is not weakened. | §6.3, §6.7, §6.12 |
| Q13 | **Approved as a gate, not as a number.** 20,000 is **not** approved as a fixed ceiling. A benchmark gate must pass before any ceiling is finalized. Until results exist the ceiling is **provisional**, configurable, and fails safely (no silent truncation, no partial rewrite). The incremental-poll / full-sweep design **remains a proposal** until correctness and replay behavior are demonstrated. Raw-event pruning stays deferred (H-5). | §6.4, §6.9, §6.10 |
| Q14 | **Approved.** Existing commitments that become unsupported are changed only after a dry-run and explicit confirmation. Never delete commitments or historical evaluations; cancel only unfinalized, genuinely unsupported ones; finalized history is preserved; idempotent; D24 replay checks required. | §5.5 |
| Q15 | **Approved as a principle:** no automatic bypass after a safety-guard abort. Any override needs an authorized actor, a recorded reason, a preview of the affected records and a narrowly scoped confirmation, and is audited. It never bypasses tenant isolation, request limits, the wall-clock budget or security validation. Detailed by R1 and R2. | §6.11 |
| Q16 | **Approved, conditional on compatibility and security verification.** Strict per-value authenticated encryption with the existing `INTEGRATION_TOKEN_ENCRYPTION_KEY`, ciphertext bound to organization, integration and credential field; malformed or invalid ciphertext is rejected, never read as plaintext; secrets redacted everywhere; the key-rotation limitation is documented; the format used by existing providers is not changed. | §8.4 |

| R1 | **Approved.** The customer-side authority for an override is the **organization owner or an explicitly authorized organization administrator**. A platform operator never silently overrides a customer's safety guard. An exceptional support-assisted override needs a separate permission path, explicit customer authorization, an audit record and a narrowly scoped confirmation. | §6.11 |
| R2 | **Approved.** An override never bypasses the failure-ratio guard, the capacity ceiling, the wall-clock budget, tenant isolation or security validation, and it **never forces a mass deletion** the deletion guard rejected; that cleanup needs a separate, reviewed workflow. | §6.11 |
| R3 | **Approved.** A run that ends only because its time or record budget was exhausted is `partial` and does not increment `consecutiveFailures`. Partial runs and reasons are recorded separately. A real provider, authentication, transport or processing failure still follows the applicable failure policy and is never hidden by a partial run. Partial runs never advance `lastSuccessfulSyncAt` or claim full freshness. D13(b) is preserved. The exact behavior of a run with completed pages and record failures is documented. | §6.12 |
| R4 | **Approved.** 5,000 is a conservative, explicitly **unvalidated** provisional guard limit, taken from the existing capacity documentation. It is not described as validated custom-provider capacity. Beta activation stays blocked until the benchmark determines the final ceiling; if the benchmark fails, the ceiling is lowered or the design revised before activation. | §6.9, §6.10 |
| R5 | **Approved as a requirement:** document a safe rollback policy from the real `runCommitmentPipeline` behavior. Never assume cancelled commitments can be reactivated; preserve finalized evaluations and audit history; never silently reactivate obsolete commitments; where safe restoration is unsupported, require a new reconciliation path instead of promising rollback. Inspected and documented. | §5.5 |
| R6 | **Approved.** A per-run cap is `partial` with no watermark advance. Activation is blocked when the source lacks a usable incremental cursor and cannot complete its initial full pass within the supported run budget. Freshness semantics are not weakened to make activation succeed. Clear customer-facing states distinguish initial sync, ongoing partial progress and failure. | §4.3, §6.13 |
| U1 | **Approved.** Organization **owner only** in V1. No administrator role or delegation is built in N9; adding one needs its own decision. | §6.11 |
| U3 | **Approved, option (a).** Block activating any configuration version that re-supports `next_reply` while Q14-cancelled `next_reply` commitments exist, until a reconciliation path exists. No shared-table or planner change. | §5.6 |
| U4 | **Approved as proposed.** A pass that completes with record failures below the guard is `ok` and advances `lastSuccessfulSyncAt`; failed tickets are reported, shown and retried every pass. | §6.12 |
| U5 | **Approved as proposed.** Three consecutive zero-progress runs make the next one `failed` with code `no_progress`. | §6.12 |
| U6 | **Design approved; not implemented.** Support-assisted override: a distinct allowlist beside `PLATFORM_ADMIN_EMAILS`, the durable `GuardOverride` model, and a new `AdminAuditLog` action. Details not named in the ruling (the 24-hour expiry, the exact field list, the exact action and variable names) remain proposed (§15). | §6.11 |
| (shared) | The optional `partial` outcome on `IngestResult` and the `cycle.ts` branch are **shared-code changes**: kept in the implementation plan with focused regression coverage and D24 replay where applicable; not implemented during the documentation review. | §6.12, §10 |

**Reaffirmed, unchanged:** raw-event pruning stays deferred until H-5 is resolved; no synthetic status history; no closure timestamp inferred from `updatedAt`; no deletion based on absence from a sync response.

## 3. Scope and non-goals

**In scope (V1):** everything in §2, plus sync-run history and record-level failure surfacing **for all providers** (§10), and the notices and alert caveat for current-status-only sources (§5.4).

**Deferred; each needs its own decision [approved]:** multiple custom integrations per organization; OAuth; webhooks; tracker or code-host roles; new canonical fields; arbitrary attributes in policy matching; templates or a marketplace; configuration import/export; policy or calendar import; a per-integration minimum polling interval (V1 follows the global worker tick, `WorkerSettings`); undelete of a soft-deleted case; **pruning of superseded raw snapshots (depends on H-5, §7)**.

**Never:** write-back to the source, executing customer code, fuzzy matching of cases, or inventing history.

---

## 4. Capabilities

### 4.1 The configuration document

A versioned JSON document (`schemaVersion: 1`) validated server-side by a **strict Zod schema**: unknown keys are rejected, sizes and counts are bounded, and the same validator runs when a draft is saved, when a version is activated and when the worker loads it. The document never contains a secret (§8.4). Illustrative shape in [Appendix B](#appendix-b--illustrative-configuration-document); the final shape is fixed in N9.4.

### 4.2 Endpoints

| Endpoint | Required? | Purpose |
| --- | --- | --- |
| `tickets` | Yes | The ticket list (the collection chosen in the response explorer). |
| `comments` | No | Replies, either embedded in the ticket response (a path) or fetched per ticket (`{{ticket.id}}` in the path). |
| `ticketDetail` | No | Re-fetch of one ticket; the only way to establish a deletion by verified 404 (§6.5). |
| `statusHistory` | No | Real status transitions, if the source exposes them (§5). |

Each endpoint specifies a **method** (`GET`, or `POST` with `readOnlySearch: true`, set only by the user's explicit confirmation), a path relative to the configured HTTPS base origin, query parameters, headers (§8.3) and, for `POST`, a JSON body template. Variables (`{{cursor}}`, `{{page}}`, `{{offset}}`, `{{limit}}`, `{{updatedSince}}`, `{{ticket.id}}`) are substituted only into URL-encoded path segments, query values and JSON string values, never into scheme, host or port.

### 4.3 Pagination and incremental sync

Pagination types **[approved]**: page number; offset/limit; cursor (read from a response path, sent as a parameter); next URL (must be same-origin and passes the same validation as any request); `Link` header (RFC 8288 `rel="next"`, same-origin). Every type has a page cap, an item cap and repeated-cursor detection.

Incremental sync **[approved]**: an updated-since request parameter (ISO 8601, epoch seconds or epoch milliseconds) with a configurable look-back, so a late-indexed update is not skipped for good (the same reason Intercom uses `WATERMARK_LOOKBACK_SECONDS` in `packages/intercom/src/backfill.ts`; **[verified]**). Re-fetching an unchanged ticket is harmless: raw events dedupe on `(integrationId, providerEventId)` plus a content hash. A source with no updated-since parameter may be listed in full each run only within the per-run limits (§6.2) and the wall-clock budget (§6.3). Because a run that stops early is `partial` and cannot report freshness (Q12, §6.12), a source whose full listing cannot finish inside one run would never be reported fresh. **Activation is blocked [approved: R6]** when the source has **no usable incremental cursor** (no updated-since parameter) **and** cannot complete its initial full pass within one run's limits. The check is empirical, not an estimate: the validator performs the full listing for the preview under the same limits and budget as a real run (§6.2, §6.3). If the listing does not end inside them, activation is refused with the measured numbers (pages, tickets, requests, seconds) and the reason; if it ends, activation is allowed. Freshness semantics are not relaxed to let such a source activate. A source **with** an incremental cursor may take many runs to import its history (resumable, §6.1); it is allowed and is shown as an import in progress, not as a fault (§6.13).

### 4.4 Authentication

API key in a header (name chosen by the user, validated per §8.3), Bearer, Basic, and a custom header. **[approved]**. Secret values are write-only (§8.4). A 401 maps to `ReauthRequiredError` and status `reauth_required`; a 403 to `PermissionDeniedError` and `permission_denied`, reusing the existing lifecycle (`apps/worker/src/cycle.ts`; **[verified]**). OAuth flows are out of scope.

### 4.5 Field mapping

Paths use a **constrained JSONPath subset**: `$`, `.key`, `['key']`, `[n]`, `[*]`. No filters, recursion, expressions or functions. `__proto__`, `constructor` and `prototype` keys are rejected. **[approved]** Transforms are a fixed, deterministic set: `trim`, `lowercase`, `coalesce(paths…)` (first non-null), `template("{a}-{b}")`, `stripHtml`, `epochToIso`, `parseDate(format, timezone)`, `valueMap`, `constant`. **[approved]**

| Elapsed field | Canonical target **[verified]** | Requirement |
| --- | --- | --- |
| External ID | `CaseFacts.externalId` → `Case.externalId` | **Required**; stable and unique within the integration |
| Created at | `CaseFacts.openedAt` and the `case_created` event | **Required**; `Case.openedAt` is set once and never updated (`packages/ingestion/src/projector.ts`) |
| Current status | `NormalizedState` on events; drives `closedAt` | **Required**; explicit value map |
| Title | `CaseFacts.subject` → `Case.subject` | Recommended |
| Priority | `CaseFacts.priority` → `Case.priority` (`CanonicalPriority`) | Recommended |
| Customer ID and name | `CustomerIdentityFact` (`provider: "custom"`, `kind`, `externalId`, `name`) | Recommended |
| Updated at | none stored; incremental-sync watermark only | Recommended |
| Ticket URL template | not stored on `Case`; computed at read time and used to recognize ticket URLs (§9.4) | Recommended |
| Tags | `CaseFacts.tags` | V1 custom field |
| Channel | `CaseFacts.channel` | V1 custom field |
| Resolved or closed timestamp | the timestamp of a `case_closed` event | Required to enable Resolution tracking (§5) |
| Comments | `agent_replied` / `customer_replied` events (author role, public/private flag, body path for display) | Required for Full SLA (§5) |

**No canonical home, deliberately not added [approved]:** ticket description, requester ID and email, assignee ID (D10 stores only the assignee's display name; the canonical `assigneeName` exists but is not in the approved V1 field list), and the source's updated-at as a stored field. Adding any of these is a domain change that needs its own decision.

### 4.6 Status, priority and date rules

- **Status.** Every external status value is explicitly mapped to one of the eight `NormalizedState` values (`new`, `open`, `pending_customer`, `pending_internal`, `in_progress`, `escalated`, `resolved`, `closed`; `packages/core/src/types.ts`; **[verified]**). An unknown value **fails the affected record** by default (code `unknown_status`); the owner may configure an explicit, documented fallback to `open`. **[approved]**
- **Priority.** An unmapped value becomes `null` with a diagnostic (`unknown_priority`), never a pass-through string. **[approved]** (This differs from today's adapters, which pass an unmappable value through; recorded so it is not mistaken for a bug.)
- **Dates.** ISO 8601 with an offset, or epoch seconds or milliseconds. A date with **no** timezone information requires an explicitly configured IANA timezone; UTC and the organization timezone are never assumed. A local time that does not exist (DST gap) or is ambiguous (DST overlap) is **rejected** (`nonexistent_local_time`, `ambiguous_local_time`) and fails the record; the engine never picks a different instant. **[approved]**

---

## 5. SLA modes and event history

### 5.1 What the SLA engine requires **[verified]**

From `packages/core/src/evaluate.ts`, `clock-rules.ts`, `reply-cycles.ts`:

| Commitment | Needs from the ticket source | If it is missing |
| --- | --- | --- |
| `first_response` | A ticket-source `case_created` whose `actor` is correct (an agent-created ticket starts the clock at the first customer reply, D5b, and the commitment is created once and never re-derived); completion by a ticket-source `agent_replied`, else `case_closed` | A reply-less close is never `met` (D5), and an open case breaches without being able to complete |
| `resolution` | `case_closed` (current closure) and `state_changed` for reopens; pauses on `resolved` always (D3) and, for native policies, on `pending_customer` (D30) | Closure is unknowable, so Resolution cannot complete; pauses are not applied |
| `next_reply` | `customer_replied` and `agent_replied` events | No cycles are derived |

Custom sources can only use **native** policies (no policy import), and native policies match on priority and customer only (`packages/commitments/src/native-policy.ts`; **[verified]**).

### 5.2 The two modes **[approved]**

| | Full SLA | Resolution-only |
| --- | --- | --- |
| Data | Tickets plus reply data that distinguishes agent from customer replies | Tickets without sufficient reply data |
| Supported | First response, next reply and resolution | **Resolution only.** First response and next reply are **unsupported** for this source and are shown as such |
| Activation checks | Reliable author-role mapping is required. Where the source exposes public/private visibility it must be mapped explicitly. The creation actor must be derivable (explicit creator-role path, first-comment author role, or an explicit configuration assertion that tickets are customer-created). | A reliable closure timestamp for terminal statuses (below) |

**U7 [approved]:** if a terminal status (a status mapped to `resolved` or `closed`) has no reliable source-supplied closure timestamp, **Resolution tracking is blocked** for that source and configuration. `updatedAt` is never substituted, because it moves whenever a closed ticket is later edited and would silently change resolution times.

**Comment visibility (Q7, approved).** Where the source exposes a public/private (or internal-note) field, it must be mapped explicitly and private comments never become replies. Where it exposes **no reliable visibility field**, Full SLA cannot be activated unless the owner explicitly acknowledges that **all returned comments are customer-visible**. The acknowledgement is recorded inside the immutable configuration version (`commentVisibilityAcknowledged`, who, when) and is never defaulted. A later version that changes the comments endpoint or comment mapping must be re-confirmed, not silently carried forward. Without it the source can still be activated as Resolution-only.

The validator runs before activation and shows, per metric, `supported`, `supported with limitations` or `unsupported`, with the reason. **Unsupported SLA targets are not silently activated** (mechanism in §5.4).

### 5.3 Status history is optional, but history is never invented **[approved]**

- If the source exposes real status history, the actual transitions are mapped and imported as `state_changed` / `case_closed` events at their real timestamps.
- If it does not, the engine uses only the **current status** and **verifiable timestamps or events the source supplies**.
- Elapsed **never synthesizes** a `state_changed`, `case_closed` or any other historical event from polling observations. The time a poll saw a status is not the time it changed.
- The documentation, UI and alerts must not claim that current status alone gives the same historical accuracy as a source with a status-history endpoint.

Limitations for a **current-status-only** source:

| Calculation | With real status history | Current status only |
| --- | --- | --- |
| Case creation | Supported | Supported from the Created At field; the first-response clock also needs a derivable creation actor |
| Closure and Resolution completion | Supported | Supported only when the source supplies a verifiable closure timestamp; otherwise Resolution tracking is blocked (U7) |
| Customer-wait pause (`pending_customer`; native policies always pause on it, D30) | Applied for the real intervals | **Not available.** Past waiting intervals are unknowable, so Resolution time can be overstated |
| Reopen detection and the solve-to-reopen exclusion (D3) | Supported | **Limited.** Only the net current state is visible; intervals closed and reopened between polls are lost |
| First response and next reply | Need reply data (Full SLA) | Same: current status adds nothing |
| Activity Timeline | Real transitions | Sparse: creation, closure (if timestamped), replies if mapped; no transitions |
| At-risk and breach alerts for Resolution | Accurate to the data | Computed on incomplete data; carry a caveat (§5.4) |

### 5.4 How limits are enforced and shown

- **Commitment exclusion in the shared pipeline [approved: Q1].** Unsupported commitment kinds are excluded where commitments are created, not hidden in the UI. Mechanism: a nullable `Integration.slaSupport Json?`, written at activation from the validated configuration, e.g. `{ "unsupportedKinds": ["first_response", "next_reply"], "limitations": ["no_status_history"] }`. `null` means full support and is what every existing provider has. The commitments packages read this generic field and never the provider name.
  - **Where [verified]:** `runCommitmentPipeline` creates `first_response` and `resolution`; `runNextReplyCyclePipeline` creates `next_reply`; `runCommitmentReResolutionPipeline` re-resolves active ones. The worker (`apps/worker/src/cycle.ts`), the connect-time sync (`apps/web/src/lib/source-sync.ts`) and the webhook path (`apps/web/src/lib/webhook-pipeline.ts`) all call these same functions, so one gate covers all three paths. The case selection joins `sourceIntegration.slaSupport`.
  - **Existing providers keep their behavior:** with `slaSupport = null` the code path is unchanged. D24 replay must show **0 differences** in commitments and evaluations for existing tenants.
  - **Focused regression tests:** `null` creates all kinds exactly as today; each unsupported kind is excluded individually; the three entry paths (worker, connect-time sync, webhook) are all gated; re-resolution skips excluded kinds; evaluation and notifications never see an excluded commitment because none is created.
  - **Commitments that already exist** for a kind that later becomes unsupported (a new configuration version): never silently left running and never deleted. The established non-destructive representation is status `cancelled`, as the cycle planner already does for a vanished Next Reply cycle (`packages/commitments/src/cycle-commitments.ts`; **[verified]**). The approved handling (dry-run, explicit confirmation, idempotent, D24 replay checks) is §5.5.
- **Notices [approved]:** a clear notice on the integration page and on case details whenever the source lacks reliable historical status transitions. It never claims full historical accuracy.
- **Alert caveat [approved, initial release]:** at-risk and breach alerts for affected Resolution calculations carry a caveat line, in the first release and not a later phase. It is a shared notification change and carries the D24 replay requirement (N9.13). Enabling the Beta flag for any organization is **blocked until N9.13 ships**.

### 5.5 Existing commitments that become unsupported **[approved: Q14]**

This applies when activating a configuration version (including a rollback) whose `slaSupport.unsupportedKinds` contains a commitment kind that the integration **already has commitments for**. A version that adds no newly unsupported kind never triggers it.

**Rules [approved]:**

- **Never delete** a commitment, an evaluation or a notification record. Cancellation is the only change this operation may make.
- **Only unfinalized commitments of a genuinely unsupported kind are cancelled.** "Unfinalized" is the codebase's own definition: `closedAt` null and status not `cancelled` (`ACTIVE_COMMITMENT_WHERE`, `packages/commitments/src/active-commitment.ts`; **[verified]**). A commitment of a kind that is still supported is never touched.
- **Finalized history is preserved:** `met` and `breached` commitments with `closedAt` set, and every evaluation, keep their outcome, `closedAt` and audit trail exactly as they are (the same rule the Next Reply planner applies, `cycle-commitments.ts`; **[verified]**).
- **Dry-run and explicit confirmation before any change.** Activation does not proceed to the cancellation step until the owner has seen the preview and confirmed it.
- **Idempotent.** Running the confirmed operation again cancels nothing further and writes nothing.

**Mechanism [proposed]:**

1. **Dry-run (read-only).** For the integration, group by kind and by current status the commitments that would be cancelled, and show: the total, the count per kind, the count per status (`on_track`, `at_risk`, and **`breached` with `closedAt` still null**, listed separately because cancelling it removes a breach that is still accruing), the commitments that are **excluded** because they are finalized (shown as "kept"), and up to 20 sample case ids. The preview is stored as a short-lived record containing its counts and a hash of the exact commitment id set. It states plainly that **cancellation is not undone by a rollback** and that cancelled `first_response` and `resolution` commitments cannot return under the current implementation (§5.6).
2. **Confirmation** is scoped to one integration, one target version and that preview hash. If the id set has changed when the owner confirms (a new commitment, a status change), the confirmation is rejected and a new preview is required. It is owner-only, same-origin and audited.
3. **Cancellation** runs in a transaction, stamps `closedAt` as the Next Reply planner does, and writes an audit record with the counts and the preview hash. Version activation and cancellation commit together or not at all.
4. **Replay.** Re-planning against the result yields an empty plan (the property `planCycleCommitments` already has).

**D24 replay checks required [approved: Q14]:** (a) for every existing provider (`slaSupport = null`) the operation does not run and replay shows 0 differences in commitments and evaluations; (b) on a custom fixture, the only differences are the previewed cancellations, classified as intentional; (c) a second run of the confirmed operation produces no difference; (d) finalized commitments and every evaluation are byte-identical before and after; (e) no commitment or evaluation row is deleted.

### 5.6 Rollback after a cancellation, and the real cancelled-commitment behavior **[approved: R5; findings verified 2026-10-09]**

R5 required the real `runCommitmentPipeline` behavior to be inspected before any rollback policy is written. **Findings** (`packages/commitments/src/pipeline.ts`, `cycle-commitments.ts`, `cycle-pipeline.ts`, `evaluate-pipeline.ts`, `re-resolution-pipeline.ts`, `schema.prisma`):

| Question | Finding |
| --- | --- |
| Does `runCommitmentPipeline` reactivate or recreate a cancelled `first_response` or `resolution` commitment? | **No.** It selects only cases with `commitments: { none: { kind } }`, and `missingCommitmentKinds` counts any existing row of the kind whatever its status. A cancelled row therefore counts as "present": the case is not considered, nothing is created, nothing is restored. `@@unique([caseId, kind, cycleKey])` with the single cycle key also forbids a second row. **A cancelled single-cycle commitment is permanent in the current implementation.** |
| Does anything cancel `first_response` or `resolution` today? | **No.** The only code that writes `status: "cancelled"` is `persistNextReplyCommitments` (Next Reply cycles). The §5.5 operation would be the **first** writer for the two single-cycle kinds, so there is no existing restore semantics to lean on for them. |
| Does anything reactivate a cancelled `next_reply` commitment? | **Yes, silently.** `planCycleCommitments` puts every cancelled row whose cycle is derived again into `restore`, and `persistNextReplyCommitments` sets it back to `on_track` with `closedAt: null`, **keeping its original `startedAt` and `dueAt`**. It records no reason and `Commitment` has no cancel-reason field, so a commitment cancelled because its kind became unsupported is indistinguishable from one whose cycle vanished. If a rollback made `next_reply` supported again, the planner would revive every such commitment on its next run, with the old clock, with no preview and no audit. |
| Do cancelled commitments reach evaluation, re-evaluation or alerts? | **No.** `ACTIVE_COMMITMENT_WHERE`, `RE_RESOLUTION_ELIGIBLE_WHERE` and the evaluation pipeline (including the sweep scope `all`) exclude `cancelled`; the case detail renders them as cancelled at their `closedAt`. |

**Rollback policy [approved: R5; mechanism proposed]**

1. **Rolling a configuration back never reactivates a cancelled commitment.** The rollback re-activates mapping and `slaSupport` for **future** processing only. The rollback preview states how many commitments of each kind remain cancelled and that they will not return.
2. **`first_response` and `resolution`:** they stay cancelled, as the pipeline already behaves. Cases that already have a cancelled row get no replacement. Cases created after the rollback get commitments normally.
3. **`next_reply`:** the silent restore described in the third finding above must be prevented, because it would revive an obsolete clock. **Approved (U3, option (a)):** N9.8a **blocks activation of any configuration version that re-supports `next_reply` for an integration that has Q14-cancelled `next_reply` commitments**, until a reconciliation path exists. This needs no shared-table or planner change. The rejected alternative, an additive cancel-reason marker on `Commitment` honored by `planCycleCommitments`, would have been a shared schema and planner change with D24 replay; it can be revisited when the reconciliation path is designed. The block ships in the same task as the cancellation (N9.8a), so the cancellation cannot run in any environment without it.
4. **Restoring cancelled commitments requires a new reconciliation path** that does not exist and is **not part of N9**: a separately reviewed workflow with its own preview, explicit confirmation, audit record and D24 replay. It must decide, and show the owner, whether a restored commitment resumes its old clock (which may have long since breached; a breach is final, D2) or starts a new one. Until it exists, rollback does not promise restoration.
5. **Preserved always:** finalized (`met`, terminally `breached`) commitments, every evaluation and notification, and the audit record of the cancellation (§5.5) are never altered by a rollback.

---

## 6. Synchronization, deletion and auditability

### 6.1 Flow

1. **Initial import [approved]:** last 90 days by default, configurable up to 365, subject to the limits below. Because the limits can be reached before an import finishes, the import is **resumable across runs**: the cursor is persisted after every completed page, and `cursor.backfillCompletedAt` is set only when the whole window has been read (the Intercom pattern; **[verified]** in `packages/intercom/src/backfill.ts`).
2. **Steady state:** every worker tick (the global active-poll interval) the adapter's `ingest` runs outside the organization lock, writing raw events and the cursor only; `syncIntegration` then normalizes and projects inside the lock (`apps/worker/src/cycle.ts`, `packages/ingestion/src/pipeline.ts`; **[verified]**). V1 has no per-integration interval; it follows the global tick and the 30-minute reconciliation ceiling.
3. **Normalization scope [proposed, not approved: Q13].** The first draft of this plan proposed re-deriving the integration's **entire stored snapshot set on every pass**, as Intercom does. Q6 asked for the existing cost to be verified first; §6.9 shows that this is **not acceptable as a standing design**. The design under evaluation uses the contract that already exists: `NormalizeContext.mode` is `incremental` on the active poll and `full` on the reconciliation sweep, the connect-time projection and an operator re-normalization request (**[verified]**: `packages/ingestion/src/pipeline.ts`, `apps/worker/src/cycle.ts`). For `custom`:
   - **Incremental pass:** only tickets with raw events newer than a persisted watermark, using the `Integration.normalizedThroughFetchedAt` / `normalizedThroughId` pair that already exists and that only Zendesk uses today (**[verified]**: `schema.prisma` comment on `Integration`). The watermark advances in the batch's `afterProject` hook, so an aborted pass never moves it.
   - **Full pass:** the entire stored set, only on the reconciliation sweep (at most every 30 minutes), at activation (dry-run), after a configuration change, and on an operator request.
   - The guard baselines in §6.4 are defined for both passes.
   - **This design is a proposal.** It is adopted only if the correctness and replay evidence and the performance evidence in §6.10 are produced. Until then it is not an implementation decision, `incrementalNormalization` stays `false` (§9.1), and the fallback in §6.9 applies.

### 6.2 Limits **[approved]**

| Limit | Value |
| --- | --- |
| Per-attempt timeout | 30 s (the existing `DEFAULT_ATTEMPT_TIMEOUT_MS`), further bounded by the remaining run budget (§6.3) |
| Ingest-run wall-clock budget | **120 s total** (§6.3) |
| Pages per run | 50 |
| Tickets per run | 5,000 |
| Response size | 5 MB each |
| Bytes per run | 50 MB |
| Request rate | 5 requests per second |
| JSON depth | 20 |
| Stored payload size | 64 KB per payload (a larger one fails its record with `payload_too_large`; it is never truncated) |
| Live cases per custom integration | **Provisional and configurable; no value is validated [approved: Q13].** Enforced before any full-set rewrite or projection (§6.4), failing safely, never truncating. The value is fixed only by the benchmark gate (§6.10). 20,000 is the largest size to be benchmarked, not an approved ceiling. |

### 6.3 Wall-clock budget and progress **[approved: Q4]**

`packages/http-retry/src/retry.ts` allows 5 attempts of up to 30 s each plus up to 60 s of waiting, so **one request can take about 210 s** (**[verified]**; see the update note in plan 03 §2). A 30-second timeout alone therefore does not bound a run. The rules:

- **One budget per ingest run: 120 seconds total**, measured from the start of `ingest` on a monotonic clock. It covers every request attempt, every retry back-off, every rate-limit wait and every child (comment) request. It does not cover the DB-only normalization and projection that follow.
- **Every request is bounded by the remaining budget.** Before each attempt: `attemptTimeoutMs = min(30 s, remaining)`; `maxTotalWaitMs`, each `Retry-After` and each back-off sleep are clamped to `remaining`; `fetchWithRetry` already accepts both `attemptTimeoutMs` and `maxTotalWaitMs` per call (**[verified]**). No attempt begins when `remaining` is zero or too small to be useful (under 1 s).
- **Safe stop on expiry:** the in-flight request is aborted by its signal; its response is discarded; nothing from a page whose requests (including child requests) did not all complete is written; the cursor stays at the last **completed** page; the updated-since watermark moves only when a full listing pass completes. Raw writes are idempotent (`skipDuplicates`), so repeating a page is harmless.
- **Outcome [approved: Q12]:** the sync run ends `partial` with reason `budget_exhausted`; it is **not** a successful sync, and the next tick resumes from the cursor. What `partial` means for progress, the watermark, sync history, resumption and freshness is §6.12.
- **Throughput consequence of the approved numbers (arithmetic, not a measurement).** 5 requests per second over 120 s allows at most **600 requests per run**. With comments embedded in the ticket response, 50 pages are reachable and the 5,000-ticket cap can bind. With a **separate comments request per ticket**, the budget binds first: roughly 500–600 tickets per run. A 90-day import of 5,000 tickets then takes about 9 runs (about 45 minutes at a 5-minute tick); a 20,000-ticket import about 34 runs (about 3 hours). Slow-but-safe is the intended behavior, and the cursor makes it resumable. The roadmap's N8-S2 trigger (backfill over 4 hours or repeated 429s) is the existing alarm for this.

### 6.4 Abort guards and the ceiling **[approved; baselines and formulas defined here; Q11 and Q13 applied]**

All guards run **inside `normalize()`, before it returns a `CanonicalBatch`**, so the projector never sees an aborted batch and nothing from it is partially applied. An abort ends the pass with an error recorded on the sync run (reason, counts, up to 20 record ids) and on `Integration.lastSyncError`; **existing cases, events and evaluations are untouched**, the watermark does not advance, and raw events already ingested are kept (append-only).

**Definitions**, computed at the start of the pass under the organization lock:

- **L** = live cases of this integration in the baseline: `Case` rows with this `organizationId` and `sourceIntegrationId` and `deletedAt` null, **all of them, in both an incremental and a full pass** (never only the cases the pass touches).
- **B** = the records the pass attempts to normalize: distinct tickets in the snapshot set it processes (all stored tickets in a full pass; the tickets after the watermark in an incremental pass). A ticket counts once.
- **F** = the members of B that fail (mapping or event derivation); a ticket counts once.
- **D** = distinct external ids in the batch's deletion set that are currently live.
- **R** = existing live cases (those counted in L) whose derived **lifecycle state** differs from the stored one. Lifecycle state is *closed* (a current `case_closed`; `Case.closedAt` non-null) versus *open*; R counts open→closed and closed→open flips. New cases and deletions are not counted in R (deletions have their own guard).
- **N** = distinct ticket ids in the pass that are not currently live cases (would be new cases).

| Guard | Abort when | Reason code |
| --- | --- | --- |
| Mass deletion **[approved]** | **D > max(3, 0.05 × L)** (no rounding: with L = 101 the threshold is 5.05) | `mass_deletion` |
| Failed records **[approved: Q2]** | **F ≥ 3 and F > 0.25 × B** | `mass_record_failure` |
| Mass lifecycle change **[approved: Q3, amended by Q11]** | **R ≥ 10 and R > 0.25 × L** (both must hold) | `mass_lifecycle_change` |
| Live-case ceiling **[provisional: Q13]** | **L + N > C**, where C is the configured ceiling (§6.10) | `live_case_ceiling` |

**Q2, exact semantics.** The 25% ratio is unchanged; the minimum is **three failed records**. When the guard does **not** fire, each failed record is excluded from the batch and reported individually on the sync run (`{recordId, code}`), the usable remainder projects normally, and the stored state of the failed tickets is left as it was. A single failed record, or any two, never aborts a pass.

| B | F | Aborts? | Why |
| --- | --- | --- | --- |
| 1 | 1 | no | F < 3 |
| 2 | 2 | no | F < 3 |
| 4 | 1 | no | F < 3 |
| 8 | 2 | no | F < 3 |
| 3 | 3 | **yes** | F ≥ 3 and 3 > 0.75 |
| 8 | 3 | **yes** | 3 > 2.00 |
| 11 | 3 | **yes** | 3 > 2.75 |
| 12 | 3 | no | 3 > 3.00 is false |
| 12 | 4 | **yes** | 4 > 3.00 |
| 100 | 25 | no | 25 > 25.00 is false |
| 100 | 26 | **yes** | 26 > 25.00 |

These boundary cases are the focused tests (§13).

**Q3 and Q11, exact semantics [approved].** The lifecycle guard aborts **only when both conditions hold**: `R ≥ 10` **and** `R > 0.25 × L`. The 25% ratio is unchanged; the minimum count of ten means a small integration's ordinary day (for example 3 of 10 tickets closed) never aborts a usable pass. When it fires, the pass aborts **before any projection** and the abort is **atomic and auditable**: the batch is never partially projected; the sync run records outcome `aborted`, reason `mass_lifecycle_change`, and `R`, `L`, the ratio and up to 20 record ids; `Integration.lastSyncError` carries the same reason; cases, events, evaluations and the watermark are unchanged.

| L | R | Aborts? | Why |
| --- | --- | --- | --- |
| 8 | 8 | no | R < 10, though every case flipped |
| 30 | 9 | no | R < 10, though 9 > 7.50 |
| 20 | 10 | **yes** | R ≥ 10 and 10 > 5.00 |
| 39 | 10 | **yes** | 10 > 9.75 |
| 40 | 10 | no | 10 > 10.00 is false |
| 40 | 11 | **yes** | 11 > 10.00 |
| 100 | 25 | no | 25 > 25.00 is false |
| 100 | 26 | **yes** | 26 > 25.00 |

These boundary cases are the focused tests (§13).

**The ceiling [provisional: Q13].** If `L + N > C` (C is the configured ceiling, §6.10) the pass fails safely with `live_case_ceiling`: **no case is rewritten, no case is deleted, nothing is projected**, nothing is silently truncated, existing data stays visible and monitored, and ingest does not start a new run for that integration until the count falls to the ceiling or the owner narrows the window. Because the ceiling check precedes any full-set rewrite, a full pass can never begin over an oversized set. C is a configured value, not a literal in the code; its default is set by the benchmark gate (§6.10).

Two consequences, stated so they are not surprises: a guard abort **repeats on every pass until the cause is resolved**, because the watermark does not move; and a legitimate bulk change (a team really closes 30% of tickets) trips the lifecycle guard until it is resolved by the override procedure of §6.11, which is never automatic and is available **only for this guard**. A rejected mass deletion has no override at all (R2); until a separate reviewed cleanup workflow exists (§15-U2) it keeps aborting the pass. Rewrites caused by a **configuration change** are covered by the dry-run and diff rule (§6.8), not by this runtime guard.

### 6.5 Deletion **[approved]**

- A ticket is **never** deleted because it is absent from a list response.
- Deletion is authoritative only when (a) the source supplies a reliable deletion signal in the data (a status value or boolean path the owner maps as "deleted"), or (b) a **verified re-fetch** (`ticketDetail`) establishes the documented deletion condition (a 404). Either writes a `ticket_deleted:{id}:{hash}` raw event, as the Zendesk adapter does (`packages/zendesk/src/backfill.ts`; **[verified]**), and normalization reads it.
- The projector never clears `deletedAt` (`packages/ingestion/src/projector.ts`; **[verified]**). A ticket restored at the source stays hidden in V1; undelete is deferred. This is a documented limitation.

### 6.6 Idempotency

Raw events are unique on `(integrationId, providerEventId)`; snapshots add a content hash to the id; cases are unique on `(organizationId, sourceIntegrationId, externalId)`; events are reconciled by `diffNormalizedEvents`. Re-running a pass creates no duplicate case or event. **[verified]** (`schema.prisma`, `packages/ingestion/src/diff.ts`.) The duplicate-id check in preview protects against a source whose "id" is not unique.

### 6.7 Sync runs **[approved]**

Every run (worker or manual) records one `IntegrationSyncRun`: start and end time, trigger, outcome (`ok`, `partial`, `failed`, `aborted`), a **reason code** for every outcome other than `ok`, config version, counts (requests, bytes, records, cases and events written, deletions), failure count, and up to 50 record-level failures as `{recordId, code}` with **no payload text**. **Retained 30 days [approved]**, pruned by the worker's reconciliation tick. Recording is generic for all providers (§10).

**`partial` [approved: Q12, R3, R6]** is a distinct outcome, never folded into `ok` and never folded into `failed`. It means the run stopped **only because** its time or record budget was exhausted. Its reason is one of `budget_exhausted` (the 120 s budget, §6.3) or `run_cap_reached` (the pages, tickets or bytes per run of §6.2; approved by R6). A partial run records how far it got (pages completed, records read, whether the initial import is still running) so that sync history shows progress, not just a status. Reasons for `partial` are recorded in the sync run, **separately** from the failure code fields: a run that is partial carries no failure code, and a failed run carries no partial reason except as a secondary note (§6.12). Guard aborts, flag-off stops and the ceiling use `aborted` or `failed` with their own codes (§6.4, §8.7).

### 6.8 Configuration versions **[approved]**

- A version is **immutable** once created; there is no update path. Activation points `Integration.activeConfigVersion` at it with a compare-and-set. **Rollback** re-activates an earlier version.
- A draft is validated before activation (schema, connectivity, mapping against a live sample, the §5 mode checks).
- **Mapping changes are forward-only by default.** `Case.openedAt` and `Commitment.startedAt` do not move (**[verified]**). Any change that could alter derived events or commitments requires a **dry-run and diff** first: `deriveBatch` is pure, so the new configuration is run over the stored snapshots and compared to the stored events with `diffNormalizedEvents`, without writing, and the UI shows the cases and events that would change.
- A new configuration that needs a field the stored whitelist projection does not contain (§7) cannot be dry-run from stored data; the UI says a **re-import** of the window is required and shows its cost against the limits.
- A version that makes a commitment kind newly unsupported for an integration that already has commitments of that kind also requires the commitment dry-run and explicit confirmation of §5.5 before it can be activated.

### 6.9 Cost of processing the stored set, and the capacity ceiling **[verified; Q6 check; Q13 applied]**

Q6 required verifying the existing normalization and projection cost before accepting the provisional ceiling. The answer is that **the 20,000 figure is not supported by any measurement, and re-deriving the whole stored set on every pass is not acceptable as a standing design.** Q13 therefore withdraws 20,000 as a ceiling to be assumed: the existing capacity documentation (`docs/capacity-limits.md`) and the N8-S3 thresholds are **constraints the custom provider must be shown to meet, not proof that it does.** Neither document measured provider normalization or projection.

| Finding | Evidence |
| --- | --- |
| The measured envelope stops at 10,000 cases and calls it "degrading" | `docs/capacity-limits.md`: comfortable up to about 5,000; at 10,000 the dashboard takes 3.5 s and the sweep holds the organization lock for 17.6 s; "beyond 10,000: not measured". 20,000 is outside it. |
| The measured numbers exclude provider normalization and projection | The perf seed inserts `NormalizedEvent` and `RawEvent` rows directly (`packages/db/src/scripts/seed-perf-baseline.ts`), and the roadmap's Phase 7 task 7.7 notes record that the incremental-normalization win "isn't visible in this seed". The recorded stages are next-reply, evaluate and lock hold; the cost of `normalize` plus `projectCanonicalBatch` per case is **unmeasured**. |
| The projector does several sequential queries per case even when nothing changed | `projectCanonicalBatch` (`packages/ingestion/src/projector.ts`): per case, a customer-identity lookup and an `upsert` (both awaited in a loop), then per event group a `findMany` of stored events plus a transaction only when the diff is non-empty. About three round trips per ticket per pass, plus customers, all inside the organization lock (**[verified]** from the code). |
| The `upsert` runs on every pass | The projector upserts each case unconditionally, so every pass issues an UPDATE for every case row (Prisma rewrites the `@updatedAt` column on each update; **[assumed]** standard Prisma behavior, not measured here). |
| Reading cost grows with snapshots, not with cases, and is unbounded while pruning is deferred | The Intercom builder (the model for V1) loads **every** snapshot row of the integration and keeps the latest per ticket (`latestSnapshotById` in `packages/intercom/src/normalize.ts`). Each change to a ticket adds a raw event (up to 64 KB for `custom`). With H-5 deferred nothing prunes them. A live-case ceiling does not bound this. |
| Rough estimate (an estimate, not a measurement) | 20,000 tickets × about 3 sequential round trips is about 60,000 queries per pass; at 1–3 ms each that is **1–3 minutes inside the organization lock**, against a 5-minute poll and webhooks that wait for the same lock. |
| The roadmap already names the alarm thresholds | N8-S3: organization sweep above 30 s or lock hold above 10 s. Both are **database-side** figures; see "What the thresholds measure" in §6.10. |

**Conclusion.** (1) A full pass on every tick is not acceptable at 20,000 cases and is not shown acceptable at 5,000–10,000. (2) Neither 10,000 nor 20,000 is validated for `custom`; 20,000 exceeds the largest size `docs/capacity-limits.md` measured and calls "degrading" (10,000), and the measured figures exclude normalization and projection. (3) No other provider is redesigned: this concerns only how `custom` uses the contract that already exists.

**Design under evaluation [proposed, not approved: Q13]:**

1. Honour `NormalizeContext.mode` as in §6.1: incremental on the active poll, full only on the reconciliation sweep, at activation, after a configuration change and on operator request.
2. For the full pass, read the **latest snapshot payload per ticket** and only the **ids** of older snapshots (the projector's `ownRawEventIds` must still list them so events sourced from an older snapshot are reconciled), instead of loading every payload.
3. **It is adopted only if §6.10 shows both that it is correct (replay and equivalence evidence) and that it is fast enough.** Neither has been shown.

**Until the benchmark gate has produced results:**

- The live-case ceiling is **provisional** and exists as a configured value from the first line of the guard code (§6.4), so there is always a limit that fails safely. **Its working default before results is 5,000 [approved: R4]: a conservative, explicitly unvalidated guard limit** taken from the one size `docs/capacity-limits.md` measured as comfortable (about 5,000 cases), and that document did not include provider normalization or projection. **It is not a validated custom-provider capacity and must not be described as one** in the product, the customer documentation or the marketing copy. It does not decide the final ceiling.
- **Beta activation stays blocked until the benchmark has determined the final ceiling (§6.10).** If the benchmark fails at 5,000 or at any tier, the ceiling is lowered or the processing design is revised before activation; a failing benchmark is never answered by raising a limit.
- The Beta flag cannot be enabled for any organization before the gate has passed and the ceiling has been fixed from its results (§12 ordering rule).
- `incrementalNormalization` is `false`. If the incremental design is not demonstrated, the fallback is a full pass per tick **only at a ceiling the benchmark shows fits the thresholds**, otherwise a lower ceiling; no design is chosen by hope.
- A configured limit that is exceeded is never worked around: no silent truncation, no partial rewrite of cases, no skipping of the oldest tickets.
- Raw-event pruning stays deferred until H-5 is resolved; the benchmark must therefore be run with unpruned snapshot growth (§6.10).

### 6.10 Benchmark gate before the ceiling is finalized **[approved as a gate: Q13; criteria proposed]**

N9.7 is not complete, and the Beta flag cannot be enabled, until a written benchmark report exists. The report is the only thing that fixes the ceiling `C`, and it states, for each tier, what was measured and on what hardware. Existing figures in `docs/capacity-limits.md` and the roadmap's N8-S3 thresholds are inputs to the pass/fail decision, not results.

**Method**

| Item | Requirement |
| --- | --- |
| Data | Synthetic custom-shaped data through the real `deriveBatch` and the real projector, not rows inserted directly into `NormalizedEvent` (the existing perf seed bypasses both; §6.9). |
| Tiers | 1,000, 5,000, 10,000 and 20,000 live cases, so the growth curve is visible and not just the endpoints. |
| Realistic volume | Raw snapshots per ticket (for example 1, 5 and 10), comments per ticket (for example 0, 5 and 20), payloads up to the 64 KB cap for the worst case, and the resulting `NormalizedEvent` count per case. Multiplicities are taken from a design partner's real data when available; otherwise the assumption is stated. |
| Passes | Full pass; incremental pass at 1%, 5% and 25% of tickets changed; first activation (dry-run); a pass that aborts on a guard (the abort path must be cheap and must not write). |
| Environment | A fresh scratch database migrated from the current schema (the shared `sla_test` database has drifted and is not usable for this), warm and cold cache, hardware recorded. The production host's size is not recorded in the repo, so the report also runs on the closest available equivalent and says which. |
| Concurrency | The pass runs while a second organization is processed and while webhooks for the benchmarked organization wait on the lock. |
| Repetition | At least five runs per cell; report median and p95. |

**Measurements per pass**

1. Wall time per stage: ingest-independent normalization (`deriveBatch`), guard evaluation, projection, commitments, evaluation, notifications.
2. Database queries: count per pass and per case, rows read and written, bytes read from `raw_events`, and round trips inside the organization lock.
3. **Organization-lock duration**, and the longest time a waiting webhook is blocked.
4. **Memory**: peak RSS and heap of the worker process during the pass, growth across repeated passes (a leak check), and the size of the largest in-memory structure.
5. The existing `PERF_METRICS` scopes, so results are comparable with `docs/capacity-limits.md`.

**What the thresholds measure.** Both are **database-side** measurements for one organization, and **neither includes provider HTTP ingestion**:

| Figure | What it covers | What it excludes |
| --- | --- | --- |
| **30 s p95, "organization sweep"** (N8-S3) | The wall time of one organization's reconciliation sweep after ingest: `deriveBatch` normalization, guard evaluation, projection, and the commitment, next-reply, evaluation and notification stages for that organization. This is the same set of stages `docs/capacity-limits.md` reports as "sweep" (next-reply, evaluate, lock held). | Fetching from the customer's API (`ingest`), including retries, waits and child requests |
| **10 s p95, "organization-lock hold"** (N8-S3) | The time `withOrganizationSlaLock` is held: the DB-local normalization and the commitment, cycle, evaluation and notification pipeline tail (`packages/db/src/organization-lock.ts` states that it "deliberately excludes provider backfill/ingestion") | Ingest; time spent waiting for the lock |
| **120 s total ingest-run budget** (Q4, §6.3) | Provider HTTP work only: every request attempt, retry back-off, rate-limit wait and child request, measured from the start of `ingest` | The DB-only normalization and projection that follow |

The 30 s and 10 s figures and the 120 s budget are independent bounds on different work. Meeting one never relaxes another, a long ingest does not count against the sweep or the lock, and a fast sweep does not extend the ingest budget. N8-S3 itself says "org sweep > 30 s" without naming the span; the reading above is this plan's statement of it, taken from the lock's documented scope and from the stages `docs/capacity-limits.md` measured, and it is subject to the owner's review.

**Pass criteria for a tier**

- Organization sweep at or below **30 s** and organization-lock hold at or below **10 s** at p95 (the N8-S3 thresholds, used as limits), including the custom provider's normalization and projection. **Neither threshold is changed by this plan; what they measure is stated under "What the thresholds measure" below.**
- Memory comfortably inside the worker's configured limit; the report states the margin and the owner decides whether it is enough.
- Query count and lock time that scale no worse than linearly with live cases, with the measured slope reported.
- Any further safety margin below the N8-S3 thresholds is the owner's call when the results are in.
- **`C` is the largest tier that passes.** If no tier passes, the ceiling is lowered and the processing design is revisited before Beta; 20,000 is configured only if the 20,000 tier passes. If a tier passes only with the incremental design, the ceiling applies only once the incremental design has also passed the correctness criteria below.

**Correctness and replay criteria for the incremental design (all required before it is adopted)**

1. **Equivalence:** after any randomized sequence of ingest and incremental passes, a full pass over the same stored data produces zero difference in cases, events and commitments (a differential test over many seeded sequences).
2. **Replay:** resetting the watermark and re-running yields identical events; repeating a pass is a no-op; normalizing the same rows twice with different fetch times is identical.
3. **Crash safety:** a failure between projection and watermark advance re-processes harmlessly; an aborted pass never moves the watermark.
4. **Out-of-order commits:** raw events that commit out of `fetchedAt` order, late look-back overlaps and backdated updates are not missed (the overlap rule Zendesk uses, or a stated equivalent).
5. **Deletion and lifecycle:** deletion signals and reopens in an incremental pass produce the same result as in a full pass; guard baselines `L`, `R`, `D`, `N` are computed over the whole integration in both modes (§6.4).
6. **Forced full pass** after a configuration change, at activation and on an operator request, proven by test.
7. **D24 replay** on a restored backup shows 0 differences for every existing provider (the shared paths are untouched), and the custom fixture's differences, if any, are classified.

### 6.11 Override after a safety-guard abort **[approved: Q15, R1, R2]**

**There is no automatic bypass.** A guard abort is never retried with relaxed thresholds, never cleared by waiting, and never overridden by a setting or a flag.

**What can be overridden [approved: R2].** Only the **mass lifecycle change guard** (`mass_lifecycle_change`). An override **never** bypasses: the failed-record ratio guard (correct the mapping instead), the live-case capacity ceiling (narrow the window or lower the configured value), the wall-clock budget (§6.3), request limits (§6.2), tenant isolation, security validation (§8), the Beta flag, or owner-only authorization of customer routes.

**Mass deletion is not overridable [approved: R2].** An override may not force a deletion that the deletion guard rejected. Cleanup of a rejected mass deletion needs a **separate, reviewed workflow** that is **not designed in N9** (§15-U2). Until it exists, a `mass_deletion` abort stands and repeats on every pass (§6.4), and the integration shows the needs-attention state of §6.13 with the counts and record ids.

**Who can authorize [approved: R1].** The customer-side authority is the **organization owner or an explicitly authorized organization administrator.** **Finding [verified]:** the product has only two organization roles, `owner` and `member` (`UserRole`, `packages/db/prisma/schema.prisma`; `requireOwner` in `apps/web/src/lib/authz.ts`), and **no administrator role or delegation exists.** In V1 the only customer-side authority is therefore a user with the `owner` role. An "explicitly authorized administrator" would need a delegation mechanism that does not exist and is not built in N9; **Approved (U1): the organization owner only in V1**; adding delegation needs its own decision. A `member` can never authorize an override.

**Customer path** (owner, in the application):

1. The owner opens the aborted pass and sees an **explicit preview**: the guard, `R`, `L` and the ratio, the affected record ids, and the open/closed flips that projecting them would cause. The preview is read-only.
2. The owner enters a **required reason** (free text).
3. The owner gives a **narrowly scoped confirmation**: bound to one integration, one guard (`mass_lifecycle_change`) and the exact preview (a hash of the aborted pass's record set); **single use**; expiring [the 24-hour expiry is proposed, not approved].
4. The next pass projects that record set once. If the underlying data changed, the preview hash no longer matches, the confirmation is void, and a new preview is required. The pass after that is guarded again.
5. Everything is written to a **durable override record** (below). The override is also referenced on the sync run that applied it.

**Support-assisted path (exceptional) [approved: R1].** A platform operator never silently overrides a customer's safety guard, and being a platform operator does not imply this ability. It is a **separate permission path** with all of:

- a **distinct permission**, not implied by `requirePlatformOperator` (**approved, U6:** a separate allowlist beside `PLATFORM_ADMIN_EMAILS`, so not every operator can);
- **explicit customer authorization** that the operator can neither create nor assert: the organization owner records, in the application, an authorization bound to the same preview hash, single use and expiring (same proposed 24-hour expiry). The operator then applies exactly that authorized, previewed override;
- an **audit record** in both places: the durable override record (path `support_assisted`, operator, authorizing owner, reason, preview hash, counts, outcome) and an `AdminAuditLog` entry (new action `apply_guard_override`; the exact name is fixed in N9.11), which today records only the platform side;
- the same **narrow, single-use, expiring confirmation** and the same never-bypass list.

**Durable override record [design approved: U6; not implemented; the field list is a proposal].** An additive, tenant-scoped model (for example `GuardOverride`): `organizationId`, `integrationId`, `guard`, `previewHash`, counts, `reason`, `path` (`customer` or `support_assisted`), requesting and authorizing user ids, operator email for the support path, `expiresAt`, `consumedAt`, `outcome`. It needs a tenant-scope classification (§8.6). It is **not** pruned with the 30-day sync history and it is not `AdminAuditLog`, which is a platform-side log; there is no organization-level audit log today (**[verified]**: the schema has `AdminAuditLog`, `BillingEvent` and `EntitlementEvent` only).

### 6.12 Partial runs, failures and freshness **[approved: Q12, R3, R6; mechanism proposed]**

**Rule [approved: Q12, R3].** A run that ends **only because** its time budget (120 s) or its record budget (pages, tickets or bytes per run, §6.2) is exhausted is **`partial`, not successful**, and **not a failure**. A real provider, authentication, transport or processing failure keeps the applicable failure policy and is never hidden because the overall run was also partial.

**Classification of a run** (applied in this order):

| Order | What ended the run | Outcome | Health effect |
| --- | --- | --- | --- |
| 1 | `ReauthRequiredError` (401), `PermissionDeniedError` (403), `credentials_unreadable`, not configured, or an unexpected exception | `failed` | The existing policy, unchanged: `lastSyncError` set, `consecutiveFailures` incremented, `failingSince` set if empty, status transitions for 401 and 403 as today |
| 2 | A provider or transport error that exhausted its retries (5xx, network, TLS, `bad_response`, 429 that did not clear), **including when the budget ran out while that request was still being retried** | `failed`, with the error code; `budget_exhausted` may be noted as secondary | The existing failure policy. **The budget cannot turn a failing provider into a "partial" run.** |
| 3 | A guard abort in normalization (`mass_record_failure`, `mass_deletion`, `mass_lifecycle_change`) or a normalization or projection error | `aborted` (or `failed` for an error) | A normalization error is already an error under `cycle.ts`, so the existing failure policy applies and the reason is recorded |
| 4 | Only the 120 s budget or a per-run cap, with no error in the current page's request chain | `partial` | `lastSyncAt` and duration written; `lastSuccessfulSyncAt`, `consecutiveFailures`, `failingSince` and `lastSyncError` **untouched** |
| 5 | The final page of the listing pass completed and normalization succeeded | `ok` | `lastSuccessfulSyncAt` set, `consecutiveFailures` reset (existing behavior) |

Partial runs and their reasons are read from the **sync-run history** (§6.7), not written into `lastSyncError`, so a failure message is never mistaken for progress and progress never overwrites a real failure message. The integration page reads the latest sync runs (§6.13).

**Exact behavior when a run contains completed pages and record failures [approved: R3 and U4].** "Record failure" means a ticket that could not be mapped or derived (`F` in §6.4).

| Case | Outcome | Pages | Counters and watermarks | Reporting |
| --- | --- | --- | --- | --- |
| A. The pass completes; `F` is below the failure-ratio guard | `ok` | All kept | `lastSuccessfulSyncAt` advances (the usable remainder projects normally, Q2); the failed tickets keep their previous stored state | Every failed ticket reported individually `{recordId, code}` (up to 50, plus the total); the integration page shows "N tickets could not be processed" until they succeed |
| B. The run ends on the budget or a cap; `F` is below the guard | `partial` | Completed pages kept | No watermark advance, no counter change | Both the partial reason and the failed tickets are recorded and shown |
| C. The run ends on the budget or a cap and the `F` guard fires on the pages read | `aborted` (`mass_record_failure`), partial reason noted as secondary | Completed pages' raw events are kept (append-only); nothing from them is projected | No watermark advance; the existing failure policy applies (`consecutiveFailures` incremented) | The failure is the headline; the partial reason is secondary |
| D. Pages 1 to k complete, then a real provider or transport failure | `failed` | Pages 1 to k kept and normalized; resumption starts at page k+1 | No `lastSuccessfulSyncAt`; failure policy applies | Failure code headline; progress recorded |
| E. The run ends on the budget; some tickets in the completed pages fail | `partial` (as B) | Kept | As B | As B |

**Failed tickets are not lost.** A failed ticket is retried on every later pass until it succeeds: a full pass always retries it, and an incremental pass includes the persisted set of failed ticket ids in addition to the tickets after the watermark. A watermark never moves past an unresolved failed ticket without it being in that set.

**Progress and the watermarks [approved: Q12]**

- Progress is kept only through the **last fully completed page**, where a page means the listing request **and every child (comment) request for its tickets**. The page's raw events and the cursor are written together in one transaction, so a crash or a stop leaves either the whole page or none of it. A page that did not fully complete writes nothing.
- The **successful-sync watermark does not advance.** `Integration.lastSuccessfulSyncAt` is set only by the run that completes the final page of a listing pass (a pass may span several runs) and the normalization that follows it without error. A partial run never sets it and never claims full freshness.
- The **updated-since watermark** moves only when a full listing pass completes. A pass spanning several runs keeps the **same window anchor** (persisted with the cursor), so resuming never shifts the window and leaves a gap.
- `backfillCompletedAt` is set only when the whole initial window has been read.

**Resumption without duplicates [approved: Q12]**

- Raw events are unique on `(integrationId, providerEventId)` and are written with `skipDuplicates`; a page repeated after a stop produces identical rows and writes nothing new (§6.6).
- Normalization is deterministic and the projector reconciles events by `diffNormalizedEvents`, so a repeated pass produces no new events.
- Commitments are created only by the shared commitment pipeline from projected events, and are unique on `(caseId, kind, cycleKey)` (**[verified]**). With no new events there is no new commitment. Ingest creates no commitment.
- A partial run never deletes: absence from an unfinished listing is never a deletion signal (§6.5).
- The DB-only normalization and projection of the pages that did complete still run and are visible, and are subject to the same guards.

**What the existing freshness model does with a partial run [verified, then proposed]**

- **Verified.** Freshness is a pure function of `lastSuccessfulSyncAt`: stale when `now − lastSuccessfulSyncAt > 3 × expected interval`, and a never-successful source is stale (`assessFreshness`, `packages/core/src/freshness.ts`). `cycle.ts` writes `lastSuccessfulSyncAt` only when the cycle recorded no error and treats a normalization error as a sync error. Today there is no third outcome: an ingest that returns is a success.
- **Proposed (shared change, §10).** `cycle.ts` gains the third outcome through an **optional** `partial` marker and reason on `IngestResult` (`packages/ingestion/src/contract.ts`). Adapters that never set it take today's path unchanged. On `partial` it writes `lastSyncAt` and `lastSyncDurationMs` only. Nothing in `assessFreshness` changes.
- **D13(b), unchanged.** A source that keeps running partial runs stops advancing `lastSuccessfulSyncAt` and becomes stale after the existing grace, like a paused or failing source. Stale at-risk alerts keep the stale-data marker; **breach alerts stay held** until a run completes the pass and the case is re-evaluated against fresh data (N3.5). A partial run never releases a held breach alert, never clears the stale marker, and never shortens or lengthens the grace. The stale-data rules apply to partial and to failed runs alike.
- **A zero-progress run** (the budget expired before any page completed) is `partial` the first times, but a run that makes no progress can never finish. After **three consecutive zero-progress runs** the next one is classified `failed` with code `no_progress` and follows the failure policy, so a source too slow to read one page is not left looking like a healthy import [approved: U5].
- **Initial import.** Until the first complete pass the integration has no `lastSuccessfulSyncAt` and is stale, and breach alerts for its cases are held (commitments computed from a half-read set would be unreliable). That is intentional and is shown to the customer as an import, not as an outage (§6.13). A 20,000-ticket import with per-ticket comment requests takes hours (§6.3).
- **A source with no incremental cursor** can only be activated if one pass fits in one run (§4.3). If it later outgrows the run limits it cannot recover on its own, so a `partial` run for such a source is reported as needs attention (§6.13), not as catching up.

### 6.13 Customer-facing sync states **[approved: R6; wording proposed]**

A long initial import must not look like a broken integration. The integration page, the integrations list and the case detail show exactly one of these states, derived from the latest sync runs (§6.7), `backfillCompletedAt`, the failure counters and the freshness assessment. The styling is neutral for the first three and an error style only for needs attention.

| State | When | What the customer sees | What it does not say |
| --- | --- | --- | --- |
| **Importing history** | `backfillCompletedAt` is null; recent runs are `ok` or `partial` with progress; no failure streak | "Importing your history: N of about M tickets read." Elapsed has not yet seen all your tickets; SLA clocks and breach alerts start after the first complete import | It never says "failed" or "disconnected", and never claims data is current |
| **Catching up** | The initial import is complete; the latest runs are `partial` with progress, and the source has an incremental cursor | "Catching up: your system returned more changes than one sync can read. Data is current through <time>." The stale-data marker applies per D13(b) | It does not say the integration is healthy or fully up to date |
| **Up to date** | The latest pass completed (`ok`) and the source is fresh | The existing healthy state; if some tickets failed, "N tickets could not be processed" with the list | |
| **Needs attention** | A real failure (reauth, permission, credentials unreadable, provider or transport failure, guard abort, ceiling, `no_progress`), or a `partial` run for a source with no incremental cursor | A specific cause and the action to take (reconnect, re-enter credentials, narrow the window, review a flagged change). Error styling | It never reports a failure as a slow import |
| **Paused / disabled** | Operator pause or the Beta flag off (§8.7) | The existing paused or disabled notice | |

The stale-data marker (D22/D13) is an overlay on any state, shown with the time the source became stale. Customer-facing copy for these states is a draft until the implementation is verified (Appendix A) and never states a supported capacity (§6.9).

---

## 7. Raw payloads, personal data and retention

| Topic | Rule |
| --- | --- |
| What is stored | **[approved]** A **whitelist projection** of the mapped fields and the identifiers the pipeline needs, not the arbitrary payload. Unmapped fields (emails, phone numbers, attachments, internal notes) are never stored. The projection keeps the original key nesting, so the same path expressions evaluate against stored payloads. |
| Size | **[approved]** 64 KB per stored payload; larger fails its record (`payload_too_large`). |
| Samples | **[approved]** Sample responses are **never stored server-side**. They are held in memory for the request and returned only to the owner's browser. |
| Latest snapshot | **[approved]** The latest snapshot a live case needs (for replay and for Conversation rendering) is kept. |
| Pruning | **[approved: deferred]** The proposed 30-day pruning of superseded raw snapshots is **not implemented**. Raw events are append-only and replayable; **H-5 (raw-event retention) is an open decision** (`docs/data-retention-and-on-call.md`, "Decisions (owner)"). Pruning stays deferred until H-5 is explicitly resolved. **No raw event is deleted to implement this feature.** |
| Why this is not indefinite-by-accident | Retention of the latest projected snapshot per live case is the same as every provider today (no expiry; **[verified]** in the retention doc) and is justified by replay and Conversation rendering. The superseded-snapshot question is the part H-5 decides. `NormalizedEvent.sourceRawEventId` is `ON DELETE RESTRICT` (**[verified]**), so any future prune may delete only unreferenced rows. |
| Drafts | **[approved]** Drafts and draft secrets **expire after 14 days**; the worker (or lazy cleanup) deletes them. |
| Sync runs | **[approved]** 30 days (§6.7). |
| Disconnect | Existing soft disconnect: credentials cleared, `status = disconnected`, configuration versions and data kept, data hidden by the read-side predicates (`packages/db/src/integration-visibility.ts`; **[verified]**). |
| Conversation rendering | **[approved: option B]** An additive, optional config-loading hook on `ProviderWebAdapter` supplies the configured body and author paths at render time. Ingest-time interpretations are **not** frozen into raw payloads, so replay is preserved. |
| Stored comment bodies | Stored only if a body path is mapped for display. Omitting it keeps message text out of Elapsed; the Conversation then shows event rows without bodies. |

---

## 8. Security design

### 8.1 Destination rules **[approved]**

Applied to the base origin and to **every** request, in the web app and in the worker (DNS and configuration can change after save):

1. WHATWG URL parse (this normalizes decimal, octal and hex IPv4 forms), `https:` only, port 443 only, no userinfo, length-limited.
2. Reject IP-literal hosts, `localhost`, single-label hosts, and `.local`, `.internal` and `.localhost` names; strip a trailing dot.
3. Resolve the name and require that **every** returned address is public. The classification reuses the existing predicate `isPublicAddress` (`packages/email/src/destination.ts`; **[verified]**: it already covers loopback, RFC1918, link-local and the metadata address 169.254.169.254, CGNAT, NAT64, Teredo, 6to4, ULA and IPv4-mapped IPv6), plus explicit denies for known metadata names and `fd00:ec2::254`.
4. A deployment-level override for local development only, modelled on `SMTP_ALLOW_PRIVATE_HOSTS`; never per organization. The name is fixed in the implementation PR [proposed].
5. The ticket-URL template host (a separate hostname from the API base) must be HTTPS, a public hostname, and is matched by **exact hostname equality**. It is used only to *recognize* links and build display links; it is never a request destination and never a redirect target. **[approved]**

### 8.2 Connection pinning and the HTTP client

**[approved, conditional]** Destination validation must apply to the address **actually connected to**, not only to an earlier DNS check, while keeping TLS SNI and hostname verification.

| Option | Mechanism | Status |
| --- | --- | --- |
| A. `undici` `Agent` with `connect.lookup` | The socket connects to the address the hook returns; SNI and certificate checks default to the origin hostname | **Preferred, but proceed only if the N9.1 spike proves it** |
| B. `node:https` with `Agent({ lookup })` | Same mechanism, no new dependency; timeouts, size caps, redirects and streaming are hand-written | **Documented fallback if the spike fails** |
| C. Resolve, then connect to a literal IP with `servername` and `Host` | The SMTP guard's approach | Rejected: fragile with dual-stack and SNI-routed hosts |
| D. External egress proxy | Network-level | Out of scope for V1 |

`undici` is not a direct dependency today; the lockfile contains only `undici-types` (typings) (**[verified]**). Adding it is conditional **[approved]**.

**N9.1 spike: pass criteria (all must hold, with local test servers; nothing is assumed from documentation):**

1. **Pinning:** with a resolver that answers a public address at validation and a private one at connect, the connection still goes to a validated address, or is refused.
2. **TLS hostname verification:** a server presenting a certificate for another name is rejected.
3. **SNI:** the server observes the SNI equal to the hostname, not an IP.
4. **Dual-stack:** a name with both A and AAAA records connects only to validated addresses; if any record is non-public the request is refused; fallback between families never uses an unvalidated address.
5. **Per-request revalidation:** a pooled keep-alive connection is not reused for a request whose fresh resolution is now non-public; practically, one agent per run, no reuse across runs or tenants.
6. **Redirects:** disabled; a 3xx is an error.
7. **Limits:** response-size and decompression caps (`Accept-Encoding: identity` plus a streamed byte cap), timeouts, and abort on budget.
8. **Proxy environment variables are ignored.**

**Recorded result (N9.1, 2026-10-09): all eight criteria pass with option A.** The spike is `packages/safe-http/spike/n9-1-spike.mjs` (`pnpm --filter @sla/safe-http spike`), run against local TLS servers with a private CA, `undici` 7.30.0, Node 22.17.0. Findings N9.2 must honour:

| # | Result | What the evidence shows |
| --- | --- | --- |
| 1 Pinning | Pass | `Agent({ connect: { lookup } })` runs the resolution **and** the validation inside the connect path, so the address connected to is the address validated; a name that now answers with a denied address is refused (`EBLOCKED`) before any socket is opened. There is no separate "check, then connect" window. |
| 2 TLS hostname | Pass | A certificate valid for `api.example.test` is rejected for `other.example.test` (`ERR_TLS_CERT_ALTNAME_INVALID`) even though both names resolve to the same validated address. |
| 3 SNI | Pass | The server observed SNI `api.example.test`, not an IP. |
| 4 Dual-stack | Pass | The hook must return the **whole validated set** and refuse when any record is denied; `autoSelectFamily` then falls back only among validated addresses (the hook is called with `options.all`, so it must support both the single and the array callback forms). |
| 5 Per-run agent | Pass | A new `Agent` re-resolves and re-validates. Within one agent a pooled socket stays on the address validated when it was opened; the client therefore creates **one agent per ingest run**, closes it at the end, and sets a short `keepAliveTimeout`. Pools are never shared across runs or tenants. |
| 6 Redirects | Pass | `undici.request` does not follow redirects; the 3xx is returned and treated as an error by the client. |
| 7 Limits | Pass | Use `undici.request`, **not** `undici.fetch`: `request` does not decompress, so a hostile server that ignores `Accept-Encoding: identity` shows a `content-encoding` header the client rejects, and a streamed byte cap stops a 50 MB body at the cap. `AbortSignal` and `headersTimeout` abort within the bound. |
| 8 Proxy variables | Pass | A plain `Agent` ignores `HTTP(S)_PROXY`; only `EnvHttpProxyAgent` reads them, and it is never used. |

Decision: **option A is adopted; `undici@7.30.0` is added to `@sla/safe-http` as an exact-pinned dependency** (7.x because 8.x requires Node 22.19 or newer and the images use `node:22-alpine`). Option B is not needed. Limitations to document: a customer API behind a corporate proxy cannot be reached; no HTTP/2. The spike's address classification is an injected predicate because local servers cannot be public; N9.2 supplies the real one (`isPublicAddress`).

### 8.3 Request rules

- **Methods:** `GET`, or `POST` with a JSON body only where the owner has designated the endpoint a read-only search/query. Any other method is rejected by the schema and again at request time. `Content-Type` and `Accept` are JSON.
- **Redirects:** disabled. A 3xx fails the request. A next URL or `Link` target must be same-origin and passes §8.1 like any request. Credentials are therefore never sent across origins.
- **Header rules:** custom header names exclude `Host`, `Content-Length`, `Transfer-Encoding`, `Connection`, `Cookie` and `X-Forwarded-*`; CR/LF in names or values is rejected; secret values come only from the secrets store.
- **No secrets in query strings [approved]:** configuration queries may not carry credentials. Query keys that look like credentials (`key`, `token`, `secret`, `password`, `auth`, `signature`, `credential`) are rejected at validation, and a query value equal to a stored secret is rejected at request time. The hard rule is that authentication lives in headers.
- **Template injection:** variables substitute only as in §4.2.
- **Budgets:** the §6.2 limits and the §6.3 wall-clock budget, enforced in one place by the client.

### 8.4 Secrets and redaction

**Storage [approved: Q8 and Q16, conditional on compatibility and security verification].** Secrets are encrypted separately from non-secret configuration and are never returned to the UI. They live in `Integration.credentials.secrets` (and in the encrypted draft until activation). Configuration versions never contain a secret. The API accepts a new value and never returns one; the UI sees only "set / not set". Reuse of `INTEGRATION_TOKEN_ENCRYPTION_KEY` through a **strict per-value helper** is approved only after the compatibility and security verification below passes; the format check is never the security guarantee, authenticated encryption and context binding are. Verified in the code 2026-10-09; the security verification is still to be run in N9.5:

| Property | Finding **[verified]** (`packages/db/src/integration-credentials.ts`, `crypto.ts`) | Fits? |
| --- | --- | --- |
| Format | `enc:v1:` + `base64url(iv).base64url(tag).base64url(ciphertext)`; AES-256-GCM; a fresh 12-byte IV per value; key = scrypt(secret, fixed salt, 32 bytes) | **Yes**, a per-value helper uses it unchanged |
| Key management | One env var, no key id or version. Encrypting or decrypting with the variable unset **throws** (fails closed) | **Yes** |
| Unprefixed values | `decryptToken` returns a value **without** the `enc:v1:` prefix **unchanged** (a migration convenience for old rows) | **No, not as is.** A secret that ever reached the database in plaintext would be used silently. The custom helper must be **strict**: it refuses to write an unprefixed value and refuses to read one (`credentials_unreadable`). |
| Authenticated encryption | AES-256-GCM: a tampered, truncated or substituted ciphertext fails the authentication tag on decrypt (`aesGcmDecrypt` in `packages/db/src/crypto.ts`) | **Yes**; this, not a prefix or envelope-format check, is the integrity guarantee |
| Context binding | The helpers add no additional authenticated data (`aesGcmEncrypt` and `aesGcmDecrypt` take none): any ciphertext decrypts under any row, tenant or field name. Someone with database write access could move one tenant's encrypted key into another tenant's credentials, which would then send it to the other tenant's configured host. | **Required, and not present today.** The custom helper binds each ciphertext to `(organizationId, integrationId, credential field name)`. Mechanism [proposed]: pass those three values as GCM additional authenticated data, so the binding is part of the authentication tag (the wire format is unchanged, because additional data is not stored); if N9.5 finds that helper compatibility prevents that, bind by encrypting an envelope `{ v, organizationId, integrationId, name, value }` inside the authenticated plaintext and verifying it on decrypt. N9.5 picks one by test and records the choice here. Neither mechanism changes how existing providers encrypt or decrypt. |
| Rotation | Changing the key makes every ciphertext unreadable (`IntegrationCredentialsUnreadableError`, generic message, original error kept on `cause`). There is no re-encrypt tool for rotation; `pnpm db:encrypt-tokens` only handles `accessToken`, `refreshToken` and Slack. The roadmap tracks zero-downtime rotation as N8-S7. | **Acceptable with a documented consequence:** after a key rotation **owners must re-enter their custom credentials** until a supported rotation mechanism exists (N8-S7). The deployment documentation and the rotation runbook must say so, because rotating `INTEGRATION_TOKEN_ENCRYPTION_KEY` makes every custom credential unreadable at once. Record the dependency; do not build a rotation tool in N9. |

**Constraints [approved: Q16]:**

- **Existing providers are untouched.** No change to the encryption format, helpers or stored values used by Zendesk, Jira, Linear, Intercom, GitHub or Slack. Any change to that needs its own separately reviewed migration plan.
- **Malformed or invalid ciphertext is rejected safely and is never read as plaintext.** A value that lacks the `enc:v1:` prefix, has the wrong number of parts, is not valid base64url, has the wrong IV or tag length, fails the authentication tag, or fails the context binding is **rejected** with one generic `credentials_unreadable` outcome, indistinguishable from the outside so the failure is not an oracle. The helper never returns the input, a partial plaintext or a default, and there is **no fallback path** that treats custom-provider ciphertext, or an unprefixed value, as a plaintext secret. It also refuses to write an unprefixed value.
- If the strict helper and binding cannot be verified as above, the fallback is a separate key for custom secrets, as a separate decision.

**Decryption failure (including after rotation) [approved with Q16; wording proposed].** The run does not call the source and does not retry; it fails with a generic message ("Credentials unavailable; enter them again") and a distinct sync-run code; the integration is surfaced like a reconnect request. The ciphertext, the key and the original crypto error are never logged: the redaction scrubber drops `cause` chains and error context from Sentry events for this error class.

**Redaction [approved: Q16 extends it to every output].** Credentials, authorization headers, sensitive URLs and payload data are removed from application logs, Sentry, **validation errors, sync history** (`IntegrationSyncRun`, `lastSyncError`) and **UI and API responses**. Validation errors are built from field paths and fixed codes, never from the submitted value: a schema error for a secret field must not echo the input (a Zod issue can carry the received value, so custom error mapping is required and tested). Today there is **no redaction**: the logger `JSON.stringify`s whatever it is given (`packages/logger/src/logger.ts`) and the Sentry wrapper passes context through (`apps/worker/src/sentry.ts`) (**[verified]**), and existing client errors embed the full URL in a message that is stored in the customer-visible `Integration.lastSyncError` (**[verified]**: `IntercomApiError`). The custom client's errors carry only `{status, endpointKey, classification}`; sync-run failures carry `{recordId, code}`. A scrubber is added to the logger wrapper and to Sentry `beforeSend` in web and worker (N9.3); it is a shared change with regression coverage and does not change what non-custom providers log other than removing secrets.

**Verification required before Beta (N9.5 exit; focused tests, §13):** (1) encryption at rest: every stored secret value starts with `enc:v1:`, and a search of `credentials`, drafts and sync runs for a seeded sentinel secret finds nothing in plaintext; (2) redaction: the sentinel never appears in captured application logs, in Sentry events, in validation errors, in `lastSyncError`, in sync-run history or failures, or in any UI or API response, including on error paths; (3) decryption failure and wrong or unset key behave as described, with no secret or ciphertext in any output; (4) the strict helper rejects an unprefixed value and every malformed form listed above (wrong part count, bad base64url, wrong IV or tag length, tampered ciphertext, tampered tag) with the same generic outcome, and never returns plaintext; (5) a ciphertext moved to another organization, integration or field name is rejected; (6) compatibility: the existing providers' encrypt and decrypt paths and stored values are byte-for-byte unchanged, and the existing `decryptToken` tests pass unmodified; (7) the rotation limitation is stated in the deployment documentation.

### 8.5 Endpoints that make outbound requests

Test-connection, sample, preview and validation endpoints are **owner-only** (`requireOwner`), pass the existing same-origin check, are **rate-limited** per organization (existing `checkRateLimit`), allow one request in flight per organization, and return only safe classifications: `ok`, `blocked_destination`, `unreachable`, `timeout`, `tls_error`, `auth_failed`, `forbidden`, `rate_limited`, `bad_response`. A blocked destination never reveals which check failed or what the name resolved to, so the endpoint cannot be used as a port scanner or resolver. The organization always comes from the session, never from input.

### 8.6 Tenant isolation **[approved]**

Every new model carries `organizationId` and is read through organization-scoped helpers. Each needs an entry in `apps/web/test/tenant-scope-classification.test.ts` and seeding in `tenant-isolation.test.ts` (**[verified]**: the first test fails for any model without a classification). Coverage extends to custom configuration, credentials (never returned), sync history, drafts and diagnostics (§13).

### 8.7 Operator Beta flag **[approved: Q5]**

A per-organization enable flag set by a platform operator from `/admin` (audited in `AdminAuditLog`, the existing pattern), **default disabled** for every organization not explicitly enabled. It gates the routes, the UI and activation. It does **not** bypass authorization (owner-only) or tenant isolation, and is checked server-side on every custom route.

**Turning the flag off.** Result: no new outbound request and no retry, existing data preserved and visible, no further sync.

- **New requests and retries.** The flag is checked (a) before an ingest run starts, (b) before every request attempt **including each retry and each back-off wake-up**, and (c) at every page boundary. A disabled flag ends the run before the next attempt.
- **A request already in flight** is aborted through its signal as soon as the disabled flag is observed. While a request is on the wire the run re-checks the flag every 5 seconds (one indexed read), so the maximum delay between the operator's change and the abort is about 5 seconds, and never longer than the request's own bounded timeout. The response, if it arrives anyway, is **discarded**: nothing is written, the cursor stays at the last completed page, and the run ends `aborted` with reason `flag_disabled`.
- **The disabled flag cannot trigger another sync.** (1) The adapter's `ingest` checks the flag first and reports "not configured" (`IntegrationNotConfiguredError`) without a request. (2) The same admin mutation also sets the existing `Integration.pollingPausedAt` (the operator pause of N4.5), which makes the worker skip ingest outright and is recorded as a pause, not as a failure; by contrast the "not configured" path would count as a failed sync and start a "failing since" streak in `cycle.ts` (**[verified]**). Belt and braces: the flag check holds even if the pause is cleared. (3) Every manual route that can cause an outbound request (test, sample, validate, preview, sync now, activate) returns a `beta_disabled` error without any request.
- **Data stays visible and monitored.** Disabling does not hide the integration, change its status, delete anything or stop DB-only work: normalization of the raw events already stored, commitments, evaluation and alerts continue. The integration goes stale and the customer sees it (D22 freshness), exactly as for an operator pause.
- **Turning it back on** does not silently resume polling that an operator paused separately: the pause is cleared by the existing resume control, and the admin screen says so.

---

## 9. Architecture and database

### 9.1 Packages

- `@sla/safe-http`: shared address classification (extracted from `@sla/email`, which re-exports it with its behavior and existing tests unchanged), the pinned HTTPS client, limits and budgets.
- `@sla/custom-ticket`: the Zod config schema, path subset, transforms, validators, the ingest engine, the **pure** `deriveBatch(config, rows)` (preview, dry-run and the worker run the same code), the adapter and the web adapter. It imports only types and errors from `@sla/ingestion` (the existing boundary rule), never the projector, and writes no domain table.

Registered once: `custom: customAdapter` and `custom: customWebAdapter`. Capabilities: `webhooks`, `policyImport`, `calendarImport`, `priorityChanges`, `officialLinks` false; `replyEvents` true only in Full SLA mode; `incrementalNormalization` **false** until the incremental design of §6.1 and §6.9 has passed the correctness and performance evidence of §6.10; it is never turned on by decision alone.

### 9.2 Registration checklist (verified 2026-10-09)

This is the exact surface; it supersedes the shorter list in plan 07 §N7.4.

**Compile-forced** (a missing entry does not type-check):

| File | Change |
| --- | --- |
| `packages/db/prisma/schema.prisma` | `IntegrationProvider` += `custom` (migration, same `ADD VALUE` pattern as the Linear, GitHub and Intercom migrations) |
| `apps/worker/src/providers.ts` | `PROVIDERS` += `custom` |
| `apps/web/src/lib/providers.ts` | `PROVIDERS` and `WEB_PROVIDERS` += `custom` |
| `apps/web/src/lib/types/integrations.ts` | `INTEGRATION_PROVIDER_LABELS` |
| `apps/web/src/modules/settings/integration-detail/csr/IntegrationDetailHeader.tsx` | `PROVIDER_ICONS` |
| `apps/web/src/modules/settings/integrations/csr/provider-presentation.tsx` | `PRESENTATION` |

**Needed but not compile-forced** (a miss is a silent bug):

| File | Change |
| --- | --- |
| `apps/web/src/lib/types/integrations.ts` | The hand-written `IntegrationProvider` union, `INTEGRATION_PROVIDERS`, `IntegrationsPageData` |
| `apps/web/src/lib/integrations-data.ts` | `getIntegrationsData` (per-provider queries) |
| `apps/web/src/modules/settings/integrations/csr/source-integration-specs.tsx` | A spec for custom, with **real** data (the existing cards show static placeholder statistics; do not copy them) |
| `apps/web/src/lib/onboarding-data.ts` | Iterates every registered provider (`REGISTRY_ORDER`), so custom would appear in onboarding and call `getIntegrationConfigStatus`, which takes the OAuth-provider type. Custom is **excluded from onboarding in V1**. |
| `apps/web/src/lib/security-summary.ts` | Iterates `WEB_PROVIDERS`, so custom appears in the public security summary: it needs `access.scopes = []` and a note that read-only is enforced by request rules, not OAuth scopes |
| `packages/db/src/plans.ts` | Starter and Team integration lines (Zendesk/Intercom wording) |
| `apps/web/src/lib/entitlements.ts`, `packages/db/src/entitlements.ts` | No code change expected: `integrationResource(provider, providerRole)` counts by role. Custom counts against `ticketSourceIntegrations`. Verify, do not assume. |
| Boundary test (`packages/core/test/provider-boundary.test.ts`) | Add the new package to `PROVIDER_PACKAGES` (a test change; made on `testing`, §13) |
| Admin tenant labels, dashboard source labels | Read `INTEGRATION_PROVIDER_LABELS`; verify |

**Deliberately not extended:** `ConfigurableIntegrationProvider` and `IntegrationConfig` (no OAuth client), `CONNECT_LINK_PROVIDERS` (trackers only), the five per-provider OAuth route sets (custom has **one** route family, §9.4), `REPORT_TICKET_URL_COLUMN` (the CSV format is fixed and Zendesk-specific), `TICKET_SOURCE_KEY_PREFIXES` (optional; a source without a prefix is shown as `#id`).

### 9.3 Database (additive and expand-only; nothing is created in this phase)

| Change | Notes |
| --- | --- |
| `IntegrationProvider` += `custom` | |
| `CustomProviderDraft` | `id`, `organizationId` (unique in V1), `displayName`, non-secret `config`, encrypted draft secrets, `expiresAt` (14 days), timestamps |
| `CustomProviderConfigVersion` | `id`, `organizationId`, `integrationId`, `version`, `schemaVersion`, `config` (immutable, no secrets), `configHash`, `createdByUserId`, `createdAt`, `validatedAt`, `note`; unique `(integrationId, version)` |
| `Integration` += `activeConfigVersion Int?` | Set by compare-and-set at activation and rollback |
| `Integration` += `slaSupport Json?` | **[approved: Q1]** Denormalized at activation (§5.4); `null` for every existing provider |
| `Organization` += `customProviderEnabled Boolean @default(false)` | The operator flag (§8.7) |
| `IntegrationSyncRun` | §6.7; index `(integrationId, startedAt)`. Carries outcome, `partial` reason and progress separately from failure codes |
| `GuardOverride` | **[design approved: U6; not implemented; no schema or code is built in the documentation phase]** §6.11: durable, tenant-scoped record of every override (customer and support-assisted paths): guard, preview hash, counts, reason, requesting and authorizing users, operator, `expiresAt`, `consumedAt`, outcome. Not pruned with the 30-day sync history |
| `Integration.credentials` (existing JSON) | For custom: encrypted secret values, the non-secret ticket-URL template (see §9.4) and the existing `reauthRequired` flag |

New models need tenant-scope classification (§8.6) and an entry in the schema docs. The `RawEvent` doc comment ("Exactly what the provider returned") is corrected in the migration PR (§11).

### 9.4 Contract and shared-code touch points

| Need | Approach |
| --- | --- |
| Recognize the organization's own ticket URLs so Jira and Linear can link to custom cases | At activation, copy the non-secret `ticketUrlTemplate` into `Integration.credentials` as plaintext, as Zendesk does with `subdomain` (the credentials doc: only tokens are encrypted). `recognizeCaseUrl(url, credentials)` then needs **no contract change** and `@sla/commitments`' `case-ref.ts` is untouched. Matching is exact hostname plus an id captured from the path. |
| Mass-delete and failure guards | Inside the pure `normalize()` (§6.4). No contract change. |
| Deletion | A `ticket_deleted` raw event written by ingest (§6.5). No contract change. |
| Sync-run and record-level failure recording **for all providers** | Minimal additive change to `apps/worker/src/cycle.ts` (§10) |
| Conversation rendering from configuration | Additive optional hook on `ProviderWebAdapter` (§7) |
| Commitment-kind exclusion (Q1) and alert caveat | §5.4 **[approved]** |
| One route family | `/api/integrations/custom/*` (draft, test, sample, validate, preview, activate, rollback, disconnect), instead of copying the five-route OAuth pattern |

Data flow:

```text
Wizard ──► /api/integrations/custom/* (owner-only, same-origin check, rate-limited, operator flag)
   draft config + encrypted draft secrets ──► CustomProviderDraft
   test / sample ──► @sla/safe-http ──► customer API   (sample returned to the browser only, never stored)
   preview / validate / dry-run ──► deriveBatch(config, in-memory or stored rows)   (no writes)
   activate ──► Integration (+ secrets, ticketUrlTemplate, slaSupport) + ConfigVersion

Worker tick (per-organization lease) ─► adapter.ingest ──► @sla/safe-http ──► RawEvent (projection) + cursor + sync run
                                     └► syncIntegration ─► deriveBatch ─► guards ─► projectCanonicalBatch
                                              └► existing commitments / evaluation / notifications
```

### 9.5 Designed for later multi-instance support

- Nothing new keys on `(organizationId, provider)`: new code addresses the custom integration by `integrationId`; configuration versions already hang off `integrationId`.
- A later **expand** migration adds `Integration.instanceKey TEXT NOT NULL DEFAULT ''` and replaces the unique key with `(organizationId, provider, instanceKey)`, then drops the old one. The 26 non-test files that mention `organizationId_provider` (**[verified]**; four of them are migration SQL) are not touched in V1.
- Known V1 couplings to lift later: `Case.system` / the policy `sourceKey` is the constant `custom`; `CustomerIdentity.kind` would need an instance prefix; ticket-URL recognizers are keyed by provider name; labels come from `INTEGRATION_PROVIDER_LABELS`.
- The drafts table's per-organization unique is the only place V1 hard-wires "one".

---

## 10. Shared changes and the D24 replay gate

Everything else in N9 is additive and isolated in the new packages.

| Change | Why | D24 / regression |
| --- | --- | --- |
| Sync-run recording and record-level failure surfacing for all providers (N9.9) **[approved]** | `cycle.ts` currently reads only `synced.policyImport` from `syncIntegration`, so `normalization.failures` is silently dropped for every provider (**[verified]**, `apps/worker/src/cycle.ts`). A minimal additive write fixes it. Existing provider semantics are preserved. | Additive table and write; focused regression coverage; replay must show no change to cases, events or evaluations |
| Third ingest outcome, `partial` (N9.9) **[approved: Q12, R3; mechanism proposed]** | `cycle.ts` has two outcomes (success, error). §6.12 adds an **optional** `partial` marker and reason to `IngestResult` (`packages/ingestion/src/contract.ts`) and the matching branch in the health write: no `lastSuccessfulSyncAt`, no failure counters touched. **This is a shared-code change. It is documented here and is not implemented during the documentation review.** | Optional field; existing adapters never set it, so their path is unchanged. **Focused regression coverage:** success still advances `lastSuccessfulSyncAt` and resets the streak; failure still increments the streak; `partial` does neither; a real failure alongside completed pages still follows the failure policy; D13(b) tests (N3.5) pass unchanged. **D24 replay** on a restored backup where the shared path is exercised: 0 differences in cases, events, commitments and evaluations for every existing provider. |
| Commitment cancellation on a newly unsupported kind (N9.8a) **[approved: Q14, R5]** | §5.5, §5.6. For `first_response` and `resolution` this is the **first** code that cancels them; the `next_reply` restore path must be prevented (§5.6) | Does not run for `slaSupport = null`; D24 replay checks in §5.5; rollback tests in §13 |
| Redaction (N9.3) **[approved]** | §8.4 | Output-only; regression coverage that non-secret log content is unchanged |
| `ProviderWebAdapter` config-loading hook (N9.10) **[approved]** | §7 | Optional member; existing adapters unchanged; Conversation rendering for Zendesk and Intercom regression-checked |
| Alert caveat (N9.13) **[approved]** | §5.4 | Shared `@sla/notifications` text change; **D24 replay required** |
| Commitment-kind exclusion in `runCommitmentPipeline`, `runNextReplyCyclePipeline` and `runCommitmentReResolutionPipeline` via `Integration.slaSupport` (N9.8/N9.8a) **[approved: Q1]** | §5.4 | `slaSupport` is `null` for all existing providers: D24 replay must show 0 differences in commitments and evaluations; focused regression tests for all three entry paths |
| `@sla/email` re-exports the shared address predicate (N9.2) | One predicate, not two | Existing destination tests unchanged and run |

Shared packages touched: `@sla/ingestion` (no change expected), `@sla/commitments` (exclusion only, Q1), `@sla/notifications` (caveat), `@sla/logger` and worker Sentry (redaction), `apps/worker` (sync runs). `@sla/core` is not touched.

## 11. Corrections deferred to the implementation PRs

The documentation phase did not touch source comments, schema comments or runtime defaults. They are scheduled here and in the roadmap's Appendix E ("Rev 8 additions"):

| Item | PR |
| --- | --- |
| `packages/ingestion/src/contract.ts` lines 8-9 and `apps/worker/src/providers.ts` line 12: "no plugin loading, no runtime registration (D16)" → reflect D31 | N9.8 |
| `packages/db/prisma/schema.prisma` `RawEvent` comment ("Exactly what the provider returned") | N9.5 |
| `packages/db/prisma/schema.prisma` `WorkerSettings` comment ("exactly one worker process") | N9.14 |
| `packages/intercom/src/normalize.ts` comment ("never diffed incrementally") | N9.14 |
| The "60 minutes" reconciliation figure in the five public `/docs/integrations/*` pages (zendesk 248, jira 279, linear 201, intercom 400, github 281). **The approach was approved (Q10): a separate, copy-only source change; the prepared diff itself awaits the owner's review.** It is prepared as five one-line string edits on its own branch, `copy/docs-reconciliation-30min`, in a separate git worktree, so it is not part of this Markdown diff and changes no behavior. The three code comments with the same figure (`api/webhooks/{jira,zendesk}/[integrationId]/route.ts`, `lib/anomaly-data.ts`) are comments and stay deferred. | separate change (not an N9 PR); comments in N9.14 |
| `ORGANIZATION_CONCURRENCY` default: **the intended default is 3 [approved]**. Align `apps/worker/src/concurrency.ts` (now 5) and `.env.example` (now 5); `docker-compose.yml` and `docs/deployment.md` already say 3 and need no change. | N9.14 |

---

## 12. Pull requests and dependencies

Small, reviewable PRs, stacked into `phase/n9-custom-ticket-provider` or from short-lived task branches into it. **[approved]**

| Task | Scope | Depends on | Shared / replay |
| --- | --- | --- | --- |
| N9.0 | Documentation phase (this) | none | no code |
| N9.1 | Security spike and written result (§8.2) | N9.0 approval | none |
| N9.2 | `@sla/safe-http` | N9.1 result; `undici` only if the spike passes | `@sla/email` re-export |
| N9.3 | Redaction (logger, Sentry `beforeSend`, `cause` stripping) | none | shared output; regression |
| N9.4 | `@sla/custom-ticket` schema, path, transforms, validators (Zod) | N9.0 | none |
| N9.5 | Additive migration, **strict per-value authenticated secrets helper bound to organization, integration and field (Q16)**, tenant-scope entries, the §8.4 verification (including existing-provider compatibility) | N9.4 | additive |
| N9.6 | Ingest engine, **120 s budget and per-request bounds (Q4), flag checks (Q5), page-atomic progress and `partial` outcome (Q12)** | N9.2, N9.4, N9.5 | none |
| N9.7 | `deriveBatch`, SLA modes, history rules, **guards with the exact formulas (§6.4, Q11), configurable ceiling that fails safely, working default 5,000 and unvalidated (Q13, R4)**, whitelist projection, **the §6.10 benchmark gate (exit criterion)**, record-failure retry set (§6.12) | N9.4 | none |
| N9.8 | Adapter, registries, registration surfaces, operator flag, `Integration.slaSupport` written at activation, plan copy and entitlement text, comment fixes | N9.5–N9.7 | registries |
| N9.8a | **Commitment-kind exclusion in the shared commitments pipeline (Q1)**, **the dry-run, confirmation and cancellation of §5.5 (Q14)**, and **the rollback guard of §5.6 (R5): no silent restore of a cancelled `next_reply`** | N9.8 | **D24 replay: 0 differences for existing providers**; the §5.5 and §5.6 checks; regression tests for all three entry paths |
| N9.9 | Sync runs and failure surfacing, all providers; the optional `partial` ingest outcome and the `cycle.ts` branch (Q12, R3) | N9.5 | D24 regression and replay where applicable; D13(b) tests unchanged |
| N9.10 | `ProviderWebAdapter` hook and Conversation rendering | N9.8 | regression |
| N9.11 | API routes, including the guard-override routes of §6.11 (customer path, and the separate support-assisted path) | N9.5, N9.8 | none |
| N9.12 | Wizard UI, settings and diagnostics, notices, **the customer-facing sync states of §6.13**, the override preview screens | N9.11, N9.9 | none |
| N9.13 | Alert caveat | N9.8a | **D24 replay** |
| N9.14 | Verified customer and marketing docs, legal flags, `ORGANIZATION_CONCURRENCY` (code and `.env.example` to 3), comment fixes, Beta enablement | everything, **N9.13** | none |

The Q10 copy fix is not in this table: it is a separate change on its own branch.

**Ordering rule:** the Beta flag cannot be enabled for any organization before N9.8a, N9.13 and the notices in N9.12 are shipped, **and before the §6.10 benchmark report exists and the live-case ceiling has been fixed from it (Q13).**

## 13. Testing and verification policy

**Policy [approved]:** follow `CLAUDE.md`. On `main`, validate with `pnpm type-check`, the relevant build and lint, plus focused tests when the owner asks for testing. **No full suite per PR, no automatic test runs on `main`, no mirrored test PR for each implementation PR.** `testing` stays based on `main`; the testing-branch workflow runs when the owner explicitly asks or when `main` is merged into `testing`. **CI currently targets `testing`, not pull requests into `main`** (`.github/workflows/ci.yml`; **[verified]**). **N9 does not change CI triggers.** **Q9 is deferred:** if a different pre-merge verification policy is needed, it is a separate decision. Focused tests are run by file, never as a blanket suite.

Focused coverage that must exist before Beta enablement (written on `testing` when the owner asks):

| Area | Cases |
| --- | --- |
| SSRF and the client | Every IPv4 and IPv6 representation, metadata names, mixed public/private records, rebinding, wrong-certificate and SNI, dual-stack, redirects and loops, cross-origin next URL and `Link`, userinfo, non-443 ports, IP-literal hosts, response-size and decompression caps, timeouts, credentials never sent cross-origin, CRLF headers, template injection into the host, credential-looking query keys, method and POST-designation enforcement |
| Mapping | Path subset (valid, invalid, wildcard, prototype-pollution keys), transform determinism, required fields, duplicate ids, timezone required for naive dates, DST gap and overlap rejected, unknown status fails (and the explicit `open` fallback), unknown priority is `null` with a diagnostic, `payload_too_large` |
| Current state versus history | No `state_changed` or `case_closed` is ever fabricated; `case_closed` only at a source timestamp; a terminal status without one blocks Resolution and `updatedAt` is never substituted; **normalizing the same rows twice with different fetch times gives identical events**; real history imported at its timestamps |
| SLA exclusion (Q1) | `slaSupport = null` behaves exactly as today for all three kinds; each unsupported kind is excluded individually; the worker, connect-time sync and webhook paths are all gated; re-resolution skips excluded kinds; nothing excluded reaches evaluation or notifications; **D24 replay shows 0 differences for existing providers** |
| SLA modes | Full SLA versus Resolution-only; creation actor; private notes never count; **no visibility field and no acknowledgement blocks Full SLA, and the acknowledgement is never defaulted (Q7)**; the pause limitation asserted for current-status-only sources |
| Failure guard (Q2) | Every row of the §6.4 boundary table, plus the non-abort path: failed records are excluded and reported, the rest projects, stored state of the failed tickets is unchanged |
| Lifecycle guard (Q3, Q11) | Every row of the §6.4 lifecycle table, in particular **R < 10 never aborts even when R > 0.25 × L**, R = 0.25 × L exactly (no abort) versus one more (abort), and R = 10 at the boundary; open→closed and closed→open both counted; new cases and deletions not counted; L is the whole integration in an incremental pass too; **abort happens before projection and leaves cases, events, evaluations and the watermark unchanged**; the abort is recorded atomically with reason, `R`, `L`, ratio and record ids; never partially projected |
| Deletion guard | D = max(3, 0.05 × L) (no abort) versus one more (abort); L = 101 threshold 5.05; abort leaves everything unchanged |
| Ceiling (Q13) | With the configured value C: L + N = C (allowed) versus C + 1 (fails safely); the value is read from configuration, not a literal; **no rewrite, deletion, truncation or projection occurs**; existing data stays visible and monitored; ingest does not start a new run while over |
| Budget (Q4) | 120 s total; each attempt bounded by the remaining budget including retries and back-off; no attempt begins at zero remaining; in-flight request aborted at expiry; partial page not written; cursor at the last completed page; resume works |
| Partial runs and failures (Q12, R3, R6) | A budget-exhausted or cap-limited run ends `partial` with reason and progress in sync history; **`lastSuccessfulSyncAt`, `consecutiveFailures`, `failingSince` and `lastSyncError` are untouched**; the cursor is at the last fully completed page (listing plus all child requests) and the page and cursor commit together; the updated-since window anchor survives resumption; resuming creates **no duplicate raw event, event or commitment**; **the five cases of the §6.12 table (A to E) each behave as written**; the budget expiring during a retried 5xx or 429 is `failed`, not `partial`; a 401 or 403 mid-run keeps its status transition; three zero-progress runs become `no_progress`; failed tickets are retried by the next incremental pass; a source never completing a pass is stale; stale at-risk alerts keep the marker and **breach alerts stay held (D13(b) tests pass unchanged)**; success still advances the watermark and failure still increments the streak for every existing provider |
| Activation blocking (R6) | A source with no updated-since parameter whose full listing does not end within one run's limits is refused, with the measured numbers; one that ends within them is allowed; a source with an incremental cursor and a long history is allowed; freshness semantics are identical in both cases |
| Customer-facing states (R6) | Importing history, catching up, up to date, needs attention and paused each appear under exactly the §6.13 conditions; a long import is never rendered as failed; a failure is never rendered as an import; the stale overlay applies to every state |
| Commitment cancellation and rollback (Q14, R5) | Dry-run writes nothing and shows counts per kind and status, including `breached` with `closedAt` null, and states that cancellation is not undone by rollback; a confirmation bound to a stale preview hash is rejected; only unfinalized commitments of the newly unsupported kind are cancelled; finalized commitments and every evaluation are byte-identical; nothing is deleted; a second run is a no-op; version activation and cancellation commit together; **D24 replay checks (a)–(e) of §5.5**; **rollback never changes a cancelled commitment; `runCommitmentPipeline` creates nothing for a case with a cancelled `first_response` or `resolution`; the Q14-cancelled `next_reply` commitments are never restored by `planCycleCommitments` (or the rollback to a version that would restore them is refused), per the approved U3 option (a)** |
| Override (Q15, R1, R2) | Only the lifecycle guard can be overridden; the failure-ratio guard, the ceiling, the budget, request limits, tenant isolation, security validation and the **deletion guard** cannot, and a mass deletion is never forced; a `member` cannot override; the customer path needs an owner, a reason, a preview and a bound, single-use, expiring confirmation; a changed record set voids it; the support-assisted path is refused without the distinct permission or without the owner's recorded authorization for the same preview hash; the operator cannot create that authorization; both paths write the durable override record, and the support path also writes `AdminAuditLog`; a guard abort is never cleared by retry or by waiting |
| Beta flag (Q5) | Flag off before a run (no request, no retry); off during a request (abort within about 5 s, response discarded, nothing written); off during a back-off (no retry); every manual route returns `beta_disabled`; data stays visible and DB-only stages continue; the flag does not bypass owner authorization or tenant isolation |
| Secrets (Q8, Q16) | Every stored secret is `enc:v1:`; a seeded sentinel never appears in `credentials`, drafts, sync runs and history, logs, Sentry events, validation errors, `lastSyncError` or API and UI responses (including error paths); the strict helper rejects an unprefixed value and each malformed form (part count, base64url, IV or tag length, tampered ciphertext or tag) with one generic outcome and **never returns plaintext**; a ciphertext moved to another organization, integration or field is rejected; unset or wrong key fails closed with a generic message and nothing sensitive in output; **existing providers' encryption paths and stored values are unchanged** and their tests pass unmodified |
| Synchronization | Each pagination type, loop detection, resume after a crash mid-page, look-back overlap deduplicates, idempotent re-run, 429 with `Retry-After` clamped to the budget |
| Deletion signals | Absence from a list never deletes; a source signal or a verified 404 does; a restored ticket stays hidden (documented V1 limitation) |
| Tenant isolation | New models classified and seeded; routes for drafts, versions, sync runs and secrets (never returned); cross-organization activation and test attempts rejected |
| Regression | Existing provider-matrix pairs, D24 replay clean for the shared changes (§10), the sync-run write for all providers (existing semantics unchanged), the redaction change, the `@sla/email` re-export, the boundary test with the new package |
| Measurement (not a test) | The §6.10 benchmark gate: tiers, realistic volume, wall time per stage, queries, organization-lock duration, memory, full and incremental passes, with the pass criteria and the incremental design's correctness and replay criteria. Its written report, not a test, fixes the ceiling. |

## 14. Rollout **[approved]**

Beta (D17), operator-enabled per organization, default off. Pilot with one or two design partners. Customer, marketing and setup documentation is updated only after each claim is verified against the final implementation; Terms and Privacy edits are drafted and marked **for legal review**, never represented as legally approved (Appendix A).

## 15. Unresolved decisions and proposed details

Two different things are tracked here. They are not the same and must not be confused.

### 15.1 Unresolved owner decisions

One owner decision remains open. It does not block N9.1, but it **must be resolved before Beta activation.**

| # | Question | Recommendation | Needed by |
| --- | --- | --- | --- |
| **U2** | **Cleanup after a rejected mass deletion (R2).** An override may not force it, so a separate reviewed workflow is required, and none is designed. Until it exists a `mass_deletion` abort blocks the whole pass for that integration and it stays stale. | Design the cleanup workflow as its own reviewed item before Beta, or accept in writing that a deletion abort blocks the integration until the cause is removed at the source. | **before Beta activation** |

**Decided by the owner and no longer open:** Q1–Q16, R1–R6, U1 (owner only), U3 (option (a)), U4, U5, U6 (design). The owner has **not** yet approved this document's final diff or the copy-only diff.

### 15.2 Proposed implementation details (not owner decisions)

These are mechanisms I wrote down so that a decision could be understood. They sit next to approved rules, but **none of them is approved by being written here.** Each stays marked `[proposed]` in its section and becomes a decision only when the owner approves it, or (for the items marked "N9.x chooses") when the owning task's review settles it.

| Proposed detail | Section | Settled by |
| --- | --- | --- |
| The 24-hour expiry of override confirmations and authorizations | §6.11 | Owner, or N9.11 review |
| The exact `GuardOverride` field list, the `apply_guard_override` action name, and the allowlist variable name | §6.11, §9.3 | N9.11 |
| The dry-run, preview-hash, confirmation and cancellation mechanics | §5.5 | N9.8a review |
| The benchmark method, tier set, repetition count, environment and pass-criteria structure (the 30 s and 10 s thresholds are unchanged) | §6.10 | Owner on the benchmark report |
| The shape of the optional `partial` marker on `IngestResult` and the `cycle.ts` branch | §6.12, §10 | N9.9 review (shared change; D24) |
| Customer-facing state names and copy | §6.13, Appendix A | N9.12, then verified copy in N9.14 |
| AAD versus envelope for binding secrets, and the wording of the decryption-failure message | §8.4 | N9.5 chooses by test |
| The name of the local-development destination override | §8.1 | N9.2 |
| The incremental-poll / full-sweep normalization design | §6.1, §6.9 | Only after the §6.10 evidence (Q13) |
| Estimates and arithmetic labelled "estimate" or "not a measurement" | §6.3, §6.9 | Not decisions; replaced by measurement |

## 16. Assumptions and risks

- **Assumed, to be proven:** the `undici` `lookup` pinning and SNI behavior (N9.1); that Prisma rewrites `@updatedAt` on every upsert (§6.9, not measured); that a superseded raw snapshot is no longer referenced by any `NormalizedEvent` (relevant only if pruning is ever approved).
- **Not inspected:** container network layout, so network-level egress rules are untested defense in depth.
- **Capacity is unproven (Q13).** No ceiling is validated for `custom`. 20,000 is larger than anything measured and larger than the "degrading" point in `docs/capacity-limits.md`, and 10,000 is only the largest size that document measured, without provider normalization or projection. Both are benchmark tiers. The incremental-poll / full-sweep design is a proposal; until §6.10 produces results the ceiling is provisional (working default 5,000, unvalidated, approved by R4), enforced before any rewrite, and the Beta flag stays off.
- **The 120 s budget and the freshness model interact (Q12).** A `partial` run never advances `lastSuccessfulSyncAt`, so a source that cannot finish a pass is reported stale and its breach alerts are held (D13(b), unchanged). That is intended, and it means large imports are visibly stale for hours; §4.3 blocks at activation a source with no incremental cursor that cannot finish a pass in one run, and §6.13 keeps an import distinguishable from a fault.
- **Risk: wrong creation actor** freezes a wrong first-response clock, because that commitment is created once and never re-derived.
- **Risk: irreversible deletion.** `deletedAt` is never cleared; the signal-only rule and the guards reduce the risk, but a restored ticket stays hidden in V1.
- **Risk: data volume and personal data.** The whitelist projection reduces it; latest-snapshot retention remains until H-5, and unpruned superseded snapshots grow without bound (§6.9), so the benchmark must include their growth (§6.10).
- **Risk: Resolution accuracy for current-status-only sources** (§5.3). Limited, labelled, and carrying an alert caveat; not equivalent to a source with real history.
- **Risk: a guard abort repeats until resolved** (§6.4). A lifecycle abort can be cleared by the documented override of §6.11; a **mass-deletion abort cannot be overridden** (R2) and blocks the whole pass, so the integration stays stale until the cause is removed or a separate cleanup workflow exists (§15-U2). There is deliberately no automatic bypass (Q15).
- **Risk: secret key rotation** makes every custom credential unreadable at once; owners must re-enter them until a supported rotation mechanism exists (N8-S7). Documented as a limitation (Q16, §8.4).
- **Risk: per-ticket comment requests** exhaust the 120 s budget first (about 500–600 tickets per run, §6.3), so large imports take hours; mitigated by resumable progress, not eliminated.
- **Risk: no CI on `main` PRs** (Q9 deferred). Correctness evidence for N9 comes from focused local checks and from the `testing` workflow when the owner runs it.
- **Risk: legal copy** (Terms, Privacy) cannot be finalized without review.

---

## Appendix A — Customer-facing and legal copy (DRAFTS)

> **DRAFT. Not published. Do not copy into any live file until the claim has been verified against the final implementation (N9.14).** Terms and Privacy text is marked **LEGAL REVIEW OUTSTANDING**: it is a proposal for the reviewer and is not legally approved.

| Where (live file today) | Today | Draft replacement | Verify against |
| --- | --- | --- | --- |
| `docs/customer-guide.md` §5 "Every connection shares the same shape" | "You never paste an API token directly for any of the five data-source integrations." | "Zendesk, Jira, Linear, Intercom and GitHub connect through OAuth or a GitHub App. The Custom REST source (Beta) is different: it is **not** an OAuth sign-in. You enter an API key, bearer token or basic-auth credentials for your helpdesk's API. They are encrypted at rest and never shown again." | N9.8, N9.11 |
| same, "Data never modified" | "…strictly read-only…" | "Elapsed only reads. For the Custom REST source, a search endpoint that needs `POST` is allowed only after you designate it as a read-only query. Elapsed never creates, edits or deletes anything in your ticket system." | N9.4 (method rules), N9.6 |
| `docs/customer-guide.md` §22 "Integration authentication", "Credential storage" | OAuth only | "Custom REST credentials are encrypted at rest, are never returned to your browser, and are removed from logs and error reports." | N9.3, N9.5 |
| `docs/customer-guide.md` §5 table | five rows | New row: **Custom REST (Beta)**, ticket source, API key / Bearer / Basic / custom header, poll only (5 minutes active, 30 minutes full sweep), no webhook | N9.6 |
| New section: SLA modes | none | "Full SLA needs your ticket data plus replies. Resolution-only tracks resolution only; first response and next reply are **not supported** for that source. If your system does not expose status history, Elapsed uses only the current status and the timestamps your system provides. **It does not reconstruct history.** Time a ticket spent waiting on the customer cannot be excluded, so resolution times can read longer than your system's own." | N9.7, N9.12 |
| `docs/customer-guide.md` §27 "Currently Supported" | five sources | Add "Custom REST ticket source (Beta)". Under limitations: "Not every connected source supports the same SLA metrics." | N9.14 |
| `README.md` line 12; `docs/customer-guide.md` lines 11, 23, 758, 864, 883; `/docs/faq`; `/docs/sla`; `HomeView`; `ConnectSourceStep` | "Zendesk, Intercom" only; "Zero write access" | Add "or a Custom REST source (Beta)"; keep "read-only" wording consistent with the above | N9.14 |
| `packages/db/src/plans.ts` Starter line | "1 support integration (Zendesk or Intercom) and 1 engineering integration" | "1 support integration (Zendesk, Intercom or Custom REST (Beta)) and 1 engineering integration" | N9.8; `pricing-plans.test.ts` asserts this copy |
| `packages/db/src/plans.ts` Team line | "Unlimited integrations (Zendesk, Jira, Linear, Intercom, GitHub)" | Add "Custom REST (Beta)". **No limit or price changes.** | N9.8 |
| `TermsView` (line 11) **LEGAL REVIEW OUTSTANDING** | "…such as Zendesk, Intercom, Jira, Linear, and GitHub…" | "…such as Zendesk, Intercom, Jira, Linear, GitHub, or a custom REST API that you configure…" | legal reviewer |
| `PrivacyView` (line 5) **LEGAL REVIEW OUTSTANDING** | names the five providers | Add the custom source, state that Elapsed stores only the fields you map (and message text only if you map it), and that credentials are encrypted. | legal reviewer; §7 |
| New `/docs/integrations/custom` | none | Setup walkthrough, supported authentication, pagination types, limits (§6.2), SLA modes, limitations, security promises, Beta status | N9.14 |

## Appendix B — Illustrative configuration document

Illustrative only; the final shape is fixed in N9.4. No secret appears in it.

```json
{
  "schemaVersion": 1,
  "displayName": "Acme Helpdesk",
  "connection": { "baseUrl": "https://api.helpdesk.example.com" },
  "auth": { "type": "api_key_header", "headerName": "X-Api-Key" },
  "tickets": {
    "request": { "method": "GET", "path": "/v2/tickets", "query": { "updated_after": "{{updatedSince}}", "per_page": "{{limit}}" } },
    "itemsPath": "$.data[*]",
    "pagination": { "type": "cursor", "cursorPath": "$.meta.next_cursor", "param": "cursor" },
    "incremental": { "format": "iso8601", "lookbackSeconds": 300 }
  },
  "comments": {
    "request": { "method": "GET", "path": "/v2/tickets/{{ticket.id}}/comments" },
    "itemsPath": "$.comments[*]"
  },
  "mapping": {
    "id": "$.id", "createdAt": "$.created_at", "status": "$.state",
    "title": "$.subject", "priority": "$.priority", "updatedAt": "$.updated_at",
    "customerId": "$.account.id", "customerName": "$.account.name",
    "closedAt": "$.resolved_at", "tags": "$.labels", "channel": "$.source"
  },
  "commentMapping": { "id": "$.id", "createdAt": "$.created_at", "authorRole": "$.author.type", "isPublic": "$.public", "body": "$.body" },
  "valueMaps": {
    "status": { "new": "new", "open": "open", "waiting": "pending_customer", "solved": "resolved" },
    "priority": { "p1": "urgent", "p2": "high", "p3": "normal", "p4": "low" },
    "authorRole": { "requester": "customer", "agent": "agent", "bot": "system" }
  },
  "unknownStatus": "fail",
  "timezone": null,
  "ticketUrlTemplate": "https://app.helpdesk.example.com/tickets/{id}",
  "history": null
}
```

## Appendix C — Facts this plan relies on (verified 2026-10-09)

| Fact | Where |
| --- | --- |
| The provider contract, `CanonicalBatch`, `EventGroup`, `recognizeCaseUrl(url, credentials)` | `packages/ingestion/src/contract.ts` |
| The projector is the only writer of `Case`, `Customer`, `NormalizedEvent`; `openedAt` set once; `deletedAt` never cleared | `packages/ingestion/src/projector.ts` |
| `syncIntegration` order and what the worker reads from its result | `packages/ingestion/src/pipeline.ts`, `apps/worker/src/cycle.ts` |
| Engine event requirements, D3/D5/D5b | `packages/core/src/evaluate.ts`, `clock-rules.ts`, `reply-cycles.ts` |
| Native policies match on priority and customer; pause on `pending_customer` | `packages/commitments/src/native-policy.ts` |
| Retry and timeout behavior | `packages/http-retry/src/retry.ts` |
| Credential encryption covers `accessToken` / `refreshToken` only | `packages/db/src/integration-credentials.ts` |
| Address classification (SMTP guard) | `packages/email/src/destination.ts` |
| No logger or Sentry redaction | `packages/logger/src/logger.ts`, `apps/worker/src/sentry.ts` |
| Soft disconnect and read-side visibility | `packages/db/src/integration-visibility.ts` |
| Tenant-scope classification test | `apps/web/test/tenant-scope-classification.test.ts` |
| CI runs only for `testing` | `.github/workflows/ci.yml` |
| Entitlements count by role | `packages/db/src/entitlements.ts` (`integrationResource`) |
| `undici` is not a direct dependency | `pnpm-lock.yaml` (only `undici-types`) |
| `runCommitmentPipeline` never recreates or restores a cancelled single-cycle commitment; only `persistNextReplyCommitments` writes or reverses `cancelled` | `packages/commitments/src/pipeline.ts`, `cycle-commitments.ts` |
| Only `owner` and `member` organization roles exist; platform operators are a separate axis | `packages/db/prisma/schema.prisma` (`UserRole`), `apps/web/src/lib/authz.ts` |
| There is no organization-level audit log; `AdminAuditLog` is platform-side | `packages/db/prisma/schema.prisma` |
