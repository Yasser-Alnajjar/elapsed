import {
  compareNormalizedEvents,
  computeElapsedWorkingMinutes,
  createCommitment,
  deriveLegSpans,
  evaluateCommitment,
  evaluateEngineeringLegTarget,
  eventsForPauseFold,
  findCaseCloseEvent,
  legAtTime,
  matchPolicyVersion,
  pauseStatesFor,
  sumLegMinutes,
  type BusinessCalendarVersion,
  type CommitmentKind,
  type CommitmentStatus,
  type EngineeringLegEvaluation,
  type Leg,
  type NormalizedEvent,
  type SLAPolicyVersion,
} from "@sla/core";
import { correlateExport, type LinkCoverage } from "./correlate";
import type { JiraParseResult, StatusCategorySource } from "./jira";
import type { ZendeskParseResult } from "./zendesk";

export const LEGS: Leg[] = ["support", "engineering", "waiting_customer", "unknown"];
const LIST_LIMIT = 10;
const TOP_ACCOUNTS_LIMIT = 5;

export interface AnalysisOptions {
  policyVersions: SLAPolicyVersion[];
  calendar: BusinessCalendarVersion;
  asOf: string;
  engineeringTargetMinutes?: number;
  zendeskSubdomain?: string;
}

export interface CaseResult {
  ticketId: string;
  subject: string | null;
  account: string | null;
  priority: string | null;
  openedAt: string;
  closedAt: string | null;
  jiraKeys: string[];
  targetMinutes: number | null;
  status: CommitmentStatus | null;
  breachedByMinutes: number | null;
  /** Who owned the case when its working-time clock crossed the target. */
  legAtBreach: Leg | null;
  legMinutes: Record<Leg, number>;
  currentLeg: Leg | null;
  engineering: EngineeringLegEvaluation | null;
  zendeskBreached: boolean | undefined;
  legWarnings: number;
}

export interface AccountRow {
  account: string;
  escalated: number;
  breached: number;
}

export interface DropSummary {
  file: string;
  rows: number;
  used: number;
  dropped: { reason: string; count: number }[];
}

export interface Findings {
  asOf: string;
  periodStart: string | null;
  periodEnd: string | null;
  targets: { priority: string | null; minutes: number }[];
  calendar: BusinessCalendarVersion;
  pauseOnStates: string[];
  engineeringTargetMinutes: number | null;

  tickets: number;
  ticketsWithoutTarget: number;
  breached: number;
  escalated: { cases: number; evaluated: number; breached: number };
  notEscalated: { cases: number; evaluated: number; breached: number };
  coverage: LinkCoverage;

  /** Escalated cases only: total minutes in each leg across all of them. */
  legTotals: Record<Leg, number>;
  breachLegs: Record<Leg, number>;
  zendeskTimer: {
    columnPresent: boolean;
    compared: number;
    agree: number;
    engineBreachedZendeskNot: CaseResult[];
    zendeskBreachedEngineNot: CaseResult[];
  };
  agingInEngineering: { total: number; cases: CaseResult[] };
  engineeringTarget: { breached: number; atRisk: number } | null;
  worstEscalatedBreaches: CaseResult[];
  topAccounts: AccountRow[];

  dataQuality: {
    files: DropSummary[];
    assumedJiraStatuses: { name: string; category: string; source: StatusCategorySource }[];
    unknownJiraStatuses: { name: string; rows: number }[];
    issuesWithoutChangelog: string[];
    casesWithLegWarnings: number;
    /** Solved/closed in the tickets export, but no audit row shows the transition: left out of target evaluation. */
    closedTicketsWithoutHistory: string[];
  };

  cases: CaseResult[];
}

type DerivedEvent = Pick<NormalizedEvent, "type" | "occurredAt" | "actor" | "fromState" | "toState" | "sourceRawEventId" | "sourceSequence">;

function toDomainEvents(
  caseId: string,
  system: NormalizedEvent["system"],
  sourceRole: NormalizedEvent["sourceRole"],
  derived: DerivedEvent[],
): NormalizedEvent[] {
  return derived.map((event, index) => ({
    id: `${event.sourceRawEventId}#${index}`,
    caseId,
    type: event.type,
    occurredAt: event.occurredAt,
    actor: event.actor,
    system,
    sourceRole,
    fromState: event.fromState,
    toState: event.toState,
    sourceRawEventId: event.sourceRawEventId,
    sourceSequence: event.sourceSequence,
  }));
}

/**
 * The instant the working-time clock crossed `targetMinutes`, found by
 * bisecting `computeElapsedWorkingMinutes` (monotonic in time) to the
 * minute. Not `dueAt`: that ignores pauses, so a case that waited on the
 * customer breached later than its original due date. The clock is measured
 * from `startedAt`, as `evaluateCommitment` measures it.
 */
function breachInstant(
  kind: CommitmentKind,
  events: NormalizedEvent[],
  policyVersion: SLAPolicyVersion,
  calendar: BusinessCalendarVersion,
  startedAt: string,
  endAt: string,
  targetMinutes: number,
): string {
  let lo = new Date(startedAt).getTime();
  let hi = new Date(endAt).getTime();
  while (hi - lo > 60_000) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const { elapsedWorkingMinutes } = computeElapsedWorkingMinutes(
      eventsForPauseFold(kind, events),
      pauseStatesFor(kind, policyVersion),
      calendar,
      { start: startedAt, end: new Date(mid).toISOString() },
    );
    if (elapsedWorkingMinutes > targetMinutes) hi = mid;
    else lo = mid;
  }
  return new Date(hi).toISOString();
}

function emptyLegRecord(): Record<Leg, number> {
  return { support: 0, engineering: 0, waiting_customer: 0, unknown: 0 };
}

function summarizeDrops(file: string, rows: number, used: number, counter: { byReason: Map<string, number> }): DropSummary {
  return {
    file,
    rows,
    used,
    dropped: [...counter.byReason.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export interface ParsedExport {
  zendesk: ZendeskParseResult;
  jira: JiraParseResult;
  rowCounts: { tickets: number; audits: number; issues: number; changelog: number };
}

/**
 * Runs the product's pure engine over a parsed export: the same
 * `matchPolicyVersion` → `createCommitment` → `evaluateCommitment` path the
 * worker uses, and `deriveLegSpans`/`sumLegMinutes` for ownership. Every
 * ticket in the export is evaluated, so escalated cases can be compared with
 * the ones that never left support.
 */
export function analyzeExport(parsed: ParsedExport, options: AnalysisOptions): Findings {
  const { zendesk, jira } = parsed;
  const { calendar, asOf } = options;
  const { links, coverage } = correlateExport(zendesk.cases, jira.issues, options.zendeskSubdomain);

  const keysByTicket = new Map<string, string[]>();
  for (const link of links) {
    const group = keysByTicket.get(link.ticketId);
    if (group) group.push(link.issueKey);
    else keysByTicket.set(link.ticketId, [link.issueKey]);
  }

  const cases: CaseResult[] = [];
  const closedTicketsWithoutHistory: string[] = [];

  for (const [ticketId, zendeskCase] of zendesk.cases) {
    const { ticket } = zendeskCase;
    const caseId = `zendesk:${ticketId}`;
    // Solved in the export but no audit row shows when: evaluating it would
    // run its clock to `asOf` and report a breach that never happened.
    const closedWithoutHistory =
      (ticket.status === "solved" || ticket.status === "closed") &&
      !zendeskCase.events.some((e) => e.type === "case_closed");
    if (closedWithoutHistory) closedTicketsWithoutHistory.push(ticketId);

    const jiraKeys = keysByTicket.get(ticketId) ?? [];
    const events = toDomainEvents(caseId, "zendesk", "ticket_source", zendeskCase.events);
    for (const key of jiraKeys) {
      const issue = jira.issues.get(key)!;
      // Exports carry no link timestamp. The integration usually creates the
      // issue from the ticket, so the issue's creation (never before the
      // ticket opened) stands in for when the escalation happened.
      const linkedAt = issue.issue.fields.created > ticket.created_at ? issue.issue.fields.created : ticket.created_at;
      events.push({
        id: `jira-link:${ticketId}:${key}`,
        caseId,
        type: "issue_linked",
        occurredAt: linkedAt,
        actor: "system",
        system: "jira",
        sourceRole: "work_tracker",
        fromState: null,
        toState: null,
        sourceRawEventId: `jira-link:${ticketId}:${key}`,
      });
      events.push(
        ...toDomainEvents(caseId, "jira", "work_tracker", issue.events.map((e) => ({ ...e, type: "state_changed" as const }))),
      );
    }
    events.sort(compareNormalizedEvents);

    const closeEvent = findCaseCloseEvent(events, asOf);
    const endBound = closeEvent && closeEvent.occurredAt < asOf ? closeEvent.occurredAt : asOf;
    const eventsToEnd = events.filter((e) => e.occurredAt <= endBound);

    const legResult = deriveLegSpans(eventsToEnd, { caseOpenedAt: ticket.created_at });
    const legMinutes = emptyLegRecord();
    for (const leg of LEGS) legMinutes[leg] = sumLegMinutes(legResult.spans, leg, endBound);
    const lastSpan = legResult.spans[legResult.spans.length - 1];
    const currentLeg = closeEvent ? null : (lastSpan?.leg ?? null);

    const policyVersion = matchPolicyVersion(
      {
        caseId,
        attributes: ticket.priority != null ? { priority: ticket.priority } : {},
        priority: ticket.priority ?? undefined,
      },
      options.policyVersions,
    );
    let status: CommitmentStatus | null = null;
    let breachedByMinutes: number | null = null;
    let legAtBreach: Leg | null = null;
    let targetMinutes: number | null = null;
    if (policyVersion && !closedWithoutHistory) {
      const commitment = createCommitment(caseId, "resolution", ticket.created_at, policyVersion, calendar);
      const evaluation = evaluateCommitment(commitment, events, policyVersion, calendar, asOf);
      status = evaluation.status;
      targetMinutes = commitment.targetMinutes;
      if (status === "breached") {
        breachedByMinutes = evaluation.breachedByMinutes ?? 0;
        const at = breachInstant(commitment.kind, events, policyVersion, calendar, commitment.startedAt, endBound, commitment.targetMinutes);
        legAtBreach = legAtTime(legResult.spans, at);
      }
    }

    const engineering =
      options.engineeringTargetMinutes && legMinutes.engineering > 0
        ? evaluateEngineeringLegTarget(
            legMinutes.engineering,
            options.engineeringTargetMinutes,
            currentLeg === "engineering",
          )
        : null;

    cases.push({
      ticketId,
      subject: ticket.subject,
      account: zendeskCase.organization,
      priority: ticket.priority,
      openedAt: ticket.created_at,
      closedAt: closeEvent?.occurredAt ?? null,
      jiraKeys,
      targetMinutes,
      status,
      breachedByMinutes,
      legAtBreach,
      legMinutes,
      currentLeg,
      engineering,
      zendeskBreached: zendeskCase.zendeskBreached,
      legWarnings: legResult.warnings.length,
    });
  }

  cases.sort((a, b) => Number(a.ticketId) - Number(b.ticketId));

  const escalatedCases = cases.filter((c) => c.jiraKeys.length > 0);
  const otherCases = cases.filter((c) => c.jiraKeys.length === 0);
  const group = (list: CaseResult[]) => ({
    cases: list.length,
    evaluated: list.filter((c) => c.status !== null).length,
    breached: list.filter((c) => c.status === "breached").length,
  });

  const legTotals = emptyLegRecord();
  for (const c of escalatedCases) for (const leg of LEGS) legTotals[leg] += c.legMinutes[leg];

  const breachLegs = emptyLegRecord();
  for (const c of cases) if (c.legAtBreach) breachLegs[c.legAtBreach] += 1;

  const compared = cases.filter((c) => c.zendeskBreached !== undefined && c.status !== null);
  const engineBreachedZendeskNot = compared.filter((c) => c.status === "breached" && c.zendeskBreached === false);
  const zendeskBreachedEngineNot = compared.filter((c) => c.status !== "breached" && c.zendeskBreached === true);

  const aging = escalatedCases
    .filter((c) => c.currentLeg === "engineering")
    .sort((a, b) => b.legMinutes.engineering - a.legMinutes.engineering);

  const accounts = new Map<string, AccountRow>();
  for (const c of escalatedCases) {
    const name = c.account ?? "Unknown account";
    const row = accounts.get(name) ?? { account: name, escalated: 0, breached: 0 };
    row.escalated += 1;
    if (c.status === "breached") row.breached += 1;
    accounts.set(name, row);
  }

  const openedDates = cases.map((c) => c.openedAt).sort();

  return {
    asOf,
    periodStart: openedDates[0] ?? null,
    periodEnd: openedDates[openedDates.length - 1] ?? null,
    targets: options.policyVersions.map((pv) => ({
      priority: pv.match.priority?.[0] ?? null,
      minutes: pv.targets[0]!.minutes,
    })),
    calendar,
    pauseOnStates: options.policyVersions[0]?.pauseOnStates ?? [],
    engineeringTargetMinutes: options.engineeringTargetMinutes ?? null,

    tickets: cases.length,
    ticketsWithoutTarget: cases.filter((c) => c.targetMinutes === null).length - closedTicketsWithoutHistory.length,
    breached: cases.filter((c) => c.status === "breached").length,
    escalated: group(escalatedCases),
    notEscalated: group(otherCases),
    coverage,

    legTotals,
    breachLegs,
    zendeskTimer: {
      columnPresent: zendesk.hasBreachColumn,
      compared: compared.length,
      agree: compared.length - engineBreachedZendeskNot.length - zendeskBreachedEngineNot.length,
      engineBreachedZendeskNot,
      zendeskBreachedEngineNot,
    },
    agingInEngineering: { total: aging.length, cases: aging.slice(0, LIST_LIMIT) },
    engineeringTarget: options.engineeringTargetMinutes
      ? {
          breached: escalatedCases.filter((c) => c.engineering?.status === "breached").length,
          atRisk: escalatedCases.filter((c) => c.engineering?.status === "at_risk").length,
        }
      : null,
    worstEscalatedBreaches: escalatedCases
      .filter((c) => c.status === "breached")
      .sort((a, b) => (b.breachedByMinutes ?? 0) - (a.breachedByMinutes ?? 0))
      .slice(0, LIST_LIMIT),
    topAccounts: [...accounts.values()]
      .sort((a, b) => b.breached - a.breached || b.escalated - a.escalated || a.account.localeCompare(b.account))
      .slice(0, TOP_ACCOUNTS_LIMIT),

    dataQuality: {
      files: [
        summarizeDrops("Zendesk tickets", parsed.rowCounts.tickets, zendesk.cases.size, zendesk.ticketDrops),
        summarizeDrops("Zendesk audits", parsed.rowCounts.audits, zendesk.auditRowsUsed, zendesk.auditDrops),
        summarizeDrops("Jira issues", parsed.rowCounts.issues, jira.issues.size, jira.issueDrops),
        summarizeDrops("Jira changelog", parsed.rowCounts.changelog, jira.changelogRowsUsed, jira.changelogDrops),
      ],
      assumedJiraStatuses: [...jira.statusCategories.values()]
        .filter((s) => s.source !== "flag")
        .sort((a, b) => a.name.localeCompare(b.name)),
      unknownJiraStatuses: [...jira.unknownStatuses.entries()]
        .map(([name, rows]) => ({ name, rows }))
        .sort((a, b) => b.rows - a.rows),
      issuesWithoutChangelog: jira.issuesWithoutChangelog.filter((key) => links.some((l) => l.issueKey === key)),
      casesWithLegWarnings: cases.filter((c) => c.legWarnings > 0).length,
      closedTicketsWithoutHistory,
    },

    cases,
  };
}
