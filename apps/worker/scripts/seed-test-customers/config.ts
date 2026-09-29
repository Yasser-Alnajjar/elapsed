/**
 * Static, hand-written definition of the Zendesk <-> Jira test dataset:
 * customers, calendars, SLA policies and the per-customer case roster. Every
 * name, id and address here is fictional (`.test` / `.invalid` domains only).
 * Nothing in this file reads the clock, the environment or a random source.
 */

export type Priority = "low" | "normal" | "high" | "urgent";
export type Channel = "email" | "web" | "chat" | "api";

/**
 * The multi-tenant layout: 11 independent Organizations (companies that each bought Elapsed), and
 * inside EACH of them the same fixture dataset — the 11 Customers below, their requesters, cases,
 * Jira escalations, policies and calendars. Organization != Customer: a Customer is a Zendesk
 * organization of the tenant's own end customers.
 */
export interface TenantDef {
  /** 0-based position; drives every id offset so nothing collides across tenants. */
  index: number;
  key: string;
  orgId: string;
  name: string;
  zendeskSubdomain: string;
  /** Deliberately not the connected subdomain: a Jira remote link the correlator must reject. */
  staleZendeskSubdomain: string;
  jiraSiteUrl: string;
  jiraCloudId: string;
  users: { id: string; email: string; name: string; role: "owner" | "member" }[];
  inviteeEmail: string;
}

/** Default "now" of the dataset. Every timestamp is an offset from it. */
export const DEFAULT_ANCHOR_ISO = "2026-09-29T15:00:00.000Z";

/** Engineering-leg OLA target (Organization.engineeringLegTargetMinutes). */
export const ENGINEERING_LEG_TARGET_MINUTES = 720;

/**
 * Local-only sign-in for the seeded orgs (bcrypt, cost 10). Test fixture — the plaintext is
 * `Elapsed#2026`; the accounts live on the reserved `.test` TLD and only exist in a database this
 * script created. `User.email` is globally unique, so each tenant gets its own addresses.
 */
export const SEED_PASSWORD_HASH =
  "$2b$10$NcM0wQH5ZJSftyBycyrm5.2E4fJLjYX90gw3jZ2tJ.YGDoWQR6IYS";

export function tenantOrgId(key: string): string {
  return `seed-org-${key}`;
}

export function tenantOrgName(key: string): string {
  return `Elapsed Fixture \u2014 ${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

export function makeTenant(key: string, index: number): TenantDef {
  return {
    index,
    key,
    orgId: tenantOrgId(key),
    name: tenantOrgName(key),
    zendeskSubdomain: `elapsed-seed-${key}`,
    staleZendeskSubdomain: `elapsed-seed-legacy-${key}`,
    jiraSiteUrl: `https://elapsed-seed-${key}.atlassian.net`,
    jiraCloudId: `seed-cloud-${key}`,
    users: [
      { id: `seed-user-${key}-owner`, email: `owner@${key}.elapsed-seed.test`, name: `${key} Owner`, role: "owner" },
      { id: `seed-user-${key}-member`, email: `member@${key}.elapsed-seed.test`, name: `${key} Member`, role: "member" },
    ],
    inviteeEmail: `invitee@${key}.elapsed-seed.test`,
  };
}

/** The single organization the previous (single-tenant) version of this seed created; removed on --reset. */
export const LEGACY_SEED_ORG = { id: "seed-org-zendesk-jira-fixtures", name: "Elapsed Test Fixtures (Zendesk + Jira)" };

// --- Calendars -------------------------------------------------------------

export type CalendarKey = "ny" | "london" | "berlin" | "always" | "24x7";

export interface ScheduleDef {
  key: "ny" | "london" | "berlin";
  scheduleId: number;
  name: string;
  /** Zendesk's Rails-style zone name (what the importer maps to IANA). */
  railsTimeZone: string;
  ianaTimeZone: string;
  openMinute: number;
  closeMinute: number;
  holidays: { id: number; name: string; start_date: string; end_date: string }[];
}

/** Mon-Fri windows. Anchor is 15:00Z, which is inside all three at once. */
export const SCHEDULES: ScheduleDef[] = [
  {
    key: "ny",
    scheduleId: 4400000001,
    name: "Standard Business Hours (New York)",
    railsTimeZone: "Eastern Time (US & Canada)",
    ianaTimeZone: "America/New_York",
    openMinute: 9 * 60,
    closeMinute: 17 * 60,
    holidays: [{ id: 5500000001, name: "Labor Day", start_date: "2026-09-07", end_date: "2026-09-07" }],
  },
  {
    key: "london",
    scheduleId: 4400000002,
    name: "EMEA Support Hours (London)",
    railsTimeZone: "London",
    ianaTimeZone: "Europe/London",
    openMinute: 8 * 60,
    closeMinute: 18 * 60,
    holidays: [{ id: 5500000002, name: "Summer Bank Holiday", start_date: "2026-08-31", end_date: "2026-08-31" }],
  },
  {
    key: "berlin",
    scheduleId: 4400000003,
    name: "DACH Support Hours (Berlin)",
    railsTimeZone: "Berlin",
    ianaTimeZone: "Europe/Berlin",
    openMinute: 8 * 60,
    closeMinute: 19 * 60,
    holidays: [{ id: 5500000003, name: "Day of German Unity", start_date: "2026-10-03", end_date: "2026-10-03" }],
  },
];

export const NATIVE_CALENDAR = {
  name: "Enterprise 24/7 (native)",
  timezone: "UTC",
};

// --- People ----------------------------------------------------------------

export interface AgentDef {
  id: number;
  name: string;
  role: "agent" | "admin";
}

export const AGENTS: AgentDef[] = [
  { id: 5001001, name: "Avery Lindqvist", role: "agent" },
  { id: 5001002, name: "Jordan Bellweather", role: "agent" },
  { id: 5001003, name: "Sam Okonkwo-Reyes", role: "agent" },
  { id: 5001004, name: "Riley Thackeray", role: "agent" },
  { id: 5001005, name: "Noor Castellanos", role: "admin" },
  { id: 5001006, name: "Elliot Fenwick", role: "agent" },
];

export interface JiraPersonDef {
  accountId: string;
  displayName: string;
}
/** Support agents who file the escalation (the issue's reporter). */
export const JIRA_REPORTERS: JiraPersonDef[] = [
  { accountId: "seed-jira-acct-r1", displayName: "Avery Lindqvist" },
  { accountId: "seed-jira-acct-r2", displayName: "Jordan Bellweather" },
  { accountId: "seed-jira-acct-r3", displayName: "Sam Okonkwo-Reyes" },
];
export const JIRA_ENGINEERS: JiraPersonDef[] = [
  { accountId: "seed-jira-acct-e1", displayName: "Petra Vashti" },
  { accountId: "seed-jira-acct-e2", displayName: "Idris Marchetti" },
  { accountId: "seed-jira-acct-e3", displayName: "Wren Oduya" },
  { accountId: "seed-jira-acct-e4", displayName: "Lucan Abernathy" },
  { accountId: "seed-jira-acct-e5", displayName: "Halima Strand" },
];

export type JiraProjectKey = "PLAT" | "INTG" | "DATA" | "MOB";
export const JIRA_PROJECTS: Record<JiraProjectKey, { id: string; name: string }> = {
  PLAT: { id: "10100", name: "Platform" },
  INTG: { id: "10101", name: "Integrations" },
  DATA: { id: "10102", name: "Data Platform" },
  MOB: { id: "10103", name: "Mobile" },
};

export type JiraStatusKey = "todo" | "inprogress" | "inreview" | "blocked" | "done";
export const JIRA_STATUSES: Record<JiraStatusKey, { id: string; name: string; category: "new" | "indeterminate" | "done" }> = {
  todo: { id: "10001", name: "To Do", category: "new" },
  inprogress: { id: "10002", name: "In Progress", category: "indeterminate" },
  inreview: { id: "10003", name: "In Review", category: "indeterminate" },
  blocked: { id: "10004", name: "Blocked", category: "indeterminate" },
  done: { id: "10005", name: "Done", category: "done" },
};

// --- Customers ---------------------------------------------------------------

export type PolicyPath = "enterprise" | "standard" | "emea" | "dach" | "native" | "none";

export interface CustomerDef {
  key: string;
  name: string;
  zendeskOrgId: number;
  tier: string | null;
  policy: PolicyPath;
  /** Customer.calendarId override (roadmap step 24). */
  calendarOverride: "24x7" | null;
  jiraProject: JiraProjectKey;
  requesters: string[];
}

export const CUSTOMERS: CustomerDef[] = [
  {
    key: "halcyon",
    name: "Halcyon Freight Systems",
    zendeskOrgId: 7100000001,
    tier: "enterprise",
    policy: "enterprise",
    calendarOverride: "24x7",
    jiraProject: "PLAT",
    requesters: ["Marisol Vandekamp", "Tobias Renwick", "Anneliese Okoro", "Dmitri Halvorsen", "Priyanka Sandoval", "Callum Whitcombe"],
  },
  {
    key: "nimbus",
    name: "Nimbus Alder Health",
    zendeskOrgId: 7100000002,
    tier: "enterprise",
    policy: "enterprise",
    calendarOverride: "24x7",
    jiraProject: "INTG",
    requesters: ["Ingrid Castellane", "Oluwaseun Abara", "Beatrix Lindholm", "Yusuf Ferreira", "Camille Thornbury"],
  },
  {
    key: "cobalt",
    name: "Cobalt Ridge Financial",
    zendeskOrgId: 7100000003,
    tier: "enterprise",
    policy: "enterprise",
    calendarOverride: null,
    jiraProject: "INTG",
    requesters: ["Thaddeus Quill", "Rosalind Ekwueme", "Matteo Brandvold", "Sunniva Aldridge", "Gideon Faraday"],
  },
  {
    key: "brightwater",
    name: "Brightwater Analytics",
    zendeskOrgId: 7100000004,
    tier: "enterprise",
    policy: "enterprise",
    calendarOverride: null,
    jiraProject: "DATA",
    requesters: ["Leontine Achebe", "Rafferty Voss", "Imogen Tarkington", "Anders Nwosu"],
  },
  {
    key: "tessellate",
    name: "Tessellate Robotics",
    zendeskOrgId: 7100000005,
    tier: "business",
    policy: "standard",
    calendarOverride: null,
    jiraProject: "MOB",
    requesters: ["Fenella Okafor", "Bartholomew Lund", "Saoirse Dellacroix", "Kwame Ashdown"],
  },
  {
    key: "orchard",
    name: "Orchard & Vane Retail",
    zendeskOrgId: 7100000006,
    tier: "business",
    policy: "standard",
    calendarOverride: null,
    jiraProject: "PLAT",
    requesters: ["Delphine Marchetti", "Osvaldo Kimathi", "Henrietta Bloom"],
  },
  {
    key: "meridian",
    name: "Meridian Quill Publishing",
    zendeskOrgId: 7100000007,
    tier: "business",
    policy: "standard",
    calendarOverride: null,
    jiraProject: "PLAT",
    requesters: ["Ambrose Tiernan", "Linnea Oyelaran", "Corwin Peabody"],
  },
  {
    key: "kestrel",
    name: "Kestrel Bay Logistics",
    zendeskOrgId: 7100000008,
    tier: "business",
    policy: "emea",
    calendarOverride: null,
    jiraProject: "INTG",
    requesters: ["Seren Llewellyn", "Anselm Hartigan", "Blessing Adeyemi"],
  },
  {
    key: "fjordline",
    name: "Fjordline Software GmbH",
    zendeskOrgId: 7100000009,
    tier: "enterprise",
    policy: "dach",
    calendarOverride: null,
    jiraProject: "DATA",
    requesters: ["Kaspar Ellingsen", "Wiebke Adjei"],
  },
  {
    key: "pebblecreek",
    name: "Pebblecreek Studio",
    zendeskOrgId: 7100000010,
    tier: "starter",
    policy: "native",
    calendarOverride: null,
    jiraProject: "MOB",
    requesters: ["Juniper Calloway", "Emeka Boatwright"],
  },
  {
    key: "lumen",
    name: "Lumen Harbor Traders",
    zendeskOrgId: 7100000011,
    tier: null,
    policy: "none",
    calendarOverride: null,
    jiraProject: "PLAT",
    requesters: ["Odalys Vermeer", "Tobiah Nakamura-Hale"],
  },
];

/** Tickets with no Zendesk organization (Case.customerId = null). */
export const UNASSIGNED_REQUESTERS = ["Rowan Delacroix-Ibe", "Merrick Sundvall"];

/** One tenant per company, in customer order: Halcyon, Nimbus, Cobalt, ... */
export const TENANTS: TenantDef[] = CUSTOMERS.map((c, i) => makeTenant(c.key, i));

const ALL_REQUESTER_NAMES = [...CUSTOMERS.flatMap((c) => c.requesters), ...UNASSIGNED_REQUESTERS];

/**
 * Requesters have no table of their own (a name on the Case plus a Zendesk user id), so distinct
 * people per tenant means distinct names: tenant 0 keeps the original names and every other tenant
 * re-pairs the same first names with last names shifted by its index — unique within a tenant and
 * across tenants, and still fictional.
 */
export function tenantRequesterName(tenantIndex: number, name: string): string {
  const position = ALL_REQUESTER_NAMES.indexOf(name);
  if (position < 0 || tenantIndex === 0) return name;
  const first = name.split(" ")[0]!;
  const lastOf = (n: string) => n.split(" ").slice(1).join(" ");
  return `${first} ${lastOf(ALL_REQUESTER_NAMES[(position + tenantIndex) % ALL_REQUESTER_NAMES.length]!)}`;
}

// --- SLA policy targets (mirrors the Zendesk payloads in dataset.ts) ---------

export interface TargetSet {
  fr: number;
  res: number;
  /** null when the policy defines no next_reply metric for this priority. */
  nr: number | null;
}

export const ENTERPRISE_TARGETS: Record<Priority, TargetSet> = {
  urgent: { fr: 15, res: 240, nr: 30 },
  high: { fr: 30, res: 480, nr: 60 },
  normal: { fr: 60, res: 960, nr: 120 },
  low: { fr: 120, res: 1920, nr: 240 },
};
export const STANDARD_TARGETS: Record<Priority, TargetSet> = {
  urgent: { fr: 60, res: 720, nr: 120 },
  high: { fr: 120, res: 1440, nr: 240 },
  normal: { fr: 240, res: 2880, nr: 480 },
  low: { fr: 480, res: 4320, nr: null },
};
export const VIP_TARGETS: TargetSet = { fr: 30, res: 480, nr: 60 };
export const EMEA_TARGETS: TargetSet = { fr: 90, res: 960, nr: 180 };
export const DACH_TARGETS: TargetSet = { fr: 60, res: 720, nr: 120 };
export const NATIVE_TARGETS: TargetSet = { fr: 480, res: 4320, nr: 720 };
/** Only used to place events for customers with no matching policy at all. */
export const NO_POLICY_PLACEHOLDER: TargetSet = { fr: 60, res: 480, nr: null };

// --- Case roster -------------------------------------------------------------

export type ScenarioKey =
  | "met_fast"
  | "met_edge"
  | "fr_breached_closed"
  | "res_breached_closed"
  | "both_breached_closed"
  | "replyless_close"
  | "open_healthy"
  | "open_fr_on_track"
  | "open_fr_at_risk"
  | "open_fr_breached"
  | "open_res_at_risk"
  | "open_res_breached"
  | "pending_customer"
  | "on_hold"
  | "multi_reply_nr_at_risk"
  | "next_reply_breached"
  | "reopened_closed"
  | "reopened_open"
  | "closed_auto"
  | "agent_created_met"
  | "agent_created_open_at_risk"
  | "priority_bump"
  | "vip_tagged_open_at_risk"
  | "escalated_in_progress"
  | "escalated_in_review"
  | "escalated_blocked_breached"
  | "escalated_done_solved"
  | "escalated_done_open"
  | "escalated_multi_issue"
  | "escalated_unlinked";

export interface RosterOpts {
  vip?: boolean;
  channel?: Channel;
  unassigned?: boolean;
  /** Case.deletedAt is stamped after normalization (source ticket deleted). */
  softDeleted?: boolean;
  /** Breach alerts for this ticket are recorded as NotificationFailure, not Notification. */
  failNotify?: boolean;
}

export type RosterEntry = [ScenarioKey, Priority | null, RosterOpts?];

export const ROSTER: Record<string, RosterEntry[]> = {
  halcyon: [
    ["met_fast", "high"],
    ["met_fast", "normal"],
    ["met_edge", "urgent"],
    ["fr_breached_closed", "high"],
    ["res_breached_closed", "normal"],
    ["both_breached_closed", "urgent"],
    ["open_healthy", "normal"],
    ["open_healthy", "low"],
    ["open_fr_on_track", "high"],
    ["open_fr_at_risk", "urgent"],
    ["open_fr_breached", "high", { failNotify: true }],
    ["open_res_at_risk", "normal"],
    ["open_res_breached", "high"],
    ["pending_customer", "normal"],
    ["multi_reply_nr_at_risk", "high"],
    ["next_reply_breached", "urgent"],
    ["escalated_in_progress", "high"],
    ["escalated_blocked_breached", "normal"],
    ["escalated_done_solved", "urgent"],
    ["escalated_multi_issue", "normal"],
    ["priority_bump", "normal"],
    ["reopened_closed", "high"],
  ],
  nimbus: [
    ["met_fast", "urgent"],
    ["met_fast", "high", { vip: true }],
    ["met_edge", "normal"],
    ["fr_breached_closed", "urgent"],
    ["res_breached_closed", "high"],
    ["open_healthy", "high"],
    ["open_fr_on_track", "urgent"],
    ["open_fr_at_risk", "high"],
    ["open_fr_breached", "urgent", { failNotify: true }],
    ["open_res_at_risk", "high"],
    ["vip_tagged_open_at_risk", "normal", { vip: true }],
    ["on_hold", "normal"],
    ["multi_reply_nr_at_risk", "urgent"],
    ["escalated_in_progress", "urgent"],
    ["escalated_in_review", "high"],
    ["escalated_done_open", "normal"],
    ["escalated_multi_issue", "high"],
    ["escalated_unlinked", "normal"],
    ["reopened_open", "high"],
    ["closed_auto", "normal"],
  ],
  cobalt: [
    ["met_fast", "normal"],
    ["met_fast", "high"],
    ["priority_bump", "normal"],
    ["met_edge", "normal"],
    ["met_edge", "high"],
    ["fr_breached_closed", "normal"],
    ["res_breached_closed", "low"],
    ["open_healthy", "normal"],
    ["open_healthy", "high"],
    ["open_fr_on_track", "normal"],
    ["open_fr_at_risk", "high"],
    ["open_res_at_risk", "normal"],
    ["escalated_done_solved", "high"],
    ["escalated_in_progress", "normal"],
    ["escalated_in_review", "high"],
    ["reopened_closed", "normal"],
  ],
  brightwater: [
    ["met_fast", "normal"],
    ["met_edge", "high"],
    ["res_breached_closed", "normal"],
    ["both_breached_closed", "high"],
    ["open_healthy", "normal"],
    ["open_res_breached", "normal"],
    ["open_fr_breached", "high"],
    ["escalated_in_progress", "normal"],
    ["escalated_blocked_breached", "normal"],
    ["escalated_done_open", "high"],
    ["escalated_multi_issue", "normal"],
    ["escalated_unlinked", "normal"],
    ["next_reply_breached", "high"],
    ["closed_auto", "low"],
  ],
  tessellate: [
    ["met_fast", "normal"],
    ["met_fast", "high"],
    ["met_edge", "normal"],
    ["fr_breached_closed", "normal"],
    ["res_breached_closed", "high"],
    ["open_healthy", "normal"],
    ["open_fr_on_track", "high"],
    ["open_fr_at_risk", "normal"],
    ["open_res_at_risk", "normal"],
    ["pending_customer", "normal"],
    ["escalated_in_progress", "high"],
    ["escalated_done_solved", "normal"],
  ],
  orchard: [
    ["met_fast", "low", { channel: "chat" }],
    ["met_fast", "normal", { channel: "api" }],
    ["met_edge", "normal"],
    ["fr_breached_closed", "low"],
    ["open_healthy", "normal", { channel: "chat" }],
    ["open_fr_at_risk", "high", { channel: "chat" }],
    ["open_fr_breached", "normal"],
    ["agent_created_met", "normal"],
    ["agent_created_open_at_risk", "normal"],
    ["on_hold", "normal", { unassigned: true }],
    ["replyless_close", "low"],
  ],
  meridian: [
    ["met_fast", "normal"],
    ["met_fast", "low"],
    ["reopened_closed", "normal"],
    ["reopened_open", "normal"],
    ["closed_auto", "normal"],
    ["closed_auto", "low"],
    ["res_breached_closed", "normal", { softDeleted: true }],
    ["open_healthy", "normal"],
    ["multi_reply_nr_at_risk", "normal"],
  ],
  kestrel: [
    ["met_fast", "high"],
    ["met_edge", "normal"],
    ["fr_breached_closed", "normal"],
    ["res_breached_closed", "low"],
    ["open_healthy", "normal"],
    ["open_fr_at_risk", "high"],
    ["open_res_at_risk", "normal"],
    ["escalated_in_progress", "high"],
    ["escalated_done_solved", "normal"],
  ],
  fjordline: [
    ["met_fast", "normal"],
    ["fr_breached_closed", "high"],
    ["open_healthy", "normal"],
    ["open_fr_breached", "normal"],
    ["open_res_at_risk", "high"],
    ["pending_customer", "normal"],
    ["escalated_in_review", "normal"],
    ["escalated_done_open", "high"],
  ],
  pebblecreek: [
    ["met_fast", "normal"],
    ["open_healthy", "normal"],
    ["pending_customer", "normal"],
    ["open_fr_at_risk", "low"],
    ["res_breached_closed", "normal"],
    ["on_hold", "normal"],
  ],
  lumen: [
    ["open_fr_on_track", null],
    ["met_fast", null],
    ["open_healthy", "low"],
  ],
};

/** No Zendesk organization: only the `vip` ticket matches any policy (the tag policy has no org condition). */
export const UNASSIGNED_ROSTER: RosterEntry[] = [
  ["vip_tagged_open_at_risk", "high", { vip: true }],
  ["open_healthy", "normal"],
  ["met_fast", "normal"],
  ["open_fr_at_risk", "low"],
];

// --- Copy pools (no real people, companies or products) -----------------------

export const GENERAL_SUBJECTS = [
  "Invoice total does not match the August statement",
  "Unable to reset password for a shared team login",
  "Dashboard export is missing the last two weeks",
  "Question about upgrading our plan mid-cycle",
  "Notification emails arriving twice",
  "Scheduled report failed to send this morning",
  "Need help configuring single sign-on for new hires",
  "Search results are not sorted by relevance",
  "How do we transfer ownership of a workspace?",
  "Attachments over 10MB fail to upload",
  "Request: add a second billing contact",
  "Mobile app logs users out every few minutes",
  "CSV import rejects valid dates",
  "Timezone shown incorrectly on scheduled jobs",
  "Clarification on data retention settings",
];

export const ENGINEERING_SUBJECTS = [
  "API returns intermittent 502 on the shipments webhook",
  "Bulk import job stalls at 60% and never completes",
  "Data sync shows duplicate records after the last release",
  "Latency spike on the reporting endpoint since Tuesday",
  "Webhook signatures failing verification for one tenant",
  "Scheduled export produces a truncated file",
  "Permissions cache serving stale role data",
  "Crash on launch after the latest mobile update",
  "Ingestion pipeline drops events with unicode payloads",
  "Rate limiting triggers far below the documented threshold",
];

export const AGENT_REPLIES = [
  "Thanks for reaching out. I am looking into this now and will update you shortly.",
  "I can reproduce what you are describing. Here is what I found so far.",
  "We have applied a fix on our side. Could you confirm it looks right on your end?",
  "Sharing the steps we took so you can verify. Let me know if anything looks off.",
  "Quick update: this is with our engineering team and I am tracking it closely.",
];

export const CUSTOMER_REPLIES = [
  "Thank you. That helps, but we are still seeing the same behaviour on our side.",
  "Following up on this. Any news? It is starting to affect our team.",
  "I tried the steps you suggested and attached a screenshot of the result.",
  "Confirmed, it looks fine now. Thanks for the quick turnaround.",
  "Actually the problem is back after the restart. Can you take another look?",
];

export const PRODUCT_AREAS = ["billing", "api", "reporting", "sso", "mobile", "integrations", "exports"];
export const TICKET_TYPES = ["question", "incident", "problem", "task"];
export const ZENDESK_GROUPS = [610001, 610002, 610003, 610004];
export const ZENDESK_BRANDS = [810001, 810002];
export const CUSTOM_FIELD_PRODUCT_AREA = 360000000101;
export const CUSTOM_FIELD_IMPACT = 360000000102;
