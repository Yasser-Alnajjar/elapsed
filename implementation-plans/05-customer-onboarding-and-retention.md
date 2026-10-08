# N5 — Customer Onboarding + Retention: Implementation Plan

> **Roadmap phase:** [N5 in `ROADMAP_Product.md`](ROADMAP_Product.md#phase-n5--customer-onboarding--retention). Task status lives in the roadmap. This file explains **how**.
> **Depends on:** [N2](02-provider-contract-and-projector.md) (capabilities drive onboarding steps) and [N4](04-platform-admin-and-plan-records.md) (shared link-coverage function, admin visibility). **Decision needed:** D26 (how a non-member tracker admin connects) before N5.3. **Unblocks:** [N6](06-entitlements-and-billing.md).
> **Estimate:** 3–4 weeks. **Branch:** `phase/n5-customer-onboarding-and-retention`.

---

## 1. Objective

- Any supported `{ticket source} × {tracker}` pair reaches first findings without help.
- Existing customers get a recurring reason to return: a monthly report, link coverage, and honest partial value.
- There is enough usage instrumentation to measure the roadmap's validation metrics.

## 2. Why this phase exists

- **Onboarding.** `plans/03` Phase 11 lists the three highest-value onboarding mitigations as **not built**: partial value while tracker approval is pending, a "request access" link for the tracker admin, and a forwardable security summary.
- **Retention.** `plans/03` 10.2 calls the scheduled monthly report "the strongest retention feature not yet shipped".
- **Verification.** Roadmap 6.8, the live onboarding walkthrough, was never done.
- **Measurement.** With 10 live customers, retention and usage now matter more than acquisition, and nothing measures usage today.

## 3. Current implementation relevant to this phase

- **Onboarding:**
  - `apps/web/src/app/onboarding/{page.tsx, review-policies/page.tsx, activation/page.tsx}`
  - `apps/web/src/modules/onboarding/{onboarding,review-policies,activation}/`
  - `apps/web/src/lib/{onboarding-data.ts, types/onboarding.ts, source-sync.ts, findings-data.ts, policy-import-review-data.ts}`
  - `app/api/onboarding/progress/route.ts`
  - After N1.16, Intercom is a supported ticket source.
- **Reports:** `apps/web/src/lib/report-data.ts`, `app/api/reports/commitments/route.ts` (CSV/JSON, keyset-paginated), `app/api/cases/export`.
- **Email and notifications:** `packages/email`, `packages/notifications/src/email-template.ts`, `OrganizationEmailSettings` (per-org SMTP), `DEPLOYMENT_SMTP_*` (deployment mailer).
- **Invitations and roles:** `packages/db/src/invitations.ts`, `packages/db/src/members.ts`, `apps/web/src/lib/authz.ts` (`requireOwner` gates integration connects).
- **Dashboard:** `modules/dashboard/dashboard/csr/{DashboardView,BlindSpotsPanel}.tsx`, `lib/dashboard-data.ts`.
- **Public docs:** `apps/web/src/app/docs/*`, `docs/customer-guide.md`.

## 4. Tasks, in implementation order

### N5.1 — Capability-driven onboarding steps
- Build steps from the connected adapters' capabilities (N2):
  1. **Connect a ticket source** (Zendesk or Intercom).
  2. **Backfill.**
  3. **Review imported policies**, only if `capabilities.policyImport`; otherwise **create a first native policy**.
  4. **Connect a work tracker** (Jira or Linear; optional).
  5. **Alerts** (Slack or email).
- Beta labels stay on Intercom and GitHub until promoted (D17). Linear was promoted out of Beta on 2026-10-05 and carries no label.
- **Verify:** onboarding-status tests for all four matrix pairs; browser walkthrough of the Zendesk + Jira and Intercom + Jira paths in local dev with stubbed integrations.

### N5.2 — Partial value before a tracker is connected
- Findings and dashboard work with the ticket source alone: support-leg numbers and commitments.
- Show a neutral banner: "Engineering time appears once a tracker is connected". Never show zero engineering time as if it were a fact.
- **Verify:** `findings-data` tests for a ticket-source-only org; no leg is shown as `engineering` without a `certain` link.

### N5.3 — Request access for the tracker admin (D26 decided: option b)
- **The problem:** connecting integrations is owner-only (`requireOwner`), and the tracker admin is usually not a member.
- **Decision (roadmap D26): option (b).** A signed, single-use, organization- and provider-scoped connect link, short-lived and consumed after successful use, lets a tracker admin who is not an Elapsed member connect the tracker. Option (a), a member invitation with a one-time connect right, was not chosen because it adds a user account.
- **How:** an owner mints the link from the onboarding tracker step (`POST /api/integrations/connect-links`). Only a SHA-256 of the token is stored (`IntegrationConnectLink`); expiry is 72 h; the link is scoped to one organization and one provider (Jira or Linear). `/connect/<token>` is public and starts that provider's OAuth with a signed state (`lib/oauth-state.ts`) carrying `connectLinkId`. The callbacks consume the link atomically (`updateMany` on `consumedAt: null`, same organization and provider, unexpired) only after the grant is known good.
- **Verify:** tests that the link works once, only for the named provider and org, and expires. The completion is recorded on the org's own data (for example `Integration.connectedBy`), not in the platform `AdminAuditLog`, which is for operator actions only.

### N5.4 — Forwardable security summary
- A public docs page (`apps/web/src/app/docs/security/page.tsx`) generated from facts:
  - read-only scopes per provider (from each provider's OAuth scope constants);
  - what is stored;
  - encryption at rest (`packages/db/src/crypto.ts`);
  - the retention and deletion answer (from H-5);
  - no write-back.
- **Verify:** the scopes on the page are read from the same constants the OAuth routes use (unit test), so the page cannot drift.

### N5.5 — Link coverage panel
- Dashboard panel: "Linked 214 of 318 escalations (67%)", with a drill-down into unlinked cases. It uses `lib/link-coverage-data.ts` from N4.4.
- Report the percentage honestly and never inflate it (Phase 15 rule: `probable` links do not count).
- **Verify:** real-DB test with certain, probable and unlinked cases.

### N5.6 — Monthly report
- **Scheduling:**
  - The worker's reconciliation tick checks, per org, whether the previous month's report has been delivered.
  - The idempotency key is `(organizationId, month)` in a new `ReportDelivery { id, organizationId, period, channel, status, deliveredAt, error }` table with a unique key.
  - The month boundary uses the org's display timezone (`Organization.timezone`), the same timezone the app displays dates in. SLA math is unaffected (it uses each business calendar's own timezone).
- **Content:**
  - compliance by commitment kind
  - breaches by stage ("time by stage", neutral language)
  - top customers by breaches
  - link coverage
  - link to the case list
  - Aggregations reuse `report-data.ts` and `analytics-data.ts`.
- **Delivery:** email through `OrganizationEmailSettings`, with the CSV attached; plus a Slack message with a link if Slack is connected. Delivery failures go to `ReportDelivery.error` and appear in the admin tenant detail.
- PDF is **out of scope** unless a customer asks twice (`plans/03` Phase 8 rule).
- **Verify:** worker test for idempotency (two ticks send once); content snapshot test; neutral-language check (no "blame", "fault", "responsible").

### N5.7 — Usage instrumentation for validation metrics
- **Weekly active orgs:** `User.lastSeenAt`, updated at most once per hour per user from the authenticated layout (`request-context.ts`).
- **Alert click-through:**
  - Slack and email case links carry `?ref=alert&n=<notificationId>`.
  - The case page records `Notification.openedAt` on first open, and only for the same organization. The notification's case must belong to the session's org.
- **Time to first value:** `Organization.firstFindingsViewedAt`.
- No third-party analytics and no tracking outside the app.
- **Verify:** tenant-isolation test covers the `openedAt` write (a foreign notification id is ignored).

### N5.8 — Live walkthroughs (closes historical 6.8 / hygiene H-9)
- Walk through onboarding with real sandbox accounts:
  - Zendesk + Jira: **required**.
  - Intercom + Jira: when a sandbox exists.
  - Zendesk + Linear: optional.
- Record time-to-findings for each.
- **Verify:** results are recorded in the roadmap (6.8 and N5.8) with dates.

## 5. Data / schema changes

| Change | Task |
|---|---|
| `ReportDelivery` model (unique `organizationId, period, channel`) | N5.6 |
| `User.lastSeenAt`, `Notification.openedAt`, `Organization.firstFindingsViewedAt` | N5.7 |
| Connect-link record (per D26; e.g. `IntegrationConnectLink`) | N5.3 |

All are additive. `ReportDelivery` and the connect-link record are covered by `tenant-isolation.test.ts`.

## 6. Verification commands

```bash
pnpm --filter @sla/db validate
pnpm type-check
pnpm test
npx vitest run apps/web/test/tenant-isolation.test.ts apps/web/test/provider-matrix-smoke.test.ts
npx vitest run apps/worker/test
```

Also run browser walkthroughs per N5.1 and N5.8.

## 7. Acceptance criteria

1. All four matrix pairs complete onboarding in local dev without manual database steps. Zendesk + Jira is completed live (N5.8).
2. A ticket-source-only org sees support-leg findings and an explicit "no tracker yet" state.
3. The monthly report is delivered exactly once per org per month, in neutral language, with failures visible to the operator.
4. Weekly-active, alert click-through and time-to-first-value can be read from the database.

## 8. Rollback

The schema is additive. The monthly report has a `WorkerSettings` kill switch (operator-only). Instrumentation writes are best-effort and never block a request.

## 9. Out of scope

- PDF reports, customer-facing portals, and shared reports (`plans/03` "do not build").
- AI summaries.
- Financial or credit figures.
- Third-party product analytics.
- SSO/SAML (parked in `ignored.md`).
