/**
 * The internal billing domain (N6.5) against real Postgres: starting a
 * subscription (in and out of a trial), plan and seat changes, cancellation
 * and resume, period renewal and trial conversion, overdue invoices, operator
 * overrides, optimistic concurrency, organization isolation, the provider
 * boundary, and that every transition is mirrored onto the organization
 * columns the entitlement checks read.
 *
 * Needs a migrated database at TEST_DATABASE_URL whose name contains "test";
 * skipped when unset. Truncates every table between tests.
 */
import type { BillingActor, BillingProvider, PrismaClient, SubscriptionSnapshot } from "../src/index";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-03T12:00:00.000Z");
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const OWNER: BillingActor = { type: "user", email: "owner@acme.test" };
const OPERATOR: BillingActor = { type: "operator", email: "ops@elapsed.test" };
const roleOf = () => "ticket_source" as const;

describe.skipIf(!TEST_DATABASE_URL)("billing domain (real Postgres)", () => {
  let prisma: PrismaClient;
  let db: typeof import("../src/index");
  let organizationId: string;
  let otherOrganizationId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = await import("../src/index");
    prisma = db.getPrismaClient();
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
    organizationId = (await prisma.organization.create({ data: { name: "Acme", planStatus: "active" } })).id;
    otherOrganizationId = (await prisma.organization.create({ data: { name: "Other", planStatus: "active" } })).id;
    await addMembers(organizationId, 3);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function addMembers(orgId: string, count: number) {
    const existing = await prisma.user.count({ where: { organizationId: orgId } });
    for (let i = 0; i < count; i += 1) {
      await prisma.user.create({
        data: { organizationId: orgId, email: `m${existing + i}-${orgId}@acme.test`, passwordHash: "x", role: existing + i === 0 ? "owner" : "member" },
      });
    }
  }

  const subscription = (orgId = organizationId) => prisma.billingSubscription.findUniqueOrThrow({ where: { organizationId: orgId } });
  const organization = (orgId = organizationId) => prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
  const invoices = (orgId = organizationId) => prisma.billingInvoice.findMany({ where: { organizationId: orgId }, orderBy: { issuedAt: "asc" } });
  const eventTypes = async (orgId = organizationId) =>
    (await prisma.billingEvent.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "asc" } })).map((event) => event.type);

  const start = (plan: string, extra: Partial<Parameters<typeof db.startSubscription>[1]> = {}) =>
    db.startSubscription(prisma, { organizationId, actor: OWNER, provider: null, plan, now: NOW, ...extra });

  async function expectBillingError(promise: Promise<unknown>, code: string) {
    await expect(promise).rejects.toMatchObject({ name: "BillingError", code });
  }

  // ---- Creating a billing account and subscription -------------------------------

  describe("starting a subscription", () => {
    it("outside a trial: active now, first period invoiced on net terms, organization mirrored", async () => {
      const snapshot = await start("team");

      expect(snapshot).toMatchObject({ plan: "team", status: "active", seatQuantity: 20, unitPriceCents: 14_900 });
      const sub = await subscription();
      expect(sub.currentPeriodStart).toEqual(NOW);
      expect(sub.currentPeriodEnd).toEqual(new Date("2026-11-03T12:00:00.000Z"));
      expect(await organization()).toMatchObject({ plan: "team", planStatus: "active" });

      const [invoice] = await invoices();
      expect(invoice).toMatchObject({ number: "INV-2026-001", status: "open", totalCents: 14_900, reason: "subscription_create", plan: "team" });
      expect(invoice!.dueAt).toEqual(at(db.INVOICE_NET_TERMS_DAYS));

      const account = await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId } });
      expect(account.billingEmail).toBe(OWNER.email);
      expect(await eventTypes()).toEqual(["subscription_started", "invoice_issued"]);
    });

    it("during a trial: the plan is chosen now and billing starts when the trial ends", async () => {
      await prisma.organization.update({ where: { id: organizationId }, data: { planStatus: "trial", trialEndsAt: at(5) } });
      const snapshot = await start("starter");

      expect(snapshot).toMatchObject({ status: "trial", plan: "starter", trialEndsAt: at(5), currentPeriodEnd: at(5) });
      expect(await invoices()).toHaveLength(0);
      expect(await organization()).toMatchObject({ plan: "starter", planStatus: "trial", trialEndsAt: at(5) });
    });

    it("refuses an unknown plan, a contract plan for a customer, and a second subscription", async () => {
      await expectBillingError(start("platinum"), "invalid_plan");
      await expectBillingError(start("enterprise"), "contact_sales");
      await start("team");
      await expectBillingError(start("starter"), "invalid_transition");
    });

    it("lets an operator start Enterprise, which is not invoiced internally", async () => {
      const snapshot = await start("enterprise", { actor: OPERATOR });
      expect(snapshot).toMatchObject({ plan: "enterprise", unitPriceCents: null, seatQuantity: 3 });
      expect(await invoices()).toHaveLength(0);
    });

    it("validates the seat quantity against seats in use and the plan limit", async () => {
      await expectBillingError(start("team", { seatQuantity: 2 }), "invalid_seats");
      await expectBillingError(start("team", { seatQuantity: 21 }), "invalid_seats");
      await expectBillingError(start("team", { seatQuantity: 3.5 }), "invalid_seats");
      await expect(start("team", { seatQuantity: 3 })).resolves.toMatchObject({ seatQuantity: 3 });
    });

    it("refuses an internal organization", async () => {
      await prisma.organization.update({ where: { id: organizationId }, data: { planStatus: "internal" } });
      await expectBillingError(start("team"), "invalid_transition");
    });

    it("two first subscriptions racing: exactly one wins", async () => {
      const results = await Promise.allSettled([start("team"), start("starter")]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.billingSubscription.count({ where: { organizationId } })).toBe(1);
    });
  });

  // ---- Plan changes ----------------------------------------------------------------

  describe("plan changes", () => {
    it("an upgrade applies now, prorates the rest of the period, and moves entitlements", async () => {
      await start("starter");
      const { version } = await subscription();
      // Halfway through a 31-day period (Oct 3 → Nov 3).
      const halfway = new Date(NOW.getTime() + 15.5 * DAY);
      await db.changeSubscriptionPlan(prisma, { organizationId, actor: OWNER, provider: null, plan: "team", expectedVersion: version, now: halfway });

      expect(await subscription()).toMatchObject({ plan: "team", unitPriceCents: 14_900, pendingPlan: null, seatQuantity: 5 });
      expect(await organization()).toMatchObject({ plan: "team" });
      const proration = (await invoices()).find((invoice) => invoice.reason === "subscription_update");
      expect(proration?.totalCents).toBe(5_000); // (149 - 49) × half
      expect(db.effectiveLimit({ plan: "team", seatQuantity: 5 }, "seats")).toBe(5);
    });

    it("a downgrade is scheduled for the period end; choosing the current plan withdraws it", async () => {
      await start("team");
      let sub = await subscription();
      await db.changeSubscriptionPlan(prisma, { organizationId, actor: OWNER, provider: null, plan: "starter", expectedVersion: sub.version, now: NOW });
      sub = await subscription();
      expect(sub).toMatchObject({ plan: "team", pendingPlan: "starter" });
      expect(await organization()).toMatchObject({ plan: "team" });

      await db.changeSubscriptionPlan(prisma, { organizationId, actor: OWNER, provider: null, plan: "team", expectedVersion: sub.version, now: NOW });
      expect(await subscription()).toMatchObject({ plan: "team", pendingPlan: null });
      expect(await eventTypes()).toContain("plan_change_cancelled");
    });

    it("a scheduled downgrade applies at renewal and the renewal is invoiced at the new price", async () => {
      await start("team");
      const sub = await subscription();
      await db.changeSubscriptionPlan(prisma, { organizationId, actor: OWNER, provider: null, plan: "starter", expectedVersion: sub.version, now: NOW });

      await db.reconcileSubscription(prisma, organizationId, at(32));
      expect(await subscription()).toMatchObject({ plan: "starter", pendingPlan: null, unitPriceCents: 4_900, seatQuantity: 5 });
      expect(await organization()).toMatchObject({ plan: "starter" });
      const cycle = (await invoices()).filter((invoice) => invoice.reason === "subscription_cycle");
      expect(cycle.map((invoice) => invoice.totalCents)).toEqual([4_900]);
    });

    it("refuses a downgrade the seats in use do not fit, and changing to the plan already on", async () => {
      await start("team");
      await addMembers(organizationId, 3); // 6 in use; Starter allows 5
      const sub = await subscription();
      await expectBillingError(
        db.changeSubscriptionPlan(prisma, { organizationId, actor: OWNER, provider: null, plan: "starter", expectedVersion: sub.version, now: NOW }),
        "invalid_seats",
      );
      await expectBillingError(
        db.changeSubscriptionPlan(prisma, { organizationId, actor: OWNER, provider: null, plan: "team", expectedVersion: sub.version, now: NOW }),
        "invalid_transition",
      );
    });

    it("a stale version is a conflict and changes nothing (no double apply)", async () => {
      await start("starter");
      const { version } = await subscription();
      await db.changeSubscriptionPlan(prisma, { organizationId, actor: OWNER, provider: null, plan: "team", expectedVersion: version, now: NOW });
      await expectBillingError(
        db.changeSubscriptionPlan(prisma, { organizationId, actor: OWNER, provider: null, plan: "team", expectedVersion: version, now: NOW }),
        "conflict",
      );
      expect((await invoices()).filter((invoice) => invoice.reason === "subscription_update")).toHaveLength(1);
    });
  });

  // ---- Seats -----------------------------------------------------------------------

  describe("seat changes", () => {
    it("changes licensed seats within range, and the entitlement check uses them", async () => {
      await start("team");
      let sub = await subscription();
      await db.changeSeatQuantity(prisma, { organizationId, actor: OWNER, provider: null, seatQuantity: 4, expectedVersion: sub.version, now: NOW });
      sub = await subscription();
      expect(sub.seatQuantity).toBe(4);
      expect(await eventTypes()).toContain("seats_changed");

      await prisma.workerSettings.create({
        data: { id: "singleton", activePollIntervalMs: 30_000, reconciliationIntervalMs: 1_800_000, freshnessGraceFactor: 3, entitlementsEnforced: true },
      });
      // 3 in use; inviting a 4th reaches the 4 licensed seats (not Team's 20).
      expect(await db.checkEntitlement(prisma, organizationId, "seats", { roleOf, now: NOW })).toEqual({ outcome: "warn", resource: "seats", used: 4, limit: 4 });
    });

    it("refuses fewer seats than in use, more than the plan allows, and no change", async () => {
      await start("starter");
      const sub = await subscription();
      const change = (seatQuantity: number) =>
        db.changeSeatQuantity(prisma, { organizationId, actor: OWNER, provider: null, seatQuantity, expectedVersion: sub.version, now: NOW });
      await expectBillingError(change(2), "invalid_seats");
      await expectBillingError(change(6), "invalid_seats");
      await expectBillingError(change(5), "invalid_transition");
      expect((await subscription()).seatQuantity).toBe(5);
    });
  });

  // ---- Cancellation and resume ------------------------------------------------------

  describe("cancellation and resume", () => {
    it("cancel schedules the end, resume withdraws it, and the period end ends it", async () => {
      await start("team");
      let sub = await subscription();
      await db.cancelSubscription(prisma, { organizationId, actor: OWNER, provider: null, expectedVersion: sub.version, now: NOW });
      sub = await subscription();
      expect(sub).toMatchObject({ cancelAtPeriodEnd: true, status: "active" });
      await expectBillingError(db.cancelSubscription(prisma, { organizationId, actor: OWNER, provider: null, expectedVersion: sub.version, now: NOW }), "invalid_transition");

      await db.resumeSubscription(prisma, { organizationId, actor: OWNER, provider: null, expectedVersion: sub.version, now: NOW });
      sub = await subscription();
      expect(sub.cancelAtPeriodEnd).toBe(false);
      await expectBillingError(db.resumeSubscription(prisma, { organizationId, actor: OWNER, provider: null, expectedVersion: sub.version, now: NOW }), "invalid_transition");

      await db.cancelSubscription(prisma, { organizationId, actor: OWNER, provider: null, expectedVersion: sub.version, now: NOW });
      await db.reconcileSubscription(prisma, organizationId, at(40));
      sub = await subscription();
      expect(sub).toMatchObject({ status: "cancelled", cancelAtPeriodEnd: false });
      expect(sub.endedAt).toEqual(new Date("2026-11-03T12:00:00.000Z"));
      expect(await organization()).toMatchObject({ planStatus: "cancelled" });
      // Only the first invoice: nothing renewed after cancellation.
      expect(await invoices()).toHaveLength(1);
      await expectBillingError(db.resumeSubscription(prisma, { organizationId, actor: OWNER, provider: null, expectedVersion: sub.version, now: at(40) }), "invalid_transition");
    });

    it("an ended subscription restarts in place with a fresh period and invoice", async () => {
      await start("team");
      const sub = await subscription();
      await db.cancelSubscription(prisma, { organizationId, actor: OWNER, provider: null, expectedVersion: sub.version, now: NOW });
      await db.reconcileSubscription(prisma, organizationId, at(40));

      await db.startSubscription(prisma, { organizationId, actor: OWNER, provider: null, plan: "starter", now: at(41) });
      expect(await subscription()).toMatchObject({ status: "active", plan: "starter", cancelAtPeriodEnd: false, endedAt: null });
      expect(await organization()).toMatchObject({ planStatus: "active", plan: "starter" });
      expect((await invoices()).map((invoice) => invoice.number)).toEqual(["INV-2026-001", "INV-2026-002"]);
    });
  });

  // ---- Lifecycle over time ------------------------------------------------------------

  describe("renewal, trial conversion and overdue invoices", () => {
    it("a trial converts at its end and renews monthly, each period invoiced once", async () => {
      await prisma.organization.update({ where: { id: organizationId }, data: { planStatus: "trial", trialEndsAt: at(5) } });
      await start("team");

      await db.reconcileSubscription(prisma, organizationId, at(70));
      await db.reconcileSubscription(prisma, organizationId, at(70)); // idempotent
      const sub = await subscription();
      expect(sub.status).not.toBe("trial");
      expect(sub.currentPeriodStart).toEqual(new Date("2026-12-08T12:00:00.000Z"));
      const cycle = await invoices();
      expect(cycle.map((invoice) => invoice.periodStart.toISOString())).toEqual([
        "2026-10-08T12:00:00.000Z",
        "2026-11-08T12:00:00.000Z",
        "2026-12-08T12:00:00.000Z",
      ]);
      expect((await eventTypes()).filter((type) => type === "trial_converted")).toHaveLength(1);
    });

    it("an unpaid invoice past due makes it past due; recording payment recovers it", async () => {
      await start("team");
      await db.reconcileSubscription(prisma, organizationId, at(15));
      expect(await subscription()).toMatchObject({ status: "past_due" });
      expect(await organization()).toMatchObject({ planStatus: "past_due" });

      const [invoice] = await invoices();
      await db.markInvoicePaid(prisma, { organizationId, invoiceId: invoice!.id, actor: OPERATOR, now: at(16) });
      expect(await subscription()).toMatchObject({ status: "active" });
      expect(await organization()).toMatchObject({ planStatus: "active" });
      await expectBillingError(db.markInvoicePaid(prisma, { organizationId, invoiceId: invoice!.id, actor: OPERATOR, now: at(16) }), "invalid_transition");
    });
  });

  // ---- Operator overrides -------------------------------------------------------------

  describe("operator overrides", () => {
    it("grace pushes open due dates out; comping voids every open invoice", async () => {
      await start("team");
      await db.extendGrace(prisma, { organizationId, actor: OPERATOR, now: NOW });
      const [invoice] = await invoices();
      expect(invoice!.dueAt).toEqual(at(db.INVOICE_NET_TERMS_DAYS + db.GRACE_EXTENSION_DAYS));

      await expect(db.voidOpenInvoices(prisma, { organizationId, actor: OPERATOR, now: NOW })).resolves.toEqual({ voided: 1 });
      expect((await invoices())[0]!.status).toBe("void");
      await expectBillingError(db.voidOpenInvoices(prisma, { organizationId, actor: OPERATOR, now: NOW }), "invalid_transition");
    });

    it("an override's audit hook commits with it, and a failing hook rolls the change back", async () => {
      await start("team");
      await db.addBillingNote(prisma, { organizationId, actor: OPERATOR, note: "Card reissued", audit: async () => {} });
      expect(await eventTypes()).toContain("operator_note");

      const [invoice] = await invoices();
      await expect(
        db.markInvoicePaid(prisma, {
          organizationId,
          invoiceId: invoice!.id,
          actor: OPERATOR,
          now: NOW,
          audit: async () => {
            throw new Error("audit write failed");
          },
        }),
      ).rejects.toThrow("audit write failed");
      expect((await invoices())[0]!.status).toBe("open");
      expect(await eventTypes()).not.toContain("invoice_paid");
    });

    it("cannot touch another organization's invoice", async () => {
      await start("team");
      await db.startSubscription(prisma, { organizationId: otherOrganizationId, actor: OWNER, provider: null, plan: "starter", now: NOW });
      const [foreign] = await invoices(otherOrganizationId);
      await expectBillingError(db.markInvoicePaid(prisma, { organizationId, invoiceId: foreign!.id, actor: OPERATOR, now: NOW }), "not_found");
      await expectBillingError(db.voidInvoice(prisma, { organizationId, invoiceId: foreign!.id, actor: OPERATOR, now: NOW }), "not_found");
      expect((await invoices(otherOrganizationId))[0]!.status).toBe("open");
    });
  });

  // ---- Provider boundary -------------------------------------------------------------

  describe("provider boundary", () => {
    it("collecting a charge needs a provider", async () => {
      await start("team");
      const [invoice] = await invoices();
      await expectBillingError(db.collectInvoice(prisma, { organizationId, invoiceId: invoice!.id, actor: OPERATOR, provider: null }), "provider_unavailable");
    });

    it("a provider is told about each committed change, and its failure rolls the change back", async () => {
      const synced: SubscriptionSnapshot[] = [];
      const provider: BillingProvider = {
        name: "Test",
        syncSubscription: vi.fn(async (snapshot: SubscriptionSnapshot) => {
          synced.push(snapshot);
        }),
        createPaymentMethodSession: vi.fn(),
        createPortalSession: vi.fn(),
        collectInvoice: vi.fn(async () => ({ paid: true })),
      };
      await start("team", { provider });
      expect(synced).toHaveLength(1);
      expect(synced[0]).toMatchObject({ organizationId, plan: "team", status: "active" });

      const [invoice] = await invoices();
      await expect(db.collectInvoice(prisma, { organizationId, invoiceId: invoice!.id, actor: OPERATOR, provider, now: NOW })).resolves.toEqual({ paid: true });
      expect((await invoices())[0]!.status).toBe("paid");

      const failing: BillingProvider = { ...provider, syncSubscription: vi.fn(async () => Promise.reject(new Error("provider down"))) };
      const sub = await subscription();
      await expect(
        db.changeSeatQuantity(prisma, { organizationId, actor: OWNER, provider: failing, seatQuantity: 10, expectedVersion: sub.version, now: NOW }),
      ).rejects.toThrow("provider down");
      expect((await subscription()).seatQuantity).toBe(20);
    });
  });
});
