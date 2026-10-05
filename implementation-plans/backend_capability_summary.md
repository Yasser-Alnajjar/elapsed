# Billing: backend capability summary

> **Rev 6 (2026-10-05).** This file began as a backend summary plus a UX brief for the billing screens (flow, screens, a design-tool prompt). The screens were built in PR #39 (roadmap N6.9, N6.10), so the brief sections were removed. What remains is what the backend does and the constraints that still hold. The code is authoritative: `packages/db/src/plans.ts`, `packages/db/src/billing.ts`, `packages/db/src/billing-provider.ts`. **No payment provider is integrated (N6.5 is not started; D28: Paymob is a sandbox/testing provider only, production provider open).**

# 1. Backend capability summary

**Plans** come from one constant, `PLANS` in `packages/db/src/plans.ts`:

| Plan       | Price   | Seats     | Integrations                | Native SLA policies | Self-serve                                        |
| ---------- | ------- | --------- | --------------------------- | ------------------- | ------------------------------------------------- |
| Starter    | $49/mo  | 5         | 1 support and 1 engineering | 3                   | Yes                                               |
| Team       | $149/mo | 20        | Unlimited                   | Unlimited           | Yes                                               |
| Enterprise | Custom  | Unlimited | Unlimited                   | Unlimited           | No (`contact_sales`; only an operator can set it) |

- **Pricing model:** pricing is flat, monthly and in USD only. Seats never change the price. There is no annual interval, add-ons, per-seat pricing, usage metering or free tier.
- **Trial:** every organization gets a 14-day trial at sign-up. Entitlements are not enforced during it.
- **Tables:** `BillingAccount`, `BillingSubscription` (carries a `version` token), `BillingInvoice` and `BillingEvent`.

**Transitions** (`packages/db/src/billing.ts`, exposed through `POST /api/billing/subscription`, owner-only):

| Action                         | Behaviour                                                                                                                                                                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`                        | **Trial running:** plan is chosen now, status `trial`, billing starts at `trialEndsAt`, no invoice. **No trial:** active now with a 1-month period, and an `open` invoice is issued, due in 14 days. Also restarts a cancelled subscription. |
| `change_plan` (upgrade)        | Applies now. Outside a trial it issues a prorated invoice.                                                                                                                                                                                   |
| `change_plan` (downgrade)      | Scheduled for period end as `pendingPlan`. Picking the current plan again withdraws it.                                                                                                                                                      |
| `change_plan` (during a trial) | Applies now, with no proration.                                                                                                                                                                                                              |
| `change_plan` (any)            | Seats in use must fit the target plan. Same plan with nothing pending is `invalid_transition`. A cancelled subscription must `start` instead.                                                                                                |
| `change_seats`                 | Within `[max(1, seatsInUse), plan limit]`.                                                                                                                                                                                                   |
| `cancel` / `resume`            | Cancellation takes effect at period end and can be resumed until then.                                                                                                                                                                       |

- **Concurrency:** every change locks the organization row, re-validates, and bumps `version`. A stale `expectedVersion` returns `conflict`.
- **Entitlements:** plan and status are mirrored onto `Organization` in the same commit, so entitlements change atomically with the plan.
- **Typed errors** (`{error, code}`): `invalid_plan` 422, `invalid_seats` 422, `contact_sales` 422, `invalid_transition` 409, `conflict` 409, `provider_unavailable` 501, plus 401 and 403 (non-owner).
- **No payment provider:** `getBillingProvider()` returns `null`. Invoices are "Direct invoice" on net-14 terms, and an operator marks them paid. `paymentMethod` is always `null`, the provider-session route returns 501, and invoice PDFs are disabled.
- **Entitlements:** the only hard stop is a lapsed trial blocking new members, integrations and policies. Everything else is a warning, and monitoring is never affected.
- **Read model:** `BillingOverviewData` already carries `planOptions` (per plan: `current`, `pending`, `selfServe`, `unavailableReason`, `effect: now | period_end`), the trial, seats, entitlements, the upcoming invoice and `canManage`.

**What the UI does now** (PR #39, `fbdbbc3` and `bee4983`)

- **Pricing (`/pricing`)** reads the billing read model for signed-in viewers: visitors are sent to sign-up, members see a read-only state, and owners go to Review & Subscribe (`/billing/subscribe?plan=`). Seat blockers, scheduled changes, past-due and `internal` organizations are reflected from `planOptions`.
- **Review & Subscribe** resolves one of `start`, `change_plan` or `resume` on the server and shows when it takes effect, what is invoiced and what changes against the plan limits. The upgrade amount is previewed with `prorateUpgradeCents`, shared with the charge.
- **Pricing FAQ** says that only an organization owner can subscribe, change plans or cancel.
- **Billing page (`/billing`)** shows the current plan, entitlements and invoices, and uses the same runner for its actions. Operators use `/admin/billing` and `/admin/billing/[organizationId]`.
- **Upgrade CTA:** `apps/web/src/lib/upgrade-cta.ts` is still contact-only; roadmap N6.4 says it changes to `/upgrade` only when N6.5 ships.

**Read-model gaps listed on 2026-10-03, status on 2026-10-05**

1. Viewer-aware pricing read: **done** (`apps/web/src/lib/pricing-viewer.ts`).
2. Prorated-upgrade preview: **done** (`prorateUpgradeCents`).
3. First-invoice preview for an unchosen plan (`cycleLines`): not re-verified.
4. `start` accepts an optional `seatQuantity` that no UI sends: not re-verified.
5. `SignInForm` ignoring `callbackUrl`: not re-verified.
6. Nothing emails an invoice or says how to pay it; there are no payment instructions and no invoice PDF: **still true**. The UI must not promise an email.
7. `internal` organizations being offered CTAs: **done** (`BillingOverviewData.internal`, `internal` pricing mode).

# 2. Constraints that still hold (what the billing UI must not show)

- Card or bank form, Stripe or any provider branding, hosted checkout, "Pay now", or payment-method management.
- Fake payment confirmation, receipts, invoice PDF download, or "Manage in billing portal". The existing disabled portal button stays.
- Annual or monthly toggle (monthly only), discount or promo codes, tax or VAT calculation, multi-currency.
- Seat purchasing or per-seat price math. Pricing is flat.
- Usage-based billing, metering or overages. Events are unmetered.
- A free tier, "pause subscription", self-serve trial extension, or customer-facing dunning and retry-charge.
- Terms or consent checkboxes, because the backend has none.
- A claim that the invoice is emailed, or specific bank or payment instructions. Neither exists.
- Features that don't exist, such as SSO or custom retention.
- Any redesign of the sign-up form.

**What stays provider-agnostic**

- The vocabulary is "invoice", "billing email" and "direct invoice", with no provider names.
- The review has a single "Payment" row that today reads "Direct invoice, net 14".
- The confirm action is generic and already tolerates a slower or failing confirm (a provider failure rolls the change back).
- The success states stay the same when a provider is added.
