/**
 * R6 (plan 09 §4.3): activation is blocked when the source has no incremental
 * cursor and one full pass does not fit in one run; the response carries the
 * measurement. The pass itself is `measureFullPass` (full-pass-activation.test.ts
 * runs it against a fixture server); here it is stubbed to isolate the wrapper.
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@sla/db";

const measure = vi.hoisted(() => vi.fn());
const draft = vi.hoisted(() => ({ incremental: false }));

vi.mock("@sla/custom-ticket", async (importActual) => {
  const actual = await importActual<typeof import("@sla/custom-ticket")>();
  return {
    ...actual,
    measureFullPass: measure,
    validateConfig: () => ({ ok: true, diagnostics: [] }),
    loadReadyDraft: async () => ({
      config: { tickets: { incremental: draft.incremental ? { format: "iso8601", lookbackSeconds: 300 } : undefined } },
      secrets: {},
    }),
  };
});

import { activateDraft } from "@/lib/custom-provider/activation";

describe("activation blocking (R6)", () => {
  it("refuses with `listing_too_large` and the measurement when a cursorless source does not fit one run", async () => {
    draft.incremental = false;
    const measurement = { completed: false, pages: 50, tickets: 50, requests: 50, seconds: 10, stoppedBy: "run_cap_reached" };
    measure.mockResolvedValueOnce(measurement);
    // No prisma call may happen before the refusal.
    const prisma = new Proxy({}, { get: () => { throw new Error("prisma must not be touched before the refusal"); } }) as unknown as PrismaClient;
    await expect(activateDraft(prisma, { organizationId: "org", userId: "u" })).resolves.toEqual({ status: "listing_too_large", measurement });
  });

  it("does not run the full-pass check for a source with an incremental cursor", async () => {
    draft.incremental = true;
    measure.mockClear();
    const stop = new Error("reached the database step");
    const prisma = new Proxy({}, { get: () => { throw stop; } }) as unknown as PrismaClient;
    await expect(activateDraft(prisma, { organizationId: "org", userId: "u" })).rejects.toBe(stop);
    expect(measure).not.toHaveBeenCalled();
  });
});
