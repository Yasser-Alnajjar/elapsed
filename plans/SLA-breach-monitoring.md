# In-depth Research: Elapsed

## Executive Summary

> **Elapsed as a general concept already exists and is quite mature.**
>
> However, **the opportunity is not to build another SLA timer**. The opportunity is to build an independent layer that monitors commitments across multiple systems or monitors SLAs externally from the helpdesk system.

---

## 1. The Current Market Already Exists

Systems such as Zendesk already provide SLA policies, countdowns, breach detection, automations, escalations, and reporting. Their automation can even notify teams before an SLA breach.

Atlassian Jira Service Management provides SLA calendars, business hours, breach triggers, and automations. Automation can be triggered when an SLA reaches a breach condition.

ServiceNow also provides SLA records with response/resolution targets, working time, remaining time, and breach status.

Freshdesk, ManageEngine, and other platforms also provide SLA tracking, reminders, and escalations.

**Therefore:**

```text
"Build an SLA timer"

        ❌

  Highly saturated market
```

But there is another direction that is more interesting.

---

## 2. The Real Opportunity: External SLA Monitoring

Newer products are moving in this direction.

For example, **Pingoru** independently monitors SaaS vendor SLAs and keeps timestamped evidence from status pages so customers can claim service credits.

**Complaya** operates in a similar space, focusing on monitoring SaaS vendor SLAs, detecting breaches, and recovering service credits automatically.

**Vendorica** focuses on vendor SLA registers, contracts, measurements, breach status, and cure windows.

So even:

```text
Vendor SLA Monitoring

        +

Service Credit Recovery
```

is starting to become a real market.

---

## 3. But There Is an Interesting Gap

Going back to your original idea:

> A script that runs every 30 minutes, checks systems, and detects SLA violations.

I think **the value isn't the SLA itself**.

The value is:

### Cross-System SLA Monitoring

For example, a company might use:

```text
Zendesk

   +

Jira

   +

Slack

   +

Email

   +

CRM

   +

ERP
```

The customer-facing SLA might be:

```text
Customer:    ACME
Contract:    Premium
Priority:    P1
Response:    2 hours
Resolution:  8 hours
```

But the ticket starts in Zendesk:

```text
Zendesk
   ↓
Support
   ↓
Jira
   ↓
Engineering
   ↓
Slack
   ↓
Finance
```

Every system sees only part of the process.

**There isn't necessarily a single source of truth.**

---

## 4. This Is Where Your Product Could Be Different

Imagine a SaaS called:

### Elapsed

It is not a helpdesk.

The concept:

```text
                 Elapsed
                       │
          ┌────────────┼────────────┐
          ↓            ↓            ↓
       Zendesk       Jira         CRM
          ↓            ↓            ↓
          └────────────┼────────────┘
                       ↓
                 SLA Engine
                       ↓
              ┌────────┴────────┐
              ↓                 ↓
          At Risk             Breached
              ↓                 ↓
           Alert             Escalate
```

You don't replace Zendesk.

You **monitor it**.

---

## 5. A Practical Example

A company has this SLA:

> P1 ticket → response within 1 hour.

The ticket exists in Zendesk.

The agent has already responded.

However, resolution requires Engineering.

Zendesk says:

```text
Status: Open
```

Meanwhile, Jira contains an issue linked to the ticket.

The Jira issue hasn't moved for 45 minutes.

Your worker:

```text
Every 30 minutes
        ↓
Fetch Zendesk tickets
        ↓
Fetch linked Jira issues
        ↓
Calculate SLA
        ↓
Check ownership
        ↓
Check last activity
        ↓
Apply rules
```

Detects:

```text
⚠ SLA At Risk

Customer:        ACME
Ticket:          #18392
SLA:             P1 Resolution — 4 hours
Elapsed:         3h 21m
Remaining:       39m
Current owner:   Engineering
Last activity:   47m ago
Risk:            HIGH
```

Then Slack receives:

```text
@engineering

ACME P1 ticket has 39 minutes
remaining before SLA breach.

Ticket #18392

[Open Ticket]
```

---

## 6. But There Is a Much More Important Feature

### OLA Monitoring

This is where the research becomes particularly interesting.

The SLA is:

> "Customer gets resolution within 8 hours."

Internally:

```text
Support → Engineering → Security → Operations
```

Each team has a different commitment.

For example:

```text
Customer SLA
  8 hours
      │
      ├── Support OLA
      │   30 min
      │
      ├── Engineering OLA
      │   2 hours
      │
      ├── Security OLA
      │   1 hour
      │
      └── Operations OLA
          90 min
```

Atlassian itself explains the distinction between SLA and OLA and highlights how SLA problems can result from internal handoffs.

This is where **the product becomes significantly more interesting**.

---

## 7. The Product Doesn't Just Say:

> SLA breached.

Instead:

```text
SLA BREACH

Customer:        ACME
SLA:             8 hours
Actual:          9h 14m

Root delay:      Engineering

Support
Target: 30m
Actual: 28m
✓

Engineering
Target: 2h
Actual: 4h 37m
Variance: +2h 37m 🔴

Security
Target: 1h
Actual: 48m
✓

Operations
Target: 90m
Actual: 1h 12m
✓
```

Management can immediately understand:

> **The problem wasn't Support. The problem was the Engineering handoff.**

That's materially different from traditional Zendesk/Jira SLA tracking.

---

## 8. Are There Competitors?

Yes, and this is where we need to be realistic.

**Clockspring** specifically advertises unified SLA monitoring across Zendesk, Jira Service Management, and even custom ticketing databases.

**Supportbench** focuses on B2B support with dynamic SLAs based on customer tier, contract, product, and severity, alongside escalations and dashboards.

**Effigate** connects SLA management with contracts, support tiers, and pre-breach escalation, particularly for IT services and MSPs.

Therefore:

```text
Cross-system SLA
```

**is not greenfield either.**

---

## 9. But the Market Is Still Open to Verticalization

Instead of:

> SLA Monitoring for Everyone

build:

### SLA Monitoring for Software Agencies

Here, the SLA isn't just customer support.

For example, an agency might have:

```text
Client Contract
────────────────────────
Critical bug:     4 hours
High:             8 hours
Normal:           2 business days
Feature request:  5 business days
```

You connect:

```text
Linear
GitHub
Slack
Gmail
ClickUp
Jira
```

Then the product calculates:

```text
Client:              Vodafone
Open commitments:    17
At risk:             3
Breached:            2
Potential penalty:   $4,800
```

---

## 10. Or MSPs

This is probably the clearest vertical.

For example:

```text
Client A
P1 → 30 min response
P2 → 2h response

Client B
P1 → 1h response
P2 → 4h response

Client C
P1 → 15m response
P2 → 1h response
```

Aggregate them into:

```text
                    SLA COMMAND CENTER

Client          At Risk     Breached     Compliance
────────────────────────────────────────────────────
ACME              2            0           99.2%
BetaCorp          1            3           96.8%
Delta             0            1           98.7%
```

ConnectWise and other PSA platforms already provide SLA management for MSPs, so your product should be **a layer above existing systems**, not another PSA.

---

## 11. The Worker Fits Your Original Idea Very Well

This is where your original concept makes sense.

You don't need realtime infrastructure initially.

You can start with:

```text
Cron
Every 15/30 minutes
        ↓
Integration adapters
        ↓
Normalize events
        ↓
SLA engine
        ↓
Evaluate rules
        ↓
Create incidents
        ↓
Notifications
```

For example:

```ts
type SLAEvent = {
  source: "zendesk" | "jira" | "linear";
  externalId: string;
  type: "created" | "responded" | "resolved" | "status_changed" | "assigned";
  occurredAt: Date;
};
```

And:

```ts
type SLAPolicy = {
  name: string;
  priority: "P1" | "P2" | "P3";
  responseMinutes: number;
  resolutionMinutes: number;
  businessHours: boolean;
  warningThresholds: number[];
};
```

Then:

```text
50%
75%
90%
100%
```

But I personally wouldn't stop at percentages.

A better representation is:

```text
Time remaining:        43m
Expected next action:  Engineering response
Current owner:         Ahmed
Last activity:         52m
Escalation:            Engineering Lead
```

---

## 12. Do I Think It's a Good SaaS Idea?

### SLA Timer SaaS

**3/10**

I wouldn't recommend it.

### Generic SLA Monitoring

**5/10**

There are enough competitors.

### Cross-System SLA + OLA Monitoring

**7.5/10**

Much more interesting.

### Vertical SLA Compliance Platform

**8.5/10**

This is where I would start paying serious attention.

Especially if the vertical has:

- Clear contracts
- Financial penalties
- Multiple teams
- Multiple systems
- SLAs that actually matter
- Real financial loss when a breach occurs

---

## 13. The Strongest Angle

There is another positioning angle that I think is stronger than everything above.

Instead of:

> **"Don't miss your SLA."**

Position it as:

> **"Prove who caused the SLA breach."**

After every breach, the product generates an:

### SLA Evidence Timeline

```text
SLA BREACH #8392

09:00  Customer request received
09:04  Support assigned
09:31  Support → Engineering
09:31  OLA clock started
11:48  Engineering picked up
13:12  Security requested
14:01  Security approved
15:32  Resolved

────────────────────

SLA Target:  6h
Actual:      6h 32m
Breach:      32m

Delay attribution:
Support       0m
Engineering  137m 🔴
Security      49m
Operations    12m
```

Then generate a report that can be sent to the customer or management.

**At this point you're no longer building a helpdesk.**

You're building a:

> **system of record for service commitments.**

---

## 14. Technical Architecture

### MVP Stack

```text
┌─────────────────────────────────────────────┐
│                   Cron Job                   │
│             Every 15-30 minutes             │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│           Integration Adapters              │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐   │
│  │Zendesk│  │ Jira │  │Linear│  │GitHub│   │
│  └──────┘  └──────┘  └──────┘  └──────┘   │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│            Event Normalizer                 │
│      Converts to unified SLAEvent           │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│              SLA Engine                     │
│  ┌─────────────────────────────────────┐   │
│  │  Evaluate rules against policies    │   │
│  │  Calculate time remaining           │   │
│  │  Track OLA handoffs                 │   │
│  └─────────────────────────────────────┘   │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│          PostgreSQL Database                │
│  ┌─────────────────────────────────────┐   │
│  │  - SLA Events                       │   │
│  │  - Policies                         │   │
│  │  - Breach Reports                   │   │
│  │  - Evidence Timeline                │   │
│  └─────────────────────────────────────┘   │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│           Notification Engine               │
│  ┌──────┐  ┌──────┐  ┌──────────┐         │
│  │Slack │  │Email │  │Webhook   │         │
│  └──────┘  └──────┘  └──────────┘         │
└─────────────────────────────────────────────┘
```

### Core Data Models

```ts
// SLA Policy Definition
type SLAPolicy = {
  id: string;
  name: string;
  priority: "P1" | "P2" | "P3" | "P4";
  responseMinutes: number;
  resolutionMinutes: number;
  businessHours: boolean;
  warningThresholds: number[]; // [50, 75, 90]
  escalationRules: EscalationRule[];
};

// Unified Event
type SLAEvent = {
  id: string;
  source: "zendesk" | "jira" | "linear" | "github";
  externalId: string;
  type:
    | "created"
    | "responded"
    | "resolved"
    | "status_changed"
    | "assigned"
    | "handoff";
  occurredAt: Date;
  data: Record<string, any>;
  metadata: {
    team?: string;
    assignee?: string;
    status?: string;
  };
};

// Breach Report
type BreachReport = {
  id: string;
  slaPolicyId: string;
  ticketId: string;
  customerId: string;
  targetTime: Date;
  actualTime: Date;
  breachDuration: number;
  timeline: TimelineEvent[];
  delayAttribution: {
    team: string;
    delay: number;
    target: number;
    variance: number;
  }[];
};
```

---

## 15. Go-to-Market Strategy

### Phase 1: MVP (3 months)

```text
✅ Cron-based polling (every 30 min)
✅ Zendesk + Jira integration
✅ Basic SLA calculation
✅ Slack notifications
✅ Simple dashboard
```

### Phase 2: Validation (3 months)

```text
✅ 5-10 beta customers
✅ OLA tracking
✅ Breach evidence generation
✅ Exportable reports
```

### Phase 3: Scale (6 months)

```text
✅ Webhooks for real-time
✅ Additional integrations
✅ Vertical-specific features
✅ Self-serve onboarding
```

---

## 16. Key Differentiators

| Feature                | Traditional SLA Tools | Elapsed |
| ---------------------- | --------------------- | ------- |
| Single source of truth | ❌                    | ✅      |
| Cross-system tracking  | ❌                    | ✅      |
| OLA monitoring         | ❌                    | ✅      |
| Delay attribution      | ❌                    | ✅      |
| Breach evidence        | ❌                    | ✅      |
| Vendor-neutral         | ❌                    | ✅      |
| Financial impact       | ❌                    | ✅      |

---

## 17. Final Conclusion

The market is **not empty**, and I would not recommend building generic SLA monitoring.

However, I see a potentially strong opportunity in a narrow product:

> **A vendor-neutral SLA/OLA compliance layer that sits above existing tools, reconstructs the timeline, attributes delays to teams and handoffs, and creates auditable breach evidence.**

The MVP can be built without AI:

```text
Cron
  +
APIs/Webhooks
  +
PostgreSQL
  +
Rules Engine
  +
Notifications
```

And your original **30-minute worker** is actually a good fit for the MVP.

Once product-market fit is proven, you can introduce webhooks and realtime processing for critical alerts.

The key strategic decision would then be **which vertical to target first** rather than whether to build SLA monitoring at all.

---

## 18. Recommended Verticals (Ranked)

| Rank | Vertical               | Rationale                                                    |
| ---- | ---------------------- | ------------------------------------------------------------ |
| 1    | **MSPs**               | Clear SLAs, financial penalties, multiple systems, high pain |
| 2    | **Software Agencies**  | Contract-based SLAs, multiple clients, reputation risk       |
| 3    | **SaaS Companies**     | Customer retention, competitive advantage                    |
| 4    | **Financial Services** | Regulatory requirements, audit needs                         |
| 5    | **Healthcare**         | Compliance, patient impact                                   |

---

## 19. Potential Revenue Models

```text
┌─────────────────────────────────────────────────┐
│             Pricing Tiers                       │
├─────────────────────────────────────────────────┤
│ Starter:    $99/mo    Up to 50 tickets          │
│ Pro:        $299/mo   Up to 500 tickets         │
│ Business:   $799/mo   Up to 2000 tickets        │
│ Enterprise: Custom    Unlimited + SLA assurance │
└─────────────────────────────────────────────────┘
```

### Additional Revenue Streams

- **SLA assurance:** Guarantee breach detection, pay penalty if missed
- **Audit reports:** Exportable compliance packages
- **Consulting:** SLA design and optimization
- **Integration development:** Custom adapters

---

## 20. Risks and Mitigations

| Risk                            | Mitigation                                     |
| ------------------------------- | ---------------------------------------------- |
| Competition from existing tools | Focus on OLA + attribution, not just SLA       |
| Integration complexity          | Start with 2-3 popular tools, expand gradually |
| Data privacy concerns           | On-premise option, SOC2 compliance             |
| Price sensitivity               | Clear ROI calculation for financial penalties  |
| Adoption friction               | Simple setup, demo with existing data          |
