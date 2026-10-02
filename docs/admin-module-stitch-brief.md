# Platform Admin module: brief for Stitch (UX design)

> **What this is:** a description of the Platform Admin module (roadmap phase N4) written so it can be pasted into Stitch to produce UX designs. It describes the product, the rules the design must respect, every screen with its real content, and ready-to-paste prompts. The module is already built (plain, functional UI); the goal of the design pass is to make it clear, scannable and calm for someone who checks it many times a day.
> **Status (2026-10-02):** the designs came back from Stitch and are implemented. They use a **left sidebar** shell rather than the top bar asked for in section 3; the sidebar is what shipped. Where the mock-ups show telemetry the product does not have (Merkle proofs, worker pods, rate-limit meters, an operator "reason" field), it was left out rather than faked.
> **Design system:** reuse the existing Elapsed system in `apps/web/stitch_elapsed/elapsed/DESIGN.md` (dark "obsidian" surfaces, Hanken Grotesk + JetBrains Mono, sky-blue primary, mint tertiary). Do not invent a new palette.

---

## 1. The product in one paragraph

**Elapsed** watches customers' support tickets (Zendesk, Intercom) and engineering issues (Jira, Linear, GitHub) and warns the customer *before* an SLA is breached. Each customer company is a **tenant** (an "organization"). **Platform Admin** is the internal console for the **one or two people who run Elapsed** (the operators). It answers three questions on one page, without SQL:

1. **Who are the customers?**
2. **Which plan and status is each on?**
3. **Is each one healthy right now?**

It also lets the operator take two small, safe, audited actions on a single integration, and keeps a permanent record of everything the operator did or looked at.

## 2. Who uses it, and the rules the design must respect

| Rule | Why it matters for the design |
|---|---|
| **Operators only** (an email allow-list). Anyone else gets a plain "Not found". | The module must feel like a separate, internal tool, not a settings page of the customer app. |
| **Never visible to customers.** | No link to it in the customer UI except one "Platform admin" entry shown only to operators. |
| **Read-mostly.** The only writes are: edit a tenant's plan record, pause/resume polling for one integration, request a re-normalization. | Do not design editing of customer data, impersonation, deleting, billing or invoices. Those are out of scope. |
| **Everything is audited.** Every write, and every time a tenant's detail page is opened, creates an audit row. | The UI should say so, calmly, where it matters (e.g. "Opening a tenant is recorded in the audit log"). |
| **No secrets, ever.** | Never show credentials, tokens, client secrets, or ticket content (subjects, requester names). Tickets appear only as a ticket id such as `#1042`. |
| **Informational plan data.** The plan record never changes how a tenant is monitored. | Say "Informational only" next to the plan form. Never imply a plan blocks or limits monitoring. |
| **Honest about effects.** Pausing polling makes the customer's data go stale. | The pause confirmation must state that plainly. |

**The user:** technical, time-poor, scanning for what is wrong. Typical session: open Tenants, look for anything red or amber, open it, decide (pause / re-normalize / contact the customer), leave. Density and scannability beat decoration. Desktop first; must remain usable at tablet and phone widths (used on call).

## 3. How it must differ from the customer app

- **Separate shell, no sidebar.** Customer app = left sidebar. Admin = **top bar** with: logo, a red **PLATFORM ADMIN** chip, the four nav tabs, the operator's email (mono), theme toggle, and a "← Back to app" link.
- The red chip is the single "you are in the admin area" signal. Keep it on every screen.
- Same dark surfaces, type and badge language as the customer app so it still feels like Elapsed.

**Navigation (4 tabs):** Overview · Tenants · Monitoring · Audit log.

## 4. Shared vocabulary (use these exact labels and colours)

**Tenant health** (one word per tenant; the most important thing on the screen)

| Label | Colour | Meaning |
|---|---|---|
| **Healthy** | green (success) | Every connected integration is syncing and no alert delivery is failing |
| **Needs a look** | amber (warning) | Working, but polling is paused on purpose, or an alert delivery is failing |
| **Unhealthy** | red (destructive) | An integration needs reconnecting, lost provider access, is in a failing streak, or is stale |
| **No integrations** | neutral outline | Nothing connected, so nothing to be healthy |

**Integration chip** (provider + state, e.g. `Zendesk · Syncing`): Syncing (green) · Stale (amber) · Failing (red) · Needs reconnect (red) · Access lost (red) · Paused (neutral/beta) · Disconnected (outline).

**Plan** (recorded by hand): Starter ($49) · Team ($149) · Enterprise (custom), seat-based; or "Not recorded" (muted italic).
**Plan status badge:** Trial (blue) · Active (green) · Past due (amber) · Cancelled (red) · Internal (neutral).

**Provider roles** (shown as small outline tags): ticket source · work tracker · code host.

**Timestamps** are exact and static ("Oct 2, 2026, 07:12:27 AM"), never relative ("2 min ago"), because operators compare them.

## 5. Screens

### 5.1 Overview (`/admin`): "Platform overview"

*Purpose:* the "anything on fire across all tenants?" page. Opened first.
*Layout:* page title + count chip ("4 organizations"), one card with two sub-sections, a "Refresh · as of …" text button.

1. **Integration health** (red count badge when non-zero). One row per *unhealthy* integration: `Organization · Provider` (links to that tenant) on the left, last-sync time in mono on the right, and a single red reason line beneath, one of:
   - "Re-authentication required"
   - "Provider-side access lost (permission denied)"
   - "Failing since Oct 2, 04:14 AM · 36 attempts · 30000 ms · last success …"
   - "Last sync failed: …"
   - "Stale since … · no recent successful sync"
   - **new:** "Polling paused by an operator since … · last success …" (amber, not red: it is deliberate)
   Empty state: green check + "Every integration on every organization is syncing cleanly."
2. **Failed alert deliveries** (red count badge). One row per alert that no channel could deliver: `Organization · #ticket · Resolution @ 80%` (links to the tenant), right side "12 attempts since 05:14 AM", red error line (`channel_not_found`). Show 25 then "+N more". Empty state: "No alert deliveries are currently failing."

*Design opportunity:* group by tenant so one outage reads as one problem, not eight rows.

### 5.2 Tenants (`/admin/tenants`): the main page

*Purpose:* one row per customer; the "who / which plan / healthy?" answer.
*Layout, top to bottom:*
1. Title "Tenants" + count chip ("4 organizations") + one-sentence explainer ("Opening a tenant is recorded in the audit log").
2. **Two summary cards side by side**
   - **Plan status:** five badges with counts (Trial 2 · Active 1 · Past due 1 · Cancelled 0 · Internal 0) and a line "2 tenants have no plan recorded yet."
   - **Provider pairs:** list of `Zendesk + Jira   2`, `Zendesk   1`, `No integrations   1`. Counts only, never customer names.
3. **Filter bar:** search box ("Search by name or owner email") + health filter chips: All · Unhealthy · Needs a look · Healthy · No integrations (one selected at a time).
4. **Table**, one row per tenant, columns:

| Column | Content |
|---|---|
| **Tenant** | name (link to detail), owner email, "Created 2 Oct 2026, 07:14 am" |
| **Plan** | plan name or "Not recorded", status badge, "Ends 5 Nov" if trial |
| **Health** | the health badge |
| **Integrations** | stacked integration chips, each with "Last success …" beneath |
| **Open cases** | right-aligned number |
| **Last 24 h** | "6 evaluations / 3 alerts sent / 2 alerts failing" (failing count red when > 0) |
| **Link coverage** | "75% (6 of 8)" or "No recent cases". Share of cases opened in the last 30 days that have a confirmed link to an engineering tracker |
| **Members** | count, plus "+1 invited" |

Empty/filter-empty: "No tenants match."
*Design opportunities:* sort by health by default (unhealthy first); a thin coloured left edge per row for health; a tiny bar for link coverage (flag below 60%); sticky header.

### 5.3 Tenant detail (`/admin/tenants/:id`)

*Purpose:* one tenant in depth, and the only place the operator can act. Opening it creates a `view_tenant` audit row; say so under the title ("Viewing this tenant has been recorded in the audit log.").
*Header:* back link "← All tenants", tenant name, health badge, plan-status badge, then one line: owner email · 1 member (+1 invited) · created date · id (mono).
*Sections, in this order (cards or stacked panels, each with an icon, a title and a one-line description):*

1. **Plan record** (editable): fields **Plan** (select: Not recorded / Starter / Team / Enterprise, hint "Starter $49 · Team $149 · Enterprise custom, seat-based"), **Status** (select: Trial / Active / Past due / Cancelled / Internal), **Trial ends** (date), **Billing reference** (text, invoice or contract id). Footer: "Informational only. It never changes how this organization is monitored." and a **Save plan record** button (disabled until something changes). States: saving, saved ("Plan record saved and audited."), error (inline alert).
2. **Integrations:** one bordered card per integration.
   - Top row: integration chip + role tag on the left; **controls** on the right: **Pause polling** (or **Resume polling** when paused) and **Request re-normalization** (disabled and relabelled "Re-normalization requested" while pending).
   - Fact grid (label above value): Last successful sync · Last attempt · Last attempt took (ms) · Consecutive failures (red if > 0) · Failing since · Backfill ("Completed Sep 12, 2026" / "Not completed") · Connected · plus, when set, **Polling paused since** and **Re-normalization requested**.
   - Red line "Last error: …" when present; amber line "Stale since …" when stale and not paused.
   - Disconnected integration: show "Disconnected: nothing to poll or re-normalize" instead of controls.
3. **Alert delivery:** "3 sent and 2 failing in the last 24 h." + red count badge; list of recent failures (`#1000 · Resolution @ 80%`, "12 attempts since …", red error), "+N more".
4. **Coverage:** key facts in a two-column grid: Open cases · Open cases with no matching SLA policy (amber when > 0) · Tracker link coverage (30 days) · Evaluations written in the last 24 h. Beneath, a small "Policy import (Zendesk), as of …" list: unsupported metrics, unsupported conditions, policies with no usable target, unresolved schedule, archived, cases with no matching policy.
5. **Worker run:** this tenant's own last run: Last started · Last finished · Last run took (s) · Next run due · Consecutive failed runs (red if > 0) · Last error.
6. Footer text button "Refresh · as of …".

**Confirmation dialogs** (centered modal, Cancel + one action; only Pause uses the red button):
- **Pause polling?** "The worker stops fetching from Jira for this organization until you resume. Evaluation keeps running on the data already stored, but no new data arrives, so the customer sees this integration as stale ("paused by Elapsed support") and breach alerts for its cases are held."
- **Resume polling?** "The worker fetches from Jira again on its next run."
- **Re-normalize?** "On its next run the worker rebuilds every Zendesk case from the raw events already stored (a full pass instead of the incremental one), then clears the request. It fetches nothing and edits no tenant data."
Error state inside the dialog (e.g. "Polling is already paused").

### 5.4 Audit log (`/admin/audit`)

*Purpose:* a permanent, read-only record. No edit or delete controls anywhere; say it ("append-only: rows are never edited or removed, and they outlive the organizations they name").
*Table, newest first:* **When** (mono, exact) · **Operator** (email) · **Action** (badge) · **Organization** (link, or "Deleted organization", or "Platform" for global actions) · **Details** (small mono, e.g. `{"provider":"jira"}` or a before/after of the plan record).
*Action badges:* Viewed tenant (outline, quiet) · Edited plan record · Paused polling · Resumed polling · Requested re-normalization · Changed worker settings (the last five in primary tint so real changes stand out from views).
*Paging:* "Newest" / "Older" links at the bottom. Empty: "Nothing recorded yet."
*Design opportunities:* render plan-record details as a readable before → after diff instead of raw JSON; filter by action ("hide views"); group consecutive views.

### 5.5 Monitoring (`/admin/monitoring`)

Existing page, moved into the admin shell: worker cycle intervals (Active monitoring 5 minutes, Reconciliation 30 minutes, each with Edit), worker status (Running / Degraded / Stopped), last and next cycle times, and a "Live data" connection panel. Changing an interval is an audited admin action. Include for consistency; low design priority.

## 6. Sample data (so the mock-ups look real)

| Tenant | Plan / status | Integrations | Health | Notes |
|---|---|---|---|---|
| **Acme** | Team · Active · INV-ACM | Zendesk Syncing, Jira Syncing | Healthy | 8 open cases, 75% link coverage, 3 alerts sent |
| **Globex** | Not recorded · Trial | Zendesk Syncing, Jira **Failing** (36 attempts since 04:14 AM, "Jira responded 503 Service Unavailable") | Unhealthy | 12 open cases, 17% link coverage, 2 alerts failing (`channel_not_found`) |
| **Initech** | Starter · Past due | Zendesk Syncing | Healthy | 3 open cases, 0% link coverage |
| **Ops HQ** | Not recorded · Trial | none | No integrations | the operator's own org |

## 7. States to design for every screen

Loading (skeleton rows) · empty · error ("This page couldn't load" with a Try again button and an optional reference id) · long names and long error strings (truncate with tooltip) · 1 tenant vs 500 tenants (list must stay fast to scan: sticky header, compact density option) · dark (primary) and light themes · phone width (table becomes stacked cards; top nav scrolls horizontally).

## 8. Explicitly out of scope (do not design)

Customer impersonation · editing a customer's cases, policies or integrations · credentials or token views · invoices, payment methods, billing-provider status · usage-versus-plan-limit meters · admin roles or permissions · feature flags · notes or comments on a tenant. (These are planned for later phases; leave no placeholder UI for them.)

---

## 9. Paste-ready Stitch prompts

Use the Elapsed design system for all of them (attach `elapsed/DESIGN.md`, or say "use the existing Elapsed dark design system"). Generate desktop first (1440 wide), then a phone variant.

**Shell + Tenants list**
> Design the "Tenants" screen of an internal Platform Admin console for Elapsed, a B2B SLA-breach monitoring product. Audience: the one or two operators who run the product; they scan for what is wrong. Dark theme, Elapsed design system. No sidebar: a sticky top bar with the Elapsed logo, a small red "PLATFORM ADMIN" chip, tabs (Overview, Tenants, Monitoring, Audit log), the operator's email in mono, a theme toggle, and a "← Back to app" link. Content: page title "Tenants" with an "N organizations" chip; two summary cards (Plan status counts as coloured badges; Provider pairs as a list of "Zendesk + Jira 2"); a search box with filter chips All / Unhealthy / Needs a look / Healthy / No integrations; then a dense table with columns Tenant (name, owner email, created), Plan (plan name or italic "Not recorded", status badge), Health (badge), Integrations (stacked chips like "Zendesk · Syncing" with "Last success…" beneath), Open cases, Last 24 h (evaluations, alerts sent, alerts failing in red), Link coverage (percentage with a thin bar, flag under 60%), Members. Sort unhealthy first and give unhealthy rows a subtle red left edge. Health colours: Healthy green, Needs a look amber, Unhealthy red, No integrations neutral. Use the sample data for Acme, Globex, Initech and Ops HQ.

**Tenant detail**
> Design the "Tenant detail" screen of the Elapsed Platform Admin console for the tenant "Globex" (Unhealthy, Trial). Same top bar. Header: back link, name, health and plan-status badges, a one-line summary (owner email, members, created, id in mono) and a quiet note that viewing is audit-logged. Stacked sections, each with icon, title and one-line description: (1) Plan record, an editable form with Plan select (Not recorded/Starter/Team/Enterprise), Status select, Trial ends date, Billing reference, a "Informational only" note and a Save button; (2) Integrations, one bordered card per integration with a status chip, role tag, a "Pause polling" and a "Request re-normalization" button, and a label-over-value fact grid (last successful sync, last attempt, duration, consecutive failures in red, failing since, backfill, connected) plus a red "Last error" line; (3) Alert delivery with a failing-count badge and rows like "#1000 · Resolution @ 80% · 12 attempts · channel_not_found"; (4) Coverage facts and a small policy-import summary; (5) Worker run facts. Also design the three confirmation dialogs (Pause polling in red with the warning copy, Resume, Re-normalize). Never show credentials or ticket content.

**Overview**
> Design the "Platform overview" screen: a triage list of everything wrong across all tenants, grouped by tenant. Two sections, "Integration health" and "Failed alert deliveries", each with a red count badge, rows linking to the tenant, reasons in red (amber when polling was paused deliberately), and friendly green empty states. Dark, Elapsed design system, same Platform Admin top bar.

**Audit log**
> Design the "Audit log": a read-only, append-only table of operator actions, newest first, with columns When (mono), Operator, Action badge, Organization (link / "Deleted organization" / "Platform"), Details. Render plan edits as a readable before → after diff. Quiet outline badges for "Viewed tenant", tinted badges for real changes (Edited plan record, Paused polling, Resumed polling, Requested re-normalization, Changed worker settings). Add a "hide views" toggle and Newest/Older paging. State clearly that rows are never edited or removed.

**Phone variants**
> Make phone versions (390 wide) of the Tenants and Tenant detail screens: the top bar becomes a compact bar with a scrollable tab row, the tenants table becomes stacked cards led by the health badge, and the integration controls become full-width buttons.
