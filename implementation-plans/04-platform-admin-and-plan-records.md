# N4 — Platform Admin + Plan Records: Implementation Plan

> **Roadmap phase:** [N4 in `ROADMAP_Product.md`](ROADMAP_Product.md#phase-n4--platform-admin--plan-records). Task status lives in the roadmap. This file explains **how**.
> **Depends on:** [N3](03-provider-isolation-and-freshness.md), for `lastSuccessfulSyncAt`, failure counters and durations. **Decisions (all closed):** D14 fixes the plan names used in N4.3 (`starter`, `team`, `enterprise`). D15 (Zendesk + Jira as the current provider pair) is captured as data in N4.7. **Unblocks:** [N5](05-customer-onboarding-and-retention.md).
> **Estimate:** 3 weeks. **Branch:** `phase/n4-platform-admin-and-plan-records`.

---

## 1. Objective

The platform operator can answer, on one page and without SQL: **who are the customers, what plan and status is each on, and is each one healthy?** Every operator action is audited. Nothing platform-level is visible to customer users.

## 2. Why this phase exists

> **Historical (written 2026-09-29, before N4).** The bullets below describe the state N4 started from. N4 replaced `/operator` with the `/admin` area (roadmap N4.1–N4.6); `/operator` now only redirects.

- There are 10 live customers, but the repository has no record of their plans, status or provider pairs.
- The only cross-tenant view is `/operator`. It shows unhealthy integrations and failed alerts only (`apps/web/src/lib/operator-monitoring-data.ts`).
- The operator is an ordinary `User` inside a tenant org, uses the tenant app shell, and leaves no audit trail.
- Monitoring was correctly moved to `/operator/monitoring` (commit `794d760`): `WorkerSettings` is a global singleton, and operator access is an environment allowlist (`PLATFORM_ADMIN_EMAILS`, `apps/web/src/lib/authz.ts`), not an org role. N4 builds on that, not around it.

## 3. Authorization boundaries

| Actor | How resolved | Can see | Can never see |
|---|---|---|---|
| Platform admin (operator) | `PLATFORM_ADMIN_EMAILS` via `isPlatformOperator` (kept at this scale) | All tenants' metadata, integration health, plan records, failures, worker health | Credentials, OAuth secrets, `IntegrationConfig.clientSecret` (never decrypted for display) |
| Org owner | `UserRole.owner` | Own org's integration health, freshness, link coverage, plan and usage (read-only) | Other tenants; `WorkerSettings`; admin notes; audit log; plan overrides |
| Org member | `UserRole.member` | Own org's operational data | Same as owner, plus owner-only settings |

- Admin UI and data functions are callable only after `isPlatformOperator`. Pages return `notFound()` for everyone else, and API routes and actions return 403.
- **Admin data modules must not be imported from tenant code.** This is enforced by a boundary test (N4.6).
- Admin roles (support / billing / engineering), a DB-backed admin table, and impersonation are **Later (≈500 tenants)**. They are out of scope here.

## 4. Current implementation relevant to this phase

> **Historical starting point (2026-09-29).** The `operator/*` paths, modules, actions and `operator-monitoring-data.ts` listed here were **replaced by N4** (2026-10-02). What exists now: routes under `apps/web/src/app/(admin)/admin/` (overview, `monitoring`, `tenants`, `tenants/[organizationId]`, `audit`, and the later `billing` pages), `apps/web/src/modules/admin/*`, `apps/web/src/lib/admin-*.ts` (auth, audit, tenants, monitoring, billing, usage), `AdminAuditLog`, and the `/api/admin/*` routes. `lib/authz.ts` and `PLATFORM_ADMIN_EMAILS` are unchanged. The list below is kept for context only.

- **Routes:** `apps/web/src/app/(main)/operator/page.tsx`, `apps/web/src/app/(main)/operator/monitoring/page.tsx`
- **Modules:** `apps/web/src/modules/operator/{csr/OperatorView.tsx, ssr/Operator.tsx, monitoring/*}`
- **Data and actions:** `apps/web/src/lib/operator-monitoring-data.ts`, `apps/web/src/actions/operator.ts`, `apps/web/src/actions/worker-settings.ts`, `apps/web/src/lib/worker-settings-data.ts`
- **Authorization:** `apps/web/src/lib/authz.ts` (`isPlatformOperator`, `requirePlatformOperator`, `requireOwner`)
- **Navigation:** `apps/web/src/components/layout/{nav-items.ts, app-sidebar.tsx}` (operator group)
- **API:** `apps/web/src/app/api/settings/worker/route.ts`
- **Tests:** `apps/web/test/{worker-settings-route,worker-settings-actions,nav-items}.test.ts`
- **Schema:** `Organization`, `User`, `Integration`, `Notification`, `NotificationFailure`, `WorkerSettings`

## 5. Tasks, in implementation order

### N4.1 — Separate admin shell
- Add an `apps/web/src/app/(admin)/admin/` route group with its own `layout.tsx`, outside the `(main)` tenant shell and sidebar.
- Move the `/operator` pages to `/admin` (overview), `/admin/monitoring`, `/admin/tenants` and `/admin/tenants/[organizationId]`. Keep `/operator/*` as redirects for one release.
- A server helper `requirePlatformAdminPage()` wraps `isPlatformOperator` and `notFound()`.
- Remove the operator group from the tenant `nav-items.ts`; the admin layout gets its own navigation.
- **Verify:** `nav-items.test.ts` updated; a member or owner gets 404 on every `/admin/*` page and 403 on every admin API or action (new `apps/web/test/admin-authz.test.ts`).

### N4.2 — Admin audit log
- **Schema:** `AdminAuditLog { id, actorEmail, action, organizationId?, integrationId?, metadata Json?, createdAt }`. It is append-only, and no update or delete path exists in code.
- Write an entry for every admin action (N4.5) and every tenant-detail view (`action: "view_tenant"`).
- Show it read-only at `/admin/audit`.
- **Verify:** a test that each action writes exactly one row, and that no code path updates or deletes rows (a grep in the boundary test).

### N4.3 — Plan and status record per organization (manual)
- **Schema on `Organization`:**
  - `plan String?` — plan identifier. D14 is decided, so the API accepts only `starter`, `team`, `enterprise` (or empty). The column stays a string; N6 may tighten it to an enum.
  - `planStatus` — enum `trial | active | past_due | cancelled | internal`, default `trial`.
  - `trialEndsAt DateTime?`
  - `billingReference String?` — free text, for example an invoice or contract id.
- The admin edits these on the tenant-detail page, and every edit is audited.
- **These fields never change monitoring behaviour** (roadmap Phase 10b principle 3: never hard-stop monitoring).
- **D14 (decided):** the live pricing model is adopted (Starter $49, Team $149, Enterprise Custom, seat-based). The `plans/03` Phase 18 model is not used. The single plan constant is `packages/db/src/plans.ts` (N6.1).
- **Verify:** `tenant-isolation.test.ts` unchanged (these are org columns); an admin edit test.

### N4.4 — Tenants list and tenant detail read models
- New `apps/web/src/lib/admin-tenants-data.ts`, using batched `groupBy` / `count` queries with no per-tenant N+1. The perf discipline from 7.7 applies.
- **Tenants list, one row per org:**
  - name, created, owner email, member count, pending invitations
  - `plan` / `planStatus` / `trialEndsAt`
  - integrations with provider, role, status, `lastSuccessfulSyncAt`, `failingSince`
  - open cases; evaluations written in the last 24 h
  - notifications sent and failed in the last 24 h
  - link coverage: cases with a `certain` tracker link ÷ cases in the last 30 days
- **Tenant detail:**
  - per-integration health: status, last error, consecutive failures, last duration, backfill completion from the integration `cursor`
  - recent `NotificationFailure`s
  - `SlaImportSummary`
  - cases with no matching policy (same query as dashboard 6.2)
  - that org's tick duration (N3)
- Link coverage lives in one shared function `lib/link-coverage-data.ts`, reused by N5's customer-facing panel.
- **Verify:** real-DB tests for both read models with two orgs (asserting no cross-contamination of counts); a query-count assertion using `PERF_METRICS`.

### N4.5 — Minimal admin actions
Each action is audited and scoped to one integration. None edits tenant data.
- **Pause / resume polling:** `Integration.pollingPausedAt DateTime?`. The worker skips **ingest** for paused integrations; normalization and evaluation still run. The customer sees "paused by Elapsed support" in integration settings.
- **Request re-normalization:** `Integration.renormalizeRequestedAt DateTime?`. The worker runs a full (non-incremental) normalization pass on its next tick, then clears the field.
- **Verify:** worker tests for both flags; action tests.

### N4.6 — Boundary guarantees
- Extend `packages/core/test/provider-boundary.test.ts` (or add `apps/web/test/admin-boundary.test.ts`) so that `lib/admin-*`, `lib/operator-monitoring-data.ts` and `actions/operator.ts` are imported only from `app/(admin)/**` and `modules/admin/**` (or `modules/operator/**`).
- Tenant pages never render `WorkerSettings` controls (assert on `nav-items` and the settings routes).
- **Verify:** the test fails if a tenant module imports an admin module.

### N4.7 — Capture the 10 customers' facts (resolves the data half of D15)
- Using the admin UI, fill in `plan`, `planStatus` and `billingReference` for every live tenant. The provider pairs are visible automatically from `Integration` rows.
- Record in the roadmap Status Board the count of tenants per provider pair; counts only, no customer names.
- **Verify:** no tenant has a null `planStatus` other than the default; the roadmap row is updated.

## 6. Data / schema changes

| Change | Task |
|---|---|
| `AdminAuditLog` model | N4.2 |
| `Organization.plan`, `planStatus` (enum), `trialEndsAt`, `billingReference` | N4.3 |
| `Integration.pollingPausedAt`, `renormalizeRequestedAt` | N4.5 |

All are additive.

## 7. Verification commands

```bash
pnpm --filter @sla/db validate
pnpm type-check
pnpm test
npx vitest run apps/web/test/admin-authz.test.ts apps/web/test/tenant-isolation.test.ts apps/web/test/nav-items.test.ts
pnpm --filter @sla/web perf:baseline
```

Also do a browser check as an operator account and as a non-operator owner account in local dev.

## 8. Acceptance criteria

1. `/admin/tenants` shows every tenant's plan, status, integration health, last successful sync, open cases, and 24 h alert delivery, without SQL.
2. Non-operators get 404 on pages and 403 on APIs and actions for everything under `/admin`.
3. Every admin action and tenant-detail view writes an audit row.
4. The 10 tenants' plan and status records are filled in, and the provider-pair counts are recorded in the roadmap.

## 9. Rollback

The schema is additive. The `/operator` redirects mean reverting only restores the old routes. The pause flag defaults to null, so it is inert if the code is reverted.

## 10. Out of scope (P1 / Later)

- **P1 (≈50 tenants):** usage vs. plan limits (→ N6); billing-provider status (→ N6); tenant data export and deletion workflow (after H-5's retention answer); support notes; operator alerts on long-unhealthy integrations beyond N3.9.
- **Later (≈500):** admin roles in the DB; consent-based impersonation; feature flags; SLO dashboards; per-tenant worker sharding.
- **Never exposed to customers:** `WorkerSettings`, circuit-breaker controls, cross-tenant data, admin notes, the audit log, plan overrides, raw provider error internals, credentials.
