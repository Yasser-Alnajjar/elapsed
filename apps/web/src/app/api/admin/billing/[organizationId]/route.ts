import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import {
  addBillingNote,
  changeSubscriptionPlan,
  collectInvoice,
  extendGrace,
  getPrismaClient,
  markInvoicePaid,
  reconcileSubscription,
  voidInvoice,
  voidOpenInvoices,
  type BillingActor,
  type BillingAuditHook,
  type Prisma,
} from "@sla/db";
import { recordAdminAudit } from "@/lib/admin-audit";
import { authOptions } from "@/lib/auth";
import { requirePlatformOperator } from "@/lib/authz";
import { getBillingProvider } from "@/lib/billing-provider";
import { billingErrorResponse, invalidInputResponse } from "@/lib/billing-route";
import { adminBillingActionSchema } from "@/lib/billing-validation";

/**
 * Operator overrides on one organization's billing (N6.5): change plan,
 * grant grace, record a payment, void or comp invoices, add a note, retry a
 * charge (provider only), reconcile. Platform operators only (`403` for
 * everyone else, including an org owner). Each override writes its billing
 * event and a `billing_override` admin audit row, with the operator's
 * rationale, in the same transaction as the change.
 */
export async function POST(request: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  const session = await getServerSession(authOptions);
  const denied = requirePlatformOperator(session);
  if (denied) return denied;

  const parsed = adminBillingActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalidInputResponse(parsed.error);

  const { organizationId } = await params;
  const input = parsed.data;
  const prisma = getPrismaClient();
  const actorEmail = session!.user.email.toLowerCase();
  const actor: BillingActor = { type: "operator", email: actorEmail };
  const audit: BillingAuditHook = (tx) =>
    recordAdminAudit(tx, {
      actorEmail,
      action: "billing_override",
      organizationId,
      metadata: input as unknown as Prisma.InputJsonValue,
    });

  try {
    const exists = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    if (!exists) return NextResponse.json({ error: "Organization not found", code: "not_found" }, { status: 404 });

    switch (input.action) {
      case "change_plan":
        await changeSubscriptionPlan(prisma, { organizationId, actor, provider: getBillingProvider(), plan: input.plan, expectedVersion: input.expectedVersion, audit });
        break;
      case "grant_grace":
        await extendGrace(prisma, { organizationId, actor, audit });
        break;
      case "mark_paid":
        await markInvoicePaid(prisma, { organizationId, invoiceId: input.invoiceId, actor, audit });
        break;
      case "void_invoice":
        await voidInvoice(prisma, { organizationId, invoiceId: input.invoiceId, actor, audit });
        break;
      case "comp_open_invoices":
        await voidOpenInvoices(prisma, { organizationId, actor, audit });
        break;
      case "add_note":
        await addBillingNote(prisma, { organizationId, actor, note: input.note, audit });
        break;
      case "retry_charge":
        await collectInvoice(prisma, { organizationId, invoiceId: input.invoiceId, actor, provider: getBillingProvider() });
        break;
      case "reconcile":
        await reconcileSubscription(prisma, organizationId);
        break;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = billingErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
