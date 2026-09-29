/**
 * The multi-tenant Zendesk <-> Jira test fixtures (apps/worker/scripts/seed-test-customers): 11
 * independent organizations, each with the same full dataset. Pure — no database. The end-to-end run
 * through the real pipelines is seed-test-customers.db.test.ts; app-layer isolation is
 * apps/web/test/seeded-tenant-isolation.test.ts.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CUSTOMERS, ROSTER, TENANTS, UNASSIGNED_ROSTER, tenantOrgId, type ScenarioKey } from "../scripts/seed-test-customers/config";
import { buildSeedDataset, type SeedDataset } from "../scripts/seed-test-customers/dataset";
import { SCENARIOS } from "../scripts/seed-test-customers/scenarios";
import { currentHourAnchor, defaultAnchor, selectTenants } from "../scripts/seed-test-customers/seed";
import { tenantConfig } from "../scripts/seed-test-customers/tenant-config";

const anchor = defaultAnchor();
const snapshot = (dataset: SeedDataset) => JSON.stringify(dataset);
const first = TENANTS[0]!;
const middle = TENANTS[5]!;
const last = TENANTS[10]!;

afterEach(() => vi.useRealTimers());

describe("tenants (organizations)", () => {
  it("defines exactly 11 independent organizations with deterministic names, ids and logins", () => {
    expect(TENANTS).toHaveLength(11);
    expect(TENANTS.map((t) => t.name)).toEqual([
      "Elapsed Fixture — Halcyon",
      "Elapsed Fixture — Nimbus",
      "Elapsed Fixture — Cobalt",
      "Elapsed Fixture — Brightwater",
      "Elapsed Fixture — Tessellate",
      "Elapsed Fixture — Orchard",
      "Elapsed Fixture — Meridian",
      "Elapsed Fixture — Kestrel",
      "Elapsed Fixture — Fjordline",
      "Elapsed Fixture — Pebblecreek",
      "Elapsed Fixture — Lumen",
    ]);
    expect(first.orgId).toBe(tenantOrgId("halcyon"));
    const unique = (values: string[]) => new Set(values).size === values.length;
    expect(unique(TENANTS.map((t) => t.orgId))).toBe(true);
    expect(unique(TENANTS.map((t) => t.name))).toBe(true);
    expect(unique(TENANTS.flatMap((t) => t.users.map((u) => u.email)))).toBe(true);
    expect(unique(TENANTS.flatMap((t) => t.users.map((u) => u.id)))).toBe(true);
    expect(unique(TENANTS.map((t) => t.zendeskSubdomain))).toBe(true);
    expect(unique(TENANTS.map((t) => t.jiraSiteUrl))).toBe(true);
    expect(unique(TENANTS.map((t) => t.jiraCloudId))).toBe(true);
    expect(TENANTS.every((t) => t.users.length === 2 && t.users.some((u) => u.role === "owner"))).toBe(true);
    expect(TENANTS.every((t) => t.users.every((u) => u.email.endsWith(".test")))).toBe(true);
  });

  it("Organization is not Customer: no tenant is named like a customer, and every tenant holds all 11 customers", () => {
    const customerNames = new Set(CUSTOMERS.map((c) => c.name));
    expect(TENANTS.some((t) => customerNames.has(t.name))).toBe(false);
    for (const tenant of [first, last]) {
      const dataset = buildSeedDataset(anchor, tenant);
      expect(dataset.customers.map((c) => c.name)).toEqual(CUSTOMERS.map((c) => c.name));
    }
  });

  it("selects tenants by key and rejects unknown ones", () => {
    expect(selectTenants()).toHaveLength(11);
    expect(selectTenants(["nimbus", "halcyon"]).map((t) => t.key)).toEqual(["halcyon", "nimbus"]);
    expect(() => selectTenants(["nope"])).toThrow(/Unknown tenant/);
  });

  it("shifts every external id per tenant, so no two of the 11 can collide", () => {
    const configs = TENANTS.map(tenantConfig);
    const disjoint = (pick: (c: ReturnType<typeof tenantConfig>) => (string | number)[]) => {
      const all = configs.flatMap(pick);
      return new Set(all).size === all.length;
    };
    expect(disjoint((c) => c.customers.map((x) => x.zendeskOrgId))).toBe(true);
    expect(disjoint((c) => c.agents.map((a) => a.id))).toBe(true);
    expect(disjoint((c) => c.schedules.map((s) => s.scheduleId))).toBe(true);
    expect(disjoint((c) => c.schedules.flatMap((s) => s.holidays.map((h) => h.id)))).toBe(true);
    expect(disjoint((c) => Object.values(c.statuses).map((s) => s.id))).toBe(true);
    expect(disjoint((c) => Object.values(c.projects).map((p) => p.id))).toBe(true);
    expect(disjoint((c) => c.reporters.concat(c.engineers).map((p) => p.accountId))).toBe(true);
    expect(disjoint((c) => c.groups)).toBe(true);
    expect(disjoint((c) => [c.customFieldProductArea, c.customFieldImpact])).toBe(true);
    // A tenant's whole ticket-id block (134 tickets) sits clear of every other block.
    const blocks = configs.map((c) => [c.ids.firstTicketId, c.ids.firstTicketId + 133]);
    for (let i = 1; i < blocks.length; i++) expect(blocks[i]![0]!).toBeGreaterThan(blocks[i - 1]![1]!);
    // Requesters are distinct people per tenant, not the same names reused.
    const names = configs.flatMap((c) => c.customers.flatMap((x) => x.requesters).concat(c.unassignedRequesters));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("seed-test-customers fixtures (one tenant's dataset)", () => {
  const dataset = buildSeedDataset(anchor, first);

  it("is deterministic: same anchor and tenant, same dataset — independent of the clock and Math.random", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-03-04T05:06:07.000Z"));
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random must not be used by the fixtures");
    });
    expect(snapshot(buildSeedDataset(anchor, first))).toBe(snapshot(dataset));
    random.mockRestore();
  });

  it("moves with the anchor: every timestamp is an offset from it", () => {
    const week = 7 * 24 * 60 * 60 * 1000;
    const shifted = buildSeedDataset(new Date(anchor.getTime() + week), first);
    expect(shifted.tickets).toHaveLength(dataset.tickets.length);
    expect(shifted.rawEvents).toHaveLength(dataset.rawEvents.length);
    expect(shifted.tickets.map((t) => t.createdAt.getTime() - week)).toEqual(dataset.tickets.map((t) => t.createdAt.getTime()));
  });

  it("the default anchor is fixed and `now` is floored to the hour", () => {
    expect(anchor.toISOString()).toBe("2026-09-29T15:00:00.000Z");
    expect(currentHourAnchor().getTime() % (60 * 60 * 1000)).toBe(0);
  });

  it("varies customers: sizes, tiers, policy paths, requester counts", () => {
    expect(CUSTOMERS).toHaveLength(11);
    const sizes = CUSTOMERS.map((c) => ROSTER[c.key]!.length);
    expect(new Set(sizes).size).toBeGreaterThanOrEqual(6);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(20);
    expect(new Set(CUSTOMERS.map((c) => c.tier)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(CUSTOMERS.map((c) => c.policy))).toEqual(new Set(["enterprise", "standard", "emea", "dach", "native", "none"]));
    expect(CUSTOMERS.every((c) => c.requesters.length >= 2)).toBe(true);
    expect(new Set(CUSTOMERS.map((c) => c.requesters.length)).size).toBeGreaterThanOrEqual(4);
  });

  it("gives every customer several cases, each with several distinct requesters used", () => {
    for (const customer of CUSTOMERS) {
      const tickets = dataset.tickets.filter((t) => t.customerKey === customer.key);
      expect(tickets.length).toBe(ROSTER[customer.key]!.length);
      expect(new Set(tickets.map((t) => t.requesterName)).size).toBeGreaterThanOrEqual(2);
    }
    expect(dataset.tickets.filter((t) => t.customerKey === null)).toHaveLength(UNASSIGNED_ROSTER.length);
  });

  it("covers every scenario at least once", () => {
    const used = new Set(dataset.tickets.map((t) => t.scenario));
    for (const scenario of Object.keys(SCENARIOS) as ScenarioKey[]) expect(used.has(scenario), scenario).toBe(true);
  });

  it("covers priorities, channels, VIP tagging, no-priority and soft-deleted tickets", () => {
    expect(new Set(dataset.tickets.map((t) => t.priority))).toEqual(new Set(["low", "normal", "high", "urgent", null]));
    expect(new Set(dataset.tickets.map((t) => t.channel))).toEqual(new Set(["email", "web", "chat", "api"]));
    expect(dataset.tickets.some((t) => t.tags.includes("vip"))).toBe(true);
    expect(dataset.tickets.some((t) => t.softDeleted)).toBe(true);
    expect(dataset.tickets.some((t) => t.failNotify)).toBe(true);
  });

  it("has unique ticket ids and unique provider event ids per integration", () => {
    expect(new Set(dataset.tickets.map((t) => t.ticketId)).size).toBe(dataset.tickets.length);
    for (const integration of ["zendesk", "jira"] as const) {
      const ids = dataset.rawEvents.filter((r) => r.integration === integration).map((r) => r.providerEventId);
      expect(new Set(ids).size, integration).toBe(ids.length);
    }
  });

  it("is referentially consistent: audits point at tickets, links at issues and tickets", () => {
    const ticketIds = new Set(dataset.tickets.map((t) => t.ticketId));
    const audits = dataset.rawEvents.filter((r) => r.providerEventId.startsWith("ticket_audit:"));
    expect(audits.length).toBeGreaterThan(dataset.tickets.length * 2);
    for (const audit of audits) expect(ticketIds.has((audit.payload as { ticket_id: number }).ticket_id)).toBe(true);

    const issueKeys = new Set(dataset.issues.map((i) => i.key));
    for (const link of dataset.rawEvents.filter((r) => r.providerEventId.startsWith("jira_link:"))) {
      const payload = link.payload as { ticket_id: string; issue_key: string };
      expect(ticketIds.has(Number(payload.ticket_id))).toBe(true);
      expect(issueKeys.has(payload.issue_key)).toBe(true);
    }
    for (const issue of dataset.issues.filter((i) => i.ticketId !== null)) expect(ticketIds.has(issue.ticketId!)).toBe(true);
    // Zendesk policies only reference this tenant's own Zendesk organizations.
    const orgIds = new Set(dataset.customers.map((c) => c.zendeskOrgId));
    for (const policy of dataset.rawEvents.filter((r) => r.providerEventId.startsWith("sla_policy:"))) {
      const conditions = (policy.payload as { filter?: { any?: { field: string; value: number }[] } }).filter?.any ?? [];
      for (const condition of conditions.filter((c) => c.field === "organization_id")) expect(orgIds.has(condition.value)).toBe(true);
    }
  });

  it("models the Zendesk -> Jira cases: many escalations, multi-issue, unlinked, orphan issues, every link mode", () => {
    expect(dataset.issues.filter((i) => i.ticketId !== null).length).toBeGreaterThanOrEqual(20);
    expect(dataset.issues.some((i) => i.ticketId === null)).toBe(true);
    expect(dataset.issues.some((i) => i.unlinked)).toBe(true);
    expect(new Set(dataset.issues.map((i) => i.linkMode))).toEqual(new Set(["both", "official", "remote", "stale_official", null]));
    const perTicket = new Map<number, number>();
    for (const i of dataset.issues) if (i.ticketId !== null) perTicket.set(i.ticketId, (perTicket.get(i.ticketId) ?? 0) + 1);
    expect(Math.max(...perTicket.values())).toBeGreaterThanOrEqual(2);
    expect(dataset.issues.some((i) => i.finalStatus === "done")).toBe(true);
    expect(dataset.issues.some((i) => i.finalStatus === "blocked")).toBe(true);
  });

  it("only uses times at or before the anchor, and keeps the Phase B boundary inside the history", () => {
    for (const row of dataset.rawEvents) expect(row.fetchedAt.getTime()).toBeLessThanOrEqual(anchor.getTime());
    expect(dataset.phaseBoundary.getTime()).toBeLessThan(anchor.getTime());
    expect(dataset.rawEvents.filter((r) => r.phase === "B").length).toBeGreaterThanOrEqual(3);
    for (const link of dataset.rawEvents.filter((r) => r.providerEventId.startsWith("jira_link:"))) {
      expect(link.fetchedAt.getTime()).toBeLessThan(anchor.getTime() - 60 * 60 * 1000);
    }
  });

  it("spreads history across weeks so trends/filters have something to work with", () => {
    const opened = dataset.tickets.map((t) => t.createdAt.getTime());
    const spanDays = (Math.max(...opened) - Math.min(...opened)) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeGreaterThanOrEqual(14);
  });
});

describe("the same fixture, generated independently per tenant", () => {
  let a: SeedDataset;
  let b: SeedDataset;
  let z: SeedDataset;
  beforeAll(() => {
    a = buildSeedDataset(anchor, first);
    b = buildSeedDataset(anchor, middle);
    z = buildSeedDataset(anchor, last);
  }, 60_000);

  it("has the same shape and scenarios in every tenant (nothing simplified)", () => {
    for (const other of [b, z]) {
      expect(other.tickets.map((t) => [t.scenario, t.customerKey, t.priority, t.channel])).toEqual(
        a.tickets.map((t) => [t.scenario, t.customerKey, t.priority, t.channel]),
      );
      expect(other.tickets.map((t) => t.createdAt.getTime())).toEqual(a.tickets.map((t) => t.createdAt.getTime()));
      expect(other.issues.map((i) => [i.linkMode, i.unlinked, i.finalStatus])).toEqual(a.issues.map((i) => [i.linkMode, i.unlinked, i.finalStatus]));
      expect(other.rawEvents).toHaveLength(a.rawEvents.length);
      expect(other.rawEvents.map((r) => [r.integration, r.phase, r.fetchedAt.getTime()])).toEqual(
        a.rawEvents.map((r) => [r.integration, r.phase, r.fetchedAt.getTime()]),
      );
    }
  });

  it("shares no external id between tenants: tickets, Zendesk orgs, Jira keys, provider events, requesters", () => {
    const sets = (d: SeedDataset) => ({
      tickets: d.tickets.map((t) => String(t.ticketId)),
      orgs: d.customers.map((c) => String(c.zendeskOrgId)),
      keys: d.issues.map((i) => i.key),
      events: d.rawEvents.map((r) => `${r.integration}|${r.providerEventId}`),
      requesters: d.tickets.map((t) => t.requesterName),
    });
    const sa = sets(a);
    for (const other of [sets(b), sets(z)]) {
      for (const kind of Object.keys(sa) as (keyof typeof sa)[]) {
        const mine = new Set(sa[kind]);
        expect(other[kind].filter((v) => mine.has(v)), kind).toEqual([]);
      }
    }
  });

  it("puts each tenant's own hostnames and nobody else's in its payloads", () => {
    const hosts = (d: SeedDataset) => new Set(snapshot(d).match(/elapsed-seed-[a-z-]+\.(zendesk\.com|atlassian\.net)/g) ?? []);
    expect(hosts(a)).toEqual(new Set([
      `${first.zendeskSubdomain}.zendesk.com`,
      `${first.staleZendeskSubdomain}.zendesk.com`,
      `${first.jiraSiteUrl.replace("https://", "")}`,
    ]));
    for (const d of [b, z]) for (const host of hosts(d)) expect(hosts(a).has(host)).toBe(false);
  });

  it("contains no real-world contact points: only .test addresses and fixture hostnames", () => {
    for (const dataset of [a, b, z]) {
      const text = snapshot(dataset);
      const emails = text.match(/[\w.+-]+@[\w.-]+/g) ?? [];
      expect(emails.length).toBeGreaterThan(0);
      for (const email of emails) expect(email.endsWith(".test"), email).toBe(true);
      for (const host of text.match(/https?:\/\/[\w.-]+/g) ?? []) {
        expect(/^https?:\/\/elapsed-seed-(legacy-)?[a-z]+\.(zendesk\.com|atlassian\.net)$/.test(host), host).toBe(true);
      }
    }
  });
});
