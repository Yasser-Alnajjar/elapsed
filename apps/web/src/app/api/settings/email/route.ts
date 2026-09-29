import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getEmailSettingsStatus, saveEmailSettings, getPrismaClient } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { destinationRefusal, emailSettingsInputSchema } from "@/lib/email-settings";

/** Status only — the password is never read back, see `getEmailSettingsStatus`. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const status = await getEmailSettingsStatus(getPrismaClient(), session.user.organizationId);
  return NextResponse.json(status);
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = emailSettingsInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const refused = await destinationRefusal(parsed.data.host);
  if (refused) return refused;

  const prisma = getPrismaClient();
  try {
    await saveEmailSettings(prisma, session.user.organizationId, parsed.data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save configuration" },
      { status: 400 },
    );
  }

  const status = await getEmailSettingsStatus(prisma, session.user.organizationId);
  return NextResponse.json(status);
}
