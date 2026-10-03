import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import {
  cancelSubscription,
  changeSeatQuantity,
  changeSubscriptionPlan,
  getPrismaClient,
  resumeSubscription,
  startSubscription,
  type BillingActor,
} from "@sla/db";
import { authOptions } from "@/lib/auth";
import { requireOwner } from "@/lib/authz";
import { getBillingProvider } from "@/lib/billing-provider";
import { billingErrorResponse, invalidInputResponse } from "@/lib/billing-route";
import { subscriptionActionSchema } from "@/lib/billing-validation";

/**
 * The organization's subscription transitions (N6.5): start, change plan,
 * change seats, cancel at period end, resume. Owners only. The organization
 * comes from the session, never the body; the body carries only intent and
 * the `expectedVersion` the page saw, and the billing domain re-validates
 * every transition against current state in one transaction.
 *
 * Responds `{ subscription }` on success, `{ error, code }` otherwise.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Not signed in", code: "unauthenticated" }, { status: 401 });
  const denied = requireOwner(session);
  if (denied) return denied;

  const parsed = subscriptionActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidInputResponse(parsed.error);

  const prisma = getPrismaClient();
  const organizationId = session.user.organizationId;
  const actor: BillingActor = { type: "user", email: session.user.email.toLowerCase() };
  const provider = getBillingProvider();
  const input = parsed.data;

  try {
    const subscription = await (() => {
      switch (input.action) {
        case "start":
          return startSubscription(prisma, { organizationId, actor, provider, plan: input.plan, seatQuantity: input.seatQuantity });
        case "change_plan":
          return changeSubscriptionPlan(prisma, { organizationId, actor, provider, plan: input.plan, expectedVersion: input.expectedVersion });
        case "change_seats":
          return changeSeatQuantity(prisma, { organizationId, actor, provider, seatQuantity: input.seatQuantity, expectedVersion: input.expectedVersion });
        case "cancel":
          return cancelSubscription(prisma, { organizationId, actor, provider, expectedVersion: input.expectedVersion });
        case "resume":
          return resumeSubscription(prisma, { organizationId, actor, provider, expectedVersion: input.expectedVersion });
      }
    })();
    return NextResponse.json({ subscription });
  } catch (error) {
    const response = billingErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
