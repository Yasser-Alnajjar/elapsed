# 03 — Product Definition, MVP, Workflow & Pricing

**Phases 7–11 and 18, plus 10b (scale). Reconciled with the built codebase on 2026-09-29.**

---

# Phase 7 — Product Reframing

## Judging the proposed positioning

| Candidate                                         | Verdict                                                                                                                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _"Don't miss your SLA."_                          | **Dead.** Every helpdesk says this and most do it adequately. Competing here means being compared on a feature the incumbent gives away.                                                            |
| _"Know why your SLA was breached."_               | **Weak.** Retrospective and low-frequency. It sells a post-mortem, and post-mortems get budget once.                                                                                                |
| _"Track, explain, and prove every SLA breach."_   | **Weak and politically loaded.** "Prove" points a finger; see Phase 8. It also anchors on breaches — an event you want to be rare — which means the product's perceived value falls as it succeeds. |
| _"The system of record for service commitments."_ | **Weakest.** Category-creation language written for an investor, not a buyer. No Head of Support has ever gone looking for one.                                                                     |

All four share a flaw: they lead with **SLA**, a word the buyer associates with a feature they already own.

## Recommended positioning

Lead with the moment of pain instead — the escalation — and let SLA be the consequence.

- **Product category:** Support escalation visibility. Sits in the support-operations tooling budget, next to QA and CSAT tools. _Do not invent a category._ A solo founder cannot afford to teach the market a new noun.

- **Core problem:** When a ticket is escalated to engineering, the customer's clock keeps running but support's visibility stops.

- **Core promise:** One honest clock that survives the handoff, and sight of the leg you cannot currently see.

- **One-line value proposition:** _Escalated tickets stop being a black box — and your SLA numbers start being true._

- **Homepage headline:**

  > **Your SLA clock doesn't stop when the ticket leaves Zendesk.**

  This works because it is a **verifiable factual claim about the buyer's own system** — Zendesk's First Reply, Next Reply, Periodic Update and Total Resolution targets genuinely do not pause in Pending status. The reader either already knows and feels seen, or does not know and immediately needs to check. Either reaction gets the next click.

- **Subheadline:**

  > See every escalated ticket across Zendesk and Jira on one clock. Know which customer commitments are at risk while there's still time to act — and where the hours actually went when there wasn't.

- **Three key benefits:**
  1. **No more blind escalations.** Every ticket in engineering's queue, shown against the customer's remaining time, not Jira's.
  2. **SLA numbers you can defend.** One elapsed-time calculation that reconciles both systems' pause rules and calendars, instead of two systems producing two answers for the same case.
  3. **The monthly report, already written.** Escalation performance by team, by customer, by tier — instead of four hours in a spreadsheet before every QBR.

- **Differentiation statement:**
  > Zendesk sees its half. Jira sees its half. Neither is built to tell you the truth about the whole, because neither is neutral. We are the only system whose job is the handoff itself.

---

# Phase 8 — Evidence & Attribution Validation

## Who would actually use it, and how often

| Audience              | Would they use it?        | Frequency    | Honest read                                                                                                          |
| --------------------- | ------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Support leadership    | Yes                       | Weekly       | The real user. Uses it to explain, not accuse.                                                                       |
| Management / exec     | Yes                       | Monthly      | Wants the aggregate, not the case file                                                                               |
| Account managers / CS | Yes                       | Per incident | Highest emotional value — walking into a call already knowing                                                        |
| Customers             | **Rarely, and carefully** | 2–6×/yr      | Sending a customer a document proving you breached by 32 minutes is a decision most companies will not make          |
| Compliance / Legal    | **No**                    | —            | No regulatory driver exists in this segment. Legal's instinct is to _prevent_ the record's creation, not consume it. |
| Contract management   | No                        | —            | Different market, different systems                                                                                  |

The honest conclusion: **evidence is used internally, weekly, to explain — and externally, rarely, under legal caution.**

## The critical question: is "prove who caused the breach" strong or dangerous?

**Dangerous, and the danger is structural rather than presentational.**

The product needs a Jira API token. That token is controlled by engineering. The product's stated purpose is to generate evidence that engineering caused the delay. A VP Engineering asked to authorise this has every reason to decline, and the decline is invisible to you — it surfaces as a deal that "went quiet during setup."

There is a second failure mode past installation. A tool used as an internal weapon gets gamed: statuses get changed to stop clocks, work moves out of Jira, tickets get closed and reopened. The measurement corrupts the thing it measures, and the data — the only asset that compounds — degrades.

**Use neutral language, without exception:**

| Never                             | Always                                    |
| --------------------------------- | ----------------------------------------- |
| "Prove who caused the breach"     | "See where the time went"                 |
| "Root cause: Engineering"         | "Longest leg: engineering queue — 2h 17m" |
| "Delay attribution"               | "Time by stage"                           |
| "Engineering breached its OLA"    | "Engineering leg exceeded its 2h target"  |
| "Blame" / "fault" / "responsible" | "Contributing" / "elapsed" / "leg"        |

And design a first-run view for engineering that shows _their_ benefit: which escalations are ageing in their queue, which have customer commitments expiring soonest, which are misrouted. Give the blocker a reason to say yes.

## Verdict on Evidence

**Supporting feature in the MVP — not the core product, not premium, not skipped.**

- **Not core**, because it fires too rarely to justify a subscription and its framing is what makes engineering block the install.
- **Not premium**, because gating it behind a higher tier prevents the moment that creates loyalty — the first time a support lead walks into an exec review with a timeline instead of an apology.
- **Not skipped**, because it costs almost nothing: once you have a normalised event store and a working clock, the timeline is a rendering of data you already hold. It is the cheapest differentiation available.

Build it as a **rendered timeline on the case detail page**. Do not build dispute packs, PDF exports, customer-facing portals or e-signature workflows until a paying customer asks twice.

---

# Phase 9 — Financial Impact

## Recommendation: exclude from the MVP entirely, with one narrow exception.

The original concept proposes computing potential service credits ("ACME, $20,000/month contract, P1 breach → $2,000 credit"). This should not ship.

**Why:**

1. **The number is small and rarely realised.** Verified: credits are typically capped at a low percentage of monthly fee, defined as the customer's _sole and exclusive remedy_, and must be claimed in writing within a short window. ROI built on "credits avoided" is built on money that mostly never moves.

2. **Contract interpretation is not computable.** Whether a given breach triggers a credit depends on exclusions, maintenance windows, force majeure, customer-caused delay, aggregation rules, and monthly caps that interact across incidents. Every contract is different. A rules engine that gets this 90% right is worse than no engine, because the 10% arrives in front of a customer.

3. **It manufactures discoverable liability.** A dashboard reading "Q3 potential service credits: $47,000" is a document that exists on the vendor's own systems, is timestamped, and is discoverable. Legal will say no, and legal will be right.

4. **One wrong number ends the relationship.** Operational estimates get corrected. Financial estimates get escalated to a CFO, and the tool never recovers.

5. **It is the wrong buyer.** Finance does not buy support tooling. Adding a financial module lengthens the sale and adds an approver without adding a champion.

**This is a product-risk assessment, not legal advice.** Anyone who ships credit calculation should have a lawyer review the liability position and the terms of service first — particularly around disclaiming reliance.

## The narrow exception

Allow an optional, manually entered **account value or tier** on each customer, used for **prioritisation and sorting only**:

> _"3 commitments at risk on accounts you've marked Tier 1."_

That is enough to make the dashboard rank by what matters, costs nothing, invents nothing, and states no financial conclusion. Nothing is calculated, multiplied, or labelled as a credit, penalty, or exposure.

**Revisit financial features only after** 10+ paying customers, real contract corpus in hand, and a customer explicitly asking — at which point it is a paid professional-services conversation, not a feature.

---

# Phase 10 — MVP Definition

Constraint: solo/small team, no enterprise sales, limited budget, needs validation fast. Everything below is judged against one question — _does this help prove customers will pay?_

> **Status as of 2026-09-29.** This phase was written as a spec before any code existed. The product ("Elapsed") is now built, and the codebase has diverged from the spec in both directions: it built several items the spec put in SHOULD/NICE, and it deliberately dropped or deferred a few MUSTs. The tables below carry a **Built** column and the divergences are called out in [10.3](#103-where-the-code-diverged-from-the-original-spec). The living build record is [`implementation-plans/ROADMAP_Product.md`](../implementation-plans/ROADMAP_Product.md); this document owns the product _decisions_, the roadmap owns the task status.

## 10.1 The reframe that shrinks the build (still holds)

In this wedge there are only **two legs**: the ticket is either with support (in the helpdesk) or with engineering (in the tracker). Which leg owns it is not something the user configures — **it is directly observable from which system the work is in and what state it is in.**

That collapses three of the heaviest items in the original scope:

- **Team mapping** → unnecessary. Two legs, inferred.
- **OLA policy configuration** → unnecessary. The engineering leg's duration is measured automatically; a target is one optional number, not a policy engine.
- **Handoff detection** → unnecessary. The handoff is the moment the linked issue is created or the ticket enters the escalated state. It is an event, not an inference.

The OLA differentiator survives; the OLA _configuration surface_ disappears. This is the single largest scope reduction available and it costs nothing. The code confirms it: `LegKind` is `support | engineering | waiting_customer | unknown`, with a `LegConfidence` of `certain | inferred | unknown`, and the one leg setting is `engineeringLegTarget` on the organization.

## 10.2 Scope, with what is actually built

Legend: ✅ built · 🟡 built, Beta / partial · ⬜ not built · ⛔ deliberately not built

### MUST HAVE

| Feature                                                                        | Built | Where it stands now                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zendesk integration (read-only OAuth)                                          | ✅    | OAuth, backfill, webhook receiver, token lifecycle with `reauth_required` and `permission_denied` states. Customers bring their own OAuth app (Settings → Integrations).                                                                                     |
| Jira integration (read-only OAuth)                                             | ✅    | OAuth, backfill, webhook receiver, remote-link correlation.                                                                                                                                                                                                   |
| **Historical backfill**                                                        | ✅    | Runs on connect. Depth is provider-driven; the 60–90 day target is not yet a documented, tested guarantee (see the scale section).                                                                                                                            |
| Deterministic case correlation via the official Zendesk↔Jira link              | ✅    | `CaseLinkMethod` is `official_link / remote_link / pattern / manual`, with `certain / probable` confidence. Unlinked cases are surfaced (`unlinkedAt`, "unmatched cases" on the dashboard) rather than guessed at. The "we could link 61%" honesty rule is kept. |
| Normalised event store (raw + normalised, separate)                            | ✅    | `RawEvent` (append-only, replayable, never read by the engine) and `NormalizedEvent` with a per-source sequence.                                                                                                                                              |
| SLA engine: first response, resolution, business hours, holidays, pause states | ✅    | `@sla/core` is pure and DST-aware. Built beyond spec: **Next Reply cycles** as a third commitment kind, versioned calendars and holiday definitions, reopen handling. Decisions D1–D7 in the roadmap pin the edge cases; seven golden scenarios gate CI.        |
| Leg timing (support leg / engineering leg elapsed)                             | ✅    | `LegSpan` per case, config-free.                                                                                                                                                                                                                              |
| At-risk and breach detection with warning thresholds                           | ✅    | Persisted `Commitment.status` + append-only `Evaluation` history; `breachedAt` is immutable (a breach is final — D2).                                                                                                                                         |
| One dashboard: at-risk now, breached this period, escalations by age           | ✅    | Health by commitment kind, at-risk page, anomaly detection, analytics. **Snapshot-based**, so it is up to one poll interval old and labelled "as of" — not real-time.                                                                                        |
| Case detail page with rendered timeline                                        | ✅    | Conversation, activity timeline, and commitment cards that explain target, matched policy, calendar and change history. Neutral language enforced.                                                                                                           |
| Slack notifications                                                            | ✅    | Deduplicated per commitment and threshold; alerts link back to the case.                                                                                                                                                                                      |
| CSV export                                                                     | ✅    | Cases export (`/api/cases/export`) and commitments report (`/api/reports/commitments`), keyset-paginated, CSV and JSON.                                                                                                                                       |
| Org + multi-user auth                                                          | ✅    | Email + password, email verification, password reset, session revocation, invitations, owner/member roles. **No OAuth/SSO sign-in.** Sign-up creates its own organization.                                                                                    |
| Customers auto-derived from Zendesk organizations                              | ✅    | Never typed in. Optional `tier` field exists on `Customer` for sorting only; it has **no data source yet** (roadmap E-15).                                                                                                                                    |

### SHOULD HAVE

| Feature                            | Built | Note                                                                                                                                   |
| ---------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Linear integration                 | 🟡    | Built, polling only, Beta.                                                                                                             |
| Optional engineering-leg target    | ✅    | One number per organization (`engineeringLegTarget`).                                                                                  |
| Email notifications                | ✅    | Per-org SMTP (`OrganizationEmailSettings`) for alerts; a separate deployment-level SMTP (`DEPLOYMENT_SMTP_*`) for invites, resets and verification. |
| SLA policy override UI             | ✅    | Went further than the spec: imported Zendesk policies are read-only (target overrides only) and **native policies** can be created, edited, versioned and deactivated. Imported policies match first, by Zendesk position (D12). |
| Webhooks for real-time freshness   | 🟡    | Zendesk and Jira only. Intercom, Linear and GitHub poll.                                                                                |
| Scheduled monthly PDF report       | ⬜    | Not built. CSV/JSON export only. Still the strongest retention feature not yet shipped.                                                |

### NICE TO HAVE — built early

The spec said "only if pulled by customers". These were built ahead of any customer pull, and each is a permanent maintenance tax (see the "6+ integrations" row below):

| Feature                          | Built | Note                                                                                              |
| -------------------------------- | ----- | ------------------------------------------------------------------------------------------------- |
| Intercom as a ticket source      | 🟡    | Beta, polling only, no engineering links yet. Decided D9: Beta; native policies give it commitments. |
| GitHub (pull requests) as an engineering source | 🟡 | Beta. Read-only GitHub App. Not an SLA source.                                                    |
| Custom business calendars per customer | ✅ | `customerCalendarOverride`, versioned calendars.                                                  |
| Operator monitoring view         | ✅    | Platform-operator-only worker settings and diagnostics (`PLATFORM_ADMIN_EMAILS`).                  |
| Concierge analysis tool          | ✅    | `apps/concierge` — offline CSV analysis for the validation motion in [05](05-Validation-and-Kill-Criteria.md). |
| Public API · SSO/SAML · anomaly detection on cycle times | ⬜ / 🟡 | API and SSO parked in `ignored.md`. A bounded-lookback cycle-time anomaly view exists. |

### DO NOT BUILD — and what happened

| Item                                                               | Held? | Why it stays out                                                                                                                                                                   |
| ------------------------------------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Financial / service-credit calculation**                         | ✅    | Phase 9. Liability with no upside. Confirmed out of scope in the roadmap.                                                                                                          |
| **AI anything**                                                    | ✅    | No question in this product needs a model. The value is correct arithmetic.                                                                                                        |
| **Team mapping / org chart / role config**                         | ✅    | Two legs, inferred. Roles are exactly `owner` and `member`.                                                                                                                        |
| **OLA policy builder**                                             | ✅    | One optional number.                                                                                                                                                               |
| **Configurable rules/workflow engine**                             | ✅    | Native policies take priority and customer checkboxes only — no conditions builder.                                                                                                |
| **Customer-facing portal or shared reports**                       | ✅    | Not built.                                                                                                                                                                         |
| **Escalation _actions_** (write-back)                              | ✅    | Every provider connection is read-only. This remains the most valuable line in the product.                                                                                        |
| **Generic connector framework / plugin SDK**                       | 🟡    | No SDK, but the five adapters (`zendesk`, `jira`, `linear`, `intercom`, `github`) have grown near-duplicate normalisation, backfill and token-lifecycle code. Folding the duplicated mappers is on the platform backlog. |
| **Mobile app, browser extension, on-prem**                         | 🟡    | No mobile or extension. Self-hosting via Docker Compose exists and is documented, which is a step toward on-prem by another name.                                                  |
| **6+ integrations**                                                | ⛔    | **Not held.** Five integrations plus Slack and email. The spec's "two, done properly" was overtaken; the mitigation is the Beta label and the Phase 8/9 backlog gate below.        |

## 10.3 Where the code diverged from the original spec

Decisions worth re-confirming, because each one changes the cost of running the business:

1. **Five integrations instead of two.** Intercom, Linear and GitHub are labelled Beta and polling-only. Recommendation: **freeze them** — no new provider work until a paying customer needs it, and do not let Beta providers count toward the pricing tiers' limits or support promises.
2. **Native policies and calendars.** More than the spec's "imported first, editable second", and necessary for Intercom (which has no SLA policies to import). It adds a precedence problem (D12) that the engine has to keep deterministic. Keep.
3. **Next Reply as a third commitment.** Not in the original MUST list; it is a real Zendesk SLA metric, and buyers will ask.
4. **Self-hosted-first deployment.** The stack ships as Docker Compose with Postgres, Nginx, one web container and one worker, plus a documented runbook. This is a hosting decision the spec never made; see [scale](#phase-10b--scale) for what it constrains.
5. **Sign-up is a real account flow** (verification email, terms acceptance), not just "email + password". Correct for a product that stores customer ticket data.
6. **Validation was not gated.** The spec's kill-criteria logic ([05](05-Validation-and-Kill-Criteria.md), roadmap decision D11) said to build only after the validation results. The product was built first; 0 of 40 outreach messages had been recorded at last check. The build is now the sunk cost, so validation matters more, not less.

## 10.4 Verdict on each item the brief lists

| Item                    | Verdict                                                                            | Built |
| ----------------------- | ---------------------------------------------------------------------------------- | ----- |
| Organizations           | MUST — minimal, one per sign-up                                                    | ✅    |
| Users                   | MUST — `owner` / `member` only                                                     | ✅    |
| Customers               | MUST — **auto-derived**, never manually entered                                    | ✅    |
| Integrations            | MUST — Zendesk + Jira. Intercom, Linear, GitHub are Beta                           | 🟡    |
| SLA policies            | MUST — imported from Zendesk first, native and overrides second                    | ✅    |
| OLA policies            | **DO NOT BUILD** as a policy system; one optional target per org                   | ✅    |
| Team mapping            | **DO NOT BUILD**                                                                   | ✅    |
| Event ingestion         | MUST                                                                               | ✅    |
| Timeline reconstruction | MUST                                                                               | ✅    |
| SLA engine              | MUST                                                                               | ✅    |
| OLA engine              | MUST, reduced form (leg durations)                                                 | ✅    |
| Breach detection        | MUST                                                                               | ✅    |
| Evidence timeline       | MUST — as a page, not a document product                                           | ✅    |
| Dashboard               | MUST — snapshot-based                                                              | ✅    |
| Notifications           | MUST                                                                               | ✅    |
| Slack                   | MUST                                                                               | ✅    |
| Email                   | SHOULD                                                                             | ✅    |
| Reports                 | CSV MUST ✅ · PDF SHOULD ⬜                                                        | 🟡    |
| Financial calculations  | **DO NOT BUILD**                                                                   | ✅    |
| AI                      | **DO NOT BUILD**                                                                   | ✅    |

**Original estimate:** 6–9 weeks for one competent full-stack developer. **Actual:** the roadmap plans about 24 weeks plus buffer at 10–15 h/week, and the pause/calendar arithmetic and backfill were the long poles, as predicted. The spec's estimate was for the two-integration MVP; the extra three providers, policy management, roles and hardening are what the rest went on.

## 10.5 What is left before the first real customer

From the roadmap's Launch Gate (Phase 7, 7 of 12 tasks done at last update). Product-level blockers only:

- Final performance re-baseline to close 7.7, and documented **capacity limits** (Launch Gate item; see next section).
- Data retention and deletion answers, and an on-call note (7.11).
- A lint step (7.10 — blocked on a TypeScript 7 / typescript-eslint incompatibility).
- A live Zendesk sandbox walkthrough of onboarding (6.8), and Sentry source-map verification (7.6).
- **Not in the roadmap, but required by this document:** a scheduled monthly report, and the Jira-pending partial-value mode from Phase 11.

---

# Phase 10b — Scale

The original document had no scale section: an MVP for 12–20 customers does not need one. The product now has enough architecture that "what breaks first" is a real question, and the pricing tiers (up to 2,500 escalations a month) make implicit capacity promises. This section records what is measured, what is inferred, and the order to fix things in. **Numbers marked _measured_ come from the roadmap's 7.7 work; everything marked _estimate_ is extrapolation and must be re-measured before it goes in a sales conversation.**

## What the system is today

| Layer         | Shape                                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web           | One Next.js container. Rate limiting is per-instance, so the web tier is **not yet safe to run as multiple instances** (roadmap R-7).                        |
| Worker        | **Exactly one active instance for the whole deployment**, enforced by a Postgres advisory lock; a second instance sits in standby. It polls **every organization on two shared timers**: an active-set poll (default 5 min) and a full reconciliation sweep (default 1 hour). |
| Database      | One Postgres. An organization-level SLA lock (`withOrganizationSlaLock`) serialises evaluation work per organization.                                       |
| Data          | Multi-tenant by `organizationId`, covered by a real-Postgres tenant-isolation test suite. Raw events are append-only and never pruned.                       |
| Freshness     | Zendesk and Jira via webhook plus poll; Intercom, Linear and GitHub poll only. Dashboards read persisted snapshots, so they lag by up to one poll.           |

## Measured (roadmap 7.7)

Dataset: one organization, **5,000 cases, ~210,000 normalised events, ~10,000 commitments**, seeded with `pnpm db:seed:perf-baseline`.

| Path                                | Result                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Case list, at-risk, case detail     | Rewritten to snapshot reads with server-side pagination; at-risk live-evaluates only the visible page. Earlier pass: case list ~1.3 s, at-risk ~0.6 s, case detail ~0.25 s. **A post-rewrite web re-baseline has not been recorded.** |
| Dashboard                           | ~2.1 s and 19 queries at the earlier pass; the analytics charts are now SQL aggregations, but the number has not been re-measured.                    |
| Worker reconciliation sweep         | Queries per stage dropped roughly 500× (batched reads and writes). Next-reply stage 3.3 s → 1.3 s, evaluate 4.0 s → 2.9 s. **Whole-org lock hold: ~4.5 s.** |
| Worker active poll                  | Barely narrower than the sweep on this seed, because ~80% of the seeded cases are open. Real datasets are usually far less open, so this is a worst case. |

Load-bearing finding: the dominant remaining cost is **loading and evaluating every event of every active commitment**, not query count. That cost is linear in open cases, per organization, per tick.

## Estimates (not measured)

- **Tick time is roughly the sum across organizations.** One worker processes tenants serially, so if a typical customer at the Starter/Growth bands is a small fraction of the 5,000-case seed, tens of customers fit comfortably inside a 5-minute poll. The limit is not "N customers" but **total open cases across all customers ÷ evaluation throughput**. At the measured ~4.5 s per 5,000-case organization sweep, a worker has room for a few hundred such organizations per hour, before counting provider API time — which the measurements above do not include and which is likely to be the real ceiling (Zendesk and Jira rate limits, per-customer OAuth apps).
- **The 2,500 escalations/month Scale-tier ceiling** is well inside the measured single-organization load. The tiers are not the constraint; total tenant count and provider rate limits are.
- **Storage** grows without bound: `RawEvent` is append-only and retained for replay. ~42 events per case at the seed's ratio means 100k cases ≈ 4M+ normalised events plus the raw rows behind them. This needs a retention policy before it needs sharding (roadmap 7.11 already owes a retention answer).

## Known scale limits, in the order they will bite

| #   | Limit                                                                                 | Symptom                                                                 | When it matters                              | Fix                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Single worker, all tenants on one timer                                               | A slow or large tenant delays everyone's alerts; one stall stops all    | First large customer, or ~dozens of tenants  | Bound per-tenant work per tick and add fairness (round-robin, per-org time budget) **before** adding workers.                                    |
| 2   | Provider rate limits, especially customer-owned OAuth apps                            | Backfill of a large Zendesk instance takes hours; polls back off        | First customer with >50k tickets             | Already partly mitigated by `http-retry`. Add a resumable, rate-aware backfill and stream findings as they compute (Phase 11's promise).          |
| 3   | Evaluation loads every event of every active commitment                               | Sweep time linear in open cases; org lock held for seconds              | Orgs above ~5k open cases                    | Evaluate only commitments whose events or policy changed since last tick (recorded in 7.7 as a deferred, riskier follow-up).                      |
| 4   | Org-level SLA lock held for the whole tick                                           | Webhook handlers for that org queue behind the sweep                    | Same customers as #3                         | Webhook path is already scoped to touched cases. Shorten the sweep's lock to per-chunk.                                                            |
| 5   | Web tier is single-instance (per-instance rate limiting, in-process state)           | No horizontal scale, no zero-downtime deploys                           | Sustained traffic or an availability promise | Move rate limiting to Postgres or Redis (R-7), then run 2+ web instances behind Nginx.                                                            |
| 6   | Unbounded `RawEvent` / `NormalizedEvent` / `Evaluation` growth                       | Slow analytics, large backups, slow restores                            | Months after the first large customer        | Retention policy, partitioning `Evaluation` and `RawEvent` by time, archiving raw events past the replay horizon.                                 |
| 7   | Secret-encryption keys cannot rotate without downtime (S-7)                           | A leaked key means a maintenance window                                 | First security questionnaire                 | Dual-key read during rotation.                                                                                                                   |
| 8   | Postgres is the queue, lock manager and store                                         | Contention between the worker, webhooks and analytics                   | Well beyond the above                        | Read replica for analytics first. A real queue is a last resort; do not add one in advance.                                                       |

## Scale principles

1. **Snapshots for reading, live evaluation for looking.** Only the visible at-risk page and the open case evaluate live. Every list, chart and alert reads persisted status. Do not regress this.
2. **Bound the work per tick, then parallelise.** Adding workers to unbounded per-tenant work only moves the stall. The advisory-lock design is the right default until #1 is fixed; the roadmap explicitly lists horizontal worker scaling as out of scope.
3. **Never hard-stop monitoring for a tenant over its tier.** Soft overage only (Phase 18). A tenant that is silently paused mid-incident churns.
4. **Measure before indexing.** The 7.7 work added no indexes because `EXPLAIN ANALYZE` showed nothing to justify one. Keep that discipline.
5. **The engine stays pure.** `@sla/core` has no I/O and no clock. That is what makes correctness testable and the golden scenarios cheap; do not let scale work leak database concerns into it.
6. **Scale the business before the system.** A customer count that a single worker cannot carry is a good problem. Do not build fairness queues or replicas for customers who do not exist yet — build the measurement (step 3 below) and let it tell you.

## Scale work, in order

1. **Close 7.7**: re-run `perf:baseline` for the web surfaces after the Phase 2 rewrite and the worker after Phase 3, and record the table above with real numbers instead of two eras of mixed ones.
2. **Write the capacity limits down** (a Launch Gate item): a tested statement of open cases per organization and organizations per worker, from a multi-organization run rather than one seeded org.
3. **Add a per-organization time budget and a tick-duration metric** to the worker, surfaced in the operator monitoring view. This is the early-warning system for limit #1.
4. **Retention and deletion policy** (7.11): what is kept, for how long, and how a customer's data is removed on disconnect or deletion.
5. **Resumable backfill with live counts**, which serves both scale (#2) and the onboarding promise in Phase 11.
6. **Tighter evaluation scope** (limit #3), once real datasets show the open ratio is not the ~80% of the seed.
7. **Multi-instance web** (limit #5), only when there is a traffic or availability reason.

Everything below step 3 is triggered by a number, not a date. If the operator view shows the poll finishing in under half its interval with headroom for backfills, do nothing.

---


# Phase 11 — Core Customer Workflow

> **Status as of 2026-09-29.** The redesigned flow below is mostly built. Onboarding modules exist for the flow, a policy-review step (`review-policies`) and an activation step. Sign-up is email + password with email verification and terms acceptance; each sign-up creates its own organization. Slack and email alerts are configured after first value, as designed. **Not verified end to end:** the live Zendesk sandbox walkthrough (roadmap 6.8) is still an owner-only manual step, so "under 15 minutes, unattended, on a real dataset" is a target, not a measured result. **Not built:** the partial-value-from-Zendesk-alone mode while Jira approval is pending, the shareable "request access" link for the Jira admin, and the one-page forwardable security summary. Those three are the mitigations for the friction ranked first below, so they are the highest-value onboarding work left.

## The proposed 13-step workflow is wrong

Steps 1–7 of the original workflow (create org → connect → import → detect customers → configure SLA → configure OLA → map teams) place **three configuration screens between the customer and their first insight.** Every one is a place to abandon. A solo founder cannot afford an onboarding that requires a call.

## The rule

> **No configuration before first value. None.**

Everything needed for the first insight is already present in the connected systems. Zendesk holds the SLA policies, the organizations, and the ticket history. Jira holds the changelog. The link between them already exists. **Ask for nothing you can read.**

## Redesigned flow

**Before any configuration — target: under 10 minutes, unattended**

1. **Sign up** — email + password. No company profile, no onboarding survey.
2. **Connect Zendesk** (OAuth, read-only) — one click.
3. **Connect Jira** (OAuth, read-only) — one click. _This is the moment the deal is really won or lost; see the note on engineering below._
4. **Backfill runs automatically** — last 60–90 days. Show a live progress view with counts appearing as they land ("1,204 tickets · 318 escalations · 41 linked issues"), because a progress bar with real numbers is itself persuasive.
5. **Findings appear with zero input:**

   > _Over the last 90 days, 318 tickets were escalated to Jira. 47 of them exceeded their customer resolution target. Escalated tickets spent an average of 2h 41m waiting to be picked up in Jira. Your top 5 affected accounts are…_

   Note what makes this possible: SLA targets came from Zendesk's own policies; customers came from Zendesk organizations; leg durations came from the Jira changelog. **The user has typed nothing.**

**Only then, configuration — each step optional and individually skippable**

6. Confirm or correct the imported SLA policies (pre-filled).
7. Optionally set a target for the engineering leg (one number, with the observed median offered as the default — "your current median is 2h 41m; set a target?").
8. Connect Slack and choose a channel.
9. Turn on live monitoring.

**Then, ongoing**

10. At-risk alerts to Slack, deduplicated, at meaningful thresholds only.
11. Breach recorded with its timeline, no action required.
12. Monthly report generated automatically and waiting on the first of the month.

## What is automatic vs. configured

| Automatic (inferred)                        | Configured (asked)                      |
| ------------------------------------------- | --------------------------------------- |
| Customers ← Zendesk organizations           | Engineering leg target (optional)       |
| SLA targets ← Zendesk SLA policies          | Slack channel + who gets alerted        |
| Business hours ← Zendesk schedules          | Alert thresholds (sensible defaults)    |
| Case correlation ← official link            | Account tier for sorting (optional)     |
| Leg ownership ← which system holds the work | SLA corrections, if the import is wrong |
| Priority/tier ← ticket fields               |                                         |

## Onboarding friction, honestly ranked

1. **The Jira OAuth grant.** Not technical — political. The Head of Support cannot grant it alone. Mitigations: a read-only scope stated prominently, a one-page security summary they can forward, a shareable "request access" link addressed to the Jira admin, and — critically — **let the product deliver partial value from Zendesk alone while Jira approval is pending**, so the trial does not stall at step 3.
2. **Backfill duration** on large instances. Mitigate by streaming findings as they compute rather than gating on completion.
3. **Poor link discipline.** If a team pastes URLs instead of using the integration, correlation coverage drops. Detect and report this honestly — _"we could link 61% of your escalations"_ — rather than silently under-reporting. Never invent a link to improve the number.

## Time-to-value target

**Under 15 minutes from signup to a findings screen**, unattended, on a real dataset. If it takes a demo call, the business does not work at this price point.

---

# Phase 18 — Pricing

> **Status as of 2026-09-29.** The pricing below is the strategy; the public pricing page (`apps/web/src/modules/marketing/pricing`) currently shows a **different, older plan set** and the product has **no billing code** (no plans, subscriptions or usage metering in the schema). Reconcile before anyone is quoted a price:
>
> | | This document | Live pricing page |
> | --- | --- | --- |
> | Plans | Starter $79 · Growth $149 · Scale $249 · Enterprise | Starter $49 · Team $149 · Enterprise |
> | Metric | Monthly escalated tickets (150 / 600 / 2,500) | Seats (5 / 20 / unlimited), policy and integration counts |
> | Trial | Free one-time 90-day Historical Review, 14 days | 14-day trial, no card |
> | Integrations | Zendesk + Jira in every tier | Tier-gated; Intercom, Linear and GitHub (Beta) marketed as included |
>
> The page prices by seats, which Phase 18 rejects (value has no relationship to agent count). Nothing enforces any of these limits in code, so tiers are currently a promise, not a control. Either update the page to the tiers here, or record a decision to change them. Also: keep Beta providers out of the tier promise, and see [Phase 10b](#phase-10b--scale) for the capacity behind the 2,500 ceiling.

## Choosing the value metric

| Model                                              | Assessment                                                                                                                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per agent                                          | **No.** Familiar, but value has no relationship to agent count, and it penalises the customer for growing the team. It also invites direct comparison with the helpdesk's per-agent price, which is a losing frame. |
| Per ticket                                         | **No.** Most tickets never escalate. Charges for volume the product does not touch.                                                                                                                                 |
| Per integration                                    | **No.** Punishes the exact behaviour that makes the product stickier.                                                                                                                                               |
| Per commitment                                     | **No.** Unpredictable and impossible to forecast at purchase time.                                                                                                                                                  |
| Per customer/account                               | Plausible — value does scale with named accounts — but the count is volatile and creates awkward mid-month arithmetic.                                                                                              |
| Pure usage                                         | **No.** Unpredictable bills kill mid-market renewals.                                                                                                                                                               |
| **Flat tiers banded by monthly escalation volume** | **Yes.**                                                                                                                                                                                                            |

**Recommendation: flat monthly subscription, tiered by monthly escalated-ticket volume.**

It scores well on every axis that matters: the value metric is the thing the product actually acts on; the price is predictable within a tier; it expands naturally as the customer grows; a support leader understands "escalations per month" without explanation; and gross margin is unaffected by seat count.

## Proposed tiers

| Tier                  | Price          | Included                                                                              | Purpose                                                                       |
| --------------------- | -------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Historical Review** | Free, one-time | 90-day backfill, findings report, read-only, expires in 14 days                       | The entire acquisition motion. Not a freemium tier — a self-serve diagnostic. |
| **Starter**           | **$79/mo**     | Up to 150 escalations/mo · Zendesk + Jira · Slack alerts · CSV export                 | Lands inside discretionary approval for a Head of Support                     |
| **Growth**            | **$149/mo**    | Up to 600 escalations/mo · leg targets · scheduled reports · multiple projects/brands | The expected centre of gravity                                                |
| **Scale**             | **$249/mo**    | Up to 2,500 escalations/mo · API access · SSO · priority support                      |                                                                               |
| **Enterprise**        | Custom         | Above 2,500 · security review · custom calendars                                      | Only when inbound                                                             |

Overage: soft — notify and upgrade at the next renewal. Never hard-stop monitoring, because a customer whose alerts went silent mid-incident churns immediately and tells people.

## Reasoning on the numbers

- **Target ACV $3.6k–$8.4k**, which needs roughly **12–20 customers to reach $10k MRR** — a plausible target for one founder in 12–18 months.
- **The top self-serve tier is deliberately well above the original doc's $99 anchor.** A $99 product needs 100 customers for the same revenue, which means a self-serve funnel and a marketing budget — neither of which exists here. $99 is not a cheaper price, it is a different and harder company.
- **Anchors:** Supportbench runs $32–$100/agent/mo, so a 10-agent team already pays $320–$1,000/mo for a helpdesk. Pylon starts at $70/seat with a 3-seat minimum. A $149–$249 add-on is a small fraction of tooling spend the buyer already approves.
- **Counter-anchor, stated honestly:** Jira Marketplace apps solve an adjacent problem for a fraction of this, and QBR Studio gives MSPs client reporting free. If the buyer frames this as "an SLA app," the price loses. The positioning in Phase 7 exists partly to prevent that framing.

**The pricing kill signal:** if qualified prospects consistently anchor below $200/mo, the unit economics do not support a founder building integrations for a living. That threshold is in [05-Validation-and-Kill-Criteria.md](05-Validation-and-Kill-Criteria.md).
