/**
 * End-to-end calendar resolution for native policies (4i) and calendar
 * version pinning (4d) — the full path from `createNativePolicy` /
 * `setOrganizationDefaultCalendar` / `setCustomerCalendar` through
 * `runCommitmentPipeline` to a real, persisted `Commitment.calendarVersionId`.
 *
 * Reproduces the reported production bug directly: a native policy with no
 * explicit calendar must resolve new commitments to the organization's
 * default calendar, never silently fall through to the system Always Open
 * calendar while a valid default exists.
 *
 * Real Postgres. Needs a migrated database at TEST_DATABASE_URL whose name
 * contains "test"; skipped when unset.
 */
import type { PrismaClient } from "@sla/db";
import type { WeeklyWindow } from "@sla/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sourceIntegration } from "./source-integration";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const at = (time: string) => new Date(`2026-09-22T${time}:00.000Z`);

describe.skipIf(!TEST_DATABASE_URL)("native policy calendar resolution (real Postgres)", () => {
  let prisma: PrismaClient;
  let commitments: typeof import("@sla/commitments");

  let organizationId: string;

  beforeAll(async () => {
    const name = new URL(TEST_DATABASE_URL!).pathname.replace(/^\//, "");
    if (!/test/i.test(name)) {
      throw new Error(`TEST_DATABASE_URL points at database "${name}"; this suite truncates every table.`);
    }
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = (await import("@sla/db")).getPrismaClient();
    commitments = await import("@sla/commitments");
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} CASCADE`,
    );

    const organization = await prisma.organization.create({ data: { name: "Calendar Resolution Org" } });
    organizationId = organization.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function createCalendar(name: string, weekly: WeeklyWindow[]) {
    const result = await commitments.createNativeCalendar(prisma, organizationId, name, {
      timezone: "UTC",
      weekly,
      holidays: [],
    });
    return result.calendarId;
  }

  async function createCase(externalId: string, overrides: Record<string, unknown> = {}) {
    return prisma.case.create({
      data: { organizationId, system: "zendesk", sourceIntegrationId: await sourceIntegration(prisma, organizationId, "zendesk"), externalId, openedAt: at("09:00"), ...overrides },
    });
  }

  const FULL_WEEK: WeeklyWindow[] = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    day: day as WeeklyWindow["day"],
    openMinute: 0,
    closeMinute: 1440,
  }));

  it("native policy with an explicit calendar uses it, ahead of the organization default", async () => {
    const explicitCalendarId = await createCalendar("Explicit", FULL_WEEK);
    const defaultCalendarId = await createCalendar("Org Default", FULL_WEEK);
    await commitments.setOrganizationDefaultCalendar(prisma, organizationId, defaultCalendarId);

    await commitments.createNativePolicy(prisma, organizationId, "Explicit calendar policy", {
      match: {},
      targets: [{ kind: "resolution", minutes: 60 }],
      calendarId: explicitCalendarId,
      warnAtPercent: [],
    });

    await createCase("case-1");
    await commitments.runCommitmentPipeline(prisma, organizationId);

    const commitment = await prisma.commitment.findFirstOrThrow({ where: { kind: "resolution" } });
    const calendarVersion = await prisma.businessCalendarVersion.findUniqueOrThrow({
      where: { id: commitment.calendarVersionId },
    });
    expect(calendarVersion.calendarId).toBe(explicitCalendarId);
  });

  // The exact reported bug (4i): a native policy with no explicit calendar,
  // and a valid organization default calendar — new commitments must use
  // the organization default, never the system Always Open calendar.
  it("native policy with no explicit calendar uses the organization default, not Always Open", async () => {
    const defaultCalendarId = await createCalendar("Current Time Test", FULL_WEEK);
    await commitments.setOrganizationDefaultCalendar(prisma, organizationId, defaultCalendarId);

    await commitments.createNativePolicy(prisma, organizationId, "Phase 4 Native Test", {
      match: {},
      targets: [{ kind: "resolution", minutes: 60 }],
      warnAtPercent: [],
    });

    await createCase("case-1");
    await commitments.runCommitmentPipeline(prisma, organizationId);

    const commitment = await prisma.commitment.findFirstOrThrow({ where: { kind: "resolution" } });
    const calendarVersion = await prisma.businessCalendarVersion.findUniqueOrThrow({
      where: { id: commitment.calendarVersionId },
    });
    expect(calendarVersion.calendarId).toBe(defaultCalendarId);
    expect(calendarVersion.alwaysOpen).toBe(false);
  });

  it("native policy with no explicit calendar and no organization default falls back to Always Open", async () => {
    await commitments.createNativePolicy(prisma, organizationId, "No calendar anywhere", {
      match: {},
      targets: [{ kind: "resolution", minutes: 60 }],
      warnAtPercent: [],
    });

    await createCase("case-1");
    await commitments.runCommitmentPipeline(prisma, organizationId);

    const commitment = await prisma.commitment.findFirstOrThrow({ where: { kind: "resolution" } });
    const calendarVersion = await prisma.businessCalendarVersion.findUniqueOrThrow({
      where: { id: commitment.calendarVersionId },
    });
    expect(calendarVersion.alwaysOpen).toBe(true);
  });

  it("re-saving a native policy without touching its calendar keeps it absent — never replaces it with Always Open", async () => {
    const defaultCalendarId = await createCalendar("Org Default", FULL_WEEK);
    await commitments.setOrganizationDefaultCalendar(prisma, organizationId, defaultCalendarId);

    const { policyId } = await commitments.createNativePolicy(prisma, organizationId, "Re-saved policy", {
      match: {},
      targets: [{ kind: "resolution", minutes: 60 }],
      warnAtPercent: [],
    });

    // Re-save the policy (e.g. changing the target), never touching calendarId.
    await commitments.updateNativePolicy(prisma, organizationId, policyId, {
      targets: [{ kind: "resolution", minutes: 120 }],
    });

    await createCase("case-1");
    await commitments.runCommitmentPipeline(prisma, organizationId);

    const commitment = await prisma.commitment.findFirstOrThrow({ where: { kind: "resolution" } });
    const calendarVersion = await prisma.businessCalendarVersion.findUniqueOrThrow({
      where: { id: commitment.calendarVersionId },
    });
    expect(calendarVersion.calendarId).toBe(defaultCalendarId);
    expect(calendarVersion.alwaysOpen).toBe(false);
    expect(commitment.targetMinutes).toBe(120);
  });

  // 4d: existing commitments must retain their effective calendar/version;
  // only new commitments pick up a later organization-default change.
  it("existing commitments stay pinned to their calendar when the organization default later changes", async () => {
    const firstDefaultId = await createCalendar("First Default", FULL_WEEK);
    const secondDefaultId = await createCalendar("Second Default", FULL_WEEK);
    await commitments.setOrganizationDefaultCalendar(prisma, organizationId, firstDefaultId);

    await commitments.createNativePolicy(prisma, organizationId, "Tracks org default", {
      match: {},
      targets: [{ kind: "resolution", minutes: 60 }],
      warnAtPercent: [],
    });

    await createCase("case-old");
    await commitments.runCommitmentPipeline(prisma, organizationId);
    const oldCommitment = await prisma.commitment.findFirstOrThrow({ where: { kind: "resolution" } });
    const oldCalendarVersion = await prisma.businessCalendarVersion.findUniqueOrThrow({
      where: { id: oldCommitment.calendarVersionId },
    });
    expect(oldCalendarVersion.calendarId).toBe(firstDefaultId);

    // Change the organization default and create a brand new case.
    await commitments.setOrganizationDefaultCalendar(prisma, organizationId, secondDefaultId);
    await createCase("case-new");
    await commitments.runCommitmentPipeline(prisma, organizationId);

    const refetchedOldCommitment = await prisma.commitment.findUniqueOrThrow({ where: { id: oldCommitment.id } });
    expect(refetchedOldCommitment.calendarVersionId).toBe(oldCommitment.calendarVersionId); // untouched

    const newCommitment = await prisma.commitment.findFirstOrThrow({
      where: { kind: "resolution", id: { not: oldCommitment.id } },
    });
    const newCalendarVersion = await prisma.businessCalendarVersion.findUniqueOrThrow({
      where: { id: newCommitment.calendarVersionId },
    });
    expect(newCalendarVersion.calendarId).toBe(secondDefaultId);
  });

  // D1b: a customer's calendar override identifies *which calendar* applies;
  // a commitment created after the calendar was edited anchors to its current
  // version, while the one created before stays on the version it was frozen
  // to.
  it("a customer calendar override resolves to the calendar's current version after it is edited", async () => {
    const calendarId = await createCalendar("Customer Calendar", FULL_WEEK);
    const customer = await prisma.customer.create({ data: { organizationId, name: "Acme" } });
    await commitments.setCustomerCalendar(prisma, organizationId, customer.id, calendarId);

    const assignedVersion = await prisma.businessCalendarVersion.findFirstOrThrow({
      where: { calendarId },
      orderBy: { version: "desc" },
    });

    const explicitCalendarId = await createCalendar("Policy Calendar", FULL_WEEK);
    await commitments.createNativePolicy(prisma, organizationId, "Policy", {
      match: {},
      targets: [{ kind: "resolution", minutes: 60 }],
      calendarId: explicitCalendarId,
      warnAtPercent: [],
    });

    await createCase("case-before-edit", { customerId: customer.id });
    await commitments.runCommitmentPipeline(prisma, organizationId);
    const before = await prisma.commitment.findFirstOrThrow({ where: { kind: "resolution" } });
    expect(before.calendarVersionId).toBe(assignedVersion.id);

    // Edit the calendar's hours after the override was assigned.
    await commitments.updateCalendar(prisma, organizationId, calendarId, {
      weekly: [{ day: 1, openMinute: 540, closeMinute: 1020 }],
    });
    const editedVersion = await prisma.businessCalendarVersion.findFirstOrThrow({
      where: { calendarId },
      orderBy: { version: "desc" },
    });
    expect(editedVersion.version).toBe(assignedVersion.version + 1);

    await createCase("case-after-edit", { customerId: customer.id });
    await commitments.runCommitmentPipeline(prisma, organizationId);

    expect((await prisma.commitment.findUniqueOrThrow({ where: { id: before.id } })).calendarVersionId).toBe(
      assignedVersion.id,
    );
    const after = await prisma.commitment.findFirstOrThrow({
      where: { kind: "resolution", id: { not: before.id } },
    });
    // The override still wins over the policy's own explicit calendar, and
    // follows the edited calendar.
    expect(after.calendarVersionId).toBe(editedVersion.id);
  });

  it("customer calendar override wins over a native policy's own organization-default resolution", async () => {
    const defaultCalendarId = await createCalendar("Org Default", FULL_WEEK);
    await commitments.setOrganizationDefaultCalendar(prisma, organizationId, defaultCalendarId);

    const customerCalendarId = await createCalendar("Customer Calendar", FULL_WEEK);
    const customer = await prisma.customer.create({ data: { organizationId, name: "Acme" } });
    await commitments.setCustomerCalendar(prisma, organizationId, customer.id, customerCalendarId);

    await commitments.createNativePolicy(prisma, organizationId, "No explicit calendar", {
      match: {},
      targets: [{ kind: "resolution", minutes: 60 }],
      warnAtPercent: [],
    });

    await createCase("case-1", { customerId: customer.id });
    await commitments.runCommitmentPipeline(prisma, organizationId);

    const commitment = await prisma.commitment.findFirstOrThrow({ where: { kind: "resolution" } });
    const calendarVersion = await prisma.businessCalendarVersion.findUniqueOrThrow({
      where: { id: commitment.calendarVersionId },
    });
    expect(calendarVersion.calendarId).toBe(customerCalendarId);
  });

  // D12: an imported policy's own explicit calendar assignment is untouched
  // by the 4i fallback mechanism, and it still matches before a native
  // policy that would otherwise also match.
  it("D12: an imported policy keeps its own calendar and is matched before a native policy", async () => {
    const importedCalendarId = await createCalendar("Imported Calendar", FULL_WEEK);
    const nativeDefaultCalendarId = await createCalendar("Org Default", FULL_WEEK);
    await commitments.setOrganizationDefaultCalendar(prisma, organizationId, nativeDefaultCalendarId);

    const importedCalendarVersion = await prisma.businessCalendarVersion.findFirstOrThrow({
      where: { calendarId: importedCalendarId },
    });
    const importedPolicy = await prisma.sLAPolicy.create({
      data: { organizationId, name: "Imported policy", source: "imported", externalId: "z-1" },
    });
    await prisma.sLAPolicyVersion.create({
      data: {
        policyId: importedPolicy.id,
        version: 1,
        match: {},
        targets: [{ kind: "resolution", minutes: 30 }],
        pauseOnStates: [],
        calendarVersionId: importedCalendarVersion.id,
        warnAtPercent: [],
        effectiveFrom: at("00:00"),
        source: "imported",
      },
    });

    await commitments.createNativePolicy(prisma, organizationId, "Fallback native policy", {
      match: {},
      targets: [{ kind: "resolution", minutes: 60 }],
      warnAtPercent: [],
    });

    await createCase("case-1");
    await commitments.runCommitmentPipeline(prisma, organizationId);

    const commitment = await prisma.commitment.findFirstOrThrow({ where: { kind: "resolution" } });
    // Matched the imported policy (D12), not the native one.
    expect(commitment.targetMinutes).toBe(30);
    expect(commitment.calendarVersionId).toBe(importedCalendarVersion.id);
  });

  // The reported bug: an explicit-calendar policy used to freeze the
  // calendar version that was latest when the policy was saved, so editing the
  // calendar to 24/7 afterwards never reached new commitments — a 1h
  // Resolution created at 17:58 local still got a ~16h runway.
  describe("explicit-calendar policy follows the calendar's current version (D1b)", () => {
    const CAIRO_BUSINESS_HOURS: WeeklyWindow[] = [0, 1, 2, 3, 4].map((day) => ({
      day: day as WeeklyWindow["day"],
      openMinute: 9 * 60,
      closeMinute: 18 * 60,
    }));
    // Monday 2026-10-05 17:58 Cairo (UTC+3), two minutes before close.
    const NEAR_CLOSE = new Date("2026-10-05T14:58:00.000Z");
    const MIN = 60_000;

    async function setUp() {
      const { calendarId } = await commitments.createNativeCalendar(prisma, organizationId, "SLA-Calendar", {
        timezone: "Africa/Cairo",
        weekly: CAIRO_BUSINESS_HOURS,
        holidays: [],
      });
      await commitments.createNativePolicy(prisma, organizationId, "Premium Support", {
        match: {},
        targets: [
          { kind: "first_response", minutes: 40 },
          { kind: "resolution", minutes: 60 },
        ],
        calendarId,
        warnAtPercent: [],
      });
      return calendarId;
    }

    const commitmentsOf = (caseId: string) =>
      prisma.commitment.findMany({ where: { caseId, kind: { in: ["first_response", "resolution"] } } });

    it("a new case after a 24/7 edit gets a ~+1h resolution deadline; the pre-edit case stays on the business-hours version", async () => {
      const calendarId = await setUp();

      const oldCase = await createCase("case-before-edit", { openedAt: NEAR_CLOSE });
      await commitments.runCommitmentPipeline(prisma, organizationId);
      const oldCommitments = await commitmentsOf(oldCase.id);
      expect(oldCommitments).toHaveLength(2);
      const oldResolution = oldCommitments.find((c) => c.kind === "resolution")!;
      // Business time: 2 min today + 58 min from Tuesday 09:00 Cairo.
      expect(oldResolution.dueAt.toISOString()).toBe("2026-10-06T06:58:00.000Z");
      const v1 = await prisma.businessCalendarVersion.findFirstOrThrow({ where: { calendarId, version: 1 } });
      expect(oldResolution.calendarVersionId).toBe(v1.id);

      // Edit the calendar to 24/7 (seven full-day windows, as the editor saves it).
      const edit = await commitments.updateCalendar(prisma, organizationId, calendarId, { weekly: FULL_WEEK });
      expect(edit).toMatchObject({ created: true, version: { version: 2 } });

      const newCase = await createCase("case-after-edit", { openedAt: NEAR_CLOSE });
      await commitments.runCommitmentPipeline(prisma, organizationId);
      // Re-resolution is not a trigger for a calendar change alone (D1b).
      await commitments.runCommitmentReResolutionPipeline(prisma, organizationId);

      const newCommitments = await commitmentsOf(newCase.id);
      expect(newCommitments).toHaveLength(2);
      for (const commitment of newCommitments) {
        // First Response and Resolution share one calendar version…
        expect(commitment.calendarVersionId).toBe(edit.version.id);
        // …and 24/7 means business time == wall-clock time.
        expect(commitment.dueAt.getTime() - commitment.startedAt.getTime()).toBe(commitment.targetMinutes * MIN);
      }
      expect(newCommitments.find((c) => c.kind === "first_response")!.dueAt.toISOString()).toBe(
        "2026-10-05T15:38:00.000Z",
      );
      expect(newCommitments.find((c) => c.kind === "resolution")!.dueAt.toISOString()).toBe(
        "2026-10-05T15:58:00.000Z",
      );

      // D1b: the pre-edit commitments are untouched.
      const oldAfter = await commitmentsOf(oldCase.id);
      for (const commitment of oldAfter) {
        const before = oldCommitments.find((c) => c.id === commitment.id)!;
        expect(commitment.calendarVersionId).toBe(v1.id);
        expect(commitment.dueAt.toISOString()).toBe(before.dueAt.toISOString());
      }
    });

    it("a policy re-saved after the calendar edit resolves to the same current calendar version", async () => {
      const calendarId = await setUp();
      const edit = await commitments.updateCalendar(prisma, organizationId, calendarId, { weekly: FULL_WEEK });
      const policy = await prisma.sLAPolicy.findFirstOrThrow({ where: { organizationId } });
      await commitments.updateNativePolicy(prisma, organizationId, policy.id, {
        targets: [{ kind: "resolution", minutes: 60 }],
      });

      const caseRow = await createCase("case-1", { openedAt: NEAR_CLOSE });
      await commitments.runCommitmentPipeline(prisma, organizationId);

      const resolution = (await commitmentsOf(caseRow.id)).find((c) => c.kind === "resolution")!;
      expect(resolution.calendarVersionId).toBe(edit.version.id);
      expect(resolution.dueAt.toISOString()).toBe("2026-10-05T15:58:00.000Z");
    });

    it("keeps closed days and multi-window days working for new commitments on the edited calendar", async () => {
      const calendarId = await setUp();
      await commitments.updateCalendar(prisma, organizationId, calendarId, {
        weekly: [
          { day: 4, openMinute: 9 * 60, closeMinute: 12 * 60 },
          { day: 4, openMinute: 13 * 60, closeMinute: 18 * 60 },
          { day: 0, openMinute: 9 * 60, closeMinute: 18 * 60 },
        ],
      });

      // Thursday 2026-10-08 17:58 Cairo: 2 min left, Fri/Sat closed, 58 more Sunday from 09:00 Cairo.
      const caseRow = await createCase("case-1", { openedAt: new Date("2026-10-08T14:58:00.000Z") });
      await commitments.runCommitmentPipeline(prisma, organizationId);
      const resolution = (await commitmentsOf(caseRow.id)).find((c) => c.kind === "resolution")!;
      expect(resolution.dueAt.toISOString()).toBe("2026-10-11T06:58:00.000Z");

      // Thursday 11:30 Cairo: 30 min before the lunch gap, 30 after it reopens at 13:00.
      const lunchCase = await createCase("case-2", { openedAt: new Date("2026-10-08T08:30:00.000Z") });
      await commitments.runCommitmentPipeline(prisma, organizationId);
      const lunchResolution = (await commitmentsOf(lunchCase.id)).find((c) => c.kind === "resolution")!;
      expect(lunchResolution.dueAt.toISOString()).toBe("2026-10-08T10:30:00.000Z");
    });
  });
});
