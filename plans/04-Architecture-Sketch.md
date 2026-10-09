# 04 — Architecture Sketch
**Phases 12–17, at design-decision depth.**

> **Built (roadmap Rev 6, 2026-10-05).** This sketch predates the code. The product is built and live; the authoritative design is the implementation plans in `implementation-plans/` (`01`–`09`) and the code. Where they differ, the plans win. The main divergences: the core decides by **role**, not provider name, and a case's own ticket-source integration is its source of truth (D16–D19, D23); providers sit behind one typed adapter contract and a shared projector (N2); data freshness is recorded and shown (D13, D22); billing is an internal, provider-neutral domain (D14, D28). Kept as written for the reasoning.

Deliberately a sketch. If the verdict in [00-Verdict.md](00-Verdict.md) is "validate before building," then detailed schemas and full interface definitions are work performed before it is known whether anyone will pay. What follows is the set of decisions that are expensive to change later — the ones worth getting right on paper now — plus the minimum type shapes needed to make them concrete.

---

# Phase 12 — Data Model

## The one architectural decision that matters

> **Store events. Never store computed time.**

Every naive version of this product stores `elapsedMinutes` on a ticket and updates it on a schedule. That design fails in four specific ways: it cannot recompute history after a policy is corrected, it cannot explain how it reached a number, it drifts whenever a poll is missed, and it cannot be audited. Since the product's only durable claim is *"our number is the true one,"* a design that cannot reproduce its own numbers is disqualifying.

Instead, elapsed time is always a **pure function** of `(ordered events, policy version, calendar)`. Cached for display, never treated as truth.

This is what makes the four layers the brief asks to separate genuinely necessary rather than architectural decoration.

## Entities

```
Organization ──┬── User
               ├── Integration ──── RawEvent
               ├── Customer ──── Case ──┬── NormalizedEvent
               │   (from Zendesk orgs)  ├── CaseLink
               ├── SLAPolicy ──────────┤
               └── BusinessCalendar    ├── Commitment ──── Evaluation
                                       ├── LegSpan
                                       └── Notification
```

| Entity | Role | Mutability |
|---|---|---|
| **Organization** | Tenant boundary | Mutable |
| **Integration** | One connected system + credentials + cursor position | Mutable |
| **RawEvent** | Exactly what the provider returned, with fetch time and a source hash | **Immutable, append-only** |
| **NormalizedEvent** | Provider-independent fact: `{caseId, type, occurredAt, actor, fromState, toState, sourceRawEventId}` | **Immutable**; regenerate by re-deriving, never by editing |
| **Case** | The unit of customer commitment — one customer request, spanning systems | Mutable projection |
| **CaseLink** | A binding between a Case and an external record, carrying its evidence and confidence | Mutable |
| **Customer** | Derived from Zendesk organizations | Mutable |
| **SLAPolicy** | Versioned. Editing creates a new version; old versions are never destroyed. | **Append-only versions** |
| **BusinessCalendar** | Working hours, timezone, holidays. Versioned like policy. | **Append-only versions** |
| **Commitment** | One obligation on one Case — "P1 resolution, 8h, under policy v3, calendar v1" | Created once, resolved once |
| **LegSpan** | A contiguous period during which one leg held the work | Derived, recomputable |
| **Evaluation** | A point-in-time computation of a Commitment: elapsed, remaining, status, and the inputs used | **Immutable snapshot** |
| **Notification** | What was sent, to whom, why, deduplication key | Immutable |

## The four separations the brief asks for

- **Raw events** — provider-shaped, immutable, never queried by the engine. Their purpose is replay: when a normalizer bug is found in month six, history is rebuilt rather than lost. Retain for 90 days minimum.
- **Normalized events** — the engine's only input. Provider-independent by construction, so the SLA engine never learns what Zendesk is.
- **Commitments** — obligations, bound to a *specific policy version and calendar version at creation time*. This is what makes historical numbers stable when today's policy changes.
- **Breaches** — not a separate entity. A breach is an `Evaluation` whose status is `breached`. Modelling it separately invites two sources of truth about the same fact.
- **Evidence** — not stored. **Rendered** from the immutable normalized event stream plus the evaluation's recorded inputs. Evidence that is stored can disagree with the data; evidence that is derived cannot.

## Lifecycle of a Case

```
ticket created (Zendesk)
   → Case opened, Customer resolved from organization
   → Commitments created from matching SLAPolicy version
        · first-response commitment
        · resolution commitment
   → NormalizedEvents accumulate from both systems
   → LegSpans derived (support | engineering | waiting-on-customer)
   → Evaluations recomputed each cycle
   → status: on-track → at-risk → met | breached
   → Case closed; commitments frozen; evaluations retained
```

## Data flow

```
provider API ──▶ Adapter ──▶ RawEvent (immutable)
                                  │
                                  ▼
                            Normalizer ──▶ NormalizedEvent (immutable)
                                  │
                                  ▼
                            Correlator ──▶ Case + CaseLink
                                  │
                                  ▼
              ┌──────────── SLA / Leg Engine ────────────┐
              │  pure(events, policyVersion, calendar)   │
              └──────────────────┬──────────────────────┘
                                 ▼
                    Evaluation (immutable snapshot)
                          │            │
                          ▼            ▼
                     Dashboard   Notification (deduplicated)
```

The adapter is the only provider-aware component. Everything to its right is provider-agnostic — which is exactly the decoupling the brief requires, achieved by boundary rather than by abstraction layers.

---

# Phase 13 — SLA Engine

## How each mechanism works

**1. Commitment creation.** On the first normalized event for a Case, match the Case's attributes (customer, priority, tier, channel) against active SLAPolicy versions, most specific first. Bind the resolved `policyVersionId` and `calendarVersionId` onto the Commitment permanently. Later policy edits create new versions and affect only Commitments created after them.

**2. Deadline calculation.** Not `start + duration`. Walk the calendar forward from the start instant, accumulating only working minutes until the target is consumed, skipping non-working hours and holidays. For 24/7 policies the calendar is a degenerate always-open case, which keeps one code path.

**3. Elapsed time.** Fold the ordered event stream into alternating running and paused intervals, intersect the running intervals with working hours, and sum. Pure, deterministic, dependent on nothing but its inputs.

**4. Pauses.** A pause is a *state predicate over normalized events*, not a provider status string. Configured as "these normalized states pause this target." This is the crux of the entire product, because the two systems disagree here: Zendesk's First Reply, Next Reply, Periodic Update and Total Resolution targets **do not pause in Pending status**, while a linked Jira issue moving to "Blocked — waiting on customer" arguably should pause. The engine must resolve that conflict explicitly and show its working. Rule: **the customer-facing commitment pauses only on customer-caused waiting**, regardless of which system reports it, and the case detail page shows every pause with its cause.

**5. Business calendars.** Timezone-aware, holiday-aware, versioned. Imported from Zendesk schedules where available. Per-customer calendars are a SHOULD, not a MUST.

**6. Policy changes.** Never retroactive. New version, applied forward. An explicit, audited "recalculate historical commitments under v4" action can exist later; it must never happen implicitly.

**7. Breach detection.** Each cycle, recompute every open commitment. Status transitions are recorded as immutable evaluations. Notifications fire on *transitions*, never on states, and carry a deduplication key of `(commitmentId, threshold)` so a poll that runs twice cannot alert twice.

**8. Reproducibility.** Guaranteed by construction: given the same normalized events, policy version and calendar version, the engine returns the same answer forever. Every evaluation stores the input version ids, so any number on any screen can be re-derived and explained months later. This is the property that makes "our number is the true one" a defensible claim rather than a marketing line.

## Core type shapes

```ts
type CommitmentKind = 'first_response' | 'resolution';
type CommitmentStatus = 'on_track' | 'at_risk' | 'met' | 'breached' | 'cancelled';

interface SLAPolicyVersion {
  id: string; policyId: string; version: number;
  match: { priority?: string[]; customerIds?: string[]; tier?: string[] };
  targets: { kind: CommitmentKind; minutes: number }[];
  pauseOnStates: NormalizedState[];   // semantic states, never provider strings
  calendarVersionId: string;
  warnAtPercent: number[];            // e.g. [50, 80, 95]
  effectiveFrom: string;              // ISO
}

interface BusinessCalendarVersion {
  id: string; version: number; timezone: string;
  weekly: { day: 0|1|2|3|4|5|6; openMinute: number; closeMinute: number }[];
  holidays: string[];                 // ISO dates
  alwaysOpen: boolean;
}

interface Commitment {
  id: string; caseId: string; kind: CommitmentKind;
  policyVersionId: string;            // frozen at creation — the reproducibility anchor
  calendarVersionId: string;
  startedAt: string; targetMinutes: number; dueAt: string;
  status: CommitmentStatus; closedAt?: string;
}

interface Evaluation {                 // immutable snapshot; a breach is one of these
  id: string; commitmentId: string; evaluatedAt: string;
  elapsedWorkingMinutes: number; remainingMinutes: number;
  status: CommitmentStatus;
  breachedByMinutes?: number;
  inputs: { lastEventId: string; policyVersionId: string; calendarVersionId: string };
}
```

Note what is absent: no `provider` field anywhere below the adapter, and no mutable elapsed counter.

---

# Phase 14 — OLA Engine

## The reduction

The original concept models arbitrary N-team chains with configured handoffs. In the chosen wedge there are **two legs plus a customer-wait state**, and which leg holds the work is *observable*, not configured. The general engine can come later, from a position of revenue.

## Ownership model

At any instant a Case is in exactly one leg:

| Leg | Determined by |
|---|---|
| `support` | Open in the helpdesk, no active linked engineering issue, not awaiting customer |
| `engineering` | A linked issue exists and is in a non-terminal, non-blocked state |
| `waiting_customer` | Helpdesk state indicates awaiting customer response |
| `unknown` | Contradictory or missing signals — **explicitly represented, never guessed** |

Ownership is a derived timeline of `LegSpan` records, recomputable from events at any time.

## Handoff model

A handoff is an event, not an inference: the linked issue's creation, or the ticket entering an escalated state. Its timestamp is the boundary between spans.

## Attribution algorithm

For a breached commitment: intersect each `LegSpan` with the commitment's working-hours window, sum per leg, and report as **time by stage** — never as blame (Phase 8). Where a leg has an optional target, report variance against it.

## Hard cases, and the honest answer to each

| Case | Handling |
|---|---|
| Ambiguous handoff | Emit `unknown` span. Show as "unattributed" in the UI. |
| Missing handoff event | Bound the span by the surrounding known events and mark it inferred. |
| Multiple teams / parallel work | Out of scope for v1 by design. If a case has multiple linked issues, attribute to `engineering` as one leg and note the count. Do not attempt per-team splitting. |
| Reassignment within engineering | Ignored. Not visible in the two-leg model, and not needed. |
| Ownership without status change | Fall back to the last unambiguous signal; do not synthesise a transition. |
| Missing Zendesk↔Jira link | The Case simply has no engineering leg. Report link coverage honestly at the account level. |
| Human configuration error | Detectable as impossible spans (negative duration, overlapping legs). Surface as a data-quality warning rather than silently normalising. |

## Confidence and uncertainty

Three levels only, shown in the UI, never hidden:

- **Certain** — every boundary is backed by an explicit event.
- **Inferred** — a boundary was bounded rather than observed.
- **Unknown** — contradictory or absent signals; time is shown as unattributed.

**Unattributed time must always be visible and must never be silently redistributed to a leg.** A product whose entire pitch is honesty about time cannot round its uncertainty into an accusation.

---

# Phase 15 — Cross-System Correlation

## Signal tiers

**Deterministic — the only tier used in v1:**
- The official Zendesk↔Jira integration's stored link
- Jira remote links pointing at a Zendesk ticket URL
- An external-id field populated by either integration
- Explicit ticket-id references in structured fields

**Configurable — v2:**
- Project ↔ brand/form mappings
- Customer-domain → account mappings for sources without an organization concept
- Naming conventions (`[ZD-18392]` in an issue summary) — offered as an opt-in pattern the customer confirms, never applied by default

**Weak — deliberately not used:**
- Title similarity, temporal proximity, shared participants, keyword overlap

## The critical requirement

> The system must never confidently invent a relationship.

Enforced structurally, not by policy: `CaseLink` carries a `method` (`official_link` | `remote_link` | `pattern` | `manual`) and a `confidence` (`certain` | `probable`). **Only `certain` links contribute to a commitment's leg timing.** Probable links are surfaced to the user as suggestions requiring one click to confirm; until confirmed, they contribute nothing to any number shown as fact.

The consequence is that coverage will be incomplete, and that must be reported prominently:

> *"Linked 214 of 318 escalations (67%). 104 escalations could not be linked to an engineering issue — [see why]."*

An honest 67% is a feature. A fabricated 100% is the failure mode that ends the company the first time a support director presents a wrong timeline to their CEO.

---

# Phase 16 — Polling & Event Architecture

## Is 30-minute polling viable?

**No — not as a single global interval.** The arithmetic settles it.

Polling adds up to a full interval of detection latency. A useful warning must arrive with enough remaining time to act:

| Commitment | Warn at 80% | Remaining budget | Blind time at 30-min poll | Usable? |
|---|---|---|---|---|
| 1h first response | 48 min | 12 min | up to 30 min | **No** — the warning can arrive after the breach |
| 4h resolution | 3h 12m | 48 min | up to 30 min | Marginal — over half the action window lost |
| 8h resolution | 6h 24m | 96 min | up to 30 min | Acceptable |
| 2 business days | — | hours | 30 min | Fine |

The general rule:

> **Poll interval ≤ 10% of the shortest monitored target.**

For the ICP in [02](02-Vertical-Wedge-ICP.md), the shortest target is a 1-hour P1 first response, which demands a **6-minute** interval. Since first response usually happens before escalation, the practical minimum for the escalation use case is **5 minutes on the active set**.

## Recommended architecture — two-speed polling

```
every 5 min   ── active-set poll ──▶ open cases with a live commitment
                (incremental cursor; a small, bounded working set)

every 60 min  ── reconciliation sweep ──▶ everything modified since last cursor
                (catches missed webhooks, deletions, retro edits)

nightly       ── integrity check ──▶ recompute a sample; alert on divergence
```

This is affordable precisely because the active set is small. A customer with 3,000 tickets/month has perhaps 60–150 open escalated cases at any moment — a handful of incremental API calls every five minutes, not a crawl of the whole instance. Both Zendesk and Jira provide incremental/cursor-based change APIs designed for exactly this pattern. *(Specific rate-limit ceilings were not verified in this research and must be confirmed against current API docs before build.)*

## The operational hazards, and their answers

| Hazard | Answer |
|---|---|
| Duplicate events | Idempotency key `(integrationId, providerEventId)`; unique index. Re-polling is safe by construction. |
| Out-of-order arrival | Order by `occurredAt`, not by fetch time. Late events trigger recomputation, which is free because evaluation is pure. |
| Missed events | The hourly reconciliation sweep is the safety net. Cursors persist; a crashed worker resumes. |
| Clock skew between providers | Store both provider timestamp and fetch timestamp; use provider time, monitor the delta. |
| Historical backfill vs. live | Same pipeline, different cursor. Backfill must be resumable and rate-limit aware. |
| Rate limits | Exponential backoff, per-integration token bucket, and shed the reconciliation sweep before ever shedding the active-set poll. |

## When to add webhooks

Not in v1. Webhooks add endpoint security, replay protection, delivery-failure handling and a second ingestion path to keep consistent — for a latency improvement the two-speed poll largely already delivers. Add them when a customer's shortest commitment drops below 30 minutes, or when active-set polling starts hitting rate limits at scale. Then keep polling as the reconciliation layer permanently; webhooks are never trustworthy alone.

---

# Phase 17 — MVP UI

## Main dashboard — one screen

What earns its place, in order down the page:

1. **At risk now** *(the reason the product is open in a tab)* — a live list, sorted by remaining time ascending. Each row: customer, ticket, commitment, **remaining time**, current leg, time in current leg. Nothing else.
2. **Breached this period** — count with a one-click drill-down.
3. **Escalations aging in engineering** — the view that gives the blocking stakeholder a reason to want this. Sorted by time in leg.
4. **Compliance %** — one number, period-scoped, with the trend arrow. Placed *below* the actionable lists, because it is a reporting artifact, not a working tool.

Cut from the proposed list: **"Delaying teams"** — with two legs it conveys nothing and carries the exact political charge Phase 8 warns against. **"Customers at risk"** — redundant with the at-risk list once it is sorted by customer. **"Recent breaches"** — the same data as #2.

Design constraint: **the at-risk list must be usable without scrolling and comprehensible in under five seconds.** This screen lives on a wall monitor in a support room, which is also how it spreads inside an account.

## Case detail page — the minimum

- Header: customer, ticket, commitment, target, **remaining or breached-by**, current leg
- **The timeline** — the core of the page. Every normalized event, in order, with working/paused shading, leg boundaries marked, and pauses labelled with their cause
- **Time by stage** — support / engineering / waiting-on-customer / unattributed, as a single horizontal bar; variance against a leg target where one is set
- Links out to the Zendesk ticket and Jira issue, and the link's confidence
- A "how this was calculated" disclosure: policy version, calendar, pause rules applied

Deferred: contributing-factors analysis, contract details, financial exposure, comment threads, PDF export, customer-shareable views.

The timeline is the entire page. If a support lead can screenshot it and paste it into Slack to end an argument, the page is done.
