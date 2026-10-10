import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { organizationSettingsInputSchema } from "@/lib/organization-settings";
import type { OrganizationSettingsData } from "@/lib/types/organization";

/** Open to any signed-in member (5.4's "read stays open" convention) — they need to see the display timezone their dates, dashboard days and monthly reports follow. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const organization = await getPrismaClient().organization.findUnique({
    where: { id: session.user.organizationId },
    select: { name: true, timezone: true },
  });
  if (!organization) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  return NextResponse.json({
    ...organization,
    canEdit: session.user.role === "owner",
  } satisfies OrganizationSettingsData);
}

/** Owner-only. The timezone is display-only: changing it re-renders how instants are shown and where dashboard days and monthly report periods fall, never a stored timestamp or an SLA result. */
export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = organizationSettingsInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const organization = await getPrismaClient().organization.update({
    where: { id: session.user.organizationId },
    data: { name: parsed.data.name, timezone: parsed.data.timezone },
    select: { name: true, timezone: true },
  });

  return NextResponse.json({ ...organization, canEdit: true } satisfies OrganizationSettingsData);
}
