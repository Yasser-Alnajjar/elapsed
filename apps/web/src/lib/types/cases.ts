import type { PriorityTier } from "../format";
import type {
  CanonicalPriority,
  ClockState,
  CommitmentKind,
  CommitmentStatus,
  EngineeringLegEvaluation,
  Leg,
  LegSpan,
  NormalizedEventType,
  NormalizedState,
  PausedInterval,
  SLAPolicyMatch,
  WeeklyWindow,
} from "@sla/core";
import type { IntegrationProvider } from "./integrations";

export interface CommitmentDetail {
  id: string;
  kind: CommitmentKind;
  /**
   * Which cycle of `kind` this commitment covers (`Commitment.cycleKey`):
   * `"single"` for first_response/resolution, a Next Reply cycle's own stable
   * key otherwise — a case can have several `next_reply` commitments at
   * once, and this is what tells them apart. Opaque; not a display label.
   */
  cycleKey: string;
  status: CommitmentStatus;
  startedAt: string;
  targetMinutes: number;
  closedAt: string | null;
  elapsedSeconds: number;
  remainingSeconds: number;
  breachedBySeconds: number | null;
  /** The SLA clock at `asOf`, from the same evaluation as the numbers above. */
  clockState: ClockState;
  pausedSince: string | null;
  /**
   * The pause-aware deadline (or breach instant) from `evaluateCommitment`;
   * null while paused before the target, since no due time is knowable
   * then. The stored `Commitment.dueAt` is deliberately not exposed here:
   * it is a nominal startedAt + target that ignores pauses.
   */
  effectiveDueAt: string | null;
  /**
   * The states that pause this commitment's clock (`pauseStatesFor`) — not
   * the policy version's configured `pauseOnStates`, which not every kind
   * honors (first response never pauses).
   */
  pauseOnStates: NormalizedState[];
  policyVersion: {
    id: string;
    /** The policy's own name (`SLAPolicy.name`), joined in — a version carries no name of its own. */
    name: string;
    version: number;
    match: SLAPolicyMatch;
    warnAtPercent: number[];
    effectiveFrom: string;
  };
  calendar: {
    id: string;
    version: number;
    timezone: string;
    weekly: WeeklyWindow[];
    holidays: string[];
    alwaysOpen: boolean;
    /**
     * Which tier of the resolution order (`Customer.calendarId` override >
     * the policy's own explicit calendar > the organization's default
     * calendar > Always Open, 4i) produced this commitment's frozen
     * `calendarVersionId` — derived by comparing it against the customer's
     * own frozen override and the policy version's own `calendarVersionId`,
     * mirroring `resolveCommitmentCalendarVersion`/
     * `resolveEffectiveCalendarVersion` (packages/commitments).
     * `organization_default` also covers the Always Open fallback tier — the
     * calendar's own `alwaysOpen` flag already makes that case visually
     * distinct.
     */
    source: "customer_override" | "policy" | "organization_default";
  };
  /**
   * When the clock actually stopped because the commitment completed
   * (`clockState === "stopped"`) — the completing event's own `occurredAt`,
   * exact to the millisecond (3.3's "met" lifecycle marker; also the breach
   * instant on a completed reply-less-close breach, though `effectiveDueAt`
   * already covers breach display). Null while still open.
   */
  completionOccurredAt: string | null;
  /**
   * Every Active-Commitment Re-Resolution that changed this commitment's
   * target in place (`CommitmentPolicyChange`), oldest first (3.4).
   */
  targetChangeHistory: {
    changedAt: string;
    previousTargetMinutes: number;
    newTargetMinutes: number;
    reason: string;
  }[];
}

export interface CaseLinkDetail {
  system: IntegrationProvider;
  externalId: string;
  url: string | null;
  method: string;
  confidence: string;
  statusName: string | null;
}

/**
 * Synthetic timeline rows (3.2/3.3) with no `NormalizedEvent` of their own —
 * derived entirely from existing data (`CommitmentPolicyChange`, the live
 * evaluation, and persisted `Notification` rows), nothing new stored.
 */
export type SyntheticTimelineEventType =
  | "policy_changed"
  | "commitment_started"
  | "commitment_at_risk"
  | "commitment_breached"
  | "commitment_met"
  | "commitment_cancelled";

export interface TimelineEventDetail {
  id: string;
  occurredAt: string;
  actor: string;
  system: string;
  type: NormalizedEventType | SyntheticTimelineEventType;
  /**
   * A `NormalizedState` for every real `NormalizedEvent`-backed type except
   * `priority_changed`, which carries a `CanonicalPriority` instead (see
   * `NormalizedEvent`, @sla/core). Always null for a synthetic row.
   */
  fromState: NormalizedState | CanonicalPriority | null;
  toState: NormalizedState | CanonicalPriority | null;
  /** Set only on a synthetic row — which commitment it's about. */
  commitmentKind?: CommitmentKind;
  /** `policy_changed` only. */
  previousTargetMinutes?: number;
  /** `policy_changed` only. */
  newTargetMinutes?: number;
  /** `policy_changed` only — the re-resolution's reason code (e.g. `"policy_switched"`). */
  reason?: string;
  /** `commitment_at_risk` only — the `warnAtPercent` threshold crossed. */
  thresholdPercent?: number;
}

/**
 * One public message in the case's conversation — an `agent_replied` or
 * `customer_replied` `NormalizedEvent` with its source text attached. Never
 * built from an inference on a name or email: `actor` is carried straight
 * through from the already-resolved `NormalizedEvent.actor` (Zendesk role /
 * Intercom author type), the same field the SLA engine itself trusts.
 *
 * Excludes private/internal notes: they are never derived into
 * `NormalizedEvent` in the first place (see `isPublicCommentEvent` in
 * @sla/zendesk and `isVisibleMessagePart` in @sla/intercom), so there is no
 * normalized record of them to surface here yet.
 */
export interface ConversationMessageDetail {
  /** The source `NormalizedEvent.id` — stable within one render, not across normalization re-runs. */
  id: string;
  occurredAt: string;
  /**
   * `"system"` only for a ticket's opening message on a ticket created by a
   * trigger/automation/rule (3.7) — no reply of that kind exists otherwise.
   */
  actor: "customer" | "agent" | "system";
  /**
   * `"case_created"` only for the synthetic opening-message entry on a
   * system-created ticket — every other message is a real reply.
   */
  type: "agent_replied" | "customer_replied" | "case_created";
  /**
   * The message's own author name, when the source system carries one
   * (Intercom always does; Zendesk only when the author is provably the
   * case's requester — Zendesk otherwise never persists a comment author's
   * name, only their role). Null falls back to a generic "Customer"/"Agent"
   * label in the UI — never guessed from an email or the case's requester
   * name when that link can't be confirmed.
   */
  authorName: string | null;
  /**
   * True only when this message is confirmed to be from the case's own
   * requester (3.7's "customer / agent / requester" sender labels) — never
   * guessed; Zendesk confirms this by comment author id, the opening
   * message by construction. Undefined (not false) otherwise.
   */
  isRequester?: boolean;
  /** Plain text, safe to render without HTML interpretation. */
  body: string;
}

export interface LegTotal {
  leg: Leg;
  minutes: number;
}

export interface CaseListRow {
  caseId: string;
  /** The ticket source the case came from (`Case.system`). */
  system: IntegrationProvider;
  externalId: string;
  subject: string | null;
  /** The case's account/company (Zendesk Organization / Intercom Company), or null when the ticket has none. Never falls back to `requesterName` — a requester is not a customer. */
  customerName: string | null;
  /** The individual who submitted the ticket (e.g. a Zendesk ticket's requester), or null when unknown. Independent of `customerName` — never merged with it. */
  requesterName: string | null;
  priority: string | null;
  tier: string | null;
  channel: string | null;
  openedAt: string;
  closedAt: string | null;
  /** Worst-precedence status across the case's commitments, or null if it has none. */
  worstCommitmentStatus: CommitmentStatus | null;
  /** The case's current support-side assignee (`Case.assigneeName`), or null when unassigned. */
  assigneeName: string | null;
  /**
   * The case's primary correlated record (e.g. the linked Jira issue), or
   * null when nothing is currently linked. A Zendesk `CaseLink` never
   * occurs — the case itself is the Zendesk side — so this is always the
   * "other" system, mirroring `CaseDetailData.links[0]`.
   */
  primaryLink: {
    system: IntegrationProvider;
    externalId: string;
    confidence: "certain" | "probable";
    /** Jira's live status name (e.g. "In Progress"), stashed into evidence by the normalizer — see `CaseLinkDetail.statusName`. Null when unavailable. */
    statusName: string | null;
  } | null;
  /**
   * A snapshot of this case's worst-precedence still-open commitment, or
   * null when the case has no open commitment right now (e.g. it's closed).
   * `remainingMinutes`/`elapsedSeconds` are derived from persisted
   * `Commitment.dueAt`/`startedAt` (ignores pauses — the same approximation
   * `getAlertSummary`'s layout alerts already use), not from a live
   * `evaluateCommitment` run: the case list never loads events or evaluates.
   * No leg-minute fields — those need per-case events, which are out of
   * scope here (still available live on the case-detail page).
   */
  liveCommitment: {
    kind: CommitmentKind;
    status: CommitmentStatus;
    targetMinutes: number;
    remainingMinutes: number;
    elapsedSeconds: number;
  } | null;
  /**
   * The final outcome of the case's worst commitment when there is no open
   * one (closed case / settled commitments): the latest persisted
   * `Evaluation`'s elapsed vs. target. `elapsedSeconds` is null when no
   * evaluation has been recorded yet. No leg-minute fields (see
   * `liveCommitment`). Null while `liveCommitment` is set, or when the case
   * has no commitment at all.
   */
  settledCommitment: {
    kind: CommitmentKind;
    status: CommitmentStatus;
    targetMinutes: number;
    elapsedSeconds: number | null;
  } | null;
}

export type CaseListStatusFilter = "all" | CommitmentStatus;
export type CaseListOpenFilter = "all" | "open" | "closed";
export type CaseListLinkFilter = "all" | "linked" | "unlinked";
export type CaseListSeverityFilter = "all" | PriorityTier;
/**
 * A sortable case-list column id (matches the `ColumnDef.id`s in
 * `csr/columns.tsx`), not the underlying database field it maps to — see
 * `SORT_COLUMNS` in `case-list-data.ts`. `null`/omitted means the default
 * (`openedAt` desc).
 */
export type CaseListSortId = "priorityDualKey" | "subject" | "currentStateAssignee";

export interface CaseListParams {
  page: number;
  pageSize: number;
  sort: { id: CaseListSortId; desc: boolean } | null;
  status: CaseListStatusFilter;
  openState: CaseListOpenFilter;
  linkState: CaseListLinkFilter;
  severity: CaseListSeverityFilter;
  q: string;
}

export interface CaseListCounts {
  status: Record<CaseListStatusFilter, number>;
  open: Record<CaseListOpenFilter, number>;
  link: Record<CaseListLinkFilter, number>;
  severity: Record<CaseListSeverityFilter, number>;
  /** Cases with at least one still-open commitment — the "SLA clock running" metric tile. */
  runningClock: number;
  /** Cases whose primary link is `certain` confidence — the "linked, certain" metric tile. */
  linkedCertain: number;
}

export interface CaseListData {
  asOf: string;
  cases: CaseListRow[];
  page: number;
  pageSize: number;
  pageCount: number;
  rowCount: number;
  counts: CaseListCounts;
}

export interface CaseDetailData {
  asOf: string;
  case: {
    id: string;
    externalId: string;
    subject: string | null;
    priority: string | null;
    tier: string | null;
    channel: string | null;
    openedAt: string;
    closedAt: string | null;
    /** The case's account/company (Zendesk Organization / Intercom Company), or null when the ticket has none. Never falls back to `requesterName` — a requester is not a customer. */
    customerName: string | null;
    /** The individual who submitted the ticket (e.g. a Zendesk ticket's requester), or null when unknown. Independent of `customerName` — never merged with it. */
    requesterName: string | null;
    /**
     * The currently-assigned agent's display name (Zendesk `assignee_id` /
     * Intercom `admin_assignee_id`, resolved to a name). Display only
     * (D10/3.6) — never used for matching or routing. Null when the case has
     * no current assignee, or the source/normalizer doesn't resolve one.
     */
    assigneeName: string | null;
    /**
     * The case's current ticket status (3.5) — the `toState` of its most
     * recent state-bearing `NormalizedEvent` (`case_created`/`state_changed`/
     * `case_closed`), derived at read time from the same event stream the
     * timeline and engine use. Null for a case with no events yet.
     */
    status: NormalizedState | null;
    /** Which ticket source created this case. */
    system: IntegrationProvider;
    /** Outbound link to the source ticket (Zendesk ticket or Intercom conversation), when buildable. */
    ticketUrl: string | null;
    /** Freshness metadata; it never changes the SLA calculation. */
    sourceStaleSince?: string | null;
    /** Source integration has never completed a successful sync (no meaningful stale-since instant). */
    sourceNeverSynced?: boolean;
  };
  currentLeg: Leg;
  commitments: CommitmentDetail[];
  legSpans: (LegSpan & { endedAt: string })[];
  legTotals: LegTotal[];
  engineeringLegTarget: EngineeringLegEvaluation | null;
  runningIntervals: { start: string; end: string }[];
  pausedIntervals: PausedInterval[];
  timeline: TimelineEventDetail[];
  /** Every public customer/agent message, in the same deterministic order as `timeline` — see `ConversationMessageDetail`. */
  conversation: ConversationMessageDetail[];
  links: CaseLinkDetail[];
}
