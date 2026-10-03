/**
 * The billing API (N6.5) against a real Postgres: who may call each route,
 * that input is validated and the organization always comes from the session,
 * typed errors, operator overrides writing their audit row with the change,
 * the provider boundary, and the billing page's read model over real rows.
 *
 * Needs a migrated database at TEST_DATABASE_URL whose name contains "test"
 * (every test truncates all tables). Skipped when unset.
 */
import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const OPERATOR = "ops@watchtower.test";

const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("server-only", () => ({}));

function sessionFor(email: string, role: "owner" | "member", organizationId: string): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: { id: "user-1", organizationId, email, emailVerifiedAt: new Date(), name: null, image: null, role, createdAt: new Date() },
  } as Session;
}

const post = (url: string, body?: unknown, method = "POST") =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe.skipIf(!TEST_DATABASE_URL)("billing API (real Postgres)", () => {
  let prisma: PrismaClient;
  let subscriptionRoute: typeof import("../src/app/api/billing/subscription/route");
  let accountRoute: typeof import("../src/app/api/billing/account/route");
  let providerRoute: typeof import("../src/app/api/billing/provider-session/route");
  let adminRoute: typeof import("../src/app/api/admin/billing/[organizationId]/route");
  let adminAllRoute: typeof import("../src/app/api/admin/billing/route");
  let billingData: typeof import("../src/lib/billing-data");
  let adminBillingData: typeof import("../src/lib/admin-billing-data");

  let organizationId: string;
  let otherOrganizationId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.PLATFORM_ADMIN_EMAILS = OPERATOR;
    prisma = (await import("@sla/db")).getPrismaClient();
    subscriptionRoute = await import("../src/app/api/billing/subscription/route");
    accountRoute = await import("../src/app/api/billing/account/route");
    providerRoute = await import("../src/app/api/billing/provider-session/route");
    adminRoute = await import("../src/app/api/admin/billing/[organizationId]/route");
    adminAllRoute = await import("../src/app/api/admin/billing/route");
    billingData = await import("../src/lib/billing-data");
    adminBillingData = await import("../src/lib/admin-billing-data");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`);
    organizationId = (await prisma.organization.create({ data: { name: "Acme", planStatus: "active" } })).id;
    otherOrganizationId = (await prisma.organization.create({ data: { name: "Other", planStatus: "active" } })).id;
    await prisma.user.create({ data: { organizationId, email: "owner@acme.test", passwordHash: "x", role: "owner" } });
    await prisma.user.create({ data: { organizationId, email: "member@acme.test", passwordHash: "x", role: "member" } });
    auth.session = sessionFor("owner@acme.test", "owner", organizationId);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const subscribe = (body: unknown) => subscriptionRoute.POST(post("/api/billing/subscription", body));
  const subscription = (orgId = organizationId) => prisma.billingSubscription.findUnique({ where: { organizationId: orgId } });
  const admin = (orgId: string, body: unknown) => adminRoute.POST(post(`/api/admin/billing/${orgId}`, body), { params: Promise.resolve({ organizationId: orgId }) });

  describe("customer subscription route", () => {
    it("needs a signed-in owner", async () => {
      auth.session = null;
      expect((await subscribe({ action: "start", plan: "team" })).status).toBe(401);
      auth.session = sessionFor("member@acme.test", "member", organizationId);
      expect((await subscribe({ action: "start", plan: "team" })).status).toBe(403);
      expect(await subscription()).toBeNull();
    });

    it("validates input and answers typed errors", async () => {
      const bad = await subscribe({ action: "start", plan: "platinum" });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ code: "invalid_input" });

      expect((await subscribe({ action: "change_seats", seatQuantity: 0, expectedVersion: 0 })).status).toBe(400);
      expect((await subscribe({ action: "teleport" })).status).toBe(400);

      const sales = await subscribe({ action: "start", plan: "enterprise" });
      expect(sales.status).toBe(422);
      expect(await sales.json()).toMatchObject({ code: "contact_sales" });

      const missing = await subscribe({ action: "cancel", expectedVersion: 0 });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({ code: "not_found" });
    });

    it("runs the lifecycle for the session's organization only, ignoring any organization in the body", async () => {
      const started = await subscribe({ action: "start", plan: "team", organizationId: otherOrganizationId });
      expect(started.status).toBe(200);
      expect(await subscription(otherOrganizationId)).toBeNull();
      let sub = (await subscription())!;
      expect(sub).toMatchObject({ plan: "team", status: "active" });

      expect((await subscribe({ action: "change_seats", seatQuantity: 5, expectedVersion: sub.version })).status).toBe(200);
      sub = (await subscription())!;
      expect(sub.seatQuantity).toBe(5);

      const stale = await subscribe({ action: "cancel", expectedVersion: sub.version - 1 });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ code: "conflict" });

      expect((await subscribe({ action: "cancel", expectedVersion: sub.version })).status).toBe(200);
      sub = (await subscription())!;
      expect(sub.cancelAtPeriodEnd).toBe(true);
      expect((await subscribe({ action: "resume", expectedVersion: sub.version })).status).toBe(200);
      expect((await subscription())!.cancelAtPeriodEnd).toBe(false);

      const events = await prisma.billingEvent.findMany({ where: { organizationId } });
      expect(events.every((event) => event.actorEmail === null || event.actorEmail === "owner@acme.test")).toBe(true);
    });
  });

  describe("billing account route", () => {
    it("validates and saves the profile for owners only", async () => {
      const invalid = await accountRoute.PATCH(post("/api/billing/account", { billingEmail: "nope" }, "PATCH"));
      expect(invalid.status).toBe(400);

      const saved = await accountRoute.PATCH(
        post("/api/billing/account", { billingEmail: "AP@Acme.test", legalName: "Acme Inc.", addressLines: ["1 Main St", ""], ccEmails: ["cfo@acme.test"] }, "PATCH"),
      );
      expect(saved.status).toBe(200);
      expect(await prisma.billingAccount.findUniqueOrThrow({ where: { organizationId } })).toMatchObject({
        billingEmail: "ap@acme.test",
        legalName: "Acme Inc.",
        addressLines: ["1 Main St"],
        ccEmails: ["cfo@acme.test"],
      });

      auth.session = sessionFor("member@acme.test", "member", organizationId);
      expect((await accountRoute.PATCH(post("/api/billing/account", { legalName: "Hijack" }, "PATCH"))).status).toBe(403);
    });
  });

  describe("provider boundary", () => {
    it("answers provider_unavailable while no payment provider is connected", async () => {
      const response = await providerRoute.POST(post("/api/billing/provider-session", { kind: "portal" }));
      expect(response.status).toBe(501);
      expect(await response.json()).toMatchObject({ code: "provider_unavailable" });
    });
  });

  describe("operator override route", () => {
    beforeEach(async () => {
      await subscribe({ action: "start", plan: "team" });
    });

    it("is closed to everyone but a platform operator, including the org's owner", async () => {
      expect((await admin(organizationId, { action: "add_note", note: "hi" })).status).toBe(403);
      expect((await adminAllRoute.POST()).status).toBe(403);
      expect(await prisma.adminAuditLog.count()).toBe(0);
    });

    it("applies an override and writes its billing event and audit row together", async () => {
      auth.session = sessionFor(OPERATOR, "member", otherOrganizationId);
      const invoice = await prisma.billingInvoice.findFirstOrThrow({ where: { organizationId } });

      expect((await admin(organizationId, { action: "mark_paid", invoiceId: invoice.id, rationale: "short" })).status).toBe(400);
      const paid = await admin(organizationId, { action: "mark_paid", invoiceId: invoice.id, rationale: "Wire transfer received 2026-10-03" });
      expect(paid.status).toBe(200);

      expect(await prisma.billingInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({ status: "paid" });
      const audit = await prisma.adminAuditLog.findMany();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actorEmail: OPERATOR, action: "billing_override", organizationId });
      expect(audit[0]!.metadata).toMatchObject({ action: "mark_paid", rationale: "Wire transfer received 2026-10-03" });

      // A refused override writes no audit row.
      const again = await admin(organizationId, { action: "mark_paid", invoiceId: invoice.id, rationale: "Wire transfer received 2026-10-03" });
      expect(again.status).toBe(409);
      expect(await prisma.adminAuditLog.count()).toBe(1);

      const retry = await admin(organizationId, { action: "retry_charge", invoiceId: invoice.id });
      expect(retry.status).toBe(501);
    });

    it("an operator plan change moves entitlements at once; an unknown organization is 404", async () => {
      auth.session = sessionFor(OPERATOR, "member", otherOrganizationId);
      const sub = (await subscription())!;
      expect((await admin(organizationId, { action: "change_plan", plan: "enterprise", expectedVersion: sub.version, rationale: "Signed enterprise contract" })).status).toBe(200);
      expect(await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).toMatchObject({ plan: "enterprise" });
      expect((await admin("missing-org", { action: "add_note", note: "hello" })).status).toBe(404);
    });
  });

  describe("read models", () => {
    it("the billing page reads the real subscription, invoices, usage and profile", async () => {
      const before = await billingData.getBillingOverview(prisma, { organizationId, canManage: true, providerAvailable: false });
      expect(before).toMatchObject({ subscription: null, effectivePlan: null, invoices: [], seats: { used: 2, licensed: null } });

      await subscribe({ action: "start", plan: "starter" });
      const after = (await billingData.getBillingOverview(prisma, { organizationId, canManage: true, providerAvailable: false }))!;
      expect(after.subscription).toMatchObject({ planId: "starter", status: "active", amountCents: 4_900, seatQuantity: 5 });
      expect(after.invoices).toHaveLength(1);
      expect(after.upcomingInvoice).toMatchObject({ planName: "Starter", amountCents: 4_900 });
      expect(after.seats).toMatchObject({ used: 2, licensed: 5, planLimit: 5, min: 2, max: 5 });
      expect(after.entitlements.find((entitlement) => entitlement.id === "seats")?.value).toEqual({ kind: "quota", used: 2, limit: 5, unit: "seats" });
      const team = after.planOptions.find((option) => option.id === "team")!;
      expect(team).toMatchObject({ effect: "now", selfServe: true, current: false });
      expect(after.planOptions.find((option) => option.id === "enterprise")).toMatchObject({ selfServe: false });
      expect(after.paymentMethod).toBeNull();
    });

    it("the admin directory and detail read every organization's real billing state", async () => {
      await subscribe({ action: "start", plan: "team" });
      const overview = await adminBillingData.getAdminBillingOverviewData(prisma, { providerAvailable: false });
      const acme = overview.tenants.find((tenant) => tenant.id === organizationId)!;
      expect(acme).toMatchObject({ tier: "team", status: "active", mrrCents: 14_900, openCents: 14_900, hasSubscription: true });
      expect(overview.tenants.find((tenant) => tenant.id === otherOrganizationId)).toMatchObject({ tier: "none", hasSubscription: false, mrrCents: 0 });

      const detail = (await adminBillingData.getAdminTenantBillingDetail(prisma, organizationId, { providerAvailable: false }))!;
      expect(detail.subscription).toMatchObject({ plan: "team", status: "active" });
      expect(detail.timeline.map((event) => event.kind)).toEqual(expect.arrayContaining(["subscription_started", "invoice_issued"]));
      expect(await adminBillingData.getAdminTenantBillingDetail(prisma, "missing-org", { providerAvailable: false })).toBeNull();
    });
  });
});
