# N2 — Provider Contract + Shared Projector: Implementation Plan

> **Roadmap phase:** [N2 in `ROADMAP_Product.md`](ROADMAP_Product.md#phase-n2--provider-contract--shared-projector). Task status lives in the roadmap. This file explains **how**.
> **Depends on:** [N1](01-provider-neutral-core.md) complete: `sourceRole`, the replay/diff harness, `CustomerIdentity`, source-aware Case keys, generic link resolution. **Unblocks:** [N3](03-provider-isolation-and-freshness.md).
> **Estimate:** 4–5 weeks. **Branch (when the phase starts):** `phase/n2-provider-contract-and-projector`.

---

## 1. Objective

- Every provider is reached through **one statically typed adapter record**.
- Adapters return **canonical records** instead of writing domain tables.
- **One shared projector** persists `Case`, `Customer`/`CustomerIdentity`, `CaseLink` and `NormalizedEvent`.
- The worker and web stop branching on provider names outside integration-settings code.

## 2. Why this phase exists

After N1 the *core* is neutral, but the *system around it* is still organised per provider:

- **Worker dispatch.** `apps/worker/src/cycle.ts:209-268` and `:345-381` dispatch with `if/else`, catch 10 provider-specific error classes (`:65-69`, `:278-282`), and hard-code GitHub-after-trackers ordering (`:121`).
- **Adapters write domain tables.** Five adapters each write `case`, `customer`, `caseLink` and `normalizedEvent` directly, with near-duplicate logic. Roadmap backlog item: "Fold the duplicated row→domain mappers".
- **The web app parses raw payloads.** `apps/web/src/lib/case-detail-data.ts:26-35, 751-924` reads `RawEvent.payload` and parses Zendesk audits and Intercom parts. `report-data.ts`, `dashboard-data.ts:43` (`ISSUE_TRACKER_SYSTEMS`) and `at-risk-data.ts:35` branch on provider names.
- **Connect-time projection** (`apps/web/src/lib/source-sync.ts`) is hand-written per provider.

A third provider (N7) should be "implement one adapter record", not "edit the worker, web and projection in five places".

## 3. Design decisions (bound by roadmap D16)

- **No general-purpose connector framework, no plugin SDK, no dynamic loading.** _(Amended by D31, 2026-10-09: the single declarative `custom` ticket-source engine is the one exception; see [plan 09](09-custom-ticket-provider.md). Everything else in this section still holds.)_ The contract is a TypeScript interface. Registries are **static object literals** with `satisfies Record<IntegrationProvider, …>`, so a missing provider is a compile error.
- **Only what current code needs.** Every contract member below maps to an existing function. Nothing is added "for future providers".
- **One new package: `packages/ingestion` (`@sla/ingestion`).** It holds the contract types, shared errors, the projector and the link resolver. It depends on `@sla/core`, `@sla/db` and `@sla/logger`. Provider packages may import **types and error classes only** from it (enforced by the boundary test). Why a new package:
  - The projector cannot live in a provider package.
  - It must not live in `@sla/commitments`, because providers would then depend on commitments again, which is the V8 inversion N1 removed.
- **Two registries, no shared registry package.** `apps/worker/src/providers.ts` holds ingest and normalize. `apps/web/src/lib/providers.ts` holds rendering, webhooks and OAuth routes. Each is one small literal. This avoids a package that imports every provider, with its dependency-cycle risk.
- **RawEvent reads for display go through the adapter.** Rendering the Conversation still reads `RawEvent` payloads, but only through the provider's `renderConversation` function, never in web code. The engine still never reads raw events. Persisting normalized message bodies is **out of scope**; it would be a new data model with no current requirement.

## 4. The contract (derived from existing code)

> **Rev 8 correction (2026-10-09).** The sketch that stood here was written before N2.1 and differs from what was built. The authority is [`packages/ingestion/src/contract.ts`](../packages/ingestion/src/contract.ts); read that file, not a copy of it. The differences, verified against the code on 2026-10-09 (also recorded in the roadmap's Appendix E):
>
> - **`ProviderAdapter`** has `provider`, `role`, `capabilities`, `ingest(ctx)`, `normalize(ctx)`, and the optional `correlate`, `recognizeCaseUrl`, `importPolicies`, `importCalendars`. `ingest` and `normalize` take context objects (`IngestContext`, `NormalizeContext`), not bare arguments.
> - **`normalize` returns a `CanonicalBatch`** with `customers`, `cases`, **`eventGroups`** (one `EventGroup` per source record, naming its `ownRawEventIds`; the sketch's flat `events` list does not exist), `deletedCaseExternalIds`, `failures` and an optional `afterProject` hook.
> - **`correlate` returns a `CorrelationOutput`** (`links: LinkFact[]`, `sweeps`, `evaluated`, `unmatched`), not `LinkFact[]`. `LinkFact` carries `caseId`, `system`, `externalId`, `method`, `methodOnUpdate`, `evidence`, `evidenceMode`, `sourceRole`, `linkedEvent`, `relinkedEvent`, `repairLinkedEvent`; the sketch's `caseUrlOrRef` / `observedAt` / `active` fields do not exist.
> - **`recognizeCaseUrl(url, credentials)`** takes the integration's stored credentials, not an `IntegrationRef`.
> - **`ProviderCapabilities`** is as sketched (`webhooks`, `policyImport`, `calendarImport`, `incrementalNormalization`, `replyEvents`, `priorityChanges`, `officialLinks`).
> - **`ProviderWebAdapter`** (web registry) is larger than sketched: `access` (read-only scopes or a note), `snapshotEventPrefix`, `externalUrl`, `conversationContext`, `renderConversation(ConversationInput)` and `verifyWebhook`.
> - **Shared errors** are `ReauthRequiredError`, `PermissionDeniedError`, `ProviderUnavailableError` and `IntegrationNotConfiguredError` (`packages/ingestion/src/errors.ts`).
>
> The one-line design intent of the original sketch still holds: every contract member maps to a function that already existed, and registries are static (D16, as amended by D31 for the single `custom` engine).

## 5. Current implementation relevant to this phase

- **Worker:** `apps/worker/src/cycle.ts` (ingest phase outside the org lock, normalize phase inside `withOrganizationSlaLock`, per-integration `try/catch`, `Integration` status transitions `:395-450`).
- **Providers:** `packages/{zendesk,jira,intercom,linear,github}/src/{backfill,normalize,correlate,tokenLifecycle}.ts`. Zendesk extras: `policies.ts`, `calendars.ts`, `webhook.ts`, and incremental normalization with `diffNormalizedEvents` (`normalize-diff` tests).
- **Web:**
  - `lib/case-detail-data.ts`, `lib/report-data.ts`, `lib/dashboard-data.ts`, `lib/at-risk-data.ts`, `lib/source-sync.ts`, `lib/webhook-pipeline.ts`
  - `lib/integrations-data.ts`, `lib/integration-detail-data.ts`
  - `modules/settings/integration-detail/csr/IntegrationDetailView.tsx`
  - `app/api/webhooks/{zendesk,jira}`, `app/api/integrations/*`
- **Import summary:** `SlaImportSummary` (Zendesk-shaped counters, one row per org) and its reader `lib/policy-import-review-data.ts`.

## 6. Tasks, in implementation order

Every task that changes what gets persisted runs **L2 replay** (N1 harness) before merging: 0 class-A differences, class-B approved in the roadmap under D24.

### N2.1 — Create `@sla/ingestion` with the contract and shared errors
- New `packages/ingestion` (`package.json`, `tsconfig.json`, `src/index.ts`, `test/`), modelled on `packages/notifications`.
- Contract types as in §4. Shared errors `ReauthRequiredError`, `PermissionDeniedError`, `ProviderUnavailableError`.
- In each provider package, make the existing error classes **extend** the shared ones. This keeps names and behaviour; the worker can then catch base classes.
- **Verify:** `pnpm type-check`; existing `tokenLifecycle` tests pass unchanged.

### N2.2 — Shared projector (`packages/ingestion/src/projector.ts`)
- `projectCanonicalBatch(prisma, integration, batch)`:
  - upserts cases on `(organizationId, sourceIntegrationId, externalId)`;
  - resolves customers through `CustomerIdentity`;
  - diff-writes `NormalizedEvent`s per case, generalised from Zendesk's `diffNormalizedEvents` so unchanged events keep their id and `createdAt`;
  - marks deleted cases (`Case.deletedAt`).
- `projectLinkFacts(prisma, organizationId, facts, resolveCaseRef)`:
  - applies the CaseLink upsert, unlink sweep and re-link semantics currently duplicated in `zendesk/correlate.ts`, `jira/correlate.ts` and `linear/correlate.ts`;
  - carries over their doc-commented edge cases unchanged: `unlinkedAt`, re-activation on the same row, and "only `certain` links count".
- Runs inside the caller's org lock, as today.
- **Verify:**
  - Unit tests with an in-memory fake, plus a real-Postgres suite (`apps/web/test/projector.test.ts`, registered in `realDatabaseSuites`).
  - Port the key assertions from `zendesk-incremental-normalization.test.ts`, `jira-remote-link-unlink.test.ts` and `official-link-correlation.test.ts`.

### N2.3 — Migrate adapters to `normalize → CanonicalBatch`, one provider per commit
Order: **Intercom → Linear → Jira → GitHub → Zendesk.** Zendesk goes last because it has incremental normalization, policy import and official links.

For each provider:
- Split today's `run*Normalization` into a pure mapping, which returns a batch, and delete its direct `prisma.case/customer/normalizedEvent` writes. The projector writes instead.
- Keep `RawEvent` ingestion (`rawEvents.ts`, `backfill.ts`) as it is.
- Zendesk's incremental watermark (`Integration.normalizedThroughFetchedAt/Id`) stays inside the Zendesk adapter's `normalize(ctx)`, which decides the ticket scope. The projector is scope-agnostic.

Per-provider exit: **L2 replay for tenants using that provider shows 0 differences** in cases, customers, events (count and content hash per case), links and evaluations. The provider's existing tests pass after being updated to assert on the returned batch.

### N2.4 — Worker registry and dispatch
- `apps/worker/src/providers.ts`: `export const PROVIDERS = { zendesk: zendeskAdapter, jira: jiraAdapter, intercom: intercomAdapter, linear: linearAdapter, github: githubAdapter } satisfies Record<IntegrationProvider, ProviderAdapter>`.
- `cycle.ts`: replace both `if/else` chains with registry calls.
  - Order integrations by role (`ticket_source` → `work_tracker` → `code_host`); this replaces `PROVIDER_CYCLE_PRIORITY` (`:121`).
  - Catch the shared base errors (replaces `:65-69`, `:278-282`).
  - The `Integration` status transitions (`reauth_required`, `permission_denied`, `lastSyncError`) stay exactly as today.
- Per-provider OAuth client config (`getIntegrationConfig`, `redirectUri`) moves behind each adapter's `ingest(ctx)`: the context carries `appUrl` and the `IntegrationConfig` lookup.
- **Verify:**
  - `apps/worker/test` suites pass.
  - A new worker test runs one cycle over an org with all five providers stubbed and asserts the processing order and failure isolation (one adapter throws `ProviderUnavailableError`; the others still ingest, and evaluation still runs).
  - `pnpm --filter @sla/worker perf:baseline` with `PERF_ORG_ID` shows no regression versus the last recorded numbers.

### N2.5 — Link resolution through the registry
- The N1.13 `resolveCaseRef` builder takes the registry's ticket-source adapters (`recognizeCaseUrl`) instead of N1's two-entry map.
- Tracker adapters return `LinkFact[]` from `correlate`; `projectLinkFacts` persists them.
- Zendesk's official-link correlation becomes Zendesk's own `correlate` (capability `officialLinks`).
- **Verify:** `provider-matrix-smoke.test.ts` (N1.17) passes for all four pairs; L2 replay shows 0 link differences.

### N2.6 — Web registry: external URLs and Conversation rendering
- `apps/web/src/lib/providers.ts`: a static `satisfies Record<IntegrationProvider, ProviderWebAdapter>` literal.
- Move the Zendesk audit and Intercom part parsing (`case-detail-data.ts:751-924`, including `buildIntercomConversationMessages`) into `renderConversation` functions exported by `@sla/zendesk` and `@sla/intercom`.
- `case-detail-data.ts` then selects the case's source adapter by `Case.system`, loads the referenced `RawEvent` rows, and calls `renderConversation`. **Conversation ≠ Activity Timeline stays:** Conversation remains message-only.
- Replace the per-provider URL builders in `case-detail-data.ts`, `report-data.ts` and `lib/case-links.ts` with `externalUrl`.
- Replace `ISSUE_TRACKER_SYSTEMS` in `dashboard-data.ts:43` and `at-risk-data.ts:35` with a role check (`CaseLink` → the provider's role from the registry).
- **Verify:**
  - Case detail, at-risk, dashboard and report tests pass (`report-data.test.ts` and the case-detail suites).
  - A browser check of a Zendesk case and an Intercom case in local dev shows identical rendering before and after (screenshots attached to the PR).

### N2.7 — Capability-driven web behaviour
- `lib/source-sync.ts`: iterate the org's integrations through the worker-side registry functions (shared through `@sla/ingestion` helpers). Run `importPolicies` / `importCalendars` only when the capability is set.
- `lib/webhook-pipeline.ts` and `app/api/webhooks/{zendesk,jira}`: keep the routes, and use `verifyWebhook` from the web registry. No new webhook routes in this phase.
- Onboarding (N1.16) and the integration settings "webhook info" read `capabilities.webhooks` instead of provider names (`modules/settings/integrations/csr/WebhookInfo.tsx`).
- **Verify:** `zendesk-webhook-route.test.ts`, `jira-webhook-route.test.ts` and `source-sync-evaluation.test.ts` pass.

### N2.8 — Generalise the import summary
- `SlaImportSummary`: add a nullable `provider` column (backfill `zendesk`) and document it as "summary of the last policy/calendar import from the provider with `policyImport` capability". Counter names stay; they are Zendesk concepts that belong to the Zendesk import.
- `lib/policy-import-review-data.ts` reads by provider.
- **Verify:** `sla-import-summary.test.ts` passes.

### N2.9 — Extend the boundary test
- Add rules to `packages/core/test/provider-boundary.test.ts`:
  1. `apps/worker/src` contains no `provider === "…"` comparisons, except inside `providers.ts`.
  2. Provider-name literals in `apps/web/src` are allowed only in: `lib/providers.ts`, `lib/*-env.ts`, `lib/*concierge*`, `modules/settings/integrations/**`, `modules/settings/integration-detail/**`, `modules/internal/**`, `app/api/integrations/**`, `app/api/webhooks/**`, `app/api/concierge/**`, `app/(main)/internal/**`, marketing and docs pages. Start with a ratchet allowlist that must be empty by N2 exit.
  3. Provider packages import only types and errors from `@sla/ingestion`, never `projector`.
- **Verify:** the test passes with an empty allowlist.

### N2.10 — Contract migrations (drop legacy keys)
- Precondition: N1's dual-write has been in production for **at least one release**, and the latest L2 replay is clean. (Met on 2026-10-01: production was on the N1 release, and the EC2 production-backup L1 and L2 replays showed 0 differences.)
- **Where it lives (Rev 6):** the migration, its `rollback.sql`, a `schema.patch` for `schema.prisma` and a README are held in `packages/db/prisma/contract/20261001110000_contract_customer_identity_and_case_source/`, deliberately **outside** `prisma/migrations`, so `migrate deploy` cannot apply it and `schema.prisma` still carries the legacy columns. To ship it: take a verified backup, move the directory into `prisma/migrations`, apply `schema.patch`, deploy it alone, then re-run the L2 replay.
- Drop `Customer.zendeskOrgId`, `intercomCompanyId`, `intercomContactId` and their three unique keys. Drop `Case @@unique([organizationId, externalId])`. Make `Case.sourceIntegrationId` NOT NULL.
- Remove the dual-write code.
- **Verify:** `pnpm --filter @sla/db validate`; migration applied to the scratch DB; full test suite; L2 replay clean; `tenant-isolation.test.ts` passes.

### N2.11 — Close-out
- All four matrix pairs pass. Full L1 + L2 replay is clean. The boundary allowlist is empty.
- Roadmap updated. `plans/04-Architecture-Sketch.md` is **not** edited in this phase; record any divergence in the roadmap's Appendix E.

## 7. Data / schema changes

| Change | Task | Kind |
|---|---|---|
| `SlaImportSummary.provider` (+ backfill) | N2.8 | expand |
| Drop legacy `Customer` identity columns and keys | N2.10 | contract |
| Drop `Case (organizationId, externalId)` unique; `sourceIntegrationId` NOT NULL | N2.10 | contract |

## 8. Backward compatibility and migration strategy

- Adapters migrate one at a time behind the same worker. A half-migrated state is valid: migrated providers return batches, unmigrated ones keep writing directly. They never touch the same case, because each case has exactly one source integration and links are written only by `projectLinkFacts` once N2.5 lands.
- Error class names are preserved (subclassing), so Sentry grouping and log event names don't change.
- Web URLs, routes and OAuth callbacks are unchanged.

## 9. Tests to add or update

- **New:** `packages/ingestion/test/*` (contract fakes, projector unit tests), `apps/web/test/projector.test.ts` (real DB), a worker registry/dispatch test, boundary test rules.
- **Update:** every provider's `normalize.test.ts` and `correlate.test.ts` to assert on returned batches and link facts; case-detail rendering tests; `provider-matrix-smoke.test.ts` stays the end-to-end gate.

## 10. Verification commands

```bash
pnpm --filter @sla/db generate
pnpm --filter @sla/db validate
pnpm type-check
pnpm test
npx vitest run packages/core/test/provider-boundary.test.ts apps/web/test/provider-matrix-smoke.test.ts apps/web/test/projector.test.ts
npx vitest run apps/web/test/sla-golden-scenarios.test.ts apps/web/test/sla-e2e-matrix.test.ts apps/web/test/tenant-isolation.test.ts
grep -rnE 'provider === "(zendesk|jira|intercom|linear|github)"' apps/worker/src
pnpm --filter @sla/worker perf:baseline
pnpm --filter @sla/commitments replay:compare -- <baseline.jsonl> <after.jsonl> --approved <approved.json>
```

## 11. Acceptance criteria

1. The worker dispatches through a static, typed registry with no provider-name branches, and catches three shared error types.
2. No provider package writes `case`, `customer`, `customerIdentity`, `caseLink` or `normalizedEvent` rows; the projector does.
3. Web code outside integration-settings, OAuth, webhook and concierge surfaces has no provider-name branches; Conversation rendering and external URLs come from adapters.
4. The legacy identity columns and the source-less Case key are gone.
5. L1 + L2 replay: 0 class-A differences. All four matrix pairs pass. Worker perf baseline has not regressed.

## 12. Rollback

- Each provider's migration (N2.3) is an independent commit: revert that provider only.
- N2.10 is the only step that isn't expand-only. Take a verified backup first, deploy it alone, and keep the previous release's image available. Rolling back after N2.10 needs a re-expand migration: re-add the columns and repopulate them from `CustomerIdentity`. Write that SQL before applying N2.10.

## 13. Out of scope

- Plugin SDK, dynamic loading, or runtime-configurable providers (D16). _(D31 allows one runtime-configurable provider, `custom`, and no other. `Integration @@unique([organizationId, provider])` stays, which is why V1 allows one custom integration per organization.)_
- More than one integration per provider per org (`Integration @@unique([organizationId, provider])` stays).
- New webhook receivers (Intercom, Linear, GitHub).
- Persisting message bodies as normalized records.
- Freshness and circuit breaking (→ N3).
- A third provider (→ N7).
