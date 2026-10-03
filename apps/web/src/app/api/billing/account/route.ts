import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient, updateBillingAccount } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { billingErrorResponse, invalidInputResponse } from "@/lib/billing-route";
import { billingAccountSchema } from "@/lib/billing-validation";

/** Replaces the organization's billing profile (legal entity, tax ID, invoice recipients). Owners only; recorded in billing history. */
export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in", code: "unauthenticated" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  const parsed = billingAccountSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidInputResponse(parsed.error);

  try {
    await updateBillingAccount(getPrismaClient(), {
      organizationId: session.user.organizationId,
      actor: { type: "user", email: session.user.email.toLowerCase() },
      input: parsed.data,
    });
    return NextResponse.json({ profile: parsed.data });
  } catch (error) {
    const response = billingErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
