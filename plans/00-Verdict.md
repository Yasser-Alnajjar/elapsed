# 00 — Final Strategic Verdict

> **Historical (written 2026-09-05; roadmap Rev 6, 2026-10-05).** This verdict and its 30-day validation plan, including the "paid pilot at $299/$699" ask, were superseded when the product was built and went live with customers (roadmap D11 closed as superseded, 2026-09-29). **Current pricing is roadmap D14: Starter $49, Team $149, Enterprise Custom.** The status of the work is in `implementation-plans/ROADMAP_Product.md`. Kept as the original reasoning.

**Phase 22.** Read this first; the reasoning is in files 01–05, and every competitive claim traces to [Research-Sources.md](Research-Sources.md).

---

## The answer to the closing question

> _Is there a painful, frequent, valuable problem here that a small team can solve better than existing alternatives?_

**Yes — but it is roughly one-fifth the size of Elapsed as specified, and it is not in the vertical the original research chose.**

There is a real, frequent, unsolved problem: **when a support ticket is escalated into an engineering tracker, the customer's SLA clock keeps running while the organisation's visibility stops, and the two systems produce different numbers for the same case.** That is worth building. Almost everything else in the concept — the six-integration vendor-neutral layer, the OLA policy engine, delay attribution as headline, service-credit calculation, the MSP-first vertical — is either already solved, actively harmful to the sale, or scope a solo founder cannot carry.

## Verdict: 6.5 / 10 for the reframed product · 3 / 10 for the concept as written

**Why not higher.** The moat is positional, not technical — it comes from being the only party willing to be neutral between Zendesk and Jira, and any of Zendesk, Atlassian, or Pylon could close it in two quarters if they decided to. Celonis already does this analysis properly at enterprise scale. Atlassian Marketplace apps (Deviniti, SaaSJet) sell cross-project SLA _and OLA_ management through Atlassian's own distribution, cheaply. Nobody has this in a budget line, so every sale is an education sale. And the pain, while daily, is survivable — teams cope with Slack and a spreadsheet, and coping is what kills most B2B tools.

**Why not lower.** The problem is genuinely unsolved in the mid-market, it recurs daily rather than quarterly, the buyer is identifiable and publicly reachable, the hardest technical problem arrives pre-solved (the official Zendesk↔Jira link makes correlation deterministic), the MVP is 6–9 weeks for one developer, and the demo — _your own last 90 days, with the failures named_ — is unusually hard to argue with.

**Why the original concept scores 3.** It competes with helpdesks, PSAs, Marketplace apps, process-mining vendors and MSP reporting tools simultaneously; it requires 6+ integrations whose maintenance would consume all available engineering capacity; it leads with a value proposition that antagonises the exact person whose API token it needs; and it proposes financial calculations that create liability without creating revenue.

**Three findings that change the original conclusion:**

1. **The competitive research it rests on does not hold.** Of six named competitors, one (**Effigate**) could not be found to exist, one (**Clockspring**) is a general data-integration platform where SLA monitoring is use case 29 of 29, and one (**Pingoru**) is status-page alerting rather than credit recovery. Meanwhile the three most serious competitors — **Deviniti's SLA+OLA app**, **Celonis process mining for ITSM**, and **ServiceNow's native OLA support** — went unmentioned. OLA tracking in particular is not novel; it is a decades-old ITIL construct with first-class support in the enterprise ITSM leader.

2. **MSPs are the wrong first vertical**, and for a reason that inverts the original logic: the entire thesis is "work crosses systems and nobody sees the whole," but an MSP's PSA _is_ the single source of truth by design. It is simultaneously the segment with the least cross-system pain and the most competitors (ConnectWise Reports & Dashboards, QBR Studio, MyITFleet, CloudRadial, Handover). Add the conflict of interest — an MSP creating a timestamped record of its own contractual breaches, where credits are the client's sole and exclusive remedy — and the pitch collapses into the crowded reporting job.

3. **"Prove who caused the SLA breach" is the worst available positioning**, not the strongest. The product needs a Jira token controlled by engineering, and its stated purpose is to generate evidence against engineering. That is a self-blocking sale, and it fails invisibly — as deals that go quiet during setup.

---

## Best vertical

**B2B SaaS companies, 80–400 employees**, with contractual support commitments to enterprise customers, running a customer-facing helpdesk and a separate engineering tracker. Weighted score 7.51 vs. 6.41 for MSPs — winning on data availability, integration simplicity, buyer reachability and escalation frequency. Full scoring in [02](02-Vertical-Wedge-ICP.md).

## Best wedge

**Escalation SLA continuity.** When a Zendesk ticket is escalated to a linked Jira issue, keep one authoritative customer-facing clock running across both systems, show support what is happening on the leg they cannot see, and warn before the customer commitment breaks.

The only wedge where the differentiated capability and the daily job are the same thing.

## Best buyer

**Head of Support / Director of Support Operations.** Owns the SLA metric, owns a $5–50k discretionary tooling budget, and is the only person for whom this is a career problem rather than an annoyance.

**The blocker is the VP Engineering**, who controls the Jira grant and has no natural upside. Every messaging and design decision must give them a reason to say yes — starting with a read-only scope and a first-run view showing which escalations are ageing in _their_ queue.

## MVP

Two integrations (Zendesk + Jira, read-only), 90-day historical backfill, deterministic correlation via the official link, an immutable event store, an SLA engine with business hours and pause handling, automatic leg timing, at-risk/breach detection, one dashboard, a case timeline, Slack alerts, CSV export. **6–9 weeks for one developer.**

**Explicitly not built:** financial/service-credit calculation, AI, team mapping, an OLA policy builder, write-back actions, a customer portal, or a sixth integration. Full MUST/SHOULD/DO-NOT list in [03](03-Product-and-MVP.md).

The scope reduction that makes this tractable: in a two-leg model, ownership is _observable_ rather than configured — so team mapping, OLA policy configuration and handoff inference all disappear while the OLA capability survives intact.

## The one capability to own

> **One honest elapsed-time number that survives the handoff between two systems that each want to be the system of record.**

Not alerting (commoditised). Not attribution (political, and available elsewhere). Not evidence (too rare to anchor a subscription). The accumulated correctness of a time-arithmetic engine that reconciles two vendors' conflicting pause rules, calendars and time zones is the only asset here that compounds.

## Product positioning

- **Category:** support escalation visibility — an existing budget line, not a new noun
- **Headline:** **Your SLA clock doesn't stop when the ticket leaves Zendesk.**
- **Subheadline:** See every escalated ticket across Zendesk and Jira on one clock. Know which customer commitments are at risk while there's still time to act — and where the hours actually went when there wasn't.
- **Language rule, without exception:** "where the time went," never "who caused it."

## Architecture

Two-speed polling — **5-minute incremental polls of the active set** (open cases with live commitments), plus an **hourly reconciliation sweep** and a nightly integrity check. Webhooks deferred until a customer's shortest commitment drops below 30 minutes.

**The proposed 30-minute interval is not viable as a single global setting.** Polling adds up to a full interval of blind time, so a 1-hour first-response target with an 80% warning threshold has a 12-minute action window that a 30-minute poll can miss entirely. Rule: **poll interval ≤ 10% of the shortest monitored target.** The two-speed design is affordable because the active set is small — dozens of cases, not the whole instance.

```
Adapter → RawEvent (immutable) → Normalizer → NormalizedEvent (immutable)
                                                      ↓
                                                 Correlator → Case
                                                      ↓
                            pure(events, policyVersion, calendarVersion)
                                                      ↓
                                          Evaluation (immutable snapshot)
                                                ↓         ↓
                                           Dashboard   Slack (deduplicated)
```

## Data model

**The decision everything else depends on: store events, never store computed time.** Elapsed time is always a pure function of `(ordered events, policy version, calendar version)`, cached for display but never treated as truth. This is what makes historical numbers reproducible and explainable — and since the product's only claim is _"our number is the true one,"_ a design that cannot reproduce its own numbers is disqualifying.

Core entities: `Organization → Integration → RawEvent → NormalizedEvent → Case → {CaseLink, Commitment → Evaluation, LegSpan}`, with `Customer`, versioned `SLAPolicy` and versioned `BusinessCalendar` alongside. A breach is not an entity — it is an `Evaluation` with status `breached`. Evidence is not stored — it is _rendered_ from the immutable event stream, so it can never disagree with the data. Detail in [04](04-Architecture-Sketch.md).

**Correlation rule:** only `certain` links (from the official integration or a Jira remote link) feed any number presented as fact. Probable matches are surfaced as one-click suggestions and contribute nothing until confirmed. Report coverage honestly — _"linked 214 of 318 escalations (67%)"_ — because a fabricated 100% ends the company the first time a support director shows a wrong timeline to their CEO.

## First integration

**Zendesk, before Jira.** Three reasons, in order:

1. **It holds the commitment metadata** — customers (organizations), contract tiers, SLA policies, business schedules, and priority. Everything needed to know _what was promised_ lives in the helpdesk. Jira only tells you what happened.
2. **The buyer controls it.** A Head of Support can grant Zendesk access alone. Jira requires the blocker's approval, so it must not sit on the critical path to first value.
3. **It delivers standalone value that keeps a stalled trial alive.** From Zendesk alone the product can already show that First Reply, Next Reply, Periodic Update and Total Resolution targets **do not pause in Pending status** — meaning the customer's own SLA numbers are wrong today in a direction they have never measured. That is a genuine finding, delivered while the Jira grant is still working through approval.

Jira second, then Linear. No fourth integration until 10 paying customers.

## First customer

A **120-person B2B SaaS company** with ~12 support agents handling ~2,500 tickets/month, of which **~150 escalate to engineering**; roughly 40 enterprise accounts on contracts with P1/P2 response and resolution targets; Zendesk connected to Jira via the official integration; a Head of Support who owns the monthly SLA number, spends half a day assembling it, privately doesn't trust it, and was recently asked by their CEO to explain a specific account's missed commitment and could not.

**Qualifying question:** _"How many tickets a month do you escalate to engineering, and do people use the Zendesk–Jira link or paste URLs?"_ Under 40 escalations, or pasted URLs — not a customer.

## Validation strategy

**Do not build yet.** Run the 30 days in [05](05-Validation-and-Kill-Criteria.md) first.

The critical change to the proposed go-to-market: **ask for a CSV export, not an OAuth grant.** "Connect your systems and we'll reconstruct your last 30 days" is the right promise with a fatal mechanism — it asks a stranger for production access to two systems, one of which the buyer does not control. A CSV export is something a Head of Support can do alone in ten minutes, requires no security review, removes the blocker from the validation phase, and needs no product to exist. The concierge analysis is a two-day throwaway script.

## 30-day plan

Starting **Monday 7 September 2026**:

- **Week 1 (7–13 Sep)** — competitive teardown of Deviniti and SaaSJet; build a 60-company target list; send 40 personalised outreach messages
- **Week 2 (14–20 Sep)** — 12–15 buyer interviews, product unmentioned until the last two minutes; collect 3 CSV exports
- **Week 3 (21–27 Sep)** — build the throwaway concierge script; deliver 5 real analyses personally, on calls, watching the reactions
- **Week 4 (28 Sep–4 Oct)** — ask everyone for a paid pilot at $299/$699 (**obsolete pilot pricing, not current pricing; see D14**). For every yes, immediately test whether the Jira OAuth grant gets approved — that answer is the most valuable data in the whole month

## Kill criteria

Decided in advance, so 5 October is a reading rather than an argument. The four that matter most:

| Condition                                                                                                          | Action                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Fewer than 3 of 15 qualified prospects agree to a paid pilot after seeing their own historical breach analysis** | **KILL** — the primary criterion. If your own failures in your own data don't convert at 20%, nothing later will. |
| Median stated willingness to pay **below $200/mo**                                                                 | **KILL** — implies 50+ customers for $10k MRR, requiring a funnel and marketing budget that don't exist           |
| Median link coverage across 5 real datasets **below 60%**                                                          | **KILL as specified** — deterministic correlation is the entire feasibility case                                  |
| **More than 3 of 5** pilots blocked by engineering refusing the Jira grant                                         | **KILL as positioned** — reposition around the engineering buyer, or stop                                         |

Plus: if more than one of five concierge analyses produces a number the customer credibly disputes, **stop and fix before selling anything.** A trust product cannot ship wrong arithmetic.

Full thresholds, including the downgrade and pivot paths, in [05](05-Validation-and-Kill-Criteria.md).

---

## What to do on Monday

1. Do not write product code.
2. Build the 40-company list and send 40 outreach messages.
3. In every interview, ask question 6 — _"official link, or pasted URLs?"_ It decides technical feasibility, and three answers will tell you most of what you need.
4. Get one CSV export by Friday.

The best outcome of this month is not a product. It is either three people paying for a thing that does not exist yet, or a clear enough no to spend the next quarter on something better.
