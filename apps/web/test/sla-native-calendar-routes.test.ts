/**
 * `POST /api/settings/calendars` (create) and `PATCH /api/settings/calendars/[id]`
 * (edit, on both a native and an imported calendar) — task 4.6/4.7. Same
 * setup as sla-native-policy-routes.test.ts (which this suite mirrors).
 *
 * Real Postgres. Needs a migrated database at TEST_DATABASE_URL whose name
 * contains "test"; skipped when unset.
 */
import type { Session } from "next-auth";
import type { PrismaClient } from "@sla/db";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
  "Native/imported calendar routes (real Postgres)",
  () => {
    let prisma: PrismaClient;
    let createRoute: typeof import("../src/app/api/settings/calendars/route");
    let updateRoute: typeof import("../src/app/api/settings/calendars/[id]/route");
    let getBusinessCalendars: typeof import("../src/lib/customer-calendars-data").getBusinessCalendars;

    let organizationId: string;
    let otherOrgCalendarId: string;

    beforeAll(async () => {
      const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
      if (!/test/i.test(name)) {
        throw new Error(
          `TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`,
        );
      }
      process.env.DATABASE_URL = TEST_DATABASE_URL;
      prisma = (await import("@sla/db")).getPrismaClient();
      createRoute = await import("../src/app/api/settings/calendars/route");
      updateRoute =
        await import("../src/app/api/settings/calendars/[id]/route");
      getBusinessCalendars = (
        await import("../src/lib/customer-calendars-data")
      ).getBusinessCalendars;
    });

    beforeEach(async () => {
      const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
      );

      const organization = await prisma.organization.create({
        data: { name: "Calendar Route Org" },
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

      const otherOrg = await prisma.organization.create({
        data: { name: "Other Org" },
      });
      const otherCalendar = await prisma.businessCalendar.create({
        data: {
          organizationId: otherOrg.id,
          name: "Other org's calendar",
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
      });
      otherOrgCalendarId = otherCalendar.id;
    });

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    const listUrl = "http://localhost:3000/api/settings/calendars";

    it("creates a native calendar and expands a recurring holiday into concrete dates", async () => {
      const response = await createRoute.POST(
        jsonRequest(listUrl, "POST", {
          name: "Support hours",
          timezone: "America/New_York",
          weekly: [{ day: 1, openMinute: 540, closeMinute: 1020 }],
          holidays: [{ date: "12-25", name: "Christmas", recurring: true }],
        }),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { calendarId: string };
      const calendar = await prisma.businessCalendar.findUniqueOrThrow({
        where: { id: body.calendarId },
        include: { versions: true },
      });
      expect(calendar).toMatchObject({
        name: "Support hours",
        source: "native",
        organizationId,
      });
      expect(calendar.versions).toHaveLength(1);
      expect(calendar.versions[0]!.holidays.length).toBeGreaterThan(1);
      for (const date of calendar.versions[0]!.holidays) {
        expect(date).toMatch(/-12-25$/);
      }
    });

    // 4h: reopening the editor (getBusinessCalendars, the calendar editor's
    // data source) must show the holiday exactly as it was entered — a
    // recurring holiday stays recurring, not flattened into a one-off date.
    it("reopening a calendar shows a recurring holiday as recurring, not as a one-off date", async () => {
      const createResponse = await createRoute.POST(
        jsonRequest(listUrl, "POST", {
          name: "Support hours",
          timezone: "America/New_York",
          weekly: [{ day: 1, openMinute: 540, closeMinute: 1020 }],
          holidays: [{ date: "12-25", name: "Christmas", recurring: true }],
        }),
      );
      const { calendarId } = (await createResponse.json()) as {
        calendarId: string;
      };

      let calendars = await getBusinessCalendars(prisma, organizationId);
      let calendar = calendars.find((c) => c.id === calendarId)!;
      expect(calendar.holidays).toEqual([
        { date: "12-25", name: "Christmas", recurring: true },
      ]);

      // Edit an unrelated field (name lives on BusinessCalendar, not the
      // version) and reopen again — recurrence must still survive.
      await updateRoute.PATCH(
        jsonRequest(`${listUrl}/${calendarId}`, "PATCH", {
          name: "Support hours (renamed)",
        }),
        {
          params: Promise.resolve({ id: calendarId }),
        },
      );

      calendars = await getBusinessCalendars(prisma, organizationId);
      calendar = calendars.find((c) => c.id === calendarId)!;
      expect(calendar.name).toBe("Support hours (renamed)");
      expect(calendar.holidays).toEqual([
        { date: "12-25", name: "Christmas", recurring: true },
      ]);
    });

    // Existing one-off holidays must continue to work exactly as before (4h).
    it("reopening a calendar shows a one-off holiday as one-off", async () => {
      const createResponse = await createRoute.POST(
        jsonRequest(listUrl, "POST", {
          name: "Support hours",
          timezone: "UTC",
          weekly: [{ day: 1, openMinute: 540, closeMinute: 1020 }],
          holidays: [
            { date: "2026-07-04", name: "Independence Day", recurring: false },
          ],
        }),
      );
      const { calendarId } = (await createResponse.json()) as {
        calendarId: string;
      };

      const calendars = await getBusinessCalendars(prisma, organizationId);
      const calendar = calendars.find((c) => c.id === calendarId)!;
      expect(calendar.holidays).toEqual([
        { date: "2026-07-04", name: "Independence Day", recurring: false },
      ]);
    });

    it("rejects an invalid timezone", async () => {
      const response = await createRoute.POST(
        jsonRequest(listUrl, "POST", {
          name: "Bad tz",
          timezone: "Not/AZone",
          weekly: [],
          holidays: [],
        }),
      );
      expect(response.status).toBe(400);
    });

    it("edits an imported calendar's hours without touching an already-created commitment (D1b)", async () => {
      const calendar = await prisma.businessCalendar.create({
        data: {
          organizationId,
          externalId: "42",
          name: "Zendesk: Business Hours",
          source: "imported",
          versions: {
            create: {
              version: 1,
              timezone: "UTC",
              weekly: [{ day: 1, openMinute: 540, closeMinute: 1020 }],
              holidays: [],
              alwaysOpen: false,
              source: "imported",
            },
          },
        },
        include: { versions: true },
      });
      const v1 = calendar.versions[0]!;

      const policy = await prisma.sLAPolicy.create({
        data: { organizationId, name: "P", source: "native" },
      });
      const policyVersion = await prisma.sLAPolicyVersion.create({
        data: {
          policyId: policy.id,
          version: 1,
          match: {},
          targets: [{ kind: "resolution", minutes: 60 }],
          pauseOnStates: [],
          calendarVersionId: v1.id,
          warnAtPercent: [],
          effectiveFrom: new Date(),
          source: "native",
        },
      });
      const caseRow = await prisma.case.create({
        data: {
          organizationId,
          externalId: "1",
          system: "zendesk", sourceIntegrationId: await sourceIntegration(prisma, organizationId, "zendesk"),
          openedAt: new Date(),
        },
      });
      const commitment = await prisma.commitment.create({
        data: {
          caseId: caseRow.id,
          kind: "resolution",
          policyVersionId: policyVersion.id,
          calendarVersionId: v1.id,
          startedAt: new Date(),
          targetMinutes: 60,
          dueAt: new Date(Date.now() + 60 * 60_000),
        },
      });

      const response = await updateRoute.PATCH(
        jsonRequest(`${listUrl}/${calendar.id}`, "PATCH", {
          weekly: [{ day: 2, openMinute: 480, closeMinute: 1000 }],
        }),
        { params: Promise.resolve({ id: calendar.id }) },
      );

      expect(response.status).toBe(200);
      const versions = await prisma.businessCalendarVersion.findMany({
        where: { calendarId: calendar.id },
        orderBy: { version: "asc" },
      });
      expect(versions).toHaveLength(2);
      expect(versions[1]).toMatchObject({ version: 2, source: "override" });

      // D1b: the already-created commitment stays frozen on v1.
      const unchanged = await prisma.commitment.findUniqueOrThrow({
        where: { id: commitment.id },
      });
      expect(unchanged.calendarVersionId).toBe(v1.id);
    });

    it("refuses to edit another organization's calendar", async () => {
      const response = await updateRoute.PATCH(
        jsonRequest(`${listUrl}/${otherOrgCalendarId}`, "PATCH", {
          timezone: "UTC",
        }),
        { params: Promise.resolve({ id: otherOrgCalendarId }) },
      );
      expect(response.status).toBe(404);
    });
  },
);
