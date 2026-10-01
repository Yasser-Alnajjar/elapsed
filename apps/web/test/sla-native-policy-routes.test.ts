/**
 * `POST /api/settings/sla-policies` (create), `PATCH /api/settings/sla-policies/[id]`
 * (edit) and the activate/deactivate routes (task 4.2/4.3/4.4, D12) — end to
 * end through the real route handlers, same setup as
 * sla-policy-override-route.test.ts (which this suite mirrors).
 *
 * Real Postgres. Needs a migrated database at TEST_DATABASE_URL whose name
 * contains "test"; skipped when unset.
 */
import type { Session } from "next-auth";
import type { PrismaClient } from "@sla/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { sourceIntegration } from "./source-integration";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => auth.session),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("server-only", () => ({}));

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe.skipIf(!TEST_DATABASE_URL)(
  "Native SLA policy routes (real Postgres)",
  () => {
    let prisma: PrismaClient;
    let createRoute: typeof import("../src/app/api/settings/sla-policies/route");
    let updateRoute: typeof import("../src/app/api/settings/sla-policies/[id]/route");
    let activateRoute: typeof import("../src/app/api/settings/sla-policies/[id]/activate/route");
    let deactivateRoute: typeof import("../src/app/api/settings/sla-policies/[id]/deactivate/route");

    let organizationId: string;
    let calendarId: string;
    let otherOrgPolicyId: string;

    beforeAll(async () => {
      const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
      if (!/test/i.test(name)) {
        throw new Error(
          `TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`,
        );
      }
      process.env.DATABASE_URL = TEST_DATABASE_URL;
      prisma = (await import("@sla/db")).getPrismaClient();
      createRoute = await import("../src/app/api/settings/sla-policies/route");
      updateRoute =
        await import("../src/app/api/settings/sla-policies/[id]/route");
      activateRoute =
        await import("../src/app/api/settings/sla-policies/[id]/activate/route");
      deactivateRoute =
        await import("../src/app/api/settings/sla-policies/[id]/deactivate/route");
    });

    beforeEach(async () => {
      const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
      );

      const organization = await prisma.organization.create({
        data: { name: "Native Policy Route Org" },
      });
      organizationId = organization.id;
      const user = await prisma.user.create({
        data: {
          organizationId,
          email: "owner@example.test",
          passwordHash: "unused",
          role: "owner",
        },
      });
      auth.session = {
        expires: new Date(Date.now() + 3_600_000).toISOString(),
        user: {
          id: user.id,
          organizationId,
          email: user.email,
          emailVerifiedAt: new Date(),
          name: null,
          image: null,
          role: "owner",
          createdAt: user.createdAt,
        },
      };

      const calendar = await prisma.businessCalendar.create({
        data: {
          organizationId,
          name: "24/7",
          source: "native",
          versions: {
            create: {
              version: 1,
              timezone: "UTC",
              weekly: [],
              holidays: [],
              alwaysOpen: true,
              source: "native",
            },
          },
        },
        include: { versions: true },
      });
      calendarId = calendar.id;

      const otherOrg = await prisma.organization.create({
        data: { name: "Other Org" },
      });
      const otherPolicy = await prisma.sLAPolicy.create({
        data: {
          organizationId: otherOrg.id,
          name: "Other org's policy",
          source: "native",
        },
      });
      otherOrgPolicyId = otherPolicy.id;
    });

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    const listUrl = "http://localhost:3000/api/settings/sla-policies";

    it("creates a native policy with source native and a first version", async () => {
      const response = await createRoute.POST(
        jsonRequest(listUrl, "POST", {
          name: "VIP customers",
          match: { priority: ["urgent"] },
          targets: [{ kind: "resolution", minutes: 120 }],
          calendarId,
          warnAtPercent: [50, 90],
        }),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { policyId: string };
      const policy = await prisma.sLAPolicy.findUniqueOrThrow({
        where: { id: body.policyId },
      });
      expect(policy).toMatchObject({
        name: "VIP customers",
        source: "native",
        organizationId,
      });
      const versions = await prisma.sLAPolicyVersion.findMany({
        where: { policyId: body.policyId },
      });
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({ version: 1, source: "native" });
    });

    it("edits a native policy by appending a version, without touching an already-created commitment", async () => {
      const created = await createRoute.POST(
        jsonRequest(listUrl, "POST", {
          name: "VIP customers",
          match: {},
          targets: [{ kind: "resolution", minutes: 120 }],
          calendarId,
          warnAtPercent: [],
        }),
      );
      const { policyId } = (await created.json()) as { policyId: string };
      const v1 = await prisma.sLAPolicyVersion.findFirstOrThrow({
        where: { policyId },
      });

      const caseRow = await prisma.case.create({
        data: {
          organizationId,
          externalId: "1",
          system: "zendesk", sourceIntegrationId: await sourceIntegration(prisma, organizationId, "zendesk"),
          priority: "urgent",
          openedAt: new Date(),
        },
      });
      const commitment = await prisma.commitment.create({
        data: {
          caseId: caseRow.id,
          kind: "resolution",
          policyVersionId: v1.id,
          calendarVersionId: v1.calendarVersionId,
          startedAt: new Date(),
          targetMinutes: 120,
          dueAt: new Date(Date.now() + 120 * 60_000),
        },
      });

      const response = await updateRoute.PATCH(
        jsonRequest(`${listUrl}/${policyId}`, "PATCH", {
          targets: [{ kind: "resolution", minutes: 60 }],
        }),
        { params: Promise.resolve({ id: policyId }) },
      );

      expect(response.status).toBe(200);
      const versions = await prisma.sLAPolicyVersion.findMany({
        where: { policyId },
        orderBy: { version: "asc" },
      });
      expect(versions).toHaveLength(2);
      expect(versions[1]).toMatchObject({
        version: 2,
        targets: [{ kind: "resolution", minutes: 60 }],
        source: "native",
      });

      // D1: the already-created commitment stays frozen on v1.
      const unchanged = await prisma.commitment.findUniqueOrThrow({
        where: { id: commitment.id },
      });
      expect(unchanged.policyVersionId).toBe(v1.id);
    });

    it("refuses to edit another organization's policy", async () => {
      const response = await updateRoute.PATCH(
        jsonRequest(`${listUrl}/${otherOrgPolicyId}`, "PATCH", {
          targets: [{ kind: "resolution", minutes: 1 }],
        }),
        { params: Promise.resolve({ id: otherOrgPolicyId }) },
      );
      expect(response.status).toBe(404);
    });

    it("deactivates and reactivates a native policy", async () => {
      const created = await createRoute.POST(
        jsonRequest(listUrl, "POST", {
          name: "Deactivate me",
          match: {},
          targets: [{ kind: "resolution", minutes: 120 }],
          calendarId,
          warnAtPercent: [],
        }),
      );
      const { policyId } = (await created.json()) as { policyId: string };

      const deactivated = await deactivateRoute.POST(
        jsonRequest(`${listUrl}/${policyId}/deactivate`, "POST"),
        {
          params: Promise.resolve({ id: policyId }),
        },
      );
      expect(deactivated.status).toBe(200);
      expect(
        (await prisma.sLAPolicy.findUniqueOrThrow({ where: { id: policyId } }))
          .deactivatedAt,
      ).not.toBeNull();

      const reactivated = await activateRoute.POST(
        jsonRequest(`${listUrl}/${policyId}/activate`, "POST"),
        {
          params: Promise.resolve({ id: policyId }),
        },
      );
      expect(reactivated.status).toBe(200);
      expect(
        (await prisma.sLAPolicy.findUniqueOrThrow({ where: { id: policyId } }))
          .deactivatedAt,
      ).toBeNull();
    });

    it("refuses to deactivate another organization's policy", async () => {
      const response = await deactivateRoute.POST(
        jsonRequest(`${listUrl}/${otherOrgPolicyId}/deactivate`, "POST"),
        {
          params: Promise.resolve({ id: otherOrgPolicyId }),
        },
      );
      expect(response.status).toBe(404);
      expect(
        (
          await prisma.sLAPolicy.findUniqueOrThrow({
            where: { id: otherOrgPolicyId },
          })
        ).deactivatedAt,
      ).toBeNull();
    });
  },
);
