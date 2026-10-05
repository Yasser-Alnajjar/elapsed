# 05 — Go-To-Market, 30-Day Validation & Kill Criteria
**Phases 19–21.**

> **Historical (roadmap Rev 5/6).** The validation-first plan, the `$299 / $699` paid pilots and the kill criteria built around the first five customers were superseded when the product went live with 10 customers (roadmap D11 closed as superseded, 2026-09-29). Ongoing measures now live in the roadmap's Validation Metrics and Review Triggers. Pricing is governed by roadmap D14 (Starter $49, Team $149, Enterprise Custom); the pilot prices below must not be reintroduced. Kept unedited for traceability.

---

# Phase 19 — Go-To-Market

## Assessing the proposed hook

> *"Connect your existing systems and we'll reconstruct your last 30 days of SLA performance."*

**The promise is excellent. The mechanism is fatal.**

The promise is right because it inverts the normal B2B trial: instead of asking a buyer to imagine value, it shows them their own failures, by name, in their own data. That is as close to an undeniable demo as this category allows.

The mechanism is fatal because it asks a stranger for **OAuth into two production systems** — one of which the buyer does not even control — before any trust exists. A Head of Support who has read one cold email cannot grant Jira access; they must go ask a VP Engineering to authorise an unknown vendor. That request will not be made, and the deal dies silently in the gap.

## The fix: ask for a file, not a token

Both Zendesk and Jira export CSV. So the first version of the offer is:

> **"Export your last 90 days of tickets and your Jira issue history — two CSVs, ten minutes. I'll reconstruct what actually happened to your escalations and send it back within 48 hours. No integration, no access, no commitment."**

This is enormously better for the first ten conversations:

- **No security review.** A CSV export is a thing a support leader can do alone, today, without asking anyone.
- **No engineering approval**, so the blocker is removed from the *validation* phase entirely — while remaining a known risk for the *product* phase, which is exactly where it should be tested separately.
- **No product needs to exist.** The analysis is a script. This is the concierge MVP.
- **It converts the ask from "trust me with your systems" to "let me do you a favour."**

Move to OAuth only for paid pilots, after the analysis has proven the value.

## The first five customers

| | |
|---|---|
| **Outreach target** | Heads of Support / Support Ops at B2B SaaS companies, 80–400 employees, hiring for or posting about support operations, with a public status page or published support SLA |
| **Where** | Support Driven (Slack/community), LinkedIn (title search: Head of Support, Director of Support Operations, Support Ops Manager at B2B SaaS), support-ops newsletters, relevant subreddits, and — highest yield — warm intros from anyone who has ever worked in B2B support |
| **Buyer** | Head of Support. Not the CTO; not the CEO. |
| **Message** | Lead with the verifiable fact, not the product: *"Zendesk's resolution timer doesn't pause when a ticket sits in Pending waiting on engineering — so if you escalate to Jira, your SLA numbers are probably wrong in a direction nobody has measured. I'm researching this. Can I reconstruct your last 90 days from a CSV export and show you? Free, 48 hours, no strings."* |
| **Demo** | Their own data. Never a sandbox. The whole strategy is that a generic demo of this product is unconvincing and a specific one is undeniable. |
| **Required data** | Zendesk ticket export with audit/event history + Jira issue export with changelog, 90 days. Nothing else. |
| **Integration setup** | None during validation. OAuth only at pilot. |
| **Time-to-value** | 48 hours in concierge mode; under 15 minutes once the product exists |
| **Pilot structure** | 30 days, **paid** — $299 or $699 depending on volume (**obsolete pilot pricing, not current pricing; see roadmap D14**). Free pilots validate politeness, not demand. Discount to first-customer pricing if needed, but never to zero. |
| **Success criteria** | The customer logs in ≥3×/week, acts on ≥1 at-risk alert, and the monthly report gets forwarded to someone more senior. That last signal is the strongest predictor of renewal. |
| **Conversion** | Convert at day 30 to a rolling monthly subscription. Ask for an annual commitment only after a customer has renewed monthly twice. |

The objective is not to sell a SaaS. It is to find out whether five people will pay real money for a result that currently arrives as a spreadsheet.

---

# Phase 20 — 30-Day Validation Plan

Starting Monday **7 September 2026**. Each week has one question it exists to answer and one number that answers it.

## Week 1 — 7–13 Sep · *Is the problem real, and is the ICP right?*

| Day | Action |
|---|---|
| Mon 7 | Finish the competitive scan started in [Research-Sources.md](Research-Sources.md): install Deviniti's and SaaSJet's trials, read their docs, find their limits. Confirm what Zendesk↔Jira's official integration does and does not carry. |
| Tue 8 | Build the target list: 40 companies matching the ICP. Verify tool stack from job postings, status pages, and support-portal footers. |
| Wed 9–Thu 10 | Write and send 40 outreach messages. Personalised on a specific observable fact about their support setup — not templated. |
| Fri 11 | Write the interview script. 8 questions, zero of which mention the product. |
| Sat–Sun | Book calls |

**Target: 40 sent → 10 replies → 6 calls booked.**

## Week 2 — 14–20 Sep · *Do they feel it, and what do they do today?*

Run **12–15 interviews**. Ask nothing about the product until the last two minutes.

The questions that actually matter:

1. "Walk me through the last time an escalated ticket went badly. What happened?"
2. "When a ticket goes to engineering, how do you know what's happening to it?" *(listen for: Slack, standups, "I ask Dave")*
3. "How do you produce your monthly SLA number? Roughly how long does that take?"
4. "Do you trust that number? Would engineering agree with it?"
5. "How many tickets a month do you escalate to engineering?" *(qualifies the ICP threshold)*
6. "Do you use the official Zendesk–Jira link, or do people paste URLs?" *(the highest-leverage question in the script — it decides technical feasibility)*
7. "When was the last time a customer disputed whether you met a commitment? What did you do?" *(tests the evidence-frequency assumption)*
8. "If I could show you where the time actually went on every escalation, who else would need to see it?" *(reveals the political map and the blocker)*

Also: ask 3 of them for the CSV export. Then run the analysis manually and send it back before Week 3 starts, so Week 3 opens with real reactions rather than a cold start.

## Week 3 — 21–27 Sep · *Does the analysis land?*

Build the concierge script — a throwaway. It parses two CSVs, correlates on the link field, computes elapsed time against stated targets with business hours, and emits a one-page findings document. **No UI, no database, no auth, no deployment.** Two days of work, maximum.

Then run it on **5 real customer datasets** and deliver each personally on a call, watching the reaction.

What to watch for, in order of importance:
- Do they immediately ask about a *specific* case? *(engagement)*
- Do they forward it to someone? *(the strongest signal available)*
- Do they dispute a number? *(engine trust — investigate every dispute; each one is either a bug or a misunderstanding, and both are critical)*
- Do they ask "can I get this every month?" *(the buying question — do not answer it too quickly)*

## Week 4 — 28 Sep – 4 Oct · *Will they pay?*

Make the ask, directly, to every one of the 12–15:

> (Obsolete pilot script, not current pricing.) "I'm building this. A 30-day pilot is $299/month for up to 150 escalations, or $699 if you're over that. I'll set it up personally. Are you in?"

Then, for anyone who says yes: **immediately test the real blocker.** Ask them to get the Jira OAuth grant approved *before* taking payment. Whether that approval happens, how long it takes, and who blocks it is the single most valuable data point in the entire 30 days — and it cannot be learned any other way.

## Measurable success criteria

| Metric | Threshold to continue | Strong signal |
|---|---|---|
| Interviews completed | ≥ 12 | 15+ |
| Can name a specific escalation that blew a commitment in 90 days | ≥ 8 of 15 | 12+ |
| Spend > 2 hrs/month assembling SLA reporting by hand | ≥ 7 of 15 | 10+ |
| Use the official Zendesk↔Jira link (not pasted URLs) | ≥ 9 of 15 | 12+ |
| Provided a CSV export when asked | ≥ 5 | 8+ |
| Concierge analyses delivered | 5 | 5 |
| Analyses producing a finding the customer did not already know | ≥ 3 of 5 | 5 of 5 |
| Analyses where a number was disputed as wrong | ≤ 1 of 5 | 0 |
| Forwarded the analysis to someone else | ≥ 2 of 5 | 4+ |
| **Paid pilots agreed at ≥ $299/mo** (obsolete pilot price; see D14) | **≥ 3** | 5+ |
| Jira OAuth approved within 10 days of asking | ≥ 2 of 3 | 3 of 3 |

---

# Phase 21 — Kill Criteria

Explicit thresholds, decided in advance so the decision on 5 October is a reading rather than an argument. Each names the action, because "kill" is rarely the only option.

## Problem

| Condition | Action |
|---|---|
| Fewer than **8 of 15** can name a specific escalation that blew a customer commitment in the last 90 days | **KILL.** The problem is theoretical. |
| Fewer than **7 of 15** spend >2h/month on manual SLA reporting | **DOWNGRADE** — pain is real but cheap to endure; expect low prices and high churn |
| **More than 8 of 15** say "we already know which team is slow, we don't need proof" | **CUT the evidence/attribution feature entirely.** Rebuild positioning around at-risk visibility alone. |
| Fewer than **6 of 15** report *any* customer dispute over a commitment in the past year | **CONFIRMS** the Phase 8 verdict: evidence stays a supporting feature and is never the headline. Not a kill. |

## Product

| Condition | Action |
|---|---|
| Median link coverage across the 5 datasets is **below 60%** | **KILL as specified.** Deterministic correlation is the feasibility case; without it this becomes an entity-resolution research project no solo founder should attempt. |
| Link coverage is **60–80%** | **PROCEED with honesty** — report coverage prominently, never fabricate |
| **More than 1 of 5** analyses produce a number the customer credibly disputes | **STOP AND FIX** before selling anything. A trust product cannot ship wrong arithmetic. |
| Fewer than **9 of 15** use the official link rather than pasted URLs | **REPIVOT** the wedge to a single-system product (Jira-only cross-project), where correlation is not required |
| 5-minute active-set polling proves infeasible on real rate limits | **RESCOPE** to resolution-only commitments (4h+), where 15-minute polling suffices. Not a kill. |
| Getting to a first insight requires a setup call in **more than 3 of 5** cases | **KILL the self-serve model.** At $299–699/mo (obsolete pilot pricing), a product needing onboarding calls does not have viable economics for one person. |

## Market

| Condition | Action |
|---|---|
| Fewer than **10 of 15** qualified prospects run both a helpdesk and a separate tracker with contractual commitments | **ICP IS WRONG.** Re-run Phase 6 before proceeding. |
| Zendesk, Atlassian, or Pylon ships cross-system SLA continuity during the 30 days | **KILL.** The positional moat was the whole moat. |
| Median time from first contact to pilot agreement exceeds **21 days** | **DOWNGRADE** — the sales cycle is too long for a founder with no pipeline |
| More than **3 of 5** pilots are blocked by engineering refusing the Jira grant | **KILL as positioned.** Either reposition as an engineering-owned tool — which changes the buyer, the pricing and the product — or stop. |

## Commercial

| Condition | Action |
|---|---|
| **Fewer than 3 of 15 qualified prospects agree to a paid pilot after seeing their own historical breach analysis** | **KILL.** This is the primary criterion. Seeing your own failures in your own data is the most persuasive thing this product will ever do; if it does not convert at 20%, nothing later will. |
| Median stated willingness to pay is **below $200/mo** | **KILL.** Below viable economics: it implies 50+ customers for $10k MRR, which requires a funnel and a marketing budget that do not exist. |
| 3+ pilots agree but **fewer than 2 convert to a second paid month** | **KILL.** Novelty, not need. |
| Prospects ask for the analysis but not the product | **PIVOT to a service** — a recurring paid analysis/report, delivered manually. Lower ceiling, immediate revenue, near-zero build. Genuinely worth considering; it is a real business. |

## The decision rule

On **5 October 2026**, one of exactly four things is true:

1. **≥3 paid pilots, link coverage ≥60%, ≤1 disputed analysis** → **BUILD.** Ship the Phase 10 MVP in 6–9 weeks.
2. **Strong interest, weak payment** → **SELL THE SERVICE.** Run it manually for 90 days; build only when manual delivery becomes the bottleneck.
3. **Payment interest but engineering blocks access** → **REPOSITION** around the engineering buyer, and re-validate from Phase 3.
4. **Anything else** → **STOP.** Write up what was learned and move on.

Option 4 is a legitimate outcome, and the discipline of this whole exercise is being willing to take it on the day rather than finding one more thing to test.
