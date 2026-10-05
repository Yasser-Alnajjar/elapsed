# N6 — Entitlements + Billing: Implementation Plan

> **Roadmap phase:** [N6 in `ROADMAP_Product.md`](ROADMAP_Product.md#phase-n6--entitlements--billing). Task status lives in the roadmap. This file explains **how**.
> **Depends on:** [N4](04-platform-admin-and-plan-records.md) (plan and status record, audit log) and [N5](05-customer-onboarding-and-retention.md).
> **Trigger-based (roadmap D20).** Normally starts only when one of these is true (D14 is resolved). N6 was **started early at the owner's request**, before any trigger fired:
> - ≥15 paying tenants;
> - manual invoicing or plan tracking costs the owner more than ~2 h per month;
> - a customer asks to change plans or pay by card without contacting you.
>
> **Decisions (all closed):** D14 (live seat-based pricing: Starter $49, Team $149, Enterprise Custom), D25 (imported policies do not count toward policy limits), D27 (restricted state after a trial; see the note in §7 on new cases), D28 (provider-agnostic billing; Paymob is the **sandbox/testing** provider only, **production provider still open**).
> **Estimate:** 2–3 weeks once triggered. **Branch:** none for N6.1–N6.4 (landed on `main` with the N5 merge); `feature/billing` for the billing steps (N6.7–N6.10).

---

## 1. Objective

- The **current, intentional** pricing (whichever model D14 confirms) is represented once in code.
- Usage is measured against it, and limits are enforced **softly**.
- Plan status is driven by an internal, provider-independent billing domain (subscriptions, invoices, events, operator overrides). A payment provider can later be plugged in behind it (N6.5) without changing that domain.
- Monitoring is **never** stopped or degraded because of plan state.

## 2. Why this phase exists (and why it is not first)

**Starting point (audit, 2026-09-29; historical, superseded by N6 itself):**
- There was **no billing, plan, subscription or usage code**. The schema had no such models; N4 added manual records only. N6 has since added the plan constant, usage read model, entitlements, trial lifecycle and an internal billing domain (N6.1–N6.4, N6.7–N6.10).
- **Two pricing models were documented, and neither was enforced.** D14 chose the live one:

  | Source | Plans | Metric |
  |---|---|---|
  | Live pricing page, `apps/web/src/modules/marketing/pricing/csr/PricingView.tsx` (last changed 2026-09-27) | Starter $49 · Team $149 · Enterprise Custom | Seats (5 / 20 / unlimited); Starter: 1 support + 1 engineering integration, up to 3 SLA policies, email alerts; Team: unlimited integrations, Slack, "90-day case history"; Enterprise: SSO/SAML, custom retention |
  | `plans/03-Product-and-MVP.md` Phase 18 | Starter $79 · Growth $149 · Scale $249 · Enterprise | Monthly escalated tickets (150 / 600 / 2,500) |

- The old `$299 / $699` pilot pricing in `plans/05` is obsolete. **Do not reintroduce it.**
- **D14 chose the live model** (Starter / Team / Enterprise, seat-based). The escalation-volume model is not adopted. The old `$299 / $699` pilot pricing stays excluded.

**Why it waits:** with 10 customers, a manual plan record (N4) is enough. Building billing before the provider boundary and freshness work would optimise invoicing over correctness.

## 3. Implementation relevant to this phase (updated 2026-10-05)

> The pricing constants now live in `packages/db/src/plans.ts` (`PLANS`); `PricingView.tsx` renders from it. The billing domain is `packages/db/src/billing.ts` with `billing-provider.ts`, `usage.ts` and `entitlements.ts`. The items below are the surfaces entitlements touch.

- **Pricing page:** `apps/web/src/modules/marketing/pricing/csr/PricingView.tsx` (renders from `PLANS`), `pricing-content.ts` (FAQ), `apps/web/src/lib/pricing-viewer.ts`.
- **Seats:** `packages/db/src/members.ts`, `packages/db/src/invitations.ts`, `apps/web/src/app/api/settings/{members,invitations}`, `apps/web/src/app/api/invitations/accept`.
- **Integrations:** `apps/web/src/app/api/integrations/*/connect`, callback routes.
- **Policies:** `packages/commitments/src/native-policy.ts`, `apps/web/src/app/api/settings/sla-policies`, imported policies from `packages/zendesk/src/policies.ts`.
- **Retention promise:** none implemented. `RawEvent` is append-only and unpruned. The "90-day case history" claim was removed from the pricing page (H-3, N6.6); the pricing page must not claim retention features.
- **Plan record:** `Organization.plan` / `planStatus` / `trialEndsAt` (N4.3).

## 4. Tasks, in implementation order

### N6.1 — Record D14 and write the entitlement table
- Add the confirmed plan list and its limits to this plan (§7) and to one code constant: `packages/db/src/plans.ts`, exporting `PLANS` with ids, limits and feature flags.
- `PricingView.tsx` renders from the same constant, so the public page and enforcement cannot drift.
- If D14 keeps the seat model: limits are seats, integrations per role, and native policies (see D25).
- If D14 chooses the escalation-volume model: the usage metric is "cases with at least one `certain` tracker link opened in the billing month".
- **Verify:** unit test that every plan on the page exists in `PLANS` and vice versa.

### N6.2 — Usage read model
- `packages/db/src/usage.ts`: `getOrganizationUsage(prisma, organizationId, period)`.
  - Seats = users + pending invitations.
  - Integrations, counted by role (from the N2 registry).
  - Native policies, plus imported policies if D25 says they count. **Recommendation: they don't**, because the customer did not create them in Elapsed.
  - Monthly escalations, if that is the metric.
- **Verify:** real-DB test; tenant isolation.

### N6.3 — Soft enforcement at the three creation points
- **Invite** (seat limit), **connect integration** (integration limit), **create native policy** (policy limit).
- Behaviour: a warning with an upgrade path, and the event is recorded on the admin tenant detail.
- **Hard blocks only at these creation points, and only if D14 explicitly requires them.** Evaluation, notifications, sync and existing data are **never** gated (Phase 10b principle 3).
- **Verify:** route tests for the warn path; a test that a tenant over every limit still gets evaluated and alerted.

### N6.4 — Trial lifecycle (D27 decided)
- Implement D27 at `trialEndsAt`: restricted state, in-app banner, owner email, account marked trial-expired; new configuration (members, integrations, native policies) is blocked; cases, monitoring, alerts and history continue. Sign-up sets `trialEndsAt` to +14 days.
- The daily check runs in the worker's reconciliation tick. It is idempotent per org per day.
- **Verify:** worker test for trial expiry.

### N6.5 — Payment-provider integration (D28 closed; not started)
- **D28:** billing is provider-agnostic. **Paymob is the initial sandbox/testing provider only; the production provider is not chosen** and must be decided separately, on Egypt support (cards, wallets such as Vodafone Cash, Fawry/reference-code payments), international availability and recurring billing, currencies, fees, settlement, webhook reliability and business/legal requirements, before any production go-live.
- The internal billing domain and the `BillingProvider` boundary already exist (N6.7, N6.8). This task is only an adapter behind `getBillingProvider()`; it must not change the subscription/plan domain.
- Implement checkout, the customer portal, and a signed webhook that updates `planStatus` / `plan`. Store the provider customer id on `Organization`.
- The webhook route lives under `apps/web/src/app/api/billing/webhook/route.ts`, with idempotency by event id and signature verification.
- Admin tenant detail shows the billing state. Manual overrides stay possible and are audited (N4.2).
- **Verify:** webhook tests with signed fixtures; replay-safe idempotency test.

### N6.6 — Make public claims match the code
- The pricing page FAQ now says that only an organization owner can subscribe, change plans or cancel, which matches the in-app flow (N6.10).
- Features advertised but not built (SSO/SAML, custom data retention, "90-day case history") must be removed or marked "on request". A copy fix for the most misleading claims should already have been done in hygiene task H-3.
- **Verify:** a checklist in the PR comparing every claim on `PricingView.tsx` with an implemented feature.

### N6.7 — Internal billing domain (provider-neutral)
- Tables `billing_accounts`, `billing_subscriptions` (carries a `version` token), `billing_invoices`, `billing_events` (migration `20261004100000_n6_internal_billing`, additive). Subscription status reuses `PlanStatus`.
- `packages/db/src/billing.ts` transitions: `start` (during a trial the plan is chosen now and billing starts at `trialEndsAt` with no invoice; otherwise active now with a one-month period and an open net-14 invoice; also restarts a cancelled subscription), `change_plan` (upgrades apply now with proration via `prorateUpgradeCents`; downgrades are scheduled for period end as `pendingPlan` and can be withdrawn; changes during a trial apply now, no proration; seats in use must fit the target plan), `change_seats` (within `[max(1, seatsInUse), plan limit]`), `cancel` / `resume`, period renewal and trial conversion on the worker's reconcile tick, `past_due` derived from invoices, and operator overrides (grace, mark paid, void, comp, notes).
- Every transition runs in one transaction under an organization row lock, re-validates, bumps `version` (a stale `expectedVersion` returns `conflict`), records a `BillingEvent`, and mirrors plan and status onto the `Organization` columns that entitlement checks read, so entitlements change atomically with the plan. Licensed seats narrow the plan's seat limit.
- Pricing is flat, monthly and USD (D14); seats never change the price.
- Typed errors: `invalid_plan`, `invalid_seats`, `contact_sales` (422); `invalid_transition`, `conflict` (409); `provider_unavailable` (501).
- **Verify:** real-Postgres domain and API suites (`packages/db/test/billing*.ts`, `apps/web/test/billing*.test.ts`, `admin-billing.test.ts`); tenant isolation and scope classification cover the four tables. Reference: [`backend_capability_summary.md`](backend_capability_summary.md).

### N6.8 — Payment-provider boundary
- `packages/db/src/billing-provider.ts` defines `BillingProvider` (subscription sync, payment-method and portal sessions, collecting an invoice). `apps/web/src/lib/billing-provider.ts` `getBillingProvider()` returns `null` until N6.5, so provider-only actions report `provider_unavailable`, invoices are "Direct invoice" on net-14 terms and an operator marks them paid. Nothing else in the app names a provider.

### N6.9 — Billing UI and API
- Customer: `/billing`, `/api/billing/{subscription,account,provider-session}` (owners change; members read). Operator: `/admin/billing`, `/admin/billing/[organizationId]`, `/api/admin/billing[/organizationId]`; every override is audited as `billing_override` in the same transaction as the change.

### N6.10 — Viewer-aware pricing and Review & Subscribe
- `/pricing` reads the billing read model for signed-in viewers (visitor → sign-up; member → read-only; owner → review screen). `/billing/subscribe?plan=` resolves one of `start` / `change_plan` / `resume` on the server and shows when it takes effect, what is invoiced and what changes against plan limits; the upgrade preview shares `prorateUpgradeCents` with the charge. No payment-provider UI. Test: `billing-pricing-flow.test.ts`.
- **Known gaps:** nothing emails an invoice or says how to pay it, there is no invoice PDF, and `paymentMethod` is always `null`. The UI must not promise an email.

## 5. Data / schema changes

- `billing_accounts`, `billing_subscriptions`, `billing_invoices`, `billing_events` (N6.7, done).
- `Organization.billingCustomerId` (N6.5, only if the chosen provider needs it).
- Possibly `Organization.plan` tightened to an enum (N6.1).
- Possibly a `UsageSnapshot { organizationId, period, metric, value }` table, **only** if D14 picks a volume metric that must be frozen per billing period.

All are additive.

## 6. Verification commands

```bash
pnpm --filter @sla/db validate
pnpm type-check
pnpm test
npx vitest run apps/web/test/tenant-isolation.test.ts
```

## 7. Entitlement table

Recorded from D14 (live pricing model, seat-based) and implemented once in `packages/db/src/plans.ts` (`PLANS`). The pricing page renders from it. `null` is unlimited.

| Plan id | Price | Seats | Support integrations | Engineering integrations | Native policies |
|---|---|---|---|---|---|
| `starter` | $49 / month | 5 | 1 | 1 | 3 |
| `team` | $149 / month | 20 | unlimited | unlimited | unlimited |
| `enterprise` | Custom | unlimited | unlimited | unlimited | unlimited |

Definitions (`packages/db/src/usage.ts`):
- **Seats** = members + pending, unexpired invitations.
- **Support integration** = a connected `ticket_source`. **Engineering integration** = a connected `work_tracker` or `code_host`. Only `disconnected` rows are not counted.
- **Native policies** = native, non-archived. Imported policies never count (D25).

Behaviour (`packages/db/src/entitlements.ts`), only at invite, connect and native-policy create, and only while `WorkerSettings.entitlementsEnforced` is on:

| State | Result |
|---|---|
| `internal`, or no recorded plan, or a limit of `null` | allow |
| Trial still running | allow (full access, as the pricing page says) |
| Under the limit | allow |
| At or over the limit | **warn**: the creation goes ahead, the response carries `entitlementWarning` with `/pricing`, an `EntitlementEvent` is recorded for the admin tenant page, and an in-app banner appears. D14 does not require a hard block. |
| Trial ended (D27) | **blocked** (HTTP 402; connect routes redirect to settings) for new members, integrations and policies. Cases, SLA monitoring, alerts, history and existing data are untouched. |

**Open decision, D27 vs monitoring:** D27 also says new *cases* are blocked once a trial ends. Cases come from provider sync, so this plan does not block them (that would stop monitoring). Recorded in the roadmap as a decision for the owner; ingestion is unchanged.

**Customer wording:** the trial banner, the blocked-connect notice and the limit warnings all say monitoring continues and use one replaceable call to action, `apps/web/src/lib/upgrade-cta.ts` (a contact link from `NEXT_PUBLIC_SUPPORT_EMAIL`, or plain text if unset). N6.5 replaces it with `/upgrade`.

Switch it on with `UPDATE worker_settings SET "entitlementsEnforced" = true;` and off the same way. It is off by default and has no UI yet.

## 8. Acceptance criteria

1. One plan constant drives both the pricing page and enforcement.
2. Usage for every tenant is visible in the admin panel.
3. Limits warn at creation points only; monitoring is never gated.
4. Plan and subscription state change only through the internal billing domain, atomically with entitlements. Once a payment provider is integrated (N6.5), its signed webhook feeds that domain idempotently.
5. No public pricing claim describes an unbuilt feature.

## 9. Rollback

- Enforcement is behind a `WorkerSettings`-style operator switch (`entitlementsEnforced`), off by default for one release.
- Billing transitions never gate monitoring. Once N6.5 exists, its webhook can be disabled without affecting monitoring, and `getBillingProvider()` returning `null` restores the internal-only mode.

## 10. Out of scope

- Metered or usage-based billing beyond what D14 requires.
- Custom invoicing.
- Tax logic beyond the billing provider's defaults.
- Seat-level SSO (parked).
- Anything that pauses monitoring.
