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

**What the UI does today**

- **Pricing:** it is static and not aware of who is viewing. Every CTA goes to `/sign-up`, and for a signed-in user `proxy.ts` bounces that straight to `/dashboard`, so it is a dead end.
- **Pricing FAQ:** the "Can I change plans later? Talk to us" answer is now stale.
- **Billing page:** `ChangePlanDialog` is a radio list with a one-line effect hint and no real review. It already calls `start`, `change_plan`, `resume` and `cancel` correctly.
- **Upgrade CTA:** `upgrade-cta.ts` still says to replace it with `/upgrade` once billing ships, and every banner is contact-only.

**Small read-model gaps.** None of these are new capabilities:

1. Pricing needs a viewer-aware read (anonymous, member or owner, plus billing state). `planOptions` can be reused.
2. There is no preview of the prorated upgrade amount. It is computed inside the transaction. A review screen can show the exact figure only if a read-only preview is added; otherwise it shows wording.
3. There is no preview of the first invoice for a plan you haven't chosen yet. `cycleLines` is derivable from `PLANS` but not exposed.
4. `start` accepts an optional `seatQuantity`, but no UI sends it.
5. `SignInForm` ignores `callbackUrl` and always goes to `/dashboard`.
6. Nothing emails an invoice or says how to pay it. There are no payment instructions and no PDF. The UI must not promise an email.
7. An `internal` organization gets `invalid_transition` on `start`, but `planOptions` would still offer CTAs.

# 2. Recommended UX flow

Seven conceptual steps collapse into two screens plus one that already exists. Plan selection happens on Pricing. Review, confirm and success are states of one screen.

```
/pricing (public, viewer-aware)
 ├─ anonymous ─────────► /sign-up (existing, 14-day trial) ─► onboarding   [no redesign]
 ├─ member ────────────► read-only: current plan marked, CTAs disabled "Ask an owner"
 ├─ owner, Enterprise ─► "Talk to us" (contact)
 └─ owner, paid plan ──► Review & subscribe  (/billing/subscribe?plan=team)
                          review → confirming → success   (or inline error)
                                                 └──────► /billing (existing: Current plan, Invoices)
```

- **One review screen for every change.** It covers start (during a trial, after a trial, or restart after cancellation), upgrade, downgrade and withdrawing a scheduled downgrade.
- **Same component in two places.** The `/billing` "Change plan" and "Upgrade" buttons should use the same review component instead of today's radio dialog. It can render as a page or in a sheet, so there is one mental model.
- **Confirmation is a state, not a page.** The success panel shows what happened and the next date, then points to Billing. There is no payment step.
- **Plan intent through sign-up.** Carrying `?plan=` through sign-up is optional. It needs wiring, not a new screen. This is a product call for you to make.

# 3. Required screens and states

**Screen A: Pricing (modify the existing page).** Keep the header, hero, three plan cards and FAQ. Only the CTA and a small context strip change per viewer.

| Viewer state                          | Context strip                                                           | Paid-plan CTA                                                                                                   | Enterprise CTA |
| ------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------- |
| Anonymous                             | None                                                                    | "Start free trial", links to sign-up                                                                            | Talk to us     |
| Member (non-owner)                    | "You're on Team"                                                        | Disabled, "Only an organization owner can manage billing."                                                      | Talk to us     |
| Owner, no subscription, trial running | "Trial ends <date>"                                                     | "Choose <Plan>", with "Billing starts when your trial ends on <date>"                                           | Talk to us     |
| Owner, trial ended or cancelled       | "Trial ended" or "Subscription ended <date>". Monitoring keeps running. | "Subscribe to <Plan>", with "Starts now; first invoice issued today"                                            | Talk to us     |
| Owner, active                         | Current plan, renewal date, status                                      | Current card: "Current plan" (disabled) plus "Manage billing". Higher plan: "Upgrade". Lower plan: "Downgrade". | Talk to us     |
| Owner, downgrade scheduled            | "Moves to Starter on <date>"                                            | Scheduled card shows a "Scheduled" pill. Current card shows "Keep Team".                                        | Talk to us     |
| Past due                              | Danger pill and invoice note                                            | Changes are still allowed                                                                                       | Talk to us     |
| Cancellation scheduled                | Warning "Ends <date>"                                                   | Link "Resume in Billing"                                                                                        | Talk to us     |
| Plan unavailable for seats            | None                                                                    | Disabled, "7 seats are in use; Starter allows 5."                                                               | —              |
| `internal` organization               | "Not billed"                                                            | None                                                                                                            | None           |

- **Contact CTA:** when `NEXT_PUBLIC_SUPPORT_EMAIL` is unset it falls back to plain text, so design both forms.
- **Loading:** the viewer state is server-rendered and the card skeleton is minimal.
- **FAQ:** the plan-change answer needs rewriting. Add a "How is billing handled?" entry with the real facts: monthly in USD, invoiced directly with 14-day terms, cancel at period end, monitoring never pauses.

**Screen B: Review & subscribe (new, one screen with states).** A `/billing/subscribe?plan=` page inside the app shell.

- **Header:** a back link to Pricing, a title that varies by variant (start, restart, upgrade, downgrade, keep current), and an owner-only note.
- **Left column:**
  - Plan card with price, limits and extra features.
  - A "From → To" row when changing.
  - "Licensed seats" as a read-only line with a link to adjust later in Billing.
  - "What changes for you": usage versus the target limits, shown as `UsageBar` rows.
- **Right column:**
  - "When this takes effect" and "What you'll be invoiced". The lines are plan fee, seats $0, total, and due date (issue date + 14 days) if there is no trial.
  - "Invoiced to <billing email> as a direct invoice".
  - The primary CTA.
  - A reassurance line: "No card needed. Monitoring never pauses. Cancel any time; it ends at period end."
- **Variants:**
  1. Start during a trial: no charge today.
  2. Start with no trial, or restart: invoice today.
  3. Upgrade, active: applies now, prorated invoice. Show the amount if the preview is added, otherwise "The price difference for the rest of this period is invoiced".
  4. Upgrade during a trial: applies now, no proration.
  5. Downgrade: scheduled for the period end, current plan stays until then, withdrawable. Seats in use must fit.
  6. Same plan with a pending downgrade: "Keep Team" (withdraw).
  7. Same plan with nothing pending: no CTA, "Already on Team".
- **Blocking and edge states (not variants):**
  - Non-owner: read-only, CTA disabled.
  - Enterprise by URL: "Priced by contract".
  - Seats blocked: `invalid_seats` message and a link to Members.
  - Cancellation scheduled: an inline notice offering resume.
- **Interaction states:**
  - Confirming: the button reads "Saving…", the form is disabled, and double-submit is blocked.
  - Success: a check, "Subscribed to Team" (or "Moved to Team", "Move to Starter scheduled", "Staying on Team"), the key dates, and CTAs "Go to Billing" and "View invoices".
  - Error: an inline alert keyed by code.
    - `conflict`: "Billing changed since this page loaded" with a "Reload latest" button.
    - `invalid_transition`: for example "Already has a subscription", with a link to Billing.
    - `invalid_seats`.
    - 401 and 403.
    - Network failure.
    - Generic failure.

**Screen C: Billing overview (existing).** Only the delta needs design:

- The Current plan card and Plan governance panel already cover trial, active, past due, cancellation scheduled, pending downgrade and ended.
- After a success redirect, show a success toast with an optional "Just subscribed" highlight.
- Route "Change plan" and "Upgrade tier" to Screen B.

# 4. What should NOT be designed

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

# 5. Stitch prompt

```text
Design the "Pricing → Subscribe" experience for Elapsed, a B2B SLA-breach monitoring product. Elapsed watches support tickets (Zendesk, Intercom) and engineering issues (Jira, Linear, GitHub) and warns the customer before an SLA is breached. This is an INTERNAL subscription flow. There is NO payment provider yet. Do not design any payment UI.

READ THIS FIRST: what billing really does today
- Plans (flat monthly price, USD only, no annual option, no per-seat pricing, no usage billing, no free tier):
  Starter $49/mo: 5 seats, 1 support integration + 1 engineering integration, 3 SLA policies, email alerts.
  Team $149/mo (most popular): 20 seats, unlimited integrations and SLA policies, Slack notifications before breach, full case correlation.
  Enterprise: custom price, unlimited, priced by contract. Customers CANNOT self-serve it; its CTA is "Talk to us".
- Every new organization gets a 14-day trial with full access, no card.
- Only an organization OWNER can change billing. Members can view but not manage.
- A customer subscribes to Starter or Team. Subscribing during the trial records the plan now and starts billing when the trial ends (no invoice today). Subscribing after the trial, or restarting a cancelled subscription, starts now and issues an invoice today, due 14 days later, settled as a "Direct invoice" (no card).
- Upgrade (Starter→Team): applies immediately; the price difference for the rest of the period is invoiced. During a trial an upgrade applies now with no proration.
- Downgrade (Team→Starter): scheduled for the end of the current period; the customer stays on Team until then; it can be withdrawn by choosing the current plan again. A downgrade is refused if seats in use exceed the target plan's seats (e.g. "7 seats are in use, but the Starter plan allows 5. Remove members or invitations first.").
- Going over integration or policy limits is only a warning; nothing is ever switched off. Monitoring, cases, alerts and history never pause.
- Cancellation always takes effect at the end of the period and can be resumed until then.
- Every change is re-validated by the server; a stale page returns "Billing changed since this page loaded."

SCREENS TO DESIGN (desktop 1440, tablet 768, mobile 390; dark theme primary, light theme too)

SCREEN A: Pricing (public marketing page, existing layout: site header, centered hero "Simple pricing, per organization", three plan cards, FAQ, footer). Keep the layout; design the viewer-aware states:
 Show a compact "context strip" under the hero only for signed-in viewers. Paid-plan card CTA by state:
 1. Anonymous: "Start free trial" (Starter, Team); "Talk to us" (Enterprise).
 2. Member (not owner): CTAs disabled with the hint "Only an organization owner can manage billing." Current plan card shows a "Current plan" pill.
 3. Owner, trial running: strip "Trial · ends Oct 17"; CTA "Choose Team"; helper "Billing starts when your trial ends on Oct 17."
 4. Owner, trial ended or subscription ended: strip "Trial ended" or "Subscription ended Oct 3 — monitoring keeps running"; CTA "Subscribe to Team"; helper "Starts now; first invoice issued today."
 5. Owner, active on Team: Team card shows a disabled "Current plan" button plus a "Manage billing" link; Starter card CTA "Downgrade to Starter" with helper "Takes effect Nov 3"; Enterprise "Talk to us". Strip: "Team · Active · Renews Nov 3".
 6. Owner on Starter: Team card CTA "Upgrade to Team" with helper "Applies now; the price difference for this period is invoiced."
 7. Downgrade scheduled: strip "Moves to Starter on Nov 3"; Starter card has a "Scheduled" pill; Team card CTA "Keep Team".
 8. Seats too high for a plan: that card's CTA disabled with "7 seats are in use; Starter allows 5."
 9. Past due: strip with a danger pill; cancellation scheduled: warning "Ends Nov 3 — Resume in Billing".
 10. Internal organization: strip "Your organization is not billed", no CTAs.
 Enterprise "Talk to us" is a mailto link when a support email is configured, otherwise plain text. Design both.
 Also design the FAQ section including a "How does billing work?" entry: monthly in USD, invoiced directly with 14-day terms, cancel any time (ends at period end), monitoring never pauses. Do NOT mention card payment.

SCREEN B: "Review & subscribe" (one screen, inside the signed-in app shell: left sidebar, breadcrumb "Billing & Subscriptions / Subscribe"). This single screen replaces plan selection confirmation, review, confirm and success. Two-column on desktop (stacks on mobile; the summary and CTA come first on mobile).
 Left column:
  - Plan card: name, price "$149.00 / month", description, limit lines (seats, integrations, SLA policies, extra features).
  - "From → To" row when changing plans (e.g. Starter → Team).
  - Licensed seats: a read-only line, e.g. "20 licensed seats (7 in use) · adjustable later in Billing". Seats never change the price.
  - "What changes for you": rows per limit (Seats, Support integrations, Engineering integrations, SLA policies) showing usage versus the new plan limit with the existing usage bars: calm, amber at 80%, red at the limit. A seat overage is a hard blocker; an integration or policy overage is a warning: "Over the limit. Nothing is switched off."
 Right column (sticky summary card):
  - "When this takes effect" (one of: "Billing starts when your trial ends on Oct 17"; "Starts now"; "Applies now"; "Takes effect Nov 3, the end of this billing period").
  - "You'll be invoiced": plan fee line, "Licensed seats (20) · Included $0.00", total, and (when there is no trial) "Due Oct 17 (14 days after issue)". For an upgrade show "Prorated difference for the rest of this period"; leave a slot for an exact amount, falling back to text if no amount is available.
  - Payment row: "Direct invoice · net 14 · sent to <billing email>" with an "Edit billing profile" link. If no billing email is set, say "No billing email set".
  - Primary CTA, labelled by variant: "Start Team subscription" · "Subscribe to Team" · "Upgrade to Team" · "Schedule downgrade to Starter" · "Keep Team" (withdraws a scheduled downgrade). Secondary "Back to pricing".
  - Reassurance line: "No card required. Monitoring never pauses. Cancel any time; it ends at the end of your billing period."
 Variants to show: start during trial; start after trial or restart; upgrade (active); upgrade (trial); downgrade; keep current (withdraw scheduled downgrade). Same plan with nothing scheduled: show "Already on Team" with no CTA.
 Edge states: non-owner (read-only, disabled CTA, owner-only hint); Enterprise reached by URL ("Priced by contract" + contact link); seats blocking a downgrade (blocker alert, disabled CTA, link "Manage members"); cancellation already scheduled (inline notice with Resume).
 Interaction states: Confirming (CTA "Saving…", fields disabled, no double submit); Success (same screen: success icon, "Subscribed to Team" / "Moved to Team" / "Move to Starter scheduled" / "Staying on Team", key dates: next billing date or trial end or effective date, "Saved and recorded in billing history", CTAs "Go to Billing" and "View invoices"); Error (inline alert, mapped by case: conflict → "Billing changed since this page loaded" + "Reload latest"; already subscribed → link to Billing; not enough seats; not signed in; not an owner; network failure "Could not reach the server. Check your connection and try again."; generic failure). Also a skeleton loading state.

SCREEN C: Billing overview (existing page, only the delta): the Current plan card and plan-governance panel already exist for trial, active, past due, cancellation scheduled, pending downgrade and ended. Design only: the post-subscribe landing (success toast "Subscribed to Team — Saved and recorded in billing history", optional "Just subscribed" highlight on the Current plan card), and make "Change plan" and "Upgrade tier" lead to Screen B.

DESIGN LANGUAGE — match Elapsed, do not invent a new look
- Tone: "One honest clock across the handoff." Calm, precise, observability-grade, dense but readable. Never blame-language.
- Dark default (canvas #060a12, surface #0b1324, raised #111c34, overlay #1a2745, hover #233356; text #f8fafc / muted #94a3b8 / subtle #64748b; border #1c273c / strong #2d3c59; primary #0ea5e9 / #38bdf8; success #10b981; warning #f59e0b; danger #f43f5e). Also provide the light theme (background #f8fafc, surface #fff, primary #0284c7).
- Type: Inter for UI, JetBrains Mono for prices, dates, counts, captions; tabular numerals; tiny uppercase mono captions with wide tracking (10px) above values.
- Shapes: 8px radius cards on a 1px border, 6px buttons, tinted bordered status pills (● ACTIVE, TRIAL, PAST DUE, SCHEDULED, CURRENT).
- Reuse existing components: Elapsed Button (default, surface, outline, destructive), Card/BillingCard, BillingCaption, BillingPill and SubscriptionStatusPill, UsageBar, Alert (warning/error), Badge "Most popular", Dialog/AlertDialog, Input, Skeleton, BillingToast (bottom-right), BillingPageHeader (breadcrumb, title, description, actions), SummaryCard pattern, marketing SiteHeader/SiteFooter, the app sidebar shell.
- Dates are exact and static ("Oct 17, 2026"), never relative.
- Responsive: Pricing cards go 3 → 1 column; Review stacks with the summary and CTA first and a sticky bottom CTA bar on mobile; tap targets 44px.
- Accessibility: visible focus rings, status never conveyed by colour alone, live-region toast, disabled controls explain why (title or helper text).

DO NOT DESIGN (belongs to a future payment-provider integration, or does not exist)
- Credit-card or bank forms, Stripe or any provider branding, hosted checkout, "Pay now", payment-method management, or a payment-confirmation or receipt screen.
- Invoice PDFs, a billing portal (the existing disabled "Manage in billing portal" button is unchanged), tax or VAT, coupons or promo codes, annual billing or a monthly/annual toggle, multi-currency, per-seat price calculators, usage or overage billing, add-ons, a free plan, pause subscription, self-serve trial extension, customer-facing dunning or retry-charge, terms or consent checkboxes.
- Any statement that an invoice is emailed, or any bank or payment instructions.
- Features that are not built (SSO and the like).
- A redesign of the sign-up form.
Keep the "Payment" row generic (Direct invoice) so a provider step can later slot in before the confirm button without changing the surrounding layout.
```

Three decisions are yours before this ships:

- **Plan carried through sign-up:** whether `?plan=` should survive sign-up, or the choice is made after the trial begins.
- **Proration preview and first-invoice preview:** whether to add them, or accept wording-only on the review screen.
- **Invoice payment instructions:** no invoice email, PDF or payment instructions exist today. This is a real gap whenever someone subscribes outside a trial.
