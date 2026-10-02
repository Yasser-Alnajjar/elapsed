import type { PrismaClient } from "@sla/db";
import type { EmailConfig, EmailMessage } from "@sla/email";
import { describe, expect, it, vi } from "vitest";
import { buildTrialExpiryEmail, deliverTrialExpiryNotice } from "../src/trial-expiry";

const NOW = new Date("2026-10-10T12:00:00Z");
const config = {} as EmailConfig;

function fake(overrides: { trialEndsAt?: Date | null; owners?: string[] } = {}) {
  const events: Record<string, unknown>[] = [];
  const organization = { name: "Acme", plan: null, planStatus: "trial", trialEndsAt: overrides.trialEndsAt === undefined ? new Date("2026-10-01T00:00:00Z") : overrides.trialEndsAt };
  const owners = overrides.owners ?? ["owner@acme.test"];
  const prisma = {
    organization: { findUnique: async () => organization },
    user: { findMany: async () => owners.map((email) => ({ email })) },
    entitlementEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (events.some((e) => e.dedupeKey === data.dedupeKey && e.kind === data.kind)) throw Object.assign(new Error("unique"), { code: "P2002" });
        events.push({ ...data });
      },
      update: async ({ data }: { data: Record<string, unknown> }) => void Object.assign(events[0]!, data),
      delete: async () => void events.splice(0, 1),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, events };
}

describe("deliverTrialExpiryNotice (N6.4)", () => {
  it("emails each owner once and stamps the event; later ticks send nothing", async () => {
    const { prisma, events } = fake({ owners: ["a@acme.test", "b@acme.test"] });
    const send = vi.fn(async (_c: EmailConfig, _m: EmailMessage) => undefined);

    expect(await deliverTrialExpiryNotice(prisma, "org-a", { appUrl: "https://sla.example.com", now: NOW, loadConfig: () => config, send })).toBe("sent");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([, message]) => message.to)).toEqual([["a@acme.test"], ["b@acme.test"]]);
    expect(events[0]).toMatchObject({ kind: "trial_expired", notifiedAt: NOW });

    expect(await deliverTrialExpiryNotice(prisma, "org-a", { appUrl: null, now: NOW, loadConfig: () => config, send })).toBe("already_handled");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends nothing while the trial is still running", async () => {
    const { prisma } = fake({ trialEndsAt: new Date("2026-11-01T00:00:00Z") });
    const send = vi.fn();
    expect(await deliverTrialExpiryNotice(prisma, "org-a", { appUrl: null, now: NOW, loadConfig: () => config, send })).toBe("not_expired");
    expect(send).not.toHaveBeenCalled();
  });

  it("releases the claim when every send fails, so the next tick retries", async () => {
    const { prisma, events } = fake();
    const failing = vi.fn(async () => {
      throw new Error("smtp down");
    });
    await expect(deliverTrialExpiryNotice(prisma, "org-a", { appUrl: null, now: NOW, loadConfig: () => config, send: failing })).rejects.toThrow("smtp down");
    expect(events).toEqual([]);

    const ok = vi.fn(async () => undefined);
    expect(await deliverTrialExpiryNotice(prisma, "org-a", { appUrl: null, now: NOW, loadConfig: () => config, send: ok })).toBe("sent");
  });

  it("releases the claim when the worker no longer owns the organization, and sends nothing", async () => {
    const { prisma, events } = fake();
    const send = vi.fn();
    await expect(
      deliverTrialExpiryNotice(prisma, "org-a", {
        appUrl: null,
        now: NOW,
        loadConfig: () => config,
        send,
        beforeSend: async () => {
          throw new Error("lease lost");
        },
      }),
    ).rejects.toThrow("lease lost");
    expect(send).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("keeps the claim, without retrying, when there is no owner to email", async () => {
    const { prisma, events } = fake({ owners: [] });
    const send = vi.fn();
    expect(await deliverTrialExpiryNotice(prisma, "org-a", { appUrl: null, now: NOW, loadConfig: () => config, send })).toBe("no_owner");
    expect(events).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("tells the owner that monitoring continues and what is paused, and never mentions billing it does not have", () => {
    const message = buildTrialExpiryEmail({ to: "o@x.com", organizationName: "Acme", appUrl: "https://sla.example.com" });
    expect(message.subject).toContain("Acme");
    expect(message.text).toContain("keep working");
    expect(message.text).toContain("https://sla.example.com/pricing");
    expect(message.text?.toLowerCase()).not.toContain("charged");
  });
});
