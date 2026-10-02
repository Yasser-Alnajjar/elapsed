import { describe, expect, it } from "vitest";
import { describeAuditChange } from "../src/lib/admin-audit-delta";
import { auditQuery, hasAuditFilters, parseAuditFilters } from "../src/lib/admin-audit-filters";

describe("describeAuditChange", () => {
  it("shows only the plan fields that changed, in words", () => {
    const change = describeAuditChange({
      action: "update_plan",
      integrationId: null,
      metadata: {
        before: { plan: null, planStatus: "trial", trialEndsAt: "2026-11-05T00:00:00.000Z", billingReference: "INV-GLX-08" },
        after: { plan: "team", planStatus: "past_due", trialEndsAt: "2026-11-05T00:00:00.000Z", billingReference: "INV-GLX-09" },
      },
    });
    expect(change.entries).toEqual([
      { field: "Plan", before: "Not recorded", after: "Team" },
      { field: "Status", before: "Trial", after: "Past due" },
      { field: "Billing reference", before: "INV-GLX-08", after: "INV-GLX-09" },
    ]);
  });

  it("reads worker interval changes as durations", () => {
    const change = describeAuditChange({
      action: "update_worker_settings",
      integrationId: null,
      metadata: {
        before: { activePollIntervalMs: 300_000, reconciliationIntervalMs: 1_800_000 },
        after: { activePollIntervalMs: 60_000, reconciliationIntervalMs: 1_800_000 },
      },
    });
    expect(change.entries).toHaveLength(1);
    expect(change.entries[0]).toMatchObject({ field: "Active monitoring" });
    expect(change.entries[0]!.before).not.toBe(change.entries[0]!.after);
  });

  it("names the provider of an integration control, and survives malformed metadata", () => {
    expect(describeAuditChange({ action: "pause_polling", integrationId: "int_1", metadata: { provider: "jira" } }).facts).toEqual([
      { label: "Provider", value: "Jira" },
      { label: "Integration", value: "int_1" },
    ]);
    expect(describeAuditChange({ action: "update_plan", integrationId: null, metadata: "nonsense" })).toEqual({ entries: [], facts: [] });
    expect(describeAuditChange({ action: "view_tenant", integrationId: null, metadata: null })).toEqual({ entries: [], facts: [] });
  });
});

describe("audit filters in the URL", () => {
  it("drops unknown actions and empty values", () => {
    expect(parseAuditFilters({ action: "drop_table", actor: "  ", org: "" })).toEqual({ action: null, actor: null, organizationId: null, hideViews: false });
    expect(parseAuditFilters({ action: "pause_polling", actor: " alex@ ", org: "org_1", hideViews: "1" })).toEqual({
      action: "pause_polling",
      actor: "alex@",
      organizationId: "org_1",
      hideViews: true,
    });
  });

  it("round-trips, omitting defaults, and hideViews is moot when one action is chosen", () => {
    expect(auditQuery({}, null)).toBe("");
    expect(auditQuery({ hideViews: true })).toBe("?hideViews=1");
    expect(auditQuery({ action: "update_plan", hideViews: true })).toBe("?action=update_plan");
    expect(auditQuery({ organizationId: "org_1" }, "cursor_9")).toBe("?org=org_1&before=cursor_9");
    expect(hasAuditFilters({})).toBe(false);
    expect(hasAuditFilters({ actor: "a" })).toBe(true);
  });
});
