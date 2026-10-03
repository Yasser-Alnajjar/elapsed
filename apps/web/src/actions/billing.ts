import "server-only";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { getPrismaClient } from "@sla/db";
import { authOptions } from "@/lib/auth";
import { getBillingOverview } from "@/lib/billing-data";
import { getBillingProvider } from "@/lib/billing-provider";
import { getRequestContext } from "@/lib/request-context";
import type { BillingOverviewData } from "@/lib/types/billing";

export const BillingActions = {
  /** The organization's subscription, usage, invoices and billing profile. Owners may manage it; members read it. */
  async getData(): Promise<BillingOverviewData> {
    const { organizationId, role } = await getRequestContext();

    const data = await getBillingOverview(getPrismaClient(), {
      organizationId,
      canManage: role === "owner",
      providerAvailable: getBillingProvider() !== null,
    });
    if (!data) redirect("/sign-in");

    return data;
  },

  /**
   * The same read model for a public page that is also shown to visitors:
   * `null` without a session instead of a redirect to sign-in.
   */
  async getDataIfSignedIn(): Promise<BillingOverviewData | null> {
    const session = await getServerSession(authOptions);
    return session ? BillingActions.getData() : null;
  },
};
