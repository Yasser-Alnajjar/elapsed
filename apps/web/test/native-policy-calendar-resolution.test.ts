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

  // 4d: a customer's calendar override pins to the specific version current
  // when it was assigned — editing that calendar's hours afterward doesn't
  // reach a *new* commitment until the override is explicitly re-set.
  it("a customer calendar override stays pinned to its assigned version after the calendar is edited", async () => {
    const calendarId = await createCalendar("Customer Calendar", FULL_WEEK);
    const customer = await prisma.customer.create({ data: { organizationId, name: "Acme" } });
    await commitments.setCustomerCalendar(prisma, organizationId, customer.id, calendarId);

    const assignedVersion = await prisma.businessCalendarVersion.findFirstOrThrow({
      where: { calendarId },
      orderBy: { version: "desc" },
    });

    // Edit the calendar's hours after the override was assigned.
    await commitments.updateCalendar(prisma, organizationId, calendarId, {
      weekly: [{ day: 1, openMinute: 540, closeMinute: 1020 }],
    });

    const explicitCalendarId = await createCalendar("Policy Calendar", FULL_WEEK);
    await commitments.createNativePolicy(prisma, organizationId, "Policy", {
      match: {},
      targets: [{ kind: "resolution", minutes: 60 }],
      calendarId: explicitCalendarId,
      warnAtPercent: [],
    });

    await createCase("case-1", { customerId: customer.id });
    await commitments.runCommitmentPipeline(prisma, organizationId);

    const commitment = await prisma.commitment.findFirstOrThrow({ where: { kind: "resolution" } });
    // Still the version frozen at assignment time, not the edited one, and
    // still wins over the policy's own explicit calendar.
    expect(commitment.calendarVersionId).toBe(assignedVersion.id);
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
});
