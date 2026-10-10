# Elapsed — Product Documentation

_Know before your customer does._

This document explains what Elapsed does, how it works, how to set it up, what every screen means, and what to expect once your systems are connected. It is written for whoever will actually use and administer the product day to day: a Head of Support, a Support Operations lead, a Customer Success manager, an Engineering Manager, or a Zendesk/Jira administrator.

---

## 1. Overview

Support teams make time-bound promises to customers — respond to a P1 within an hour, resolve it within a day. Those promises are tracked in the helpdesk (Zendesk, Intercom). But the work behind many of those promises doesn't stay in the helpdesk: it gets escalated into an engineering tracker (Jira, Linear, or a GitHub pull request), where a different team, on a different tool, with different status names, picks it up.

The customer's clock doesn't know or care which tool the work is sitting in. It keeps running. But visibility usually stops at the moment of escalation — support can see that a ticket is "waiting on engineering," but not how long it's actually been waiting, whether it's about to breach, or where the time went once it's over.

Elapsed connects to your helpdesk and your engineering tracker(s), reconstructs one continuous timeline per customer case across every connected system, and gives you:

- A single dashboard of what's at risk right now and what has already breached
- A case-level timeline showing exactly which system owned the work at every point in time
- Automatic detection of when a commitment is approaching or has crossed its target
- Slack and email alerts at the moment a threshold is crossed
- A record you can open during a QBR or an executive review that explains a number rather than just stating it

**What it connects to today:** Zendesk and Intercom as ticket sources; Jira, Linear, and GitHub as engineering-side sources; Slack and email for alerts. All connections are read-only — the product never creates, edits, or comments on anything in your connected systems (the one narrow exception, GitHub's OAuth scope, is explained in [Section 22](#22-security-and-access)).

**What you get:** one elapsed-time number per commitment that both teams can trust, because it's computed the same way every time from the same recorded events — not re-typed from two different tools into a spreadsheet before every report.

If you're evaluating this product for the first time, read this document once, in order — it deliberately gets less abstract and more concrete as it goes, ending with an end-to-end example (Section 25) and a setup checklist (Section 28).

---

## 2. The Problem SLA Solves

A typical enterprise support commitment looks like this: _"P1 tickets get a first response within 1 hour and a resolution within 8 business hours."_

That commitment is easy to track as long as the ticket stays inside the helpdesk. The moment it's escalated — linked to a Jira issue, handed to an engineer, turned into a pull request — three things happen at once:

1. **The clock doesn't pause just because the work moved.** Unless the ticket enters a status your policy explicitly treats as a pause (see [Section 12](#12-sla-calculation)), the customer's resolution target keeps counting down while the case sits in someone else's tracker.
2. **Visibility splits across two systems that don't talk to each other in SLA terms.** Zendesk shows "escalated." Jira shows "In Progress," "Blocked," or "Done." Neither tool tells you what fraction of the _customer's_ 8-hour window has already been consumed while the case sat in the other one.
3. **The two systems produce different numbers for the same case**, because each one is doing time arithmetic under its own rules, its own calendar, and its own definition of "paused." Reconciling that by hand — checking two tools, cross-referencing ticket and issue IDs, subtracting timestamps — is exactly the kind of hour-before-a-QBR work this product exists to remove.

This is why the product's core claim is narrow and specific: it doesn't try to manage your support workflow, your engineering workflow, or your tickets. It reconstructs _one_ honest elapsed-time number per commitment, across however many systems the work touched, from the events those systems actually reported — and it shows its work, so the number is something you can explain rather than something you have to defend.

**A word on how we talk about this.** When a commitment breaches while most of the elapsed time occurred inside engineering's queue, that is a fact about _where the time went_ — not a verdict about who is at fault. You will not find this product describing a breach as "caused by engineering" or naming a "responsible team." It reports time by stage. What you do with that information is a management decision, not something the tool decides for you.

---

## 3. How SLA Works

A short glossary up front — full definitions are in [Section 26](#26-glossary):

| Term               | Meaning                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Customer**       | An account, derived automatically from your helpdesk's organizations/companies — never typed in by hand.                                                                       |
| **Case**           | One customer request, followed across every system it touches (a Zendesk ticket, possibly linked to a Jira issue, a Linear issue, or a GitHub pull request).                   |
| **Commitment**     | One obligation attached to a case — e.g. "first response, 1 hour" or "resolution, 8 business hours" — bound to the specific policy and calendar in effect when it was created. |
| **Leg**            | Which system currently "owns" the case: `support`, `engineering`, `waiting_customer`, or `unknown`.                                                                            |
| **At risk**        | A commitment has consumed enough of its target time to cross a warning threshold, but has not yet run out.                                                                     |
| **Breached**       | A commitment's target has been exceeded.                                                                                                                                       |
| **Timeline**       | The ordered sequence of every recorded event on a case, across every connected system, used to compute everything above.                                                       |
| **Working time**   | Elapsed time counted only during the hours your calendar defines as open (or all the time, for a 24/7 policy).                                                                 |
| **Paused time**    | Time that doesn't count against a commitment, because the case is in a state your policy defines as customer-caused waiting.                                                   |
| **Remaining time** | Target minus elapsed working time.                                                                                                                                             |

**A worked example, matching how the product actually behaves:**

A customer submits a P1 ticket in Zendesk. The moment the ticket is created, Elapsed matches it against your imported Zendesk SLA policies and opens two commitments: a first-response target and a resolution target, each bound to the exact policy version and business calendar in effect at that instant.

Support responds, then escalates the ticket by linking it to a Jira issue (through Jira's own remote-link mechanism — no manual re-entry). The case's **leg** switches from `support` to `engineering` the instant that link is recorded. The resolution commitment's clock keeps running — it does not pause on escalation, only on customer-caused waiting (by default, only Zendesk's "Pending" status).

Engineering works the issue. Every status change on the Jira issue is recorded as a normalized event on the case's timeline. As elapsed working time climbs past 80% of the 8-hour target, the case shows as **at risk** on the dashboard and a Slack alert fires (if configured). If the Jira issue is resolved and the Zendesk ticket is marked solved before the 8 hours of working time are consumed, the commitment closes **met**. If not, it closes **breached**, and the case detail page shows exactly how much of the elapsed time was spent in each leg.

That's the whole model: two legs plus a customer-wait state, a small number of explicit statuses, and one clock that survives the handoff.

---

## 4. Getting Started

### Step 1 — Create your account

Go to the sign-up page and provide:

- **Organization name** — a free-text label for your account (e.g. your company name).
- **Work email**
- **Password** — at least 8 characters.

There is no company profile to fill in, no product tour, and no onboarding survey. Creating an account immediately creates a new, empty organization and signs you in.

> **Note on teams:** each sign-up creates a brand-new organization and makes you its **owner**. To add teammates to that organization, invite them from Settings → Members (see [Section 22](#22-security-and-access)); a teammate who signs up on their own gets a separate organization.

### Step 2 — Connect Zendesk

You'll land on the onboarding screen immediately after sign-up. The first thing it asks for is your Zendesk connection.

- **What it's used for:** Zendesk is the source of truth for what you promised — your customers (organizations), your SLA policies, your business-hours schedules, and your ticket history.
- **What you provide:** your Zendesk subdomain (the `xxx` in `xxx.zendesk.com`). You'll be redirected to Zendesk to approve the connection through a standard OAuth flow.
- **Permissions requested:** **read-only** (`read` scope). No write scope is ever requested.
- **What is read:** tickets (via Zendesk's incremental export API), each ticket's full audit trail (every status change, every event), organizations, SLA policy definitions, business-hours schedules and holidays, and the official Zendesk↔Jira links registry (used for correlation — see Section 15).
- **What is never changed:** nothing. No ticket, comment, tag, or field in Zendesk is ever created, updated, or deleted by this product.
- **After connecting:** a 90-day historical backfill starts automatically — see Step 4.

### Step 3 — Connect Jira

Jira is optional at this stage, but it's what turns on the escalation timeline — the reason most teams buy this product.

- **Why it's needed:** Jira tells you what happened to the work once it left the helpdesk — status changes, who touched it, and when it moved.
- **What you provide:** nothing beyond approving the connection — you'll be redirected to Atlassian's OAuth consent screen.
- **Permissions requested:** **read-only** (`read:jira-work`) plus `offline_access`, which is required only so the connection can refresh its own access token without asking you to reconnect every hour. No write scope is ever requested.
- **What is read:** issues (via JQL search), each issue's changelog (status transitions), and remote links (used to find the Zendesk ticket a Jira issue is linked to).
- **What is never changed:** nothing. No issue, comment, status, or field in Jira is ever created, updated, or deleted.
- **If you skip this step:** onboarding continues with Zendesk data alone. You can connect Jira later from Settings → Integrations with no loss of history — the 90-day backfill runs from whenever you connect it, not from your Zendesk connection date.

> **If you are not the person who can approve Jira (or Linear):** an owner can create a **connect link** from the tracker step of onboarding and send it to the tracker's administrator. The link works for one organization and one provider (Jira or Linear), can be used once, and expires after 72 hours. The administrator opens it and approves the same read-only connection; they do not need an Elapsed account. Once the connection succeeds the link is consumed and the integration is recorded as connected through it.

> **A note for whoever approves the Jira connection:** the scope requested is read-only, and this document states plainly what is and isn't read. If your organization requires a security review before granting API access, everything above is what that review needs to evaluate.

### Step 4 — Initial synchronization

Once Zendesk (and optionally Jira) is connected, a historical backfill runs automatically.

- **What happens:** the product pulls the **last 90 days** of tickets/issues and their full history from each connected system. This window is fixed in the current implementation — it is not currently configurable from the UI.
- **What you see:** a live progress panel showing counts as they land — **Tickets**, **Escalations**, and **Linked issues** — updating automatically while the backfill runs (the page polls for progress every few seconds).
- **What you can do while it runs:** nothing is required. You can leave the page; the backfill continues in the background. There's a "Skip to dashboard" link if you don't want to wait.
- **How long it takes:** depends on your ticket volume; there is no fixed estimate. The progress panel is the way to check.
- **If it fails:** an inline error appears (e.g. "Zendesk backfill failed to start"). If Zendesk or Jira access has expired or was revoked mid-sync, a reconnect banner appears with a one-click link back to that provider's connection flow.
- **When results become available:** as soon as the Zendesk backfill finishes, you're taken to the **Findings** screen (Section 8) automatically. If Jira is still catching up in the background, the panel says so explicitly rather than making you wait for it.

### Step 5 — Configuration

Nothing above required you to configure anything — every number so far came from data already in Zendesk and Jira. From here, configuration is optional and lives under **Settings → SLA** and **Settings → Integrations**. See [Section 19](#19-configuration) for the complete reference. In short:

| Setting                    | What it means                                                                                                  | Default if left alone                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Engineering leg target     | An optional, org-wide target (in hours) for how long a case should spend in the engineering leg                | Not set — cases can sit in engineering indefinitely without triggering an at-risk/breach state for that leg specifically (the underlying customer commitment still runs) |
| Customer calendar override | Pin a specific customer to a different business calendar than the one their matched policy would otherwise use | The customer uses whatever calendar their matched SLA policy resolves to                                                                                                 |
| SLA policy target override | Override the imported minutes for a first-response or resolution target on a given policy                      | The imported Zendesk value is used as-is                                                                                                                                 |
| Slack alert channel        | Which Slack channel receives at-risk/breach alerts                                                             | No Slack channel connected — no Slack alerts sent                                                                                                                        |

---

## 5. Integrations

The product connects to two kinds of systems: **ticket sources**, which create Cases and carry the customer commitment, and **engineering-side sources**, which contribute status and timing to a case's engineering leg without creating their own Cases. Slack and email are outbound-only notification channels, not data sources.

| Integration                                        | Role                                     | Auth                                  | Sync                            | Webhook |
| -------------------------------------------------- | ---------------------------------------- | ------------------------------------- | ------------------------------- | ------- |
| [Zendesk](#6-zendesk-integration)                  | Ticket source                            | OAuth2, read-only                     | Poll (5 min / 30 min) + webhook | Yes     |
| [Jira](#7-jira-integration)                        | Engineering source                       | OAuth2, read-only                     | Poll (5 min / 30 min) + webhook | Yes     |
| [Intercom](/docs/integrations/intercom) **(Beta)** | Ticket source (alternative to Zendesk)   | OAuth2, read-only                     | Poll only                       | No      |
| [Linear](/docs/integrations/linear)                | Engineering source (alternative to Jira) | OAuth2, read-only                     | Poll only                       | No      |
| [GitHub](/docs/integrations/github) **(Beta)**     | Engineering source (pull requests)       | OAuth2                                | Poll only                       | No      |
| [Custom REST](#custom-rest-beta) **(Beta)**        | Ticket source (any helpdesk with a JSON API) | API key, Bearer, Basic or a custom header, read-only | Poll only (5 min / 30 min) | No      |
| Slack                                              | Alert channel                            | OAuth2 (bot token)                    | Outbound only                   | —       |
| Email                                              | Alert channel                            | SMTP (self-service, per organization) | Outbound only                   | —       |

Intercom and GitHub are **Beta**: built and usable, but with known gaps (see each one's "Known limitations" section on its own integration page, linked above) and no onboarding-progress reporting (Zendesk and Jira only — see below). Zendesk and Jira are the only integrations covered by task 2.9's live-account verification checklist so far.

Every connection shares the same shape:

- **Connect:** one click, redirects to the provider's own OAuth consent screen. You never paste an API token directly for the five OAuth integrations. The Custom REST source (Beta) is the exception: it is not an OAuth sign-in, and you enter the credentials for your helpdesk's own API, which are encrypted and never shown again.
- **Data imported:** the specific resources listed in each provider's section below — never more.
- **Data never modified:** every ticket-source and engineering-source integration is strictly read-only. The only two things this product ever writes to an external system are a Slack message and an outbound email — both are alerts, never a write-back into Zendesk, Jira, Intercom, Linear, or GitHub.
- **Correlation:** how a case in one system is matched to a record in another — see [Section 15](#15-correlation-between-systems).
- **Sync behavior:** Elapsed syncs each connected system in the background on two schedules — an **active-set poll** (every 5 minutes by default) for open cases with a live commitment, and a **reconciliation sweep** (every 30 minutes by default, and never longer than 30 minutes) that re-checks everything, including closed cases, as a safety net against a missed poll. Zendesk and Jira additionally support a real-time webhook that closes the gap between polls for the one ticket/issue that just changed.
- **Disconnecting:** always a soft disconnect. The connection stops syncing and its credentials are cleared, and everything that came from it — its cases, commitments, events, links, alerts, and the figures built on them — disappears from the app and from alerts and reports. Nothing is deleted: reconnecting the same integration brings all of it back.
- **Reauthentication:** if a token expires, is revoked, or a refresh attempt fails, the integration is marked **"Needs reconnect"** on the Integrations page, and a banner with a one-click reconnect link appears wherever that provider's data would otherwise be shown (onboarding, the integration's own detail page).

### When an integration is unavailable

Elapsed can make an integration temporarily unavailable, for example during a provider incident or maintenance, or because a Beta integration is open only to selected organizations. You will see one of these on the Integrations page and in onboarding:

- **Unavailable**: the integration can't be connected right now. If Elapsed added a note, it is shown on the card.
- **Coming soon**: the integration is listed but can't be connected yet.
- **Paused by Elapsed**: you are connected, but Elapsed has paused this integration. This is not a disconnect, and you don't need to do anything.

While an integration is paused by Elapsed:

- Nothing is deleted or changed. Your connection, credentials, cases, events, commitments and history stay as they are, and stay visible.
- Elapsed makes no requests to that system, ignores its webhooks, and refuses new connections, reconnects and manual imports. These requests return the error code `integration_disabled`, `integration_coming_soon` or `integration_beta_restricted`.
- SLA tracking continues on the data already received, and the integration is shown as **stale** (see the freshness notices), so at-risk alerts carry a stale-data marker and breach alerts wait until data is fresh again.
- You can still disconnect it.

When Elapsed makes the integration available again, syncing resumes from where it stopped and catches up on changes made in the meantime, including changes whose webhooks were ignored. If you had disconnected it yourself, it stays disconnected until you reconnect it.

### Custom REST (Beta)

For a helpdesk Elapsed has no built-in integration for. It is a ticket source configured entirely from the **Integrations → Custom REST** page; no code is run and nothing is installed. It must be enabled for your organization by the platform operator first, one Custom REST source is allowed per organization, and only the organization **owner** can configure it.

- **What it does:** reads tickets (and, optionally, replies and status history) from a JSON API over HTTPS, maps them into Elapsed's fields, and feeds the same SLA engine as every other source.
- **Read-only:** Elapsed sends `GET` requests, and `POST` only to an endpoint you have explicitly confirmed is a read-only search. It never creates, edits or deletes anything in your system. Redirects are not followed, and requests go only to the address you configured (a public HTTPS host on port 443).
- **Authentication:** an API key in a header, a Bearer token, Basic authentication, or a custom header. OAuth is not supported and credentials in the query string are refused. Credentials are encrypted at rest, never shown again, and removed from logs and error reports.
- **Fields:** required are the ticket ID, created time and status. Recommended are title, priority, customer ID and name and an updated-since parameter. Tags and channel can be mapped. Only fields you map are stored.
- **Two SLA modes:** **Full SLA** needs the replies on each ticket (with who wrote each one and whether it was public) and tracks first response, next reply and resolution. **Resolution-only** tracks resolution only; first response and next reply are shown as **not supported** for the source. Resolution needs a closing timestamp from your system: Elapsed never uses "updated at" as a closing time.
- **No invented history:** if your system does not provide status history, Elapsed uses each ticket's current status and the timestamps your system gives it. It does not reconstruct history, so time a ticket waited on the customer cannot be excluded and resolution times can read longer than your system's own. Alerts for those calculations say so.
- **Syncing:** on the same two schedules as other sources, with a 120-second limit on each sync's requests. A large first import (default 90 days, up to 365) is read over several syncs and is shown as **Importing your history**, not as a fault; SLA clocks and breach alerts start after the first complete import. If your API cannot return only recent changes and a full listing does not fit in one sync, the connection is refused with the measured numbers.
- **Sync history:** the Syncs list shows only syncs that changed your data or that did not complete cleanly (partial, stopped or failed, or with tickets that could not be processed). A sync that finds nothing new is not listed; the page instead shows **Last checked** (the last successful check) and **Last data update** (the last time Elapsed actually changed your data). History is kept for 30 days.
- **Safety checks:** a sync that would delete or change the open/closed state of an unusually large share of your tickets, or fail on many tickets, is stopped before anything is changed. You can review a stopped lifecycle change and approve it once; a mass deletion cannot be approved.
- **Configuration versions:** every change is a new immutable version; you can roll back to an earlier one. A rollback applies to future processing and never restores commitments a later version cancelled.
- **Limits:** a deleted ticket is hidden only when your system says so (a status or flag you map, or a confirmed "not found"); a ticket restored later stays hidden. Capacity for large organizations has not been validated yet, so this source is Beta and enabled per organization.
- **Credentials and key rotation:** if the deployment's `INTEGRATION_TOKEN_ENCRYPTION_KEY` is rotated, saved Custom REST credentials become unreadable and the owner must enter them again.

### Bringing your own OAuth app

Before any of the five data-source integrations can be connected, your organization must configure its own OAuth application credentials (Client ID and Client Secret) for that provider, from the **Integrations** page. There is no shared, built-in application you connect through by default — this is a one-time setup step per provider, done once per organization. Client secrets are encrypted at rest and are never displayed again after saving (only edited by supplying a new one).

---

## 6. Zendesk Integration

### Purpose

Zendesk is the system of record for what you promised. It supplies your SLA policy definitions, your business-hours calendars, your customers (as Zendesk organizations), and the full ticket history the resolution and first-response clocks are computed from.

### Connection

From Settings → Integrations (or during onboarding), enter your Zendesk subdomain and approve the OAuth prompt.

### Permissions

OAuth scope: **`read`**. No write scope is ever requested.

### Data imported

- Tickets (incremental export — every ticket, current and historical, within the 90-day backfill window)
- Full audit trail per ticket (every status change and event)
- Organizations (become **Customers**)
- SLA policy definitions
- Business-hours schedules and holidays
- Requester and assignee display names, resolved from the ticket's own sideloaded user list. Display only — shown on the case header, never used for policy matching, routing, or SLA calculations. See [Section 22](#22-security-and-access).

### Data used for calculations

- Ticket status transitions drive the case timeline and the `pending_customer` pause state.
- Imported SLA policies supply commitment targets (first-response and resolution minutes) and warning thresholds.
- Imported business-hours schedules supply the calendar used to compute working time, unless overridden per customer (Section 19).

### Data used for correlation

Zendesk doesn't initiate correlation itself in this product — Jira and Linear look for a Zendesk ticket URL in _their own_ records (remote links, attachments) and match it back to a Zendesk ticket by exact subdomain. See [Section 15](#15-correlation-between-systems).

### Data not modified

Nothing. No ticket, field, tag, or comment is ever created or changed in Zendesk.

### Sync behavior

Polled every 5 minutes (active cases) and every 30 minutes (full reconciliation). A webhook is also available (Section 20) to close the last few minutes of latency on ticket status changes; it requires a one-time manual setup in Zendesk Admin Center (instructions are shown on the integration's detail page, with a copyable endpoint URL and bearer token). The trigger's request body must be `{"ticket_id": "{{ticket.id}}", "timestamp": "{{ticket.updated_at_with_timestamp}}"}`. The timestamp is required for replay protection, and plain `{{ticket.updated_at}}` won't work because Zendesk renders it as a date with no time (e.g. "May 18"), so those deliveries are rejected with `401`. Zendesk's **Test webhook** button sends a sample body with no `timestamp` and doesn't fill in placeholders, so it gets the same `401`. To test from there, replace the body with a real ticket id and the current UTC time, such as `{"ticket_id": "123", "timestamp": "2026-09-17T08:40Z"}`, and send it within 5 minutes of that time. SLA policies and business-hours schedules are re-imported every cycle, so a policy edit in Zendesk is picked up automatically without reconnecting.

### Known limitations

- Only two Zendesk SLA metrics currently map to commitments: **First reply time** → first-response, and **resolution time** → resolution. Other Zendesk metrics (next-reply time, requester-wait time, agent-work time, periodic-update time) are not currently imported as separate commitments.
- Policy conditions based on fields other than **priority** and **organization** (e.g. tags, ticket form, group) are not currently applied — a policy using them will still import, but those extra conditions are dropped from the match, which can make the imported policy match more broadly than it does inside Zendesk itself.
- If a policy references a business-hours schedule that hasn't been imported yet, it falls back to an always-open (24/7) calendar until that schedule is available — the product never guesses at a calendar.

### Troubleshooting

See [Section 23](#23-troubleshooting).

---

## 7. Jira Integration

### Purpose

Jira supplies the engineering side of the timeline: what happened to an escalated case after a Zendesk ticket was linked to a Jira issue.

### Connection

From Settings → Integrations (or during onboarding), click Connect and approve Atlassian's OAuth consent screen. The product uses the first Jira site your account has access to.

### Permissions

OAuth scopes: **`read:jira-work offline_access`**. `offline_access` exists only to obtain a refresh token so the connection doesn't need re-approval on every use — it grants no additional data access. No write scope is ever requested.

### Data imported

- Issues (via JQL search, incrementally by `updated` timestamp)
- Each issue's changelog (status transitions)
- Each issue's remote links (used to find the linked Zendesk ticket)
- Site-wide status list (for readable status labels)

### Data used for calculations

Every status transition on a linked Jira issue becomes a normalized event on the case's timeline and contributes to leg attribution (Section 14) — whether the case is currently in the `engineering` leg, and for how long.

### Data used for correlation

A Jira issue's own **remote links** are read for a URL pointing at your Zendesk subdomain. If found, the case is linked with `certain` confidence via the method labeled **"Remote link."** Zendesk's own official Jira-links registry (read as part of the Zendesk connection, Section 6) is the authoritative correlation signal and is checked independently — it still establishes the link even if this issue's remote link is missing or stale. See [Section 15](#15-correlation-between-systems) for exactly how strict this match is.

### Data not modified

Nothing. No issue, status, comment, or field in Jira is ever created or changed.

### Sync behavior

Same two-speed poll as Zendesk (5 min / 30 min), plus an optional webhook (manually registered in Jira's own admin settings — Section 20) for near-real-time updates on issue creation and updates.

### What happens when...

| Situation                                                                  | Behavior                                                                                                                                                                                       |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A Jira issue is linked to a Zendesk ticket (via Jira's remote link)        | The case's leg switches to `engineering` on the next sync; the customer commitment keeps running under its own pause rules — linking does not pause anything by itself.                        |
| A Jira issue is **not** linked                                             | The case simply has no engineering leg. It is excluded from "escalated" counts, and its leg reads as `support` (or `unknown` if no ticket status has been observed at all).                    |
| A link is missing or the connection between two records can't be confirmed | The case is treated as unlinked — never guessed at. Coverage (how many escalated cases could be linked) is something the product reports honestly, not something it inflates.                  |
| A linked issue's status changes                                            | Recorded as a new event on the timeline immediately at the next poll (or the next webhook delivery).                                                                                           |
| A linked issue is resolved or closed                                       | The case's leg switches back to `support`. Note: **only Zendesk closing the ticket closes the case itself** — a Jira issue reaching "Done" does not close the Zendesk case or its commitments. |
| Jira data is missing or a fetch temporarily fails                          | The last known state is kept; the next successful poll catches up. If the failure is due to an expired/revoked connection, the integration is marked "Needs reconnect."                        |

### Known limitations

- Only one Jira site is used per organization (the first one your OAuth grant has access to).
- There is no manual "link this ticket to this issue" action in the product today — correlation is entirely automatic, based on Jira's own remote-link data. See [Section 27](#27-product-limitations).

### Troubleshooting

See [Section 23](#23-troubleshooting).

---

## 8. Onboarding

The onboarding flow is a single page (`/onboarding`) that changes shape depending on your connection state, rather than a fixed multi-step wizard.

### Screen: Connect Zendesk

**What this step does:** establishes the ticket source everything else depends on.
**What you need to provide:** your Zendesk subdomain.
**What happens automatically:** nothing yet — this step is the one manual action required to start.
**After connecting:** you're redirected back and the screen switches to the backfill/progress view.
**If you skip it:** you can't proceed — Zendesk is required before the product has anything to show.

### Screen: Backfill in progress

**What this step does:** shows live counts as your last 90 days of Zendesk data (and Jira data, if connected) are imported.
**What you need to provide:** nothing.
**What SLA does automatically:** pulls tickets, audits, organizations, SLA policies, and business-hours schedules; if Jira is connected, pulls issues, changelogs, and remote links in parallel; runs correlation and commitment creation as data lands.
**What happens if you leave the page:** the backfill keeps running in the background — you can use "Skip to dashboard" and come back.
**Common problems:** a stalled or failed backfill shows an inline error naming which provider failed. An expired connection shows a reconnect banner.

### Screen: Optional Jira connection

Shown alongside the Zendesk backfill progress if Jira isn't connected yet. **What happens if you skip it:** you still get findings from Zendesk alone (first-response/resolution accuracy, business-hours pause behavior); the engineering-leg timeline simply won't exist for any case until Jira is connected, at which point its own 90-day backfill starts independently.

### Screen: Findings ready

Once the Zendesk backfill completes, a button appears: **"Findings are ready →"**, and the page auto-advances there after a short delay. See [Section 9](#9-findings) for what's on it.

---

## 9. Findings

The findings screen (`/onboarding/findings`) is the first payoff of connecting your systems — a plain-language summary of your last 90 days, computed with zero configuration.

**If you have escalated cases:** a summary sentence such as _"Over the last 90 days, 318 tickets were escalated to Jira. 47 of them exceeded their customer resolution target,"_ plus, when available, the average time escalated tickets spent waiting to be picked up in the engineering leg. Below that, a **Top affected accounts** table (up to 5 rows) showing which customers had the most escalations and breaches.

**If you have no escalated cases yet:** an empty state explaining that findings will appear automatically once Jira is connected and issues get linked — nothing further to configure.

**Note on terminology:** "escalated" here means the case has at least one link to Jira, Linear, or GitHub — not Jira specifically, even though the summary sentence currently only mentions Jira by name.

Two actions are always available: **"Confirm SLA policies & connect Slack"** (goes to Settings → Integrations) and **"Go to dashboard →"**.

---

## 10. Dashboard

The dashboard (`/dashboard`) is the single screen meant to answer "what needs attention right now," followed by a monthly-report-style analytics section.

### Unusual cycle times (shown only when detected)

A warning banner listing customer/commitment-type combinations whose recent resolution times are statistically unusual compared to their own history — e.g. _"Acme Corp · Resolution is running slower than usual: recent median 6h 40m vs. baseline 2h 10m (5 recent of 18 historical cases)."_ This is a statistical comparison (a modified z-score against the customer's own historical median), not a prediction or an AI-generated insight, and it requires at least 12 historical closed commitments and 5 recent ones before it will say anything for a given customer/kind pair.

### The three headline numbers

| Tile                     | What it means                                                                                                                                       | Period                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **Breached**             | Count of commitments that crossed their target and are still open or closed as breached                                                             | Last 30 days                     |
| **Compliance**           | Percentage of closed commitments in the period that closed **met** rather than **breached**, with a trend indicator against the prior 30-day period | Last 30 days                     |
| **Aging in engineering** | Count of cases currently sitting in the `engineering` leg right now                                                                                 | Point-in-time, not period-scoped |

### SLA Analytics

Three charts, all computed from the same 30-day period as the tiles above:

- **Breaches Over Time** — a daily line chart of breach counts across the period, by the day (in your organization's display timezone) each commitment actually ran out of time (business hours and customer pauses included), not the day it was first synced or evaluated. Imported history lands on its original dates.
- **SLA Compliance** — a donut chart of all cases in the period by their worst commitment status: **Met**, **At Risk**, **Breached**.
- **Breaches by Stage** — a horizontal bar chart of breached time attributed to each leg (support, engineering, waiting on customer, unknown) — this is the "where did the time go" view, not a ranking of teams.

Each chart shows a plain empty state (e.g. "No breaches in this period") rather than an empty or broken-looking chart when there's nothing to plot yet.

### Operational Attention

- **At risk now** — a live, searchable, sortable table of every open commitment, showing customer, case (linked to its detail page), ticket number, commitment type, status, remaining time (shown as "X overdue" in red once past due), current leg, and time in that leg. Includes a CSV export of what's currently shown and a manual refresh control.
- **Breached cases** — a collapsible list of every case that breached in the last 30 days, each linking to its case detail page.
- **Aging in engineering** — a list of cases currently in the engineering leg, sorted by how long they've been there, showing remaining/over-by time against the engineering leg target if one is configured (Section 19).

---

## 11. Cases

The **All cases** page (`/cases`) lists every case your organization has — open and closed, from every connected ticket source — in one searchable, sortable, paginated table.

**Columns:** Customer, Case (subject), Ticket number, Priority, Tier, Channel, **SLA status** (the worst status among the case's commitments), **Case status** (Open/Closed), Opened date, Closed date.

The case detail page's header (Section 12) additionally shows the case's current fine-grained status (e.g. "Pending customer", not just Open/Closed) and its currently-assigned agent, when the connected system reports one.

**What each field means:**

- **SLA status** rolls up all of a case's commitments into one badge, in this priority order: Breached > At Risk > On Track > Met > Cancelled.
- **Case status** is separate from SLA status — a case can be closed and still show a breached SLA status, because closing the ticket doesn't erase what already happened to its commitments.
- **Priority, Tier, Channel** are read as-is from the source ticket; they are not modified or interpreted by this product beyond being used to match SLA policies (priority) or, where populated, customer tier.

The table supports full-text search, column sort, column reordering and resizing, adjustable page size, and CSV export of every case matching the current view.

---

## 12. Case Timeline

The case detail page (`/cases/[caseId]`) is where a specific number gets explained. It reconstructs the full lifecycle of one case from every recorded event, across every connected system.

**Header:** customer, subject/ticket number, current leg, current status, priority/tier/channel badges, assignee (when the connected system reports one), opened and (if applicable) resolved timestamps, and a direct link back to the ticket in Zendesk.

**Commitments:** one card per active commitment (first response, resolution), each showing its target, when it started, its headline number (remaining, overdue, or over-target), its due time, and a **"How this was calculated"** disclosure that shows the policy's name and version, a plain-language description of which conditions matched it, the calendar used, what states pause it, what its warning thresholds are, and — when the commitment's target changed after a priority or policy update — the full history of those changes with each one's reason. The number is never presented without a way to see how it was produced.

**Case journey:** a horizontal stage-timeline bar, one colored segment per period the case spent in a given leg (support, engineering, waiting on customer, unknown), with a legend showing total time per leg. Below it, a second bar shows the commitment's running vs. paused intervals across the same timeline, so you can see at a glance when the clock was and wasn't counting.

**Activity timeline:** every normalized event on the case, in order, with an icon by type (created, status changed, issue linked/unlinked, case closed, priority changed), who or what triggered it (customer, agent, or system), and which connected system it came from. It also shows the SLA story alongside the ticket history — a policy re-match with the target change it caused, and each commitment's own lifecycle markers (started, at-risk threshold crossed, breached, met, cancelled) — all derived from data already recorded elsewhere (re-resolution history, evaluations, and sent alerts), never a second copy of it. A glossary (the "?" icon) explains every normalized status in plain language directly in the UI.

**Conversation:** every public customer/agent message on the case, in order, labeled Customer, Agent, or — when confirmed to be the ticket's own requester — Requester. A ticket opened automatically (by a trigger, automation, or rule) shows its opening message as a neutral note rather than attributing it to a person. For an Intercom conversation, the conversation's own first message (which Intercom stores on the conversation, not as a reply) is shown first in the same way. Internal/private notes are never shown here.

**Linked records:** every external record this case is connected to — the Zendesk ticket itself, plus any linked Jira issue, Linear issue, or GitHub pull request — each showing how the link was established (see Section 15) and its live status label pulled from that system.

**How to read the timeline as a customer:** the timeline is a rendering of events your own connected systems reported — it is not an inference about intent, and it will never show a boundary between two legs that isn't backed by an actual recorded event (or, for the very first span on a case, bounded by the case's own creation time when no earlier event exists).

---

## 13. SLA Calculation

The engine's one governing rule: **elapsed time is always computed from the recorded event history, a specific policy version, and a specific calendar version — never stored as a running counter.** This is what lets any number, on any screen, be recomputed and explained later, and it's what makes the "how this was calculated" disclosure on every commitment possible.

### Business hours vs. 24/7

Each SLA policy is bound to a business calendar — either a set of weekly working windows with a timezone and holiday list (imported from Zendesk's own business-hours schedules), or an always-open calendar for 24/7 targets. An 8-hour resolution target under a business-hours calendar does not mean 8 calendar hours — only time inside the calendar's open windows counts, so an 8-hour target opened at 4pm on a Friday, under a 9-to-5 weekday calendar, doesn't come due until well into the following week.

Working windows follow the calendar's local wall clock through daylight-saving changes: a 9-to-5 window is 9-to-5 local time on both sides of a clock change. On the change day itself, a window that spans the skipped hour counts one hour less and a window that spans the repeated hour counts one hour more, because that is how much real time passed.

### Display timezone vs. calendar timezone

Elapsed has two different kinds of timezone, and they do different jobs:

- **Organization display timezone** (Settings → Organization). Every date and time you see in Elapsed is shown in this timezone: case timelines, commitments, members, integration status, banners and alert messages. It is also the timezone that new timezone pickers start on (for example, a new business calendar), the one that groups the dashboard's charts into days, and the one the monthly report uses to decide where a month starts and ends. Changing it changes only how times are *shown*: stored timestamps and SLA results do not change.
- **Business calendar timezone**. Each business calendar has its own timezone. Its working windows and holidays are read in that timezone, and it alone decides how SLA deadlines are calculated. A new calendar starts with your display timezone pre-selected, but you can pick another, and an existing calendar never changes when you change the display timezone.

Billing dates and the "Breached at (UTC)" column in the monthly report CSV stay in UTC on purpose.

### Holidays

Holidays are dates the calendar treats as fully non-working, in the calendar's own timezone. A day marked as a holiday contributes zero working minutes even if it would otherwise fall inside a normal working window.

### Paused states ("waiting for customer")

**Zendesk-imported policies never pause Resolution while a ticket is Pending**, exactly like Zendesk's own Total Resolution timer, so the breach times and elapsed numbers you see here match Zendesk's SLA view. (Time spent **solved** is still excluded after a reopen, as in Zendesk.) **Policies you create in Elapsed** pause on the **"Pending customer"** normalized state by default, regardless of which connected system reported that status; this is not adjustable per policy from the settings UI. First Response and Next Reply never pause under either kind of policy. Putting a ticket **on hold** (Zendesk's internal-hold status) does **not** pause the resolution clock — that time keeps counting, the same as any other open time. This is a deliberate MVP choice, not a gap: on-hold is for internal triage, not customer waiting, so it doesn't excuse the clock.

### Reopened tickets

If a Zendesk ticket is solved and later reopened, the resolution commitment's clock is **not** reset. It resumes live evaluation from the original commitment start time, over the full event history — so a ticket that was marked "met" at solve time can read as "breached" once reopened and re-evaluated, if the total working time now exceeds target. The time the ticket spent solved is **excluded**: the clock pauses automatically between the solve and the reopen (matching Zendesk's own behavior), so only time the ticket was actually open counts toward the target.

A first-response commitment is not affected by a reopen: once an agent has replied, its result is final. A ticket closed with no agent reply at all is a separate case — see "First response without a reply" below.

### First response without a reply

Closing a ticket before an agent ever replied publicly is **not** treated as a met first response — it's the promise going unkept, not the promise being satisfied quickly. A ticket closed this way is reported as breached (once past target) rather than shown as "met" the moment the case closes.

On a ticket an agent created on the customer's behalf (rather than the customer submitting it directly), the first-response clock does not start at ticket creation — it starts at the customer's first message. Until the customer has said anything, there is no promise to measure a response against.

### Next Reply and closed tickets

Closing a case ends any Next Reply cycle that was still waiting on an agent's answer — an unanswered customer message is not carried forward as an open obligation once the ticket is closed. If the ticket is reopened and the customer writes again, that starts a fresh Next Reply cycle from that new message.

### Priority changes

Changing a case's priority, customer, or (where populated) tier is not ignored: on the next poll or webhook delivery, every commitment on that case that is still open (not yet met, and not terminally breached — see [Section 14](#14-at-risk-and-breached-states)) is re-matched against your current SLA policies, and moved onto whichever version now applies. The clock itself never resets — only the policy, target, and calendar version update, and elapsed time keeps being derived from the same original start time and event history. A commitment that has already completed (met, or breached and closed) keeps the policy version it finished under, permanently.

A Zendesk priority change is shown on the case's Activity timeline (Section 12) as its own event, and the resulting target change — when it triggers a policy re-match — appears alongside it with its reason. Both are display only: recording them on the timeline never feeds back into policy matching or the SLA engine.

### Multiple SLA policies

When a case is created, its attributes (priority, customer, and — where populated — tier) are matched against your imported SLA policies in **Zendesk's own policy order** (the order your policies are listed in Zendesk's SLA settings) — the first policy in that order whose conditions match wins, exactly as Zendesk itself would apply them. A policy created directly in this product (not imported from Zendesk) has no Zendesk order to follow, so it and any other unordered policy fall back to **most-specific-match-wins**: a policy that names this specific customer beats one that only names a priority, which beats a catch-all default policy. Ties are broken deterministically so the same inputs always produce the same match.

> **Note:** tier-based policy matching exists in the engine, but no currently connected data source (Zendesk or Intercom) populates a customer or case tier automatically today — see [Section 21](#21-data-accuracy-and-limitations).

### Policy changes

Editing a policy's target never rewrites history in the sense of altering a past record, but it is **not** invisible to commitments already in progress: it creates a new version of that policy, and any currently open commitment still matched to that policy (by the same mechanism as [Priority changes](#priority-changes) above) moves onto the new version — its target, calendar version, and due date update, while its clock keeps running from its original start time. Only a commitment that has already completed (met, or breached and closed) keeps the exact policy version it finished under, permanently, so a policy correction never changes a number that's already been reported and closed out.

### Worked example

_"An 8-hour resolution target does not necessarily mean 8 calendar hours. If the applicable calendar is business-hours based, only working time counts toward the commitment — a case opened Friday afternoon under a 9-to-5 weekday calendar may not come due until partway through the following week, even though far more than 8 clock hours will have passed."_

---

## 14. At-Risk and Breached States

A commitment moves through a small, fixed set of statuses:

| Status        | Definition                                                                                                                                         | What causes the transition                                                                                                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **On track**  | Elapsed working time is below every configured warning threshold                                                                                   | Default state on creation                                                                                                                                                                                                                                                                       |
| **At risk**   | Elapsed working time has crossed a configured warning threshold (default thresholds: 50%, 80%, 95% of target) but the target has not been exceeded | Working time crosses a threshold                                                                                                                                                                                                                                                                |
| **Breached**  | Elapsed working time has exceeded the target, or the commitment completed after its target was already consumed                                    | Target exceeded, evaluated on every sync cycle                                                                                                                                                                                                                                                  |
| **Met**       | The commitment completed with elapsed working time still within target                                                                             | First response: an agent's first public reply (Zendesk public comment, Intercom admin reply) before target is exceeded. A case closing before any reply is never "met" — see [Section 13](#13-sla-calculation). Resolution: the case closes (Zendesk marks it solved) before target is exceeded |
| **Cancelled** | Defined in the data model but not currently produced by any part of the product                                                                    | —                                                                                                                                                                                                                                                                                               |

**Notifications:** crossing into **at risk** or **breached** triggers a Slack and/or email alert, if configured (Section 16) — but only for the customer-facing first-response and resolution commitments. The separate, optional engineering-leg target (Section 19) is currently dashboard-only and does not send its own alert.

**Warning thresholds** are currently fixed at 50%, 80%, and 95% of target for every imported policy and are not adjustable from the settings UI in the current implementation.

---

## 15. Correlation Between Systems

Correlation is how a Zendesk ticket gets connected to a Jira issue, a Linear issue, or a GitHub pull request. The product uses exactly one rule for every correlation it makes:

> **Only a deterministic, verifiable link is ever created. Nothing is guessed.**

### How each link is established

| Link                          | Method            | How it's verified                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jira issue → Zendesk ticket   | **Official link** | Read from Zendesk's own official Jira-links registry (the data behind the official Zendesk↔Jira integration), which hands back the Zendesk ticket id and Jira issue key directly. This is the authoritative signal: no URL to parse, no hostname to validate.              |
| Jira issue → Zendesk ticket   | **Remote link**   | Read from Jira's own remote-links data for that issue. Accepted only if the linked URL's hostname is _exactly_ your connected Zendesk subdomain — a similar-looking or different tenant's domain is never accepted.                                                                                   |
| Jira issue → Intercom conversation | **Official link** | Read from the `jira_issue_key` attribute that Intercom's own Jira integration sets on the Intercom object it created the issue from (Intercom writes nothing on the Jira side). When that object is a **Tracker ticket**, the issue is linked to each customer conversation that Intercom lists as linked to the tracker. Trackers themselves are not shown as cases: they are the link between conversations and the issue, not a customer's work. A conversation or customer ticket carrying the key is linked directly. Titles are never compared. Clearing or changing the key, or unlinking the tracker, unlinks the case. |
| Linear issue → Zendesk ticket | **Remote link**   | Same rule as Jira, applied to Linear's attachment/link data.                                                                                                                                                                                                                                          |
| GitHub pull request → case    | **Pattern match** | The PR's title or branch name is scanned for a Jira- or Linear-style issue key (e.g. `ENG-1234`). If that key already has a confirmed Jira or Linear link to a case, the pull request is linked to the same case(s). A PR can reference more than one issue key and link to more than one case if so. |

Both Jira methods run independently and can both fire for the same
relationship — that's expected, not a bug. If a Jira issue and a Zendesk
ticket are linked through both the official Jira-links registry and a
matching Jira remote link, the product still records exactly one link
between them, shown as **"Official link."** The official-link
signal is treated as authoritative: it's what's shown whenever it's present,
even if a remote link also exists.

This matters most when a Jira remote link has gone stale — for example, an
organization reconnected Zendesk under a new subdomain, and an old remote
link still points at the previous one. **That stale hostname is never
repaired or relaxed** — a remote link on the wrong subdomain is rejected
exactly as before, with no exception. But because the official Jira-links
registry carries the ticket id and issue key directly rather than a URL, it
still establishes the relationship on its own, independent of whether the
remote link is current, stale, or was never created at all.

### Confidence levels

Every link carries a confidence level. The current implementation only ever produces **certain** links — every link shown anywhere in the product is backed by an explicit, verifiable record in the source system, never a probability estimate or a suggested match awaiting confirmation.

### What happens when SLA cannot establish a relationship

If no verifiable link exists, the case simply has no engineering leg — it reads as `support` (or `unknown`, if no status has ever been observed on it at all). It is excluded from "escalated" counts on the Findings screen. This is deliberate: an honest, partial coverage number is worth more than a number that silently assumes a relationship it can't prove. **The product currently reports coverage implicitly (via the Findings and dashboard counts) rather than as one explicit "N% of escalations linked" statistic** — a customer who wants the exact linked-vs-unlinked ratio for a period can derive it from the Findings screen's escalation counts or the compliance CSV export (Section 17).

### What this means for you

If your team pastes ticket URLs into a Jira comment instead of using Jira's remote-link feature (or the equivalent for Linear/GitHub), that case will not correlate — the link exists to a human reading the comment, but not in a form this product can verify. Use your system's native "link" or "remote link" feature, not a pasted URL in free text, to get a case attributed to its engineering leg.

---

## 16. Notifications

There are two notification channels, and only one is self-service today.

### Slack

- **How to connect:** from Settings → Integrations, click Connect Slack and approve the OAuth prompt. Bot scopes requested: `chat:write`, `chat:write.public`, `channels:read`, `groups:read` — enough to post messages and list channels for the picker; nothing else.
- **Choosing a channel:** after connecting, pick one channel from a list (public and private channels the bot can see) and save it. There is exactly **one alert channel per organization** in the current implementation — no per-severity or per-team routing.
- **What messages look like:** each message names the commitment, ticket and customer, then a second line with the matched policy's name, the target, and when the commitment started (plus the exact breach time once breached), and a link straight to the case in this product.
  - Breach: `🚨 First response SLA breached — #4821 for Acme Corp, over target by 1h 12m.`<br>`Policy: Urgent SLA · Target: 2h · Started: Sep 17, 2026, 09:00 UTC · Breached: Sep 17, 2026, 11:12 UTC`<br>`View ticket` (link)
  - At risk: `⚠️ Resolution SLA at risk — #4821 for Acme Corp, 80% of target used, 1h 36m remaining.`<br>`Policy: Standard SLA · Target: 8h · Started: Sep 17, 2026, 09:00 UTC`<br>`View ticket` (link)
- **When notifications are sent:** the moment a first-response or resolution commitment crosses a warning threshold (50/80/95%) or breaches, checked on every sync cycle (at minimum every 5 minutes for open cases) and immediately on a Zendesk/Jira webhook delivery if configured.
- **When the source data is stale:** if the integration a case comes from has not synced successfully for a while (see [Data freshness](#data-freshness)), an **at-risk** alert is still sent, marked with the time the data went stale. A **breach** alert is **held** until the source is fresh again; once it is, the case is re-evaluated and the breach alert is sent only if the breach is confirmed. A held alert is sent exactly once.
- **Deduplication:** each commitment/threshold combination alerts at most once, ever — a poll that runs twice, or a webhook that fires alongside a scheduled poll, cannot double-alert.
- **What happens when a notification fails:** the failure is recorded internally; it does not block the same alert from being attempted through the other configured channel (email), and it does not stop other cases from being evaluated or alerted.

### Email

Email alerts use the same trigger and deduplication logic as Slack, carry the same policy/target/start/breach context and case link, and go to **every user in your organization** — each as its own individual email (never one message listing every recipient in `To`), so no recipient can see who else was alerted. There is currently no per-user opt-out or preference and no way to route email differently from Slack.

**Configuring it:** from Settings → Integrations → Notifications, enter your SMTP host, port, security mode (None/STARTTLS/SSL-TLS), username, password, and from-address. Use **Test Connection** to check authentication and **Send Test Email** to confirm delivery before saving — each organization brings its own SMTP server, there is no shared deployment-level fallback. The password is encrypted at rest and never shown again once saved; leave it blank when editing other fields to keep the current one.

---

## 17. Reports and Exports

There are two distinct kinds of CSV export in the product today.

### In-page exports (Dashboard and All Cases)

The **At risk now** table on the dashboard and the **All cases** table both have an **Export CSV** button that downloads exactly what's currently shown in that table (respecting your current search/filter/sort), in the columns visible in that view.

### Full compliance export

The dashboard's **Export Full Report** button generates a complete CSV of **every commitment your organization has**, open and closed, with no date-range or status filter — it always exports the full history. This is the report to use for a QBR or an audit trail.

**Columns, in order:** Customer, Ticket, Zendesk URL, Jira issues, Linear issues, GitHub pull requests, Commitment (First response/Resolution), Status, Target, Elapsed, Breached by, Opened at, Due at, Closed at.

**Where to find it:** the **Export full report** button beside the _SLA Analytics_ heading on the dashboard. The file is built in one pass rather than streamed, so an organization with a very large commitment history may wait a few seconds for the download to start.

### Monthly report

Once a month Elapsed sends a report for the **previous calendar month** (in your organization's time zone).

- **By email:** to every member of your organization, with the month's data attached as a **CSV**. It uses your organization's email settings, so email must be configured for it to arrive.
- **In Slack:** a message in your connected alert channel, if Slack is connected.
- **Once per month:** each channel gets the report at most once per organization and month. A month with no activity is skipped, and an organization created after the month ended is not sent a report for it.

**Not currently available:** PDF export. Do not expect a formatted, presentation-ready report: exports are CSV only, and the monthly report is an email with a CSV attached.

---

## 18. Filters and Search

| Screen                  | Search           | Filters                                        | Sort                  | Pagination                                     |
| ----------------------- | ---------------- | ---------------------------------------------- | --------------------- | ---------------------------------------------- |
| Dashboard — At risk now | Free-text search | None beyond the fixed "open commitments" scope | Column sort           | Fixed list, capped with an overflow note       |
| All cases               | Free-text search | None beyond what search covers                 | Every column sortable | Adjustable page size (10–100), page navigation |

There is currently no dedicated date-range picker, status filter, customer filter, priority filter, or integration filter as a distinct UI control — the dashboard's period-scoped numbers (breaches, compliance) use a fixed rolling 30-day window, and the Findings screen uses a fixed rolling 90-day window; neither is currently adjustable from the UI.

---

## 19. Configuration

Every setting that exists in the product today, in one place.

| Setting                                                       | Location                                          | What it means                                                                                                                                                   | Default                                         | When to change it                                                         | Effect of changing it                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Zendesk/Jira/Linear/Intercom/GitHub OAuth app credentials** | Settings → Integrations, per provider "Configure" | Your organization's own OAuth Client ID/Secret for that provider — required before that provider can be connected                                               | Not configured                                  | Once, before first connecting that provider                               | Enables the Connect button for that provider                                                                                        |
| **Engineering leg target**                                    | Settings → SLA                                    | An optional, org-wide target (in hours) for how long a case should stay in the engineering leg before it's flagged at-risk/breached _for that leg specifically_ | Not set                                         | If you want visibility into engineering turnaround time as its own metric | Cases exceeding the target show as at-risk/breached in the "Aging in engineering" view; does **not** send its own Slack/email alert |
| **Customer calendar override**                                | Settings → SLA                                    | Pin a specific customer to one of your imported business calendars, instead of whatever their matched policy would otherwise resolve to                         | Uses the calendar from the matched SLA policy   | If one customer's contractual hours differ from your general policy       | Applies to **new** commitments only — commitments already created keep their original calendar                                      |
| **SLA policy target override**                                | Settings → SLA                                    | Override the imported minutes for a first-response or resolution target on a specific policy                                                                    | Uses the value imported from Zendesk            | If the imported value doesn't match your actual contractual target        | Creates a new policy version; existing commitments keep their original target, new commitments use the override                     |
| **Slack alert channel**                                       | Settings → Integrations → Slack                   | Which Slack channel receives at-risk/breach alerts                                                                                                              | None — no alerts sent until a channel is chosen | Once, after connecting Slack                                              | Alerts start posting to the chosen channel                                                                                          |

**Settings that do not exist in the current implementation** (do not look for these — they are not hidden elsewhere): per-policy pause-state configuration (which statuses pause a clock, beyond the fixed defaults above), custom warning-threshold percentages, per-user notification preferences, role-based permissions, and a public API key.

---

## 20. Data Synchronization

| Mechanism                        | Cadence                                                 | What it covers                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Initial backfill**             | Once per integration, at connect time                   | Last 90 days of history from that provider (fixed window)                                                                                              |
| **Active-set poll**              | Every 5 minutes by default                              | Open cases with a live commitment — the working set most likely to need a fresh evaluation                                                             |
| **Reconciliation sweep**         | Every 30 minutes by default (30 minutes is the maximum) | Every case, including closed ones — catches anything a webhook or an active-set poll might have missed                                                 |
| **Webhook (Zendesk, Jira only)** | Real time, on delivery                                  | The single ticket/issue the webhook fired for — re-fetches it, re-evaluates it, and can send an alert within moments, independent of the poll schedule |

**Providers without webhook support** (Intercom, Linear, GitHub) rely entirely on the poll schedule above (Intercom also re-reads conversations changed in the previous 5 minutes on every sync, so a change its search had not indexed yet is not missed) — expect data from those systems to be current as of the last successful 5-minute (or, worst case, 30-minute) sync, not instantaneous.

**When a provider is unavailable:** a failed sync for one integration does not block syncing for any other integration, or for any other organization on the platform. The last successfully synced state is kept, the failure is recorded, and the next scheduled sync attempt tries again automatically. If the failure is caused by an expired or revoked connection rather than a transient error, the integration is marked **"Needs reconnect"** and stays in that state until you reconnect it — it will not silently keep retrying a connection that requires your action.

**When records are updated later** (e.g. a ticket's priority changes after the fact, or a status is corrected): the next sync picks up the change as a new event on the timeline and the engine recomputes forward from there. Because computed numbers are never stored as a mutable counter, correcting an underlying event's timing is reflected the next time the affected commitment is evaluated.

**Realistic expectation:** this product does not promise real-time monitoring by default. It promises data that is, at most, one reconciliation cycle old (30 minutes, by default and at most) for anything not covered by a webhook, and typically much fresher (5 minutes or less) for anything currently open. Zendesk and Jira additionally benefit from webhook-driven updates when configured.

---

### Data freshness

Elapsed records when each integration last synced successfully. An integration is treated as **stale** once that is older than **three times its expected sync interval** (so about 15 minutes with the default 5-minute active polling), or if it has never synced. Staleness never changes how SLA time is calculated; it labels the data so you know how far to trust it.

- **Where you see it:** a banner on the dashboard and on affected cases ("Data stale since …"), the case detail page, and the integration's status in Settings → Integrations, each with the time it went stale.
- **Alerts:** at-risk alerts carry a stale-data marker and breach alerts are held until the data is fresh (see [Section 16](#16-notifications)).
- **What to do:** check the integration's status for a reconnect or permission prompt (see Troubleshooting → Integration needs reauthentication).

## 21. Data Accuracy and Limitations

This product's entire value depends on its numbers being trustworthy — so this section says plainly where the numbers can be incomplete, approximate, or simply not produced yet.

- **Unlinked escalations have no engineering leg.** If a case can't be correlated to an engineering-tracker record with certainty, it is reported as unlinked — never guessed at, and never silently attributed to `engineering`. Its "escalated" status and any engineering-leg timing is simply absent, not estimated.
- **The pause rule is fixed, not customer-tunable.** Zendesk-imported policies do not pause Resolution on Pending (matching Zendesk). Policies created in Elapsed pause Resolution on "Pending customer" only. If your workflow uses another status for customer-caused waiting and expects it to pause the clock, it will not. An Intercom ticket set to "Waiting on customer" counts as "Pending customer" (the conversation itself stays open, so this is read from the ticket's own state); snoozing a conversation does not pause.
- **Warning thresholds are fixed at 50/80/95% of target** for every policy; they are not currently adjustable per policy or per customer from the UI.
- **Customer/case tier is not currently populated.** Neither the Zendesk nor Intercom integration currently writes a tier value onto a customer or case, even though the underlying policy-matching engine supports tier-based rules. If your SLA policies are meant to differ by account tier, that distinction is not currently applied automatically — until tier data is populated, tier-based policy conditions have no effect.
- **A closed ticket's reopen behavior is intentional, not a bug.** Reopening a solved ticket resumes the original clock rather than starting a fresh one — see Section 13.
- **Multiple linked engineering issues on one case are combined, not split.** If a case has more than one linked Jira/Linear issue or GitHub pull request open at once, they're all attributed to a single `engineering` leg rather than broken out per issue.
- **A case with no ticket-status events yet shows `unknown`, not a guess.** Newly created or sparse cases may show an `unknown` leg or a lower-confidence timeline span until enough events have been recorded to establish a boundary with certainty.
- **Provider API limitations apply.** Correlation depends entirely on your team using each provider's own native linking feature (Jira remote links, Linear attachments) — a pasted URL in a comment or description is not detected. GitHub's search results are practically bounded by GitHub's own API limits for very high pull-request volumes on a single repository.
- **No manual link-confirmation workflow exists yet.** If a case should be linked but the automatic correlation can't establish it with certainty, there is currently no in-product way to manually confirm or create that link — see [Section 27](#27-product-limitations).
- **Onboarding progress reporting currently covers Zendesk and Jira only.** The live counters on the onboarding screen (tickets, escalations, linked issues) do not currently reflect Intercom, Linear, or GitHub backfill progress — those integrations' status is visible on the Integrations settings page instead, just not on the onboarding progress view.

When the product cannot confidently determine something — a link, a leg boundary, a calendar — it shows that state explicitly (`unknown`, unlinked, or a lower confidence marker) rather than resolving it silently in either direction.

---

## 22. Security and Access

- **Sign-in:** email and password only. Passwords are hashed before storage; sessions use a signed token. There is currently no single sign-on (SSO/SAML) option.
- **Integration authentication:** every data-source integration (Zendesk, Jira, Linear, Intercom, GitHub) uses that provider's own OAuth flow — this product never asks you to paste a personal API token for those five integrations. Slack similarly uses OAuth to obtain a bot token.
- **Read-only access:** Zendesk, Jira, Linear, and Intercom are connected under OAuth scopes that grant read-only access. GitHub is connected through a GitHub App your organization creates with read-only repository permissions (Pull requests: read, Contents: read) and installs only on the repositories you choose. Its token can't write to GitHub, and can't read any repository the App isn't installed on. Connections made before this change used a classic GitHub OAuth App with the broader, write-capable `repo` scope. That scope was never used to write, but if you connected GitHub that way, switch to a GitHub App and reconnect (see the GitHub integration docs).
- **What SLA writes back to your connected systems:** nothing, in every case — Zendesk, Jira, Linear, Intercom, and GitHub are read-only in practice as well as by design. The only two outbound actions this product ever takes are posting a Slack message and sending an alert email — both are notifications about your data, not modifications to your source systems.
- **Organization isolation:** every customer, case, integration, and setting is scoped to your organization; a request for a case that doesn't belong to your organization is treated as not found.
- **Assignee names:** the case header (Section 12) shows the currently-assigned agent's display name, resolved from Zendesk's `assignee_id` or Intercom's `admin_assignee_id`. Only the name is stored — never the provider's internal numeric id — and it is display only: never used for policy matching, routing, scoring, or any calculation. It updates on the next sync after a reassignment; there is no history of past assignees.
- **Credential storage:** Custom REST credentials (API key, token or password) are encrypted at rest, bound to your organization, never returned to the browser, and removed from logs and error reports. OAuth tokens for connected integrations, and the OAuth application credentials you configure for your organization, are stored encrypted. Disconnecting an integration clears its stored credentials.
- **Team members and invitations:** an owner invites a teammate by email from Settings → Members. The invitation is valid for 7 days and can be revoked or resent. The invitee accepts it and joins your organization; they do not get a separate one. Owners can change a member's role and remove members, and an organization always keeps at least one owner.
- **Roles:** there are two, **owner** and **member**. Owners can connect and disconnect integrations, change SLA policies, calendars and the engineering target, edit organization and email settings, manage members and invitations, and manage billing. Members cannot make those changes. There are no roles beyond these two, and no SSO/SAML.
- **Compliance certifications, data residency, and retention policy:** not currently documented in the implementation. If these are requirements for your organization, raise them directly with your account contact rather than assuming a specific answer from this document.

---

## 23. Troubleshooting

### Zendesk won't connect

- **Symptom:** OAuth redirect fails, or you're returned to the connect screen without success.
- **Possible cause:** an incorrect subdomain, or the OAuth application isn't configured for your organization yet.
- **Check:** confirm the subdomain matches exactly what precedes `.zendesk.com` in your Zendesk URL, and that your organization has configured Zendesk OAuth credentials under Settings → Integrations → Zendesk → Configure.
- **Resolution:** re-enter the correct subdomain and retry. If the "Configure" step hasn't been completed, complete it first — you can't connect without it.

### Jira won't connect

- **Symptom:** Atlassian's consent screen doesn't appear, or the connection fails afterward.
- **Possible cause:** Jira OAuth credentials not configured for your organization, or the approving user doesn't have access to a Jira site.
- **Check:** Settings → Integrations → Jira → Configure has valid credentials; the Atlassian account approving the connection has access to the Jira site you intend to connect.
- **Resolution:** complete the Configure step, then retry the connection.

### Jira authorization is pending

- **Symptom:** a Head of Support has connected Zendesk, but Jira approval is waiting on an engineering administrator.
- **What to do in the meantime:** proceed with onboarding on Zendesk alone — findings and first-response/resolution accuracy are available without Jira. Connect Jira later from Settings → Integrations with no loss of Zendesk history.

### No tickets appear

- **Symptom:** the dashboard or cases list is empty after connecting Zendesk.
- **Possible cause:** backfill hasn't completed yet, or there are genuinely no tickets in the last 90 days.
- **Check:** the Integrations → Zendesk detail page's "Sync status" card shows whether a backfill has completed and when it last ran.
- **Resolution:** wait for backfill to complete, or trigger it manually from the "Run backfill" button on that page.

### No Jira issues appear

- **Symptom:** cases never show an engineering leg even though your team escalates to Jira.
- **Possible cause:** Jira isn't connected yet, its backfill hasn't finished, or issues aren't linked using Jira's native remote-link feature.
- **Check:** Integrations → Jira detail page's sync status; confirm your team links issues via Jira's "link" feature (or the official Zendesk-for-Jira app, if in use) rather than pasting URLs into free text.
- **Resolution:** connect Jira if not already connected; if it is connected and synced, review your team's linking habits — a pasted URL is not detected as a link.

### No cases are linked

- **Symptom:** Findings or the dashboard show a low or zero "escalations" number despite genuine escalations happening.
- **Possible cause:** links are being created outside Jira/Linear's native remote-link or attachment feature.
- **Resolution:** see [Section 15](#15-correlation-between-systems) and standardize on the native linking feature going forward — this cannot be fixed retroactively for tickets that were linked by convention rather than by feature.

### Historical data is missing

- **Symptom:** tickets or issues older than 90 days don't appear.
- **Cause:** the backfill window is a fixed 90 days in the current implementation; nothing older is imported.
- **Resolution:** none available today — this is a fixed limit, not a setting.

### SLA numbers look unexpected

- **Symptom:** a commitment's remaining/elapsed time doesn't match your mental math.
- **Check:** open the case detail page and expand "How this was calculated" on the commitment in question — it shows the exact policy version, calendar, and pause rule applied. Most surprises trace back to a business-hours calendar (not 24/7) or the fixed "Pending customer" pause rule not matching your team's actual workflow status.

### A case is showing the wrong state

- **Symptom:** the leg (support/engineering/waiting on customer) doesn't match what you'd expect.
- **Check:** the case detail page's activity timeline for the most recent status event; leg attribution is driven entirely by the last recorded status from your connected systems, not by manual assignment.

### Timeline is incomplete

- **Symptom:** gaps in the case journey or activity timeline.
- **Possible cause:** the case predates when an integration was connected, or a sync hasn't caught up yet.
- **Check:** whether the earliest event shown corresponds to when the relevant integration was first connected and backfilled.

### Slack notifications are not arriving

- **Symptom:** no alerts despite commitments crossing thresholds.
- **Check:** Settings → Integrations → Slack shows a chosen channel; confirm the bot hasn't been removed from that channel in Slack itself.
- **Resolution:** reconnect Slack and re-select a channel if needed.

### Data appears stale

- **Symptom:** a known recent change in Zendesk/Jira hasn't shown up yet.
- **Expected behavior:** allow up to 5 minutes for an active case under normal polling, or up to 30 minutes in the worst case (reconciliation-only), unless a webhook is configured for that provider (Zendesk/Jira only).
- **When it is flagged:** if an integration has not synced successfully for more than three times its expected interval, Elapsed marks its data as stale (see [Data freshness](#data-freshness)).

### Integration needs reauthentication

- **Symptom:** an integration shows "Needs reconnect" on the Integrations page, or a reconnect banner appears elsewhere.
- **Cause:** the stored access/refresh token was rejected or has expired.
- **Resolution:** click the reconnect link/button for that provider and re-approve the OAuth prompt. No history is lost — only the credential is refreshed.

**When to contact support:** if a backfill has been stuck in progress for an extended period, if a connection repeatedly fails "Configure," or if a specific case's calculated number contradicts what's on the disclosure panel (which would indicate a genuine defect rather than an expected limitation described above).

---

## 24. Frequently Asked Questions

**What systems does Elapsed support?**
Zendesk and Intercom as ticket sources; Jira, Linear, and GitHub as engineering-side sources; Slack and email for alerts.

**Is Elapsed read-only?**
Yes, for every connected data source (Zendesk, Jira, Linear, Intercom, GitHub) — it only reads. The only outbound writes anywhere in the product are a Slack message and an alert email. GitHub is connected through a read-only GitHub App (Section 22).

**Does Elapsed modify Zendesk?**
No. No ticket, field, tag, or comment is ever created or changed.

**Does Elapsed modify Jira?**
No. No issue, status, comment, or field is ever created or changed.

**How far back does historical data go?**
90 days from the date each integration was connected. This window is fixed and not currently adjustable.

**How often is data refreshed?**
Every 5 minutes for open cases, every 30 minutes for a full reconciliation sweep, and near-instantly for Zendesk/Jira when a webhook is configured. See [Section 20](#20-data-synchronization).

**How is an SLA calculated?**
As working time elapsed against a target, computed from the recorded event history under a specific policy and calendar version, pausing only where the policy says so: never for Zendesk-imported policies, on the "Pending customer" state for policies created in Elapsed. See [Section 13](#13-sla-calculation).

**What happens when a ticket is escalated?**
The case's leg switches to `engineering` the moment a verified link to an engineering-tracker record is recorded. The customer commitment's clock keeps running — escalation itself does not pause it.

**How does SLA know which Jira issue belongs to a ticket?**
By reading Jira's own remote-link data on that issue and matching a Zendesk URL against your exact connected subdomain. See [Section 15](#15-correlation-between-systems).

**What happens when there is no link?**
The case has no engineering leg. It's excluded from escalation counts and never guessed at.

**What does "At Risk" mean?**
A commitment has consumed enough working time to cross a warning threshold (50/80/95% of target by default) without yet exceeding it.

**What does "Breached" mean?**
A commitment's elapsed working time has exceeded its target.

**Can SLA calculate business hours?**
Yes — calendars imported from Zendesk's business-hours schedules, or a 24/7 always-open calendar, are used to compute working time.

**What happens on holidays?**
A date marked as a holiday on the applicable calendar contributes zero working minutes.

**Can I change an SLA policy?**
You can override a policy's first-response/resolution target minutes from Settings → SLA. This creates a new policy version; existing commitments are unaffected, and only new commitments use the new target. Other parts of a policy (match conditions, pause states, warning thresholds) aren't editable from the UI today.

**What happens when an integration stops working?**
It's marked "Needs reconnect," a banner appears with a one-click fix, other integrations and organizations keep syncing normally, and no history is lost.

**Can multiple users access the same organization?**
Yes. An owner invites teammates by email from Settings → Members. Invited users join the existing organization with the role **member** unless an owner makes them an owner. A user who signs up without an invitation gets a new, separate organization.

**What data does SLA store?**
The raw data returned by each connected system's API, a normalized (provider-independent) version of every event, the customers/cases/commitments derived from it, and point-in-time evaluation snapshots. No data beyond what's described in each integration's section is collected.

**Can SLA calculate service credits?**
No. There is no financial or service-credit calculation anywhere in the product.

**Does SLA use AI?**
No. The one place that might look like it — the "unusual cycle times" dashboard banner — is a statistical comparison (a modified z-score against each customer's own historical median), not a machine-learning or generative model.

---

## 25. Example End-to-End Scenario

**Acme Corp**, a customer on a P1 contract requiring a 1-hour first response and an 8-business-hour resolution, submits a ticket in Zendesk.

1. **Ticket created.** The case is opened, Acme Corp is resolved as the customer (already known from a prior Zendesk organization sync), and two commitments are created — first response and resolution — bound to the matching imported SLA policy and its business-hours calendar.
2. **Support responds within 40 minutes.** The first-response commitment closes **met**.
3. **The ticket is escalated** — an engineer links it to a Jira issue using Jira's native link feature. On the next sync, this is read back as a certain, verified remote link. The case's leg switches from `support` to `engineering`. The resolution commitment keeps running; escalation itself does not pause it.
4. **Engineering works the issue.** Every status change on the Jira issue (e.g. "To Do" → "In Progress" → "In Review") is recorded as a normalized event on the case's timeline.
5. **The case becomes at risk.** As elapsed working time crosses 80% of the 8-hour target, the dashboard shows the case in "At risk now," and — if Slack is connected — a message posts: _"⚠️ Resolution SLA at risk — #4821 for Acme Corp, 80% of target used, 1h 36m remaining."_
6. **The Jira issue is resolved**, and the Zendesk ticket is marked solved, at a total elapsed working time just under the 8-hour target.
7. **The resolution commitment closes met.** The dashboard's compliance number for the period reflects it; the case's SLA status column reads "Met."
8. **The final timeline**, viewed on the case detail page, shows: a short support-leg span at the start, a long engineering-leg span in the middle, the exact Jira status transitions that occurred during it, the "how this was calculated" disclosure naming the exact policy and calendar version used, and a link out to both the original Zendesk ticket and the Jira issue.

That case detail page — timeline, leg breakdown, calculation disclosure, and links to both source records — is the artifact meant to answer, without a verbal explanation, _"what actually happened with this ticket?"_

---

## 26. Glossary

| Term                       | Definition                                                                                                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SLA**                    | Service Level Agreement — a time-bound commitment made to a customer (e.g. respond within 1 hour).                                                                                                                                                             |
| **Commitment**             | One specific obligation on one case (first response or resolution), bound permanently to the policy and calendar version in effect when it was created.                                                                                                        |
| **Case**                   | One customer request, followed across every connected system it touches.                                                                                                                                                                                       |
| **Escalation**             | A case that has been linked to at least one engineering-tracker record (Jira, Linear, or GitHub).                                                                                                                                                              |
| **Engineering leg**        | The period(s) during which a case is owned by the engineering tracker rather than the helpdesk.                                                                                                                                                                |
| **At Risk**                | A commitment has crossed a warning threshold but has not yet exceeded its target.                                                                                                                                                                              |
| **Breached**               | A commitment's elapsed working time has exceeded its target.                                                                                                                                                                                                   |
| **Met**                    | A commitment closed within its target.                                                                                                                                                                                                                         |
| **Working Hours**          | The portion of elapsed time that falls inside a calendar's defined open windows; only this time counts toward a business-hours commitment.                                                                                                                     |
| **Business Calendar**      | A named set of weekly working windows, a timezone, and holidays (or an always-open 24/7 calendar), imported from Zendesk or applied by default.                                                                                                                |
| **Pause**                  | A period during which a commitment's clock is not counting, triggered by the "Pending customer" normalized state under policies created in Elapsed, and by a solved ticket (until reopened) for Resolution. Zendesk-imported policies do not pause on Pending. |
| **Correlation**            | The process of matching a case to a record in another connected system (e.g. a Zendesk ticket to a Jira issue), using only verifiable, deterministic evidence.                                                                                                 |
| **Backfill**               | The one-time import of the last 90 days of history from a newly connected integration.                                                                                                                                                                         |
| **Synchronization (sync)** | The ongoing process of polling connected systems for changes and updating cases, commitments, and evaluations accordingly.                                                                                                                                     |
| **Timeline**               | The ordered sequence of every normalized event on a case, across every connected system.                                                                                                                                                                       |
| **Normalized Event**       | A single recorded fact about a case (created, status changed, linked, unlinked, closed), translated from a provider's own data into this product's provider-independent vocabulary.                                                                            |
| **Integration**            | A connection to an external system (Zendesk, Jira, Linear, Intercom, GitHub, or Slack).                                                                                                                                                                        |

---

## 27. Product Limitations

### Currently Supported

- Zendesk and Intercom as ticket sources; Jira, Linear, and GitHub as engineering-leg sources
- Automatic 90-day backfill with live progress reporting
- Deterministic correlation via each provider's native linking feature (never fuzzy-matched)
- Business-hours and 24/7 SLA calculation, with holidays
- First-response and resolution commitment tracking, at-risk/breach detection with fixed warning thresholds
- Engineering-leg (OLA) target as a single org-wide optional number
- Per-customer calendar overrides and per-policy target overrides (both versioned, never retroactive)
- Case timeline with full activity history and "how this was calculated" disclosure
- Statistical cycle-time anomaly detection on the dashboard
- Slack alerts (one channel per organization) and email alerts (deployment-configured)
- CSV export (in-page, and a full compliance report reachable by direct URL) and a monthly report by email and Slack
- Team invitations with owner and member roles
- Plans, a 14-day trial and owner-managed subscriptions (Section 29)
- Data-freshness labelling of stale integrations, with held breach alerts
- Real-time webhooks for Zendesk and Jira, supplementing the poll schedule

### Partially Supported

- **Reports/export:** the full compliance CSV works but has no in-app button linking to it yet.
- **Onboarding progress:** the live counters count tickets from your connected ticket source (Zendesk or Intercom) and escalations and linked issues from Jira or Linear; GitHub backfill status is visible on the Integrations page instead.
- **Tier-based SLA policy matching:** the engine supports it, but no current integration populates a tier value, so it has no practical effect today.
- **Webhooks:** available for Zendesk and Jira only; Intercom, Linear, and GitHub are polling-only.

### Not Supported

- Manual case-link creation or confirmation of a "probable" match (the underlying data model reserves fields for this, but no path in the product creates or exposes it today)
- Per-policy pause-state configuration or custom warning-threshold percentages
- PDF export (exports are CSV; the monthly report is emailed with a CSV attached)
- Single sign-on (SSO/SAML), and roles beyond owner and member
- Paying by card or wallet inside the product (no payment provider is integrated; invoices are direct, see Section 29)
- Financial or service-credit calculations of any kind
- AI-generated summaries, predictions, or recommendations
- A public API

---

## 28. Customer Setup Checklist

### Before setup

- [ ] A Zendesk administrator (or someone who can create an OAuth app) is available
- [ ] A Jira administrator is available, if engineering-leg visibility is in scope
- [ ] Your team agrees on which native linking feature (Jira remote links, Linear attachments) it will use to connect tickets to engineering work going forward
- [ ] You know which Zendesk SLA policies you expect to see imported

### Setup

- [ ] Create your account (organization name, work email, password)
- [ ] Configure Zendesk OAuth credentials, then connect Zendesk
- [ ] Configure Jira OAuth credentials, then connect Jira (can be done later without losing progress)
- [ ] Wait for the 90-day backfill to complete (progress shown live)
- [ ] Review the Findings screen
- [ ] Review imported SLA policies and business calendars under Settings → SLA
- [ ] Set an engineering-leg target, if desired
- [ ] Connect Slack and choose an alert channel, if desired
- [ ] Configure SMTP under Settings → Integrations → Notifications if you want email alerts too

### Validation

- [ ] Confirm your customer list under Settings → SLA → Customer calendars matches your actual accounts
- [ ] Confirm ticket counts on the Findings/dashboard screens look plausible against your own Zendesk view
- [ ] Open a known escalated ticket and confirm it shows a Jira/Linear/GitHub link on its case detail page
- [ ] Confirm imported SLA policy targets match your actual contractual commitments (override any that don't)
- [ ] Open one case and read through its full timeline and "how this was calculated" disclosure
- [ ] Trigger a test scenario (or wait for a real one) and confirm a Slack alert arrives

### Ready for monitoring

- [ ] Zendesk connected and backfilled
- [ ] Jira (and Linear/GitHub/Intercom, if used) connected and backfilled
- [ ] SLA policies and calendars reviewed and corrected where needed
- [ ] Slack channel selected (and/or email confirmed with your account contact)
- [ ] Dashboard reviewed by whoever owns the SLA number day to day

---

## 29. Plans, Trial and Billing

**Plans.** Pricing is flat, monthly and in US dollars. Seats never change the price.

| Plan | Price | Seats | Integrations | Native SLA policies |
|---|---|---|---|---|
| Starter | $49 / month | 5 | 1 support and 1 engineering | 3 |
| Team | $149 / month | 20 | Unlimited | Unlimited |
| Enterprise | Custom (talk to us) | Unlimited | Unlimited | Unlimited |

- **Imported policies do not count** toward the policy limit; only policies you create in Elapsed do.
- **Trial.** Every new organization starts with a 14-day trial.
- **Limits are warnings.** Going over a plan's seat, integration or native-policy limit shows a warning with how to upgrade. It does not stop monitoring, alerts or access to your history.
- **After a trial ends.** Cases, SLA monitoring, alerts, the dashboard and your history keep working, and the owner is emailed. Adding new members, integrations or native policies is blocked until you subscribe. This applies when plan enforcement is switched on for your deployment.
- **Who can change the plan.** Only an organization owner can subscribe, change plans, change seats or cancel, from the Pricing page (which leads to Review & Subscribe) or the Billing page. Members can see the current plan and entitlements and read invoices.
- **How changes take effect.** An upgrade applies immediately and is invoiced pro rata. A downgrade is scheduled for the end of the billing period and can be withdrawn before then. Cancellation takes effect at the end of the period and can be resumed until then. Enterprise is arranged with us, not self-served.
- **Payment.** Invoices are issued directly, due in 14 days, and an operator records them as paid. Paying by card or wallet inside the product is not available yet, and invoice PDFs and invoice emails are not available yet.
