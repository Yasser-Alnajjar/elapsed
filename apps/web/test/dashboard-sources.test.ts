import type { SourceRole } from "@sla/core";
import { describe, expect, it } from "vitest";
import { dashboardSourceStatus } from "../src/lib/dashboard-sources";

const ROLES: Record<string, SourceRole> = {
  zendesk: "ticket_source",
  intercom: "ticket_source",
  jira: "work_tracker",
  linear: "work_tracker",
  github: "code_host",
  custom: "ticket_source",
};
const views = (connected: string[]) =>
  Object.fromEntries(
    Object.entries(ROLES).map(([p, role]) => [p, { role, connected: connected.includes(p) }]),
  ) as Parameters<typeof dashboardSourceStatus>[0];

describe("dashboardSourceStatus", () => {
  it("names Intercom and Jira when those are the connected ones", () => {
    expect(dashboardSourceStatus(views(["intercom", "jira"]))).toEqual([
      { label: "Intercom", connected: true, role: "ticket_source" },
      { label: "Jira", connected: true, role: "work_tracker" },
    ]);
  });

  it("lists every connected source of a role, not just the first", () => {
    expect(dashboardSourceStatus(views(["zendesk", "intercom", "jira", "linear", "github"])).map((s) => s.label)).toEqual([
      "Zendesk",
      "Intercom",
      "Jira",
      "Linear",
      "GitHub",
    ]);
  });

  it("shows a placeholder for a required role with nothing connected, and omits an absent code host", () => {
    expect(dashboardSourceStatus(views([]))).toEqual([
      { label: "Ticket source", connected: false, role: "ticket_source" },
      { label: "Work tracker", connected: false, role: "work_tracker" },
    ]);
  });
});
