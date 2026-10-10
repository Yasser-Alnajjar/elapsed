# N10 — Integration Control Center: Implementation Plan

> **Roadmap phase:** [N10 in `ROADMAP_Product.md`](ROADMAP_Product.md#phase-n10--integration-control-center). Task status lives in the roadmap. This file explains **how**.
> **Decision:** [D33](ROADMAP_Product.md#product-decisions) (approved 2026-10-09). **Amends:** D17 (how a stage change is applied), D31 / plan 09 §8.7 (where the Custom REST per-organization flag lives), plan 04 §10 (feature flags were "Later").
> **Needs:** N4 (admin shell, `AdminAuditLog`), N9.8 (the `custom` provider and its Beta flag). **Branch:** `phase/n10-integration-control-center`. Parallel track, like N9.

---

## 1. Objective

A platform operator can control, from `/admin/integrations` and without a deployment, whether each integration provider is **enabled**, which **release stage** it is in, and **which organizations** may use it while it is in Beta. Every such control is enforced by the backend on every path that talks to a provider, is audited, and never deletes or alters a customer's integration, credentials or data.

## 2. Approved decisions (owner, 2026-10-09)

| # | Ruling |
|---|---|
| 1 | Linear is seeded **Stable** (consistent with the D17 amendment of 2026-10-05). From N10 on, a stage change is applied in the admin console; D17 still requires it to be an explicit owner decision, recorded in the roadmap. |
| 2 | Integration availability controls are pulled forward from plan 04 §10 ("feature flags, Later") as D33 / N10. `PLATFORM_ADMIN_EMAILS` stays the only platform-admin authority. No database-backed admin roles. |
| 3 | `Organization.customProviderEnabled` is folded into the generic Beta allowlist. The N9.14-F1 restriction is preserved **and enforced by the backend**: until it is lifted, Custom REST cannot be added to any allowlist, opened to all organizations, or promoted to Stable. The admin UI says why. |
| 3-A1 | **Amends ruling 3 (owner, 2026-10-10); ruling 3's text above is unchanged and remains the history.** While N9.14-F1 is open, an operator may add or remove **individual organizations** on the Custom REST allowlist, but only while the provider is **Beta with an allowlist**; each add is scoped to that one organization and audited. **Still blocked with 409 `rollout_blocked`:** opening Custom REST to all organizations and promoting it to Stable. N9.14-F1 stays open for those and for public Beta copy. Reason: ruling 3 as written made the Beta allowlist unusable, so a limited, operator-controlled Beta could not run at all. |
| 4 | An integration operation runs only when the provider is **enabled and available to that organization**. Moving a provider to an allowlist or to Coming Soon blocks operations for organizations that no longer qualify. Configuration, credentials and stored data are preserved. |
| 5 | Webhooks for an unavailable provider return **HTTP 200 with an ignored body**; reconciliation recovers the missed changes after re-enablement (§6.4). |
| 6 | `enabled` is independent of `releaseStage`. Stages are **Stable, Beta, Coming Soon**. "Disabled" is not a stage. |
| 7 | Slack is out of scope for N10 V1. Its notification-channel behavior is unchanged. |
| 8 | Implementation on `phase/n10-integration-control-center`, PR to `main`. The implementation is synced to `testing` only as far as needed to run the focused N10 tests; no unrelated full-suite runs. |

## 3. Starting point (audit, 2026-10-09)

**Registry.** Two static adapter registries, `apps/web/src/lib/providers.ts` and `apps/worker/src/providers.ts`, keyed by the `IntegrationProvider` enum (`zendesk`, `jira`, `linear`, `intercom`, `github`, `custom`). Compile-time only (D16). Nothing is persisted about availability.

**Stage.** "Beta" is a presentation constant: `beta` in `modules/settings/integrations/csr/provider-presentation.tsx` and a hard-coded badge in `source-integration-specs.tsx` (Intercom, GitHub), plus `CustomIntegrationCard`. No backend reads it. Intercom and GitHub are Beta and open to **every** organization.

**Custom REST.** `Organization.customProviderEnabled` (default off), set from the tenant-detail panel, audited as `enable_custom_provider` / `disable_custom_provider`. Turning it off also sets `Integration.pollingPausedAt` on the custom integration. Read by `ownerGuard`, `integrations-data`, `custom-provider/status`, the custom card and `runCustomIngest` (before the run and every ~5 s while a request is in flight). N9.14-F1 forbids turning it on, but nothing in code prevents it.

**Entry points and their gates before N10.**

| Entry point | Files | Gate before N10 |
|---|---|---|
| OAuth / credential connect | `app/api/integrations/{zendesk,jira,linear,intercom,github}/connect` | owner + entitlements (`gateIntegrationConnect`) |
| OAuth callback (completes a connection) | `.../{provider}/callback` | owner or connect link; **no availability or entitlement re-check** |
| Connect links (D26) | `app/api/integrations/connect-links` (create), `connect-links/[token]/start` | owner (create) / token; **none** |
| OAuth app configuration | `.../{provider}/config` (GET/POST/DELETE) | owner |
| Manual backfill / import | `.../{provider}/backfill` | owner |
| Webhooks | `app/api/webhooks/{zendesk,jira}/[integrationId]` | shared secret; **ignores `pollingPausedAt`** |
| Concierge exports (live provider calls) | `app/api/concierge/{zendesk,jira}/export`, `.../integrations` | concierge access |
| Custom REST routes | `app/api/integrations/custom/*` via `ownerGuard` | owner + Beta flag |
| Worker ingest | `apps/worker/src/cycle.ts` `processOrganization` (single call site) | operator pause |
| Custom ingest | `packages/custom-ticket/src/ingest.ts` `runCustomIngest` | Beta flag, re-checked during the run |

Disconnect routes stay ungated on purpose (a customer may always disconnect). Slack routes are out of scope (ruling 7).

**Propagation today.** The worker loads an organization's integrations at the start of each organization run; `WorkerSettings` is read through a 2-second cache (`settings-reader.ts`). Web reads per request. There is no Redis and none is needed.

## 4. Model

### 4.1 States

| `enabled` | `releaseStage` | `betaAccess` | Who may use it |
|---|---|---|---|
| false | any | any | Nobody. New connections and every provider operation are refused. Existing rows and data are kept. |
| true | `stable` | ignored | Every organization. |
| true | `beta` | `all_organizations` | Every organization; shown with a Beta label. |
| true | `beta` | `allowlist` | Only organizations on the provider's allowlist. |
| true | `coming_soon` | ignored | Nobody can connect or operate it; shown in selectors as "Coming soon". |

Every check reduces to one question, asked by one resolver: **is this provider available to this organization now?** The answer is `available`, or `unavailable` with one code:

| Code | Meaning |
|---|---|
| `integration_disabled` | `enabled = false` |
| `integration_coming_soon` | stage is Coming Soon |
| `integration_beta_restricted` | Beta with an allowlist that does not include the organization |

### 4.2 Static catalog (code) vs persisted policy (database)

- **Catalog** (`packages/db/src/integration-catalog.ts`): `INTEGRATION_CATALOG satisfies Record<IntegrationProvider, …>` with the display name, category (`ticket_source`, `work_tracker`, `code_host`, matching the adapter role), connection type (`oauth`, `credentials`, `api_key_config`), the **default** availability, and an optional **rollout block** (`custom`: N9.14-F1). A provider added to the enum does not compile until it has an entry. This is the D16 rule: registration stays static; only runtime availability is data.
- **Policy** (database): one `IntegrationAvailability` row per provider, plus `IntegrationBetaAllowlist` rows. A missing row falls back to the catalog default, so a new enum value is safe before its seed row exists.
- **Coming Soon applies only to providers in the enum.** A provider without an adapter (for example Zoho Desk before N7) cannot be listed, because adding it to the enum requires an adapter. Documented limitation.

### 4.3 Schema (additive)

```prisma
enum IntegrationReleaseStage { stable beta coming_soon }
enum IntegrationBetaAccess   { all_organizations allowlist }

model IntegrationAvailability {
  provider        IntegrationProvider     @id
  enabled         Boolean                 @default(true)
  releaseStage    IntegrationReleaseStage
  betaAccess      IntegrationBetaAccess   @default(allowlist)
  /// Customer-facing explanation while disabled or Coming Soon. Never a secret.
  statusMessage   String?
  /// Optimistic concurrency: every write is compare-and-set on this value.
  version         Int                     @default(0)
  updatedAt       DateTime                @updatedAt
  updatedByEmail  String?
}

model IntegrationBetaAllowlist {
  provider        IntegrationProvider
  organizationId  String
  addedByEmail    String
  createdAt       DateTime     @default(now())
  organization    Organization @relation(..., onDelete: Cascade)
  @@id([provider, organizationId])
  @@index([organizationId])
}
```

**Seed (same migration), chosen so the deploy changes no behavior:**

| Provider | enabled | stage | betaAccess | Allowlist |
|---|---|---|---|---|
| zendesk | true | stable | allowlist (unused) | — |
| jira | true | stable | allowlist (unused) | — |
| linear | true | stable | allowlist (unused) | — |
| intercom | true | beta | **all_organizations** | — |
| github | true | beta | **all_organizations** | — |
| custom | true | beta | allowlist | every organization with `customProviderEnabled = true` |

`Organization.customProviderEnabled` is **kept, unread** (expand step) and dropped by a later contract migration (N10-F1), the same pattern as N2.10, so a rolling deploy never meets a missing column.

## 5. Enforcement

### 5.1 One resolver

`packages/db/src/integration-availability.ts`:

- `getIntegrationAvailabilityPolicy(db, provider)` and `listIntegrationAvailability(db)`: the row, or the catalog default.
- `resolveIntegrationAvailability(db, organizationId, provider)` → `{ available: true } | { available: false, code, message }`. Two indexed reads (the policy row and, only for an allowlisted Beta, one allowlist row).
- `resolveOrganizationAvailability(db, organizationId)` → a map for every provider (two queries), for the worker and for selectors.

No cache: every check reads the database, so a change applies to the next check in every web and worker process. The cost is one primary-key read per check, well under the cost of the provider call it guards. No Redis or other infrastructure.

### 5.2 Web

`apps/web/src/lib/integration-availability.ts`:

- `requireIntegrationAvailable(organizationId, provider)` → `NextResponse | null`. Unavailable: **403** `{ error, code, provider }`, where `code` is one of §4.1's codes. This is the documented API error.
- `availabilityRedirect(provider, code, requestUrl)` for the OAuth GET routes: a redirect to `/settings/integrations?availability=<code>&provider=<provider>`, the pattern `blockedConnectRedirect` already uses; the integrations page shows a toast.

Gated routes (in addition to their existing checks; the availability check runs after authentication and before any provider call or write):

| Route | Unavailable response |
|---|---|
| `{provider}/connect` (5) | redirect (GET) / 403 (POST) |
| `{provider}/callback` (5) | redirect; the code is not exchanged and no credentials are stored; a connect link is **not** consumed |
| `connect-links` POST (create) | 403 |
| `connect-links/[token]/start` | redirect to the link page with the reason; the link is not consumed |
| `{provider}/config` POST and DELETE | 403 (GET stays readable) |
| `{provider}/backfill` (5) | 403 |
| `webhooks/{zendesk,jira}/[integrationId]` | **200** `{ status: "ignored", reason: <code> }` after the secret check, before parsing; nothing stored (ruling 5) |
| `concierge/{zendesk,jira}/export` | 403 |
| `custom/*` via `ownerGuard` | 403, same codes (`integration_beta_restricted` replaces `beta_disabled`; no client code read `beta_disabled`). `status` and `disconnect` pass `requireAvailable: false`: they make no outbound request, and a customer can always see and disconnect a paused source |

A static **boundary test** lists every route under `app/api/integrations/**` and `app/api/webhooks/**` and `app/api/concierge/**/export` and fails if one that is not on the explicit exemption list (disconnect routes, Slack, connect-link revoke) does not call the availability helper.

### 5.3 Worker

- `processOrganization` reads `resolveOrganizationAvailability` once per organization run, **before ingest**. An unavailable integration is treated exactly like the N4.5 operator pause: no provider call, no sync attempt recorded, no failure, no `failingSince` streak. It is logged as `integration_ingest_unavailable` with the code.
- Normalization, commitments, evaluation and alerts on data **already stored** keep running, as for a pause and as plan 09 §8.7 approved for Custom REST. They are not provider operations. Freshness goes stale and the customer sees it (D22); D13(b) holds breach alerts on stale sources as before.
- `runCustomIngest` replaces its flag read with the resolver, before the run and in its ~5-second in-flight re-check, so disabling Custom REST still aborts an in-flight request within about 5 seconds and discards its response.
- Built-in providers have no in-flight abort: a call already running when the operator disables the provider finishes its current bounded run (each request ≤ 30 s per attempt, plan 03); the next run is blocked. Documented limitation.
- There is no job queue. "Queued" work is the next scheduled organization run, which re-checks.

### 5.4 Custom REST specifics (rulings 3, 4)

- Removing an organization from the Custom REST allowlist keeps plan 09 §8.7's belt-and-braces behavior: the same transaction sets `pollingPausedAt` on its custom integration. Re-adding does **not** resume a pause (§8.7, unchanged).
- **Rollout block (N9.14-F1; amended by ruling 3-A1, 2026-10-10).** While the catalog carries the block, the admin API refuses, with 409 `rollout_blocked`: setting Custom REST's `betaAccess` to `all_organizations`; promoting it to `stable`. Adding an organization to its allowlist is allowed only while the provider is `beta` with `allowlist` (otherwise 409 `rollout_blocked`); the add is scoped to that organization and audited. _(As first written, this bullet also refused every allowlist add; see ruling 3-A1.)_ Narrowing changes (disable, Coming Soon, removing an organization) stay allowed. Lifting the block is a reviewed code change made when N9.14-F1 is closed. Organizations seeded from an existing `customProviderEnabled = true` stay on the list; nothing is removed by the migration.

### 5.5 Customer-facing

- `integrations-data.ts` and onboarding data carry each provider's availability (stage, available, code, message). The settings page and the onboarding selector show an unavailable provider as **Unavailable** (disabled) or **Coming soon**, with the operator's message when set, and no connect control. A Beta-restricted provider is hidden from organizations not on its allowlist, as Custom REST is today.
- A connected integration whose provider becomes unavailable is shown as **"Paused by Elapsed"**, not "Disconnected": `Integration.status` is never changed. The customer may still disconnect it; reconnecting is blocked.
- The Beta label is derived from `releaseStage`, replacing the presentation constants.

## 6. Lifecycle effects

### 6.1 Disabling (or losing eligibility)

| Item | Effect |
|---|---|
| Integration rows, credentials, cursors, webhook secrets | Unchanged |
| Raw events, cases, events, commitments, evaluations, notifications | Unchanged; no row is deleted or rewritten |
| New connection, reconnect, OAuth completion, connect link | Refused (§5.2) |
| Worker ingest | Skipped like a pause (§5.3) |
| Webhook deliveries | Acknowledged and ignored (200) |
| Manual backfill, concierge export, custom test/sample/preview/activate | Refused |
| Normalization, evaluation, alerts on stored data | Continue; the source goes stale |
| Customer disconnect | Allowed |

### 6.2 Re-enabling

Nothing has to be repaired. The next organization run ingests from the stored cursor; webhooks are processed again. An integration that was `disconnected`, `reauth_required` or operator-paused stays in that state: re-enabling never reconnects or resumes anything the customer or an operator stopped separately.

### 6.3 Platform unavailability vs customer disconnect

They are different columns and never written by the same action: availability lives in `IntegrationAvailability` / `IntegrationBetaAllowlist`; disconnect is `Integration.status = disconnected`. The UI and the worker log name them differently.

### 6.4 Webhook recovery (ruling 5)

Only Zendesk and Jira have webhook receivers. Both pollers read from persisted cursors: Zendesk's incremental export `start_time` (`packages/zendesk/src/backfill.ts`) and Jira's `updated >= updatedSince` JQL (`packages/jira/src/backfill.ts`). A change whose webhook was ignored is therefore fetched by the first poll after re-enablement. Webhooks were already only a freshness accelerator over the 5-minute poll and 30-minute reconciliation (roadmap step 20).

## 7. Admin console

- **Page** `/admin/integrations` (`app/(admin)/admin/integrations/page.tsx`, `modules/admin/integrations/{ssr,csr}`), linked from the admin navigation. Existing admin shell, table, badges, dialogs and the theme-aware toast (`lib/notify.ts`). No new visual system.
- **Table, one row per provider:** name and key; category and connection type; Enabled/Disabled; stage; Beta access and allowlist size; connections (non-disconnected `Integration` rows) and active organizations (distinct organizations with a non-disconnected integration); health from fields the product already relies on (connected, failing, needs attention, stale against the freshness grace); last update and operator (`updatedAt`, `updatedByEmail`); a rollout-block notice when present.
- **Edit dialog:** enabled switch, stage, Beta access, customer-facing message, and a required **reason**. Before saving a change that narrows availability, the dialog loads an **impact preview** (organizations and connections that lose access) from the API and requires an explicit confirmation. Blocked options are disabled with the rollout-block reason (Custom REST: N9.14-F1).
- **Allowlist panel:** list, add (organization search), remove with confirmation.
- **States:** loading, error with retry, empty, success and failure toasts. A 409 `stale_version` reloads the row and asks the operator to review and retry.
- **Tenant detail:** the Custom REST panel becomes a view of that organization's allowlist membership with add/remove, through the same API.

### 7.1 Admin API (platform operators only, `requirePlatformOperator`)

| Method and route | Body | Result |
|---|---|---|
| `GET /api/admin/integrations` | — | rows of §7 |
| `PATCH /api/admin/integrations/providers/[provider]` | `{ expectedVersion, enabled?, releaseStage?, betaAccess?, statusMessage?, reason }` | updated row; 400 invalid; 409 `stale_version` / `rollout_blocked`; no-op writes nothing |
| `POST /api/admin/integrations/providers/[provider]/impact` | proposed change | `{ organizationsLosingAccess, connectionsAffected }` (read-only) |
| `POST /api/admin/integrations/providers/[provider]/allowlist` | `{ organizationId, reason }` | 201; 409 `rollout_blocked` / already listed |
| `DELETE /api/admin/integrations/providers/[provider]/allowlist/[organizationId]` | `{ reason }` | 200 |
| `POST /api/admin/tenants/[organizationId]/custom-provider` | `{ enabled, reason }` | **kept** for one release, now a thin wrapper over allowlist add/remove (same rollout block; a no-op answers `{ changed: false }`) |

The existing per-integration controls route `/api/admin/integrations/[integrationId]` is unchanged.

### 7.2 Audit

Each write is one transaction with exactly one `AdminAuditLog` row (`recordAdminAudit`):

| Action | `integrationId` | `metadata` |
|---|---|---|
| `update_integration_availability` | null | `{ provider, before, after, reason }` (policy fields only) |
| `add_integration_allowlist` | null | `{ provider, organizationId, reason }` (`organizationId` also set on the row) |
| `remove_integration_allowlist` | null | `{ provider, organizationId, reason, pausedPolling }` |

No credential, token, secret or configuration payload is read or written by these paths. The legacy `enable_custom_provider` / `disable_custom_provider` actions stay readable in the audit log.

### 7.3 Concurrency

`PATCH` is a compare-and-set: `updateMany({ where: { provider, version: expectedVersion } })`, `version` incremented; zero rows updated is `409 stale_version`. The missing-row case inserts the seeded default first, inside the same transaction. Allowlist add is idempotent on its primary key (a duplicate is 409 `already_listed`, nothing written).

## 8. Security

- Only `PLATFORM_ADMIN_EMAILS` operators can read or change availability (ruling 2). Organization owners and members get 403 from the API and `notFound()` from the page.
- No organization-level setting can override a platform restriction: every customer path goes through the resolver after its own authorization.
- The admin data is aggregated counts and policy fields. Credentials are never selected.
- The customer-facing message is operator-authored text, rendered as text.

## 9. Tasks, in order

| Task | Scope | Done when |
|---|---|---|
| **N10.0** | Documentation: D33, this plan, roadmap entries, amendments to plans 04, 05 and 09, operator runbook `docs/integration-availability.md`, customer guide | Recorded before any code (this commit) |
| **N10.1** | Schema, migration with seed, catalog, resolver (`@sla/db`) | Migration generated; type-check clean |
| **N10.2** | Web enforcement: helper, every route of §5.2, `ownerGuard`, boundary test | Every listed route calls the helper; type-check clean |
| **N10.3** | Worker and custom ingest enforcement (§5.3) | Unavailable integrations skipped as a pause; custom abort uses the resolver |
| **N10.4** | Admin API, mutations, audit, concurrency, rollout block (§5.4, §7.1–§7.3) | Routes and mutations type-check; audit rows per write |
| **N10.5** | Admin console page, dialogs, allowlist, tenant-detail panel (§7) | Loading, error, empty, success states; browser check |
| **N10.6** | Customer-facing availability (§5.5): settings page, onboarding selector, derived Beta label | Unavailable/Coming soon/Paused by Elapsed shown |
| **N10.7** | Focused tests on `testing` (§10) | Listed tests pass |
| **N10-F1** | Contract migration dropping `Organization.customProviderEnabled` | After N10 is deployed (owner decides when) |

## 10. Tests (focused, on `testing`, ruling 8)

> **As built (2026-10-09).** Suites: `packages/db/test/integration-availability.test.ts` (unit), `packages/db/test/integration-availability.db.test.ts` (two pools), `packages/custom-ticket/test/ingest-availability.db.test.ts`, `apps/web/test/integration-availability-admin.test.ts`, `apps/web/test/integration-availability-routes.test.ts`, `apps/web/test/integration-availability-boundary.test.ts` (static), `apps/web/test/admin-integrations-view.test.ts` (static render; the repo has no DOM test environment, so the refresh-error and toast paths are not automated and were checked in a browser), `apps/worker/test/integration-availability.test.ts`. The four real-database suites are listed in `vitest.config.ts`.

- **Resolver:** every state of §4.1, missing-row defaults, allowlist hit and miss.
- **Admin authorization and persistence:** owner, member and signed-out get 401/403 on every new route; an operator's write persists and writes one audit row; no-op writes nothing; no secret in audit metadata.
- **Concurrency:** two writes with the same `expectedVersion`: one succeeds, one gets 409.
- **Rollout block:** each blocked Custom REST change (all organizations, Stable, an allowlist add outside Beta/allowlist) is refused with 409 and writes nothing; narrowing changes and an allowlist add under Beta/allowlist succeed and write one audit row (3-A1).
- **Connect and reconnect:** connect, callback and connect-link start refuse an unavailable provider without storing credentials or consuming the link.
- **Webhook:** an unavailable provider gets 200 ignored and nothing is ingested.
- **Backfill, config writes, concierge export, custom routes:** 403 with the code.
- **Worker:** an unavailable integration is skipped as a pause (no provider call, no failure, no streak); stored-data stages still run; re-enabling ingests on the next run.
- **Eligibility:** removing an organization from an allowlist blocks it on the next check; others continue.
- **Data preservation:** disabling and re-enabling leave `Integration` rows, credentials, cases, events and commitments byte-identical.
- **Propagation:** a change written by one client is observed by the next resolver call on a separate client (no cache).
- **Boundary:** every gated route calls the helper.
- **UI:** the admin view's loading, error, empty and success states.

Type-check (`pnpm type-check`) and the web build run on the phase branch.

## 11. Rollback

Additive schema. Reverting the code leaves two unused tables and the still-present `customProviderEnabled` column, which the reverted code reads again. Allowlist additions made after the deploy would not be reflected in the column; the runbook says to re-check the Custom REST flag after a rollback.

## 12. Out of scope

Percentage rollout; an "internal organizations" concept (no such flag exists; use the allowlist); Slack (ruling 7); per-plan availability; database-backed admin roles (ruling 2); an in-flight abort for built-in providers; listing providers that have no adapter.
