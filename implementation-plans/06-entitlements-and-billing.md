# N6 — Entitlements + Billing: Implementation Plan

> **Roadmap phase:** [N6 in `ROADMAP_Product.md`](ROADMAP_Product.md#phase-n6--entitlements--billing). Task status lives in the roadmap. This file explains **how**.
> **Depends on:** [N4](04-platform-admin-and-plan-records.md) (plan and status record, audit log) and [N5](05-customer-onboarding-and-retention.md).
> **Trigger-based (roadmap D20).** Start only when one of these is true **and D14 is resolved**:
> - ≥15 paying tenants;
> - manual invoicing or plan tracking costs the owner more than ~2 h per month;
> - a customer asks to change plans or pay by card without contacting you.
>
> **Open decisions:** D14 (pricing model), D25 (do imported policies count toward policy limits), D27 (trial expiry behaviour), D28 (billing provider).
> **Estimate:** 2–3 weeks once triggered. **Branch:** `phase/n6-entitlements-and-billing`.

---

## 1. Objective

- The **current, intentional** pricing (whichever model D14 confirms) is represented once in code.
- Usage is measured against it, and limits are enforced **softly**.
- Plan status is driven by a billing provider instead of manual records.
- Monitoring is **never** stopped or degraded because of plan state.

## 2. Why this phase exists (and why it is not first)

**Current reality (audit, 2026-09-29):**
- There is **no billing, plan, subscription or usage code**. `packages/db/prisma/schema.prisma` has no such models; N4 adds manual records only.
- **Two pricing models are documented, and neither is enforced:**

  | Source | Plans | Metric |
  |---|---|---|
  | Live pricing page, `apps/web/src/modules/marketing/pricing/csr/PricingView.tsx` (last changed 2026-09-27) | Starter $49 · Team $149 · Enterprise Custom | Seats (5 / 20 / unlimited); Starter: 1 support + 1 engineering integration, up to 3 SLA policies, email alerts; Team: unlimited integrations, Slack, "90-day case history"; Enterprise: SSO/SAML, custom retention |
  | `plans/03-Product-and-MVP.md` Phase 18 | Starter $79 · Growth $149 · Scale $249 · Enterprise | Monthly escalated tickets (150 / 600 / 2,500) |

- The old `$299 / $699` pilot pricing in `plans/05` is obsolete. **Do not reintroduce it.**
- This plan does not choose a price or a model. **D14 must be decided by the owner first.**

**Why it waits:** with 10 customers, a manual plan record (N4) is enough. Building billing before the provider boundary and freshness work would optimise invoicing over correctness.

## 3. Current implementation relevant to this phase

- **Pricing constants:** `apps/web/src/modules/marketing/pricing/csr/PricingView.tsx` (`PLANS`, `FAQS`), `apps/web/src/lib/types/marketing.ts`.
- **Seats:** `packages/db/src/members.ts`, `packages/db/src/invitations.ts`, `apps/web/src/app/api/settings/{members,invitations}`, `apps/web/src/app/api/invitations/accept`.
- **Integrations:** `apps/web/src/app/api/integrations/*/connect`, callback routes.
- **Policies:** `packages/commitments/src/native-policy.ts`, `apps/web/src/app/api/settings/sla-policies`, imported policies from `packages/zendesk/src/policies.ts`.
- **Retention promise:** none implemented. `RawEvent` is append-only and unpruned, while the pricing page advertises "90-day case history".
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

### N6.4 — Trial lifecycle (⛔ D27)
- Implement the D27 decision on what happens at `trialEndsAt`. The recommended default is: banner, owner email, admin flag, and monitoring continues.
- The daily check runs in the worker's reconciliation tick. It is idempotent per org per day.
- **Verify:** worker test for trial expiry.

### N6.5 — Billing provider integration (⛔ D28)
- Implement checkout, the customer portal, and a signed webhook that updates `planStatus` / `plan`. Store the provider customer id on `Organization`.
- The webhook route lives under `apps/web/src/app/api/billing/webhook/route.ts`, with idempotency by event id and signature verification.
- Admin tenant detail shows the billing state. Manual overrides stay possible and are audited (N4.2).
- **Verify:** webhook tests with signed fixtures; replay-safe idempotency test.

### N6.6 — Make public claims match the code
- Update the pricing page FAQ. It currently says "upgrade, downgrade, or cancel at any time from your account settings. Changes are prorated automatically", which is untrue until N6.5 ships.
- Features advertised but not built (SSO/SAML, custom data retention, "90-day case history") must be removed or marked "on request". A copy fix for the most misleading claims should already have been done in hygiene task H-3.
- **Verify:** a checklist in the PR comparing every claim on `PricingView.tsx` with an implemented feature.

## 5. Data / schema changes

- `Organization.billingCustomerId` (N6.5).
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

_To be completed when D14 is decided. Intentionally left blank: this plan does not invent prices or limits._

| Plan id | Price | Limits | Features |
|---|---|---|---|
| — | — | — | — |

## 8. Acceptance criteria

1. One plan constant drives both the pricing page and enforcement.
2. Usage for every tenant is visible in the admin panel.
3. Limits warn at creation points only; monitoring is never gated.
4. Plan status is updated by the billing provider's signed webhook, idempotently.
5. No public pricing claim describes an unbuilt feature.

## 9. Rollback

- Enforcement is behind a `WorkerSettings`-style operator switch (`entitlementsEnforced`), off by default for one release.
- The billing webhook can be disabled without affecting monitoring.

## 10. Out of scope

- Metered or usage-based billing beyond what D14 requires.
- Custom invoicing.
- Tax logic beyond the billing provider's defaults.
- Seat-level SSO (parked).
- Anything that pauses monitoring.
