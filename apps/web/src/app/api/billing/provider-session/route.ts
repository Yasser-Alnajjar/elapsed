import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { BillingError, getPrismaClient } from "@sla/db";
import { getAppUrl } from "@/lib/app-url";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { getBillingProvider } from "@/lib/billing-provider";
import { billingErrorResponse, invalidInputResponse } from "@/lib/billing-route";
import { providerSessionSchema } from "@/lib/billing-validation";

/**
 * A hosted provider page: the self-service portal, or a payment-method form.
 * Owners only. With no payment provider connected this answers
 * `501 provider_unavailable`; the billing page disables these actions then.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in", code: "unauthenticated" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  const parsed = providerSessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidInputResponse(parsed.error);

  try {
    const provider = getBillingProvider();
    if (!provider) throw new BillingError("provider_unavailable", "Payment methods and the billing portal need a payment provider, and none is connected yet.");
    const organizationId = session.user.organizationId;
    const returnUrl = `${getAppUrl()}/billing`;
    if (parsed.data.kind === "portal") return NextResponse.json(await provider.createPortalSession({ organizationId, returnUrl }));
    const account = await getPrismaClient().billingAccount.findUnique({ where: { organizationId }, select: { billingEmail: true } });
    return NextResponse.json(await provider.createPaymentMethodSession({ organizationId, billingEmail: account?.billingEmail ?? null, returnUrl }));
  } catch (error) {
    const response = billingErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
