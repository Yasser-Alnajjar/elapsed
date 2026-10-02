import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient } from "@sla/db";
import { CalendarNotFoundError, createNativePolicy, CustomerIdsNotFoundError } from "@sla/commitments";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { gateCreation } from "@/lib/entitlements";
import { parseMatch, parseTargets, parseWarnAtPercent, ValidationError } from "@/lib/sla-policy-validation";

/** Creates a native SLA policy (task 4.3, D12). Imported policies are never created here — they only ever come from a Zendesk sync. */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as
    | {
        name?: string;
        match?: unknown;
        targets?: unknown;
        calendarId?: string;
        warnAtPercent?: unknown;
      }
    | null;

  if (!body?.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  // calendarId is optional (4i): omitted means "use the organization's
  // default calendar" instead of pinning an explicit one.
  if (body.calendarId !== undefined && typeof body.calendarId !== "string") {
    return NextResponse.json({ error: "calendarId must be a string" }, { status: 400 });
  }

  try {
    const targets = parseTargets(body.targets);
    const match = parseMatch(body.match);
    const warnAtPercent = parseWarnAtPercent(body.warnAtPercent);

    // N6.3: a lapsed trial blocks a new native policy (D27); an over-limit plan only warns. Imported policies never count (D25).
    const gate = await gateCreation(session.user.organizationId, "nativePolicies");
    if (!gate.proceed) return gate.response;

    const prisma = getPrismaClient();
    const result = await createNativePolicy(prisma, session.user.organizationId, body.name.trim(), {
      match,
      targets,
      calendarId: body.calendarId,
      warnAtPercent,
    });
    return NextResponse.json({ ...result, ...(gate.warning && { entitlementWarning: gate.warning }) });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof CalendarNotFoundError || error instanceof CustomerIdsNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
