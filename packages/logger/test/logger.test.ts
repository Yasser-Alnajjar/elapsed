import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger";

describe("createLogger", () => {
  it("writes one JSON line per call, merging base and call fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger({ kind: "active_set_poll" });

    logger.info("cycle_finished", { organizationsProcessed: 3 });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(line).toMatchObject({
      level: "info",
      event: "cycle_finished",
      kind: "active_set_poll",
      organizationsProcessed: 3,
    });
    expect(typeof line.time).toBe("string");
    spy.mockRestore();
  });

  it("child() carries the parent's fields and lets call-site fields override them", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = createLogger({ organizationId: "org_1", stage: "ingest" });
    const child = logger.child({ integrationId: "int_1", provider: "zendesk" });

    child.warn("backfill_ticket_audits_missing", { ticketId: "42", stage: "backfill" });

    const line = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(line).toMatchObject({
      level: "warn",
      organizationId: "org_1",
      integrationId: "int_1",
      provider: "zendesk",
      ticketId: "42",
      stage: "backfill",
    });
    spy.mockRestore();
  });

  it("routes error() to console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    createLogger().error("cycle_failed", { error: "boom" });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
