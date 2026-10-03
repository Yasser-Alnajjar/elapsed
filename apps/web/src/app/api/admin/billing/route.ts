import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { getPrismaClient, reconcileSubscription } from "@sla/db";
import { recordAdminAudit } from "@/lib/admin-audit";
import { authOptions } from "@/lib/auth";
import { requirePlatformOperator } from "@/lib/authz";

/**
 * Reconciles every live subscription now: elapsed periods renew and issue
 * their invoices, ended trials convert, overdue invoices mark `past_due`.
 * The same thing every billing read does for one organization. Operators only;
 * audited once as `billing_override`.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  const denied = requirePlatformOperator(session);
  if (denied) return denied;

  const prisma = getPrismaClient();
  const now = new Date();
  const subscriptions = await prisma.billingSubscription.findMany({ where: { status: { not: "cancelled" } }, select: { organizationId: true } });
  for (const { organizationId } of subscriptions) await reconcileSubscription(prisma, organizationId, now);

  await recordAdminAudit(prisma, {
    actorEmail: session!.user.email.toLowerCase(),
    action: "billing_override",
    metadata: { action: "reconcile_all", subscriptions: subscriptions.length },
  });
  return NextResponse.json({ reconciled: subscriptions.length });
}
