import type { PrismaClient } from "@sla/db";

export class CustomerNotFoundError extends Error {
  constructor(customerId: string) {
    super(`Customer ${customerId} not found`);
  }
}

export class CalendarNotFoundError extends Error {
  constructor(calendarId: string) {
    super(`Business calendar ${calendarId} not found`);
  }
}

/**
 * Assigns, or clears with `calendarId: null`, the `BusinessCalendar` a
 * customer's future commitments should anchor to (roadmap step 24) — e.g. a
 * contractually 24/7 enterprise-tier calendar in place of whatever the
 * matched `SLAPolicyVersion` would otherwise resolve to. `calendarId` must
 * belong to the same organization as the customer, so this can't be used to
 * point one tenant's customer at another tenant's calendar. Only affects
 * commitments created after the change — `Commitment.calendarVersionId`
 * stays frozen at creation like everywhere else in this pipeline.
 *
 * `calendarVersionId` records the calendar's latest version at assignment,
 * but it only identifies *which calendar* overrides: a new commitment anchors
 * to that calendar's current version at creation (D1b), so a later edit to
 * the calendar's hours reaches this customer's new commitments without
 * re-setting the override. Existing commitments never move.
 */
export async function setCustomerCalendar(
  prisma: PrismaClient,
  organizationId: string,
  customerId: string,
  calendarId: string | null,
): Promise<void> {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, organizationId } });
  if (!customer) throw new CustomerNotFoundError(customerId);

  let calendarVersionId: string | null = null;
  if (calendarId !== null) {
    const calendar = await prisma.businessCalendar.findFirst({
      where: { id: calendarId, organizationId },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!calendar) throw new CalendarNotFoundError(calendarId);
    calendarVersionId = calendar.versions[0]?.id ?? null;
  }

  await prisma.customer.update({ where: { id: customerId }, data: { calendarId, calendarVersionId } });
}

/**
 * Sets, or clears with `calendarId: null`, the organization's default
 * calendar (task 4.7) — the pre-filled choice when creating a native policy
 * or calendar, and (4i) the calendar a native policy with no explicit
 * calendar resolves to for its new commitments, ahead of the system Always
 * Open fallback (`resolveEffectiveCalendarVersion`, calendar-fallback.ts).
 * Never overrides a policy's own explicit calendar, and never a customer's
 * calendar override — those still both win first, exactly as before.
 */
export async function setOrganizationDefaultCalendar(
  prisma: PrismaClient,
  organizationId: string,
  calendarId: string | null,
): Promise<void> {
  if (calendarId !== null) {
    const calendar = await prisma.businessCalendar.findFirst({ where: { id: calendarId, organizationId } });
    if (!calendar) throw new CalendarNotFoundError(calendarId);
  }

  await prisma.organization.update({ where: { id: organizationId }, data: { defaultCalendarId: calendarId } });
}
