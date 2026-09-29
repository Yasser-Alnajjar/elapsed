/**
 * Ticket timelines. Each scenario returns when a ticket was created, the
 * ordered things that happened to it (replies, status/priority changes) and
 * any Jira escalation. Times are placed with the real business-calendar math
 * from `@sla/core` (`computeDeadline` / `workingMinutesBetween`), so "85% of
 * the first-response target consumed" really is 85% of it on that customer's
 * calendar rather than an accident of wall-clock offsets.
 *
 * Pure: the only time input is `Ctx.anchor`.
 */
import { computeDeadline, workingMinutesBetween, type BusinessCalendarVersion } from "@sla/core";
import type { JiraStatusKey, Priority, ScenarioKey } from "./config";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export type ZStatus = "new" | "open" | "pending" | "hold" | "solved" | "closed";
export type LinkMode = "official" | "remote" | "both" | "stale_official";

export type Step =
  | { at: number; kind: "reply"; by: "agent" | "customer"; status?: ZStatus }
  | { at: number; kind: "note" }
  | { at: number; kind: "status"; to: ZStatus; via?: "automation" }
  | { at: number; kind: "priority"; to: Priority };

export interface IssuePlan {
  /** When the Zendesk<->Jira link was first observed (the escalation instant). */
  linkedAt: number;
  createdAt: number;
  mode: LinkMode | null;
  transitions: { at: number; to: JiraStatusKey }[];
  /** Zendesk's link registry stops reporting this link (Phase B manifest). */
  unlinked?: boolean;
}

export interface Built {
  createdAt: number;
  steps: Step[];
  issues: IssuePlan[];
  agentCreated?: boolean;
  /** Everything at/after this instant is only ingested in Phase B (see seed.ts). */
  stage2From?: number;
  /** The priority a `priority` step moves the ticket to, if the ticket ends up different from where it started. */
  finalPriority?: Priority;
}

export interface Ctx {
  anchor: number;
  cal: BusinessCalendarVersion;
  fr: number;
  res: number;
  nr: number | null;
  /** Position of the ticket in the whole dataset — the only source of variation. */
  n: number;
  priority: Priority | null;
}

export function addWorking(from: number, minutes: number, cal: BusinessCalendarVersion): number {
  return computeDeadline(new Date(from), minutes, cal).getTime();
}

/** The latest instant `s` with `workingMinutesBetween(s, end) >= minutes` (minute granularity). */
export function backWorking(end: number, minutes: number, cal: BusinessCalendarVersion): number {
  if (cal.alwaysOpen) return Math.floor((end - minutes * MIN) / MIN) * MIN;
  let lo = Math.floor((end - 400 * DAY) / MIN);
  let hi = Math.floor(end / MIN);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (workingMinutesBetween(new Date(mid * MIN), new Date(end), cal) >= minutes) lo = mid;
    else hi = mid - 1;
  }
  return lo * MIN;
}

/** A finished ticket's last event must be at least this far before the anchor. */
const M_UPDATE_BUFFER = 3 * HOUR;

function timeline(createdAt: number) {
  const steps: Step[] = [];
  const issues: IssuePlan[] = [];
  let last = createdAt;
  /** Keeps every step strictly after the previous one (Zendesk audits never share an instant here). */
  const next = (at: number) => (last = Math.max(at, last + MIN));
  return {
    steps,
    issues,
    reply(at: number, by: "agent" | "customer", status?: ZStatus): number {
      const when = next(at);
      steps.push({ at: when, kind: "reply", by, ...(status ? { status } : {}) });
      return when;
    },
    status(at: number, to: ZStatus, via?: "automation"): number {
      const when = next(at);
      steps.push({ at: when, kind: "status", to, ...(via ? { via } : {}) });
      return when;
    },
    note(at: number): number {
      const when = next(at);
      steps.push({ at: when, kind: "note" });
      return when;
    },
    priority(at: number, to: Priority): number {
      const when = next(at);
      steps.push({ at: when, kind: "priority", to });
      return when;
    },
    issue(plan: Omit<IssuePlan, "createdAt">): IssuePlan {
      const full: IssuePlan = { ...plan, createdAt: plan.linkedAt - 4 * MIN };
      issues.push(full);
      return full;
    },
    build(extra: Partial<Built> = {}): Built {
      return { createdAt, steps, issues, ...extra };
    },
  };
}

function lastAt(built: Built): number {
  return Math.max(
    built.createdAt,
    ...built.steps.map((s) => s.at),
    ...built.issues.flatMap((i) => [i.linkedAt, ...i.transitions.map((t) => t.at)]),
  );
}

/**
 * A ticket that lives entirely in the past: start somewhere in the last
 * month, and if the story would not have finished before "now" push it back a
 * whole week at a time (weekly shifts keep the business-hours alignment).
 */
function historical(c: Ctx, build: (t0: number) => Built): Built {
  let t0 = c.anchor - (4 + ((c.n * 5) % 20)) * DAY - ((c.n * 23) % 11) * 17 * MIN;
  t0 = Math.floor(t0 / MIN) * MIN;
  for (let attempt = 0; attempt < 10; attempt++) {
    const built = build(t0);
    if (lastAt(built) <= c.anchor - M_UPDATE_BUFFER) return built;
    t0 -= 7 * DAY;
  }
  throw new Error(`ticket ${c.n}: could not fit a historical scenario before the anchor`);
}

/** Working-time offset from a start instant on the ticket's own SLA calendar. */
const clock = (c: Ctx) => (from: number, minutes: number) => addWorking(from, Math.max(1, Math.round(minutes)), c.cal);

/** Latest an escalation may be observed: keeps every link before the Zendesk link manifest (seed.ts). */
const linkCap = (c: Ctx) => c.anchor - 2 * HOUR;
/** Latest a Jira transition may land. */
const jiraCap = (c: Ctx) => c.anchor - 25 * MIN;

/**
 * Still waiting on a first reply `elapsedMinutes` (working time) after creation. Not silent: an agent
 * has opened the ticket and the customer has chased once — neither completes First Response.
 */
function awaitingFirstReply(c: Ctx, elapsedMinutes: number): Built {
  const t0 = backWorking(c.anchor, elapsedMinutes, c.cal);
  const w = clock(c);
  const t = timeline(t0);
  t.status(w(t0, 0.1 * elapsedMinutes), "open");
  t.reply(w(t0, 0.55 * elapsedMinutes), "customer");
  return t.build();
}

function requireNr(c: Ctx): number {
  if (c.nr === null) throw new Error(`ticket ${c.n}: scenario needs a next_reply target but priority ${c.priority} has none`);
  return c.nr;
}

export const SCENARIOS: Record<ScenarioKey, (c: Ctx) => Built> = {
  // ---- closed, before "now" ------------------------------------------------
  met_fast: (c) =>
    historical(c, (t0) => {
      const w = clock(c);
      const t = timeline(t0);
      t.reply(w(t0, 0.25 * c.fr), "agent", "open");
      t.reply(w(t0, 0.08 * c.res), "customer");
      t.reply(w(t0, 0.12 * c.res), "agent", "pending");
      t.reply(w(t0, 0.25 * c.res), "customer", "open");
      t.reply(w(t0, 0.35 * c.res), "agent", "solved");
      return t.build();
    }),

  met_edge: (c) =>
    historical(c, (t0) => {
      const w = clock(c);
      const t = timeline(t0);
      t.reply(w(t0, 0.93 * c.fr), "agent", "open");
      t.note(w(t0, 0.5 * c.res));
      t.reply(w(t0, 0.9 * c.res), "customer");
      t.reply(w(t0, 0.95 * c.res), "agent", "solved");
      return t.build();
    }),

  fr_breached_closed: (c) =>
    historical(c, (t0) => {
      const w = clock(c);
      const t = timeline(t0);
      t.reply(w(t0, 1.6 * c.fr), "agent", "open");
      t.reply(w(t0, 0.5 * c.res), "customer");
      t.reply(w(t0, 0.7 * c.res), "agent", "solved");
      return t.build();
    }),

  res_breached_closed: (c) =>
    historical(c, (t0) => {
      const w = clock(c);
      const t = timeline(t0);
      t.reply(w(t0, 0.3 * c.fr), "agent", "open");
      t.reply(w(t0, 0.2 * c.res), "customer");
      t.reply(w(t0, 0.3 * c.res), "agent", "pending");
      t.reply(w(t0, 0.6 * c.res), "customer", "open");
      t.reply(w(t0, 1.35 * c.res), "agent", "solved");
      return t.build();
    }),

  both_breached_closed: (c) =>
    historical(c, (t0) => {
      const w = clock(c);
      const t = timeline(t0);
      t.reply(w(t0, 1.8 * c.fr), "agent", "open");
      t.reply(w(t0, 0.8 * c.res), "customer");
      t.reply(w(t0, 1.5 * c.res), "agent", "solved");
      return t.build();
    }),

  /** A reply-less close is never "met" for first response (D5). */
  replyless_close: (c) =>
    historical(c, (t0) => {
      const w = clock(c);
      const t = timeline(t0);
      t.reply(w(t0, 0.3 * c.fr), "customer");
      t.status(w(t0, 0.5 * c.fr), "solved");
      return t.build();
    }),

  reopened_closed: (c) =>
    historical(c, (t0) => {
      const w = clock(c);
      const t = timeline(t0);
      t.reply(w(t0, 0.3 * c.fr), "agent", "open");
      const solved = t.reply(w(t0, 0.3 * c.res), "agent", "solved");
      const reopened = t.reply(solved + DAY, "customer", "open");
      t.reply(w(reopened, 0.15 * c.res), "agent", "solved");
      return t.build();
    }),

  closed_auto: (c) =>
    historical(c, (t0) => {
      const w = clock(c);
      const t = timeline(t0);
      t.reply(w(t0, 0.3 * c.fr), "agent", "open");
      const solved = t.reply(w(t0, 0.4 * c.res), "agent", "solved");
      // Zendesk's own automation closes a solved ticket days later: a second case_closed that must not reopen anything.
      t.status(solved + 4 * DAY, "closed", "automation");
      return t.build();
    }),

  agent_created_met: (c) =>
    historical(c, (t0) => {
      const w = clock(c);
      const t = timeline(t0);
      t.status(t0 + MIN, "open");
      // First-response clock only starts at the customer's first reply (D5b).
      const customerReply = t.reply(t0 + 40 * MIN, "customer");
      t.reply(w(customerReply, 0.6 * c.fr), "agent");
      t.reply(w(customerReply, 0.15 * c.res), "customer");
      t.reply(w(customerReply, 0.3 * c.res), "agent", "solved");
      return t.build({ agentCreated: true });
    }),

  // ---- still open at the anchor --------------------------------------------
  open_healthy: (c) => {
    const t0 = backWorking(c.anchor, 0.3 * c.res, c.cal);
    const w = clock(c);
    const t = timeline(t0);
    t.reply(w(t0, 0.2 * c.fr), "agent", "open");
    t.reply(w(t0, 0.1 * c.res), "customer");
    t.reply(w(t0, 0.14 * c.res), "agent");
    return t.build();
  },

  open_fr_on_track: (c) => awaitingFirstReply(c, 0.3 * c.fr),
  open_fr_at_risk: (c) => awaitingFirstReply(c, 0.87 * c.fr),
  open_fr_breached: (c) => awaitingFirstReply(c, 1.6 * c.fr),

  open_res_at_risk: (c) => {
    const t0 = backWorking(c.anchor, 0.9 * c.res, c.cal);
    const w = clock(c);
    const t = timeline(t0);
    t.reply(w(t0, 0.3 * c.fr), "agent", "open");
    t.reply(w(t0, 0.2 * c.res), "customer");
    t.reply(w(t0, 0.25 * c.res), "agent");
    return t.build();
  },

  open_res_breached: (c) => {
    const t0 = backWorking(c.anchor, 1.3 * c.res, c.cal);
    const w = clock(c);
    const t = timeline(t0);
    t.reply(w(t0, 0.4 * c.fr), "agent", "open");
    t.reply(w(t0, 0.3 * c.res), "customer");
    t.reply(w(t0, 0.4 * c.res), "agent");
    return t.build();
  },

  pending_customer: (c) => {
    const t0 = backWorking(c.anchor, 0.5 * c.res, c.cal);
    const w = clock(c);
    const t = timeline(t0);
    // Native policies pause Resolution while pending; imported ones never do (H-12).
    t.reply(w(t0, 0.3 * c.fr), "agent", "pending");
    return t.build();
  },

  on_hold: (c) => {
    const t0 = backWorking(c.anchor, 0.45 * c.res, c.cal);
    const w = clock(c);
    const t = timeline(t0);
    t.reply(w(t0, 0.3 * c.fr), "agent", "open");
    t.status(w(t0, 0.2 * c.res), "hold");
    return t.build();
  },

  multi_reply_nr_at_risk: (c) => {
    const nr = requireNr(c);
    const customerReplyAt = backWorking(c.anchor, 0.87 * nr, c.cal);
    const t0 = backWorking(customerReplyAt, 0.3 * c.res, c.cal);
    const w = clock(c);
    const t = timeline(t0);
    t.reply(w(t0, 0.2 * c.fr), "agent", "open");
    t.reply(w(t0, 0.1 * c.res), "customer");
    t.reply(w(t0, 0.15 * c.res), "agent");
    t.reply(customerReplyAt, "customer");
    return t.build();
  },

  next_reply_breached: (c) => {
    const nr = requireNr(c);
    const customerReplyAt = backWorking(c.anchor, 1.6 * nr, c.cal);
    const t0 = backWorking(customerReplyAt, 0.3 * c.res, c.cal);
    const w = clock(c);
    const t = timeline(t0);
    t.reply(w(t0, 0.2 * c.fr), "agent", "open");
    t.reply(w(t0, 0.1 * c.res), "customer");
    t.reply(w(t0, 0.15 * c.res), "agent");
    t.reply(customerReplyAt, "customer");
    return t.build();
  },

  reopened_open: (c) => {
    const reopenedAt = backWorking(c.anchor, 0.25 * c.res, c.cal);
    const solvedAt = reopenedAt - 2 * HOUR;
    const t0 = backWorking(solvedAt, 0.3 * c.res, c.cal);
    const w = clock(c);
    const t = timeline(t0);
    t.reply(w(t0, 0.2 * c.fr), "agent", "open");
    t.reply(solvedAt, "agent", "solved");
    t.reply(reopenedAt, "customer", "open");
    return t.build();
  },

  agent_created_open_at_risk: (c) => {
    const customerReplyAt = backWorking(c.anchor, 0.87 * c.fr, c.cal);
    const t0 = customerReplyAt - 2 * HOUR;
    const t = timeline(t0);
    t.status(t0 + MIN, "open");
    t.reply(customerReplyAt, "customer");
    return t.build({ agentCreated: true });
  },

  vip_tagged_open_at_risk: (c) => awaitingFirstReply(c, 0.9 * c.fr),

  /**
   * Created as `normal`, bumped to `urgent` two days ago. Phase A only knows the
   * first half; Phase B delivers the bump, and re-resolution moves the still
   * active commitments onto the urgent policy (a CommitmentPolicyChange row).
   */
  priority_bump: (c) => {
    const bumpAt = c.anchor - 2 * DAY - HOUR;
    const t0 = backWorking(bumpAt, 0.25 * c.res, c.cal);
    const w = clock(c);
    const t = timeline(t0);
    t.reply(w(t0, 0.3 * c.fr), "agent", "open");
    t.reply(w(t0, 0.1 * c.res), "customer");
    t.priority(bumpAt, "urgent");
    t.reply(bumpAt + 90 * MIN, "agent");
    return t.build({ stage2From: bumpAt, finalPriority: "urgent" });
  },

  // ---- Zendesk -> Jira escalations -------------------------------------------
  escalated_in_progress: (c) => {
    const t0 = backWorking(c.anchor, 0.55 * c.res, c.cal);
    const w = clock(c);
    const t = timeline(t0);
    t.reply(w(t0, 0.3 * c.fr), "agent", "open");
    const linkedAt = Math.min(w(t0, 0.25 * c.res), linkCap(c));
    t.issue({
      linkedAt,
      mode: null,
      transitions: [{ at: Math.min(linkedAt + 2 * HOUR, jiraCap(c)), to: "inprogress" }],
    });
    return t.build();
  },

  escalated_in_review: (c) => {
    const t0 = backWorking(c.anchor, 0.85 * c.res, c.cal);
    const w = clock(c);
    const t = timeline(t0);
    t.reply(w(t0, 0.3 * c.fr), "agent", "open");
    const linkedAt = Math.min(w(t0, 0.3 * c.res), linkCap(c));
    t.status(linkedAt + 2 * MIN, "hold");
    const span = jiraCap(c) - linkedAt;
    t.issue({
      linkedAt,
      mode: null,
      transitions: [
        { at: linkedAt + Math.floor(span * 0.25), to: "inprogress" },
        { at: linkedAt + Math.floor(span * 0.6), to: "inreview" },
      ],
    });
    return t.build();
  },

  /** Long-running engineering leg, well past the org's OLA target, ticket past its Resolution target. */
  escalated_blocked_breached: (c) => {
    const t0 = backWorking(c.anchor, 1.25 * c.res, c.cal);
    const w = clock(c);
    const t = timeline(t0);
    t.reply(w(t0, 0.4 * c.fr), "agent", "open");
    const linkedAt = Math.min(w(t0, 0.2 * c.res), linkCap(c));
    const span = jiraCap(c) - linkedAt;
    t.issue({
      linkedAt,
      mode: null,
      transitions: [
        { at: linkedAt + Math.floor(span * 0.2), to: "inprogress" },
        { at: linkedAt + Math.floor(span * 0.5), to: "blocked" },
      ],
    });
    return t.build();
  },

  /** Jira finishes first, then support solves the ticket. */
  escalated_done_solved: (c) =>
    historical(c, (t0) => {
      const w = clock(c);
      const t = timeline(t0);
      t.reply(w(t0, 0.3 * c.fr), "agent", "open");
      const linkedAt = w(t0, 0.3 * c.res);
      const inProgress = w(linkedAt, 0.05 * c.res);
      const inReview = w(linkedAt, 0.12 * c.res);
      const done = w(linkedAt, 0.2 * c.res);
      t.issue({
        linkedAt,
        mode: null,
        transitions: [
          { at: inProgress, to: "inprogress" },
          { at: inReview, to: "inreview" },
          { at: done, to: "done" },
        ],
      });
      t.reply(w(done, 0.04 * c.res), "agent", "solved");
      return t.build();
    }),

  /** Engineering is done but the ticket is still open on the support side. */
  escalated_done_open: (c) => {
    const t0 = backWorking(c.anchor, 0.6 * c.res, c.cal);
    const w = clock(c);
    const t = timeline(t0);
    t.reply(w(t0, 0.3 * c.fr), "agent", "open");
    const linkedAt = Math.min(w(t0, 0.2 * c.res), linkCap(c));
    t.status(linkedAt + 2 * MIN, "hold");
    t.issue({
      linkedAt,
      mode: null,
      transitions: [
        { at: Math.min(w(linkedAt, 0.04 * c.res), jiraCap(c)), to: "inprogress" },
        { at: Math.min(w(linkedAt, 0.15 * c.res), jiraCap(c)), to: "done" },
      ],
    });
    return t.build();
  },

  escalated_multi_issue: (c) => {
    const t0 = backWorking(c.anchor, 0.7 * c.res, c.cal);
    const w = clock(c);
    const t = timeline(t0);
    t.reply(w(t0, 0.3 * c.fr), "agent", "open");
    const first = Math.min(w(t0, 0.2 * c.res), linkCap(c) - HOUR);
    const second = Math.min(w(t0, 0.3 * c.res), linkCap(c));
    t.issue({
      linkedAt: first,
      mode: null,
      transitions: [
        { at: w(first, 0.05 * c.res), to: "inprogress" },
        { at: w(first, 0.2 * c.res), to: "done" },
      ],
    });
    t.issue({
      linkedAt: second,
      mode: null,
      transitions: [{ at: Math.min(w(second, 0.05 * c.res), jiraCap(c)), to: "inprogress" }],
    });
    return t.build();
  },

  /** Linked, then Zendesk's registry stops reporting the link (Phase B): CaseLink.unlinkedAt + issue_unlinked. */
  escalated_unlinked: (c) => {
    const t0 = backWorking(c.anchor, 0.5 * c.res, c.cal);
    const w = clock(c);
    const t = timeline(t0);
    t.reply(w(t0, 0.3 * c.fr), "agent", "open");
    const linkedAt = Math.min(w(t0, 0.2 * c.res), linkCap(c));
    t.issue({
      linkedAt,
      mode: "official",
      unlinked: true,
      transitions: [{ at: Math.min(w(linkedAt, 0.05 * c.res), jiraCap(c)), to: "inprogress" }],
    });
    return t.build();
  },
};
