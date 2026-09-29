/**
 * Turns the static config + ticket scenarios into the exact provider payloads
 * (Zendesk tickets/audits/organizations/SLA policies/schedules/Jira links,
 * Jira issues/changelogs/remote links/statuses) that a real backfill would
 * have stored as `RawEvent`s. They are built with the packages' own
 * `map*ToRawEvent` mappers, so the ids and hashes match what production
 * writes, and the real normalizers/correlators/pipelines can then derive
 * everything else.
 *
 * Pure and deterministic: `buildSeedDataset(anchor)` reads no clock, no
 * environment and no random source.
 */
import type { BusinessCalendarVersion } from "@sla/core";
import {
  expandHolidayDates,
  intervalsToWeeklyWindows,
  mapAuditToRawEvent,
  mapBusinessHoursScheduleToRawEvent,
  mapJiraLinkManifestToRawEvent,
  mapJiraLinkToRawEvent,
  mapOrganizationToRawEvent,
  mapScheduleHolidaysToRawEvent,
  mapSlaPolicyManifestToRawEvent,
  mapSlaPolicyToRawEvent,
  mapTicketToRawEvent,
  mapUserToRawEvent,
  type ZendeskAudit,
  type ZendeskBusinessHoursSchedule,
  type ZendeskJiraLink,
  type ZendeskOrganization,
  type ZendeskSlaPolicy,
  type ZendeskTicket,
  type ZendeskUser,
} from "@sla/zendesk";
import {
  mapChangelogHistoryToRawEvent,
  mapIssueToRawEvent,
  mapRemoteLinkManifestToRawEvent,
  mapRemoteLinkToRawEvent,
  mapStatusToRawEvent,
  type JiraChangelogHistory,
  type JiraIssue,
  type JiraRemoteLink,
} from "@sla/jira";
import {
  AGENT_REPLIES,
  CUSTOMER_REPLIES,
  DACH_TARGETS,
  EMEA_TARGETS,
  ENGINEERING_SUBJECTS,
  ENTERPRISE_TARGETS,
  GENERAL_SUBJECTS,
  NATIVE_TARGETS,
  NO_POLICY_PLACEHOLDER,
  PRODUCT_AREAS,
  ROSTER,
  STANDARD_TARGETS,
  TICKET_TYPES,
  UNASSIGNED_ROSTER,
  VIP_TARGETS,
  type CalendarKey,
  type Channel,
  type CustomerDef,
  type JiraProjectKey,
  type JiraStatusKey,
  type Priority,
  type RosterEntry,
  type RosterOpts,
  type ScheduleDef,
  type ScenarioKey,
  type TargetSet,
  TENANTS,
  type TenantDef,
} from "./config";
import { tenantConfig, type TenantConfig } from "./tenant-config";
import { DAY, HOUR, MIN, SCENARIOS, type Built, type Ctx, type IssuePlan, type LinkMode, type ZStatus } from "./scenarios";

export type Phase = "A" | "B";

export interface SeedRawEvent {
  integration: "zendesk" | "jira";
  /** Phase A is everything known before the priority bump / link removal; Phase B is what arrives after (see seed.ts). */
  phase: Phase;
  providerEventId: string;
  sourceHash: string;
  payload: unknown;
  fetchedAt: Date;
}

export interface TicketFixture {
  ticketId: number;
  customerKey: string | null;
  requesterName: string;
  scenario: ScenarioKey;
  priority: Priority | null;
  tags: string[];
  channel: Channel;
  softDeleted: boolean;
  failNotify: boolean;
  jiraKeys: string[];
  createdAt: Date;
}

export interface IssueFixture {
  key: string;
  ticketId: number | null;
  /** When Zendesk/Jira first observed the link (the escalation instant). Null for an issue nothing links to. */
  linkedAt: Date | null;
  linkMode: LinkMode | null;
  unlinked: boolean;
  finalStatus: JiraStatusKey;
}

export interface SeedDataset {
  tenant: TenantDef;
  /** The tenant's customers, with this tenant's Zendesk org ids and requester names. */
  customers: CustomerDef[];
  anchor: Date;
  /** The Phase A/B boundary: when the priority bump is delivered and re-resolution runs. */
  phaseBoundary: Date;
  calendars: Record<CalendarKey, BusinessCalendarVersion>;
  tickets: TicketFixture[];
  issues: IssueFixture[];
  rawEvents: SeedRawEvent[];
}

const CHANNELS: Channel[] = ["email", "web", "email", "chat", "api", "web"];
const LINK_MODES: LinkMode[] = ["both", "official", "remote", "stale_official"];

const iso = (ms: number) => new Date(ms).toISOString();

export function buildCalendars(schedules: ScheduleDef[]): Record<CalendarKey, BusinessCalendarVersion> {
  const fromSchedule = (s: ScheduleDef): BusinessCalendarVersion => ({
    id: `seed-cal-${s.key}`,
    version: 1,
    timezone: s.ianaTimeZone,
    weekly: intervalsToWeeklyWindows(scheduleIntervals(s)),
    holidays: expandHolidayDates(s.holidays),
    alwaysOpen: false,
  });
  const byKey = (key: "ny" | "london" | "berlin") => fromSchedule(schedules.find((s) => s.key === key)!);
  return {
    ny: byKey("ny"),
    london: byKey("london"),
    berlin: byKey("berlin"),
    always: { id: "seed-cal-always", version: 1, timezone: "UTC", weekly: [], holidays: [], alwaysOpen: true },
    "24x7": {
      id: "seed-cal-24x7",
      version: 1,
      timezone: "UTC",
      weekly: NATIVE_WEEKLY,
      holidays: [],
      alwaysOpen: false,
    },
  };
}

/** Sunday..Saturday, all day — the native 24/7 calendar. */
export const NATIVE_WEEKLY = ([0, 1, 2, 3, 4, 5, 6] as const).map((day) => ({ day, openMinute: 0, closeMinute: 1440 }));

function scheduleIntervals(s: ScheduleDef) {
  return [1, 2, 3, 4, 5].map((day) => ({ start_time: day * 1440 + s.openMinute, end_time: day * 1440 + s.closeMinute }));
}

/** Which policy the engine will match, mirrored here only to place timestamps sensibly. */
function targetsFor(customer: CustomerDef | null, priority: Priority | null, vip: boolean): { targets: TargetSet; cal: CalendarKey } {
  if (vip) return { targets: VIP_TARGETS, cal: customer?.calendarOverride ?? "always" };
  const override = customer?.calendarOverride ?? null;
  const p = priority ?? "normal";
  switch (customer?.policy) {
    case "enterprise":
      return { targets: ENTERPRISE_TARGETS[p], cal: override ?? "ny" };
    case "standard":
      return { targets: STANDARD_TARGETS[p], cal: override ?? "ny" };
    case "emea":
      return { targets: EMEA_TARGETS, cal: override ?? "london" };
    case "dach":
      return { targets: DACH_TARGETS, cal: override ?? "berlin" };
    case "native":
      return { targets: NATIVE_TARGETS, cal: override ?? "always" };
    default:
      return { targets: NO_POLICY_PLACEHOLDER, cal: "always" };
  }
}

// --- Zendesk reference data -----------------------------------------------------

const orgConditions = (cfg: TenantConfig, keys: string[]) =>
  keys.map((key) => ({ field: "organization_id", operator: "is", value: cfg.customers.find((c) => c.key === key)!.zendeskOrgId }));

function metrics(
  priority: string | null,
  t: TargetSet,
  businessHours: boolean,
): NonNullable<ZendeskSlaPolicy["policy_metrics"]> {
  return [
    { priority, metric: "first_reply_time", target: t.fr, business_hours: businessHours },
    { priority, metric: "total_resolution_time", target: t.res, business_hours: businessHours },
    ...(t.nr !== null ? [{ priority, metric: "next_reply_time", target: t.nr, business_hours: businessHours }] : []),
  ];
}

const scheduleId = (cfg: TenantConfig, key: "ny" | "london" | "berlin") => cfg.schedules.find((s) => s.key === key)!.scheduleId;

function buildPolicies(cfg: TenantConfig, anchor: number): ZendeskSlaPolicy[] {
  const created = iso(anchor - 120 * DAY);
  const priorities: Priority[] = ["urgent", "high", "normal", "low"];
  const base = { created_at: created, updated_at: created };
  return [
    {
      id: cfg.ids.policyBase + 0,
      title: "VIP Escalation",
      description: "Any ticket tagged vip, regardless of organization.",
      position: 1,
      filter: { all: [{ field: "current_tags", operator: "includes", value: "vip" }] },
      policy_metrics: metrics(null, VIP_TARGETS, false),
      ...base,
    },
    {
      id: cfg.ids.policyBase + 1,
      title: "Enterprise Support",
      description: "Per-priority targets for the four enterprise accounts, on New York business hours.",
      position: 2,
      filter: { any: orgConditions(cfg, ["halcyon", "nimbus", "cobalt", "brightwater"]) },
      schedule_id: scheduleId(cfg, "ny"),
      policy_metrics: [
        ...priorities.flatMap((p) => metrics(p, ENTERPRISE_TARGETS[p], true)),
        // A metric with no CommitmentKind equivalent: shows up in the SLA import summary.
        { priority: null, metric: "agent_work_time", target: 60, business_hours: true },
      ],
      ...base,
    },
    {
      id: cfg.ids.policyBase + 2,
      title: "EMEA Coverage",
      position: 3,
      filter: { any: orgConditions(cfg, ["kestrel"]) },
      schedule_id: scheduleId(cfg, "london"),
      policy_metrics: metrics(null, EMEA_TARGETS, true),
      ...base,
    },
    {
      id: cfg.ids.policyBase + 3,
      title: "DACH Coverage",
      position: 4,
      filter: { any: orgConditions(cfg, ["fjordline"]) },
      schedule_id: scheduleId(cfg, "berlin"),
      policy_metrics: metrics(null, DACH_TARGETS, true),
      ...base,
    },
    {
      id: cfg.ids.policyBase + 4,
      title: "Professional Support",
      position: 5,
      filter: { any: orgConditions(cfg, ["tessellate", "orchard", "meridian"]) },
      schedule_id: scheduleId(cfg, "ny"),
      policy_metrics: [
        ...priorities.flatMap((p) => metrics(p, STANDARD_TARGETS[p], true)),
        { priority: null, metric: "requester_wait_time", target: 2880, business_hours: true },
      ],
      ...base,
    },
  ];
}

// --- Ticket materialization -------------------------------------------------------

interface TicketInput {
  id: number;
  n: number;
  customer: CustomerDef | null;
  customerIdx: number;
  requesterIdx: number;
  requesterName: string;
  entry: RosterEntry;
}

const pick = <T>(pool: readonly T[], n: number): T => pool[n % pool.length]!;

interface AuditEventInput {
  type: string;
  field_name?: string;
  value?: unknown;
  previous_value?: unknown;
  [key: string]: unknown;
}

interface RenderedTicket {
  fixture: TicketFixture;
  built: Built;
  snapshots: { ticket: ZendeskTicket; phase: Phase; fetchedAt: number }[];
  audits: { audit: ZendeskAudit; phase: Phase; fetchedAt: number }[];
}

function isEscalation(scenario: ScenarioKey): boolean {
  return scenario.startsWith("escalated_");
}

function renderTicket(
  cfg: TenantConfig,
  input: TicketInput,
  anchor: number,
  requesterId: number,
  calendars: Record<CalendarKey, BusinessCalendarVersion>,
): RenderedTicket {
  const { id, n, customer, entry } = input;
  const [scenario, priority, opts = {} as RosterOpts] = entry;
  const vip = opts.vip === true;
  const { targets, cal } = targetsFor(customer, priority, vip);

  const ctx: Ctx = { anchor, cal: calendars[cal], fr: targets.fr, res: targets.res, nr: targets.nr, n, priority };
  const built = SCENARIOS[scenario](ctx);

  const channel: Channel = opts.channel ?? pick(CHANNELS, n);
  const agent = pick(cfg.agents, n);
  const assignee = opts.unassigned ? null : agent;
  const submitterId = built.agentCreated ? agent.id : requesterId;
  const escalation = isEscalation(scenario);
  const subject = escalation ? pick(ENGINEERING_SUBJECTS, n) : pick(GENERAL_SUBJECTS, n);
  const area = pick(PRODUCT_AREAS, n);
  const tags = [area, ...(escalation ? ["escalated_to_engineering"] : []), ...(vip ? ["vip"] : [])];
  const via = { channel };

  const audits: RenderedTicket["audits"] = [];
  let seq = 0;
  const auditBase = 9_100_000_000 + id * 100;
  const nextAuditId = () => auditBase + ++seq;
  let status = "new" as ZStatus;
  let curPriority = priority;
  let updatedAt = built.createdAt;
  const stage2: { snapshot?: { status: ZStatus; priority: Priority | null; updatedAt: number } } = {};

  const pushAudit = (at: number, authorId: number, channelVia: string, events: AuditEventInput[]) => {
    const auditId = nextAuditId();
    const phase: Phase = built.stage2From !== undefined && at >= built.stage2From ? "B" : "A";
    if (phase === "B" && stage2.snapshot === undefined) stage2.snapshot = { status, priority: curPriority, updatedAt };
    const audit: ZendeskAudit = {
      id: auditId,
      ticket_id: id,
      created_at: iso(at),
      author_id: authorId,
      via: { channel: channelVia },
      events: events.map((event, i) => ({ ...event, id: auditId * 10 + i })),
    };
    audits.push({ audit, phase, fetchedAt: Math.min(at + MIN, anchor) });
    updatedAt = at;
  };

  const comment = (authorId: number, isPublic: boolean, body: string): AuditEventInput => ({
    type: "Comment",
    public: isPublic,
    author_id: authorId,
    body,
    plain_body: body,
  });
  const statusChange = (to: ZStatus): AuditEventInput[] => {
    if (to === status) return [];
    const change = { type: "Change", field_name: "status", value: to, previous_value: status };
    status = to;
    return [change];
  };

  // The creation audit: the ticket's own description, stamped at created_at.
  pushAudit(built.createdAt, submitterId, channel, [
    { type: "Create", field_name: "status", value: "new" },
    comment(submitterId, true, `${subject}. Please advise.`),
  ]);

  const sorted = [...built.steps].sort((a, b) => a.at - b.at);
  let replyN = 0;
  for (const step of sorted) {
    switch (step.kind) {
      case "reply": {
        replyN += 1;
        const byAgent = step.by === "agent";
        const authorId = byAgent ? agent.id : requesterId;
        const body = byAgent ? pick(AGENT_REPLIES, n + replyN) : pick(CUSTOMER_REPLIES, n + replyN);
        const target = step.status ?? (byAgent && status === "new" ? "open" : !byAgent && status === "pending" ? "open" : status);
        pushAudit(step.at, authorId, byAgent ? "web" : channel, [comment(authorId, true, body), ...statusChange(target)]);
        break;
      }
      case "note":
        pushAudit(step.at, agent.id, "web", [comment(agent.id, false, "Internal note: checked logs, nothing conclusive yet.")]);
        break;
      case "status":
        pushAudit(step.at, agent.id, step.via ?? "web", statusChange(step.to));
        break;
      case "priority": {
        const change = { type: "Change", field_name: "priority", value: step.to, previous_value: curPriority };
        pushAudit(step.at, agent.id, "web", [change]);
        curPriority = step.to;
        break;
      }
    }
  }

  const finalPriority = built.finalPriority ?? priority;
  const customFields = [
    { id: cfg.customFieldProductArea, value: area },
    { id: cfg.customFieldImpact, value: escalation ? "high" : pick(["low", "medium"], n) },
  ];
  const make = (s: ZStatus, p: Priority | null, updated: number): ZendeskTicket => ({
    id,
    url: `https://${cfg.tenant.zendeskSubdomain}.zendesk.com/api/v2/tickets/${id}.json`,
    external_id: null,
    subject,
    created_at: iso(built.createdAt),
    updated_at: iso(updated),
    status: s,
    priority: p,
    organization_id: customer?.zendeskOrgId ?? null,
    requester_id: requesterId,
    submitter_id: submitterId,
    tags,
    via,
    type: escalation ? pick(["incident", "problem"], n) : pick(TICKET_TYPES, n),
    group_id: escalation ? cfg.groups[3]! : pick(cfg.groups.slice(0, 3), n),
    assignee_id: assignee?.id ?? null,
    brand_id: pick(cfg.brands, n),
    ticket_form_id: cfg.formId,
    recipient: cfg.recipient,
    custom_fields: customFields,
  });

  const snapshots: RenderedTicket["snapshots"] = [];
  const lastAuditAt = Math.max(...audits.map((a) => Date.parse(a.audit.created_at)));
  const finalFetchedAt = Math.min(lastAuditAt + 2 * MIN, anchor - 5 * MIN);
  if (stage2.snapshot !== undefined) {
    const s2 = stage2.snapshot;
    snapshots.push({ ticket: make(s2.status, s2.priority, s2.updatedAt), phase: "A", fetchedAt: s2.updatedAt + 2 * MIN });
    snapshots.push({ ticket: make(status, finalPriority, lastAuditAt), phase: "B", fetchedAt: finalFetchedAt });
  } else {
    snapshots.push({ ticket: make(status, finalPriority, lastAuditAt), phase: "A", fetchedAt: finalFetchedAt });
  }

  return {
    built,
    snapshots,
    audits,
    fixture: {
      ticketId: id,
      customerKey: customer?.key ?? null,
      requesterName: input.requesterName,
      scenario,
      priority: finalPriority,
      tags,
      channel,
      softDeleted: opts.softDeleted === true,
      failNotify: opts.failNotify === true,
      jiraKeys: [],
      createdAt: new Date(built.createdAt),
    },
  };
}

// --- Jira materialization -----------------------------------------------------------

const JIRA_PRIORITY: Record<string, { id: string; name: string }> = {
  urgent: { id: "1", name: "Highest" },
  high: { id: "2", name: "High" },
  normal: { id: "3", name: "Medium" },
  low: { id: "4", name: "Low" },
};

interface JiraBuildState {
  keyCounters: Record<JiraProjectKey, number>;
  historyId: number;
  officialLinkId: number;
  remoteLinkId: number;
  issueCount: number;
  /** Jira issue ids are unique per site, across projects (keys are per project). */
  issueIdSeq: number;
}

function jiraIssueSnapshot(cfg: TenantConfig, args: {
  key: string;
  issueId: string;
  project: JiraProjectKey;
  summary: string;
  priority: Priority | null;
  createdAt: number;
  updatedAt: number;
  status: JiraStatusKey;
  reporterIdx: number;
  assigneeIdx: number | null;
}): JiraIssue {
  const status = cfg.statuses[args.status];
  const reporter = cfg.reporters[args.reporterIdx % cfg.reporters.length]!;
  const assignee = args.assigneeIdx === null ? null : cfg.engineers[args.assigneeIdx % cfg.engineers.length]!;
  return {
    id: args.issueId,
    key: args.key,
    self: `${cfg.tenant.jiraSiteUrl}/rest/api/3/issue/${args.issueId}`,
    fields: {
      summary: args.summary,
      status: { id: status.id, name: status.name, statusCategory: { key: status.category } },
      priority: JIRA_PRIORITY[args.priority ?? "normal"]!,
      project: { id: cfg.projects[args.project].id, key: args.project, name: cfg.projects[args.project].name },
      created: iso(args.createdAt),
      updated: iso(args.updatedAt),
      reporter: { accountId: reporter.accountId, displayName: reporter.displayName },
      assignee: assignee ? { accountId: assignee.accountId, displayName: assignee.displayName } : null,
    },
  };
}

function statusItem(cfg: TenantConfig, from: JiraStatusKey, to: JiraStatusKey): JiraChangelogHistory["items"][number] {
  return {
    field: "status",
    fieldtype: "jira",
    from: cfg.statuses[from].id,
    fromString: cfg.statuses[from].name,
    to: cfg.statuses[to].id,
    toString: cfg.statuses[to].name,
  };
}

/** The fixture dataset for ONE tenant (organization). Same shape and scenarios for every tenant; only names and external ids differ. */
export function buildSeedDataset(anchorDate: Date, tenant: TenantDef = TENANTS[0]!): SeedDataset {
  const anchor = anchorDate.getTime();
  const cfg = tenantConfig(tenant);
  const calendars = buildCalendars(cfg.schedules);
  const rawEvents: SeedRawEvent[] = [];
  const add = (
    integration: SeedRawEvent["integration"],
    phase: Phase,
    mapped: { providerEventId: string; sourceHash: string; payload: unknown },
    fetchedAt: number,
  ) => rawEvents.push({ integration, phase, ...mapped, fetchedAt: new Date(fetchedAt) });

  const referenceAt = anchor - 90 * DAY;

  // ---- Zendesk reference data ------------------------------------------------------
  const users: ZendeskUser[] = cfg.agents.map((a) => ({ id: a.id, role: a.role, name: a.name }));
  const requesterIdFor = (customerIdx: number, requesterIdx: number) => cfg.ids.requesterBase + customerIdx * 100 + requesterIdx;
  const unassignedIdFor = (i: number) => cfg.ids.unassignedBase + i;
  cfg.customers.forEach((c, ci) => c.requesters.forEach((name, ri) => users.push({ id: requesterIdFor(ci, ri), role: "end-user", name })));
  cfg.unassignedRequesters.forEach((name, i) => users.push({ id: unassignedIdFor(i), role: "end-user", name }));
  for (const user of users) add("zendesk", "A", mapUserToRawEvent(user), referenceAt);

  for (const c of cfg.customers) {
    const organization: ZendeskOrganization = {
      id: c.zendeskOrgId,
      name: c.name,
      updated_at: iso(referenceAt),
      external_id: `seed-${tenant.key}-${c.key}`,
      tags: [c.tier ?? "untiered"],
      created_at: iso(referenceAt - 200 * DAY),
    };
    add("zendesk", "A", mapOrganizationToRawEvent(organization), referenceAt);
  }

  for (const s of cfg.schedules) {
    const schedule: ZendeskBusinessHoursSchedule = { id: s.scheduleId, name: s.name, time_zone: s.railsTimeZone, intervals: scheduleIntervals(s) };
    add("zendesk", "A", mapBusinessHoursScheduleToRawEvent(schedule), referenceAt);
    add("zendesk", "A", mapScheduleHolidaysToRawEvent({ scheduleId: s.scheduleId, holidays: s.holidays }), referenceAt);
  }

  const policies = buildPolicies(cfg, anchor);
  for (const policy of policies) add("zendesk", "A", mapSlaPolicyToRawEvent(policy), referenceAt);
  const policyManifest = mapSlaPolicyManifestToRawEvent(policies.map((p) => p.id));
  add("zendesk", "A", { ...policyManifest, providerEventId: `sla_policy_manifest:seed-${tenant.key}-1` }, referenceAt + HOUR);

  // Jira statuses (site-wide list).
  for (const status of Object.values(cfg.statuses)) {
    add("jira", "A", mapStatusToRawEvent({ id: status.id, name: status.name, statusCategory: { key: status.category, name: status.name } }), referenceAt);
  }

  // ---- Tickets -----------------------------------------------------------------------
  const inputs: TicketInput[] = [];
  let nextTicketId = cfg.ids.firstTicketId;
  let n = 0;
  cfg.customers.forEach((customer, customerIdx) => {
    (ROSTER[customer.key] ?? []).forEach((entry, i) => {
      const requesterIdx = i % customer.requesters.length;
      inputs.push({
        id: nextTicketId++,
        n: n++,
        customer,
        customerIdx,
        requesterIdx,
        requesterName: customer.requesters[requesterIdx]!,
        entry,
      });
    });
  });
  UNASSIGNED_ROSTER.forEach((entry, i) => {
    const requesterIdx = i % cfg.unassignedRequesters.length;
    inputs.push({
      id: nextTicketId++,
      n: n++,
      customer: null,
      customerIdx: -1,
      requesterIdx,
      requesterName: cfg.unassignedRequesters[requesterIdx]!,
      entry,
    });
  });

  const rendered = inputs.map((input) =>
    renderTicket(
      cfg,
      input,
      anchor,
      input.customer ? requesterIdFor(input.customerIdx, input.requesterIdx) : unassignedIdFor(input.requesterIdx),
      calendars,
    ),
  );

  for (const r of rendered) {
    for (const snapshot of r.snapshots) add("zendesk", snapshot.phase, mapTicketToRawEvent(snapshot.ticket, users), snapshot.fetchedAt);
    for (const a of r.audits) add("zendesk", a.phase, mapAuditToRawEvent(a.audit), a.fetchedAt);
  }

  // ---- Jira issues + Zendesk<->Jira links -------------------------------------------
  const state: JiraBuildState = {
    keyCounters: {
      PLAT: cfg.ids.firstJiraNumber,
      INTG: cfg.ids.firstJiraNumber,
      DATA: cfg.ids.firstJiraNumber,
      MOB: cfg.ids.firstJiraNumber,
    },
    historyId: cfg.ids.firstHistoryId,
    officialLinkId: cfg.ids.firstOfficialLinkId,
    remoteLinkId: cfg.ids.firstRemoteLinkId,
    issueCount: 0,
    issueIdSeq: 20_000 + tenant.index * 1_000,
  };
  const issueFixtures: IssueFixture[] = [];
  const officialLinks: { link: ZendeskJiraLink; linkedAt: number; unlinked: boolean }[] = [];

  rendered.forEach((r, ticketIdx) => {
    const customer = inputs[ticketIdx]!.customer;
    const project: JiraProjectKey = customer?.jiraProject ?? "PLAT";
    r.built.issues.forEach((plan: IssuePlan, issueIdx) => {
      const key = `${project}-${++state.keyCounters[project]}`;
      const issueId = String(++state.issueIdSeq);
      const mode: LinkMode = plan.mode ?? pick(LINK_MODES, state.issueCount);
      state.issueCount += 1;
      r.fixture.jiraKeys.push(key);
      const ticketPriority = r.fixture.priority;
      const summary = `${pick(ENGINEERING_SUBJECTS, inputs[ticketIdx]!.n + issueIdx)} (customer escalation)`;
      const reporterIdx = inputs[ticketIdx]!.n;
      const engineerIdx = inputs[ticketIdx]!.n + issueIdx;

      // Status walk.
      const transitions = [...plan.transitions].sort((a, b) => a.at - b.at);
      const histories: { history: JiraChangelogHistory; at: number }[] = [];
      let current: JiraStatusKey = "todo";
      transitions.forEach((tr, i) => {
        const engineer = cfg.engineers[(engineerIdx + i) % cfg.engineers.length]!;
        const items = [statusItem(cfg, current, tr.to)];
        if (i === 0) {
          items.push({ field: "assignee", fieldtype: "jira", from: null, fromString: null, to: engineer.accountId, toString: engineer.displayName });
        }
        histories.push({
          at: tr.at,
          history: { id: String(++state.historyId), author: { accountId: engineer.accountId, displayName: engineer.displayName }, created: iso(tr.at), items },
        });
        current = tr.to;
      });

      const snap = (status: JiraStatusKey, updatedAt: number) =>
        jiraIssueSnapshot(cfg, {
          key,
          issueId,
          project,
          summary,
          priority: ticketPriority,
          createdAt: plan.createdAt,
          updatedAt,
          status,
          reporterIdx,
          assigneeIdx: histories.length > 0 ? engineerIdx : null,
        });
      // An early snapshot (as created) and the latest one — different content, so two RawEvents, latest wins.
      if (histories.length > 0) add("jira", "A", mapIssueToRawEvent(snap("todo", plan.createdAt)), plan.createdAt + MIN);
      const lastUpdate = histories.length > 0 ? histories[histories.length - 1]!.at : plan.createdAt;
      add("jira", "A", mapIssueToRawEvent(snap(current, lastUpdate)), lastUpdate + MIN);
      for (const { history, at } of histories) add("jira", "A", mapChangelogHistoryToRawEvent(key, history), at + MIN);

      // How Zendesk and Jira know about each other.
      const ticketId = r.fixture.ticketId;
      const subject = r.snapshots[r.snapshots.length - 1]!.ticket.subject ?? "";
      if (mode === "official" || mode === "both" || mode === "stale_official") {
        const link: ZendeskJiraLink = {
          id: ++state.officialLinkId,
          ticket_id: String(ticketId),
          issue_key: key,
          issue_id: issueId,
          created_at: iso(plan.linkedAt),
        };
        officialLinks.push({ link, linkedAt: plan.linkedAt, unlinked: plan.unlinked === true });
        add("zendesk", "A", mapJiraLinkToRawEvent(link), plan.linkedAt);
      }
      if (mode === "remote" || mode === "both" || mode === "stale_official") {
        const host = mode === "stale_official" ? tenant.staleZendeskSubdomain : tenant.zendeskSubdomain;
        const remote: JiraRemoteLink = {
          id: ++state.remoteLinkId,
          self: `${tenant.jiraSiteUrl}/rest/api/3/issue/${key}/remotelink/${state.remoteLinkId}`,
          globalId: `system=https://${host}.zendesk.com&id=${ticketId}`,
          relationship: "mentioned in",
          object: { url: `https://${host}.zendesk.com/agent/tickets/${ticketId}`, title: `Zendesk Ticket #${ticketId}: ${subject}` },
        };
        const at = plan.linkedAt + (mode === "both" ? 30_000 : 0);
        add("jira", "A", mapRemoteLinkToRawEvent(key, remote), at);
        const manifest = mapRemoteLinkManifestToRawEvent(key, [remote.id]);
        add("jira", "A", { ...manifest, providerEventId: `remote_link_manifest:${key}:seed-${tenant.key}-1` }, at + 5_000);
      }
      issueFixtures.push({ key, ticketId, linkedAt: new Date(plan.linkedAt), linkMode: mode, unlinked: plan.unlinked === true, finalStatus: current });
    });
  });

  // Two internal engineering issues no support ticket ever points at.
  const orphans: { project: JiraProjectKey; summary: string; steps: JiraStatusKey[] }[] = [
    { project: "PLAT", summary: "Refactor the retry queue backoff policy", steps: ["inprogress", "done"] },
    { project: "DATA", summary: "Upgrade the warehouse connector to the new driver", steps: ["inprogress"] },
  ];
  orphans.forEach((o, i) => {
    const key = `${o.project}-${++state.keyCounters[o.project]}`;
    const issueId = String(++state.issueIdSeq);
    const createdAt = anchor - (9 + i) * DAY;
    let current: JiraStatusKey = "todo";
    const histories = o.steps.map((to, s) => {
      const at = createdAt + (s + 1) * 6 * HOUR;
      const engineer = cfg.engineers[(i + s) % cfg.engineers.length]!;
      const history: JiraChangelogHistory = {
        id: String(++state.historyId),
        author: { accountId: engineer.accountId, displayName: engineer.displayName },
        created: iso(at),
        items: [statusItem(cfg, current, to)],
      };
      current = to;
      return { history, at };
    });
    const last = histories.length > 0 ? histories[histories.length - 1]!.at : createdAt;
    add(
      "jira",
      "A",
      mapIssueToRawEvent(
        jiraIssueSnapshot(cfg, { key, issueId, project: o.project, summary: o.summary, priority: "normal", createdAt, updatedAt: last, status: current, reporterIdx: i, assigneeIdx: i }),
      ),
      last + MIN,
    );
    for (const { history, at } of histories) add("jira", "A", mapChangelogHistoryToRawEvent(key, history), at + MIN);
    issueFixtures.push({ key, ticketId: null, linkedAt: null, linkMode: null, unlinked: false, finalStatus: current });
  });

  // Zendesk's link registry, listed in full twice (each backfill re-lists everything): the second run,
  // in Phase B, no longer reports the links that were removed.
  const lastLinkAt = Math.max(0, ...officialLinks.map((l) => l.linkedAt));
  const manifestOneAt = lastLinkAt + MIN;
  const manifestTwoAt = manifestOneAt + 15 * MIN;
  if (manifestTwoAt > anchor - 5 * MIN) throw new Error("Zendesk link manifests would land after the anchor");
  const m1 = mapJiraLinkManifestToRawEvent(officialLinks.map((l) => l.link.id));
  add("zendesk", "A", { ...m1, providerEventId: `jira_link_manifest:seed-${tenant.key}-1` }, manifestOneAt);
  const m2 = mapJiraLinkManifestToRawEvent(officialLinks.filter((l) => !l.unlinked).map((l) => l.link.id));
  add("zendesk", "B", { ...m2, providerEventId: `jira_link_manifest:seed-${tenant.key}-2` }, manifestTwoAt);

  const bumpTicket = rendered.find((r) => r.built.stage2From !== undefined);
  const phaseBoundary = new Date(bumpTicket?.built.stage2From ?? anchor - 2 * DAY - HOUR);

  return {
    tenant,
    customers: cfg.customers,
    anchor: anchorDate,
    phaseBoundary,
    calendars,
    tickets: rendered.map((r) => r.fixture),
    issues: issueFixtures,
    rawEvents,
  };
}

