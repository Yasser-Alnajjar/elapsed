"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import type { PlanId } from "@sla/db/plans";
import { Button } from "@/components/ui/button";
import type { BillingOverviewData } from "@/lib/types/billing";
import { OWNER_ONLY_HINT, PROVIDER_HINT, useBillingActions } from "../billing-actions-context";
import { BillingPageHeader } from "../BillingPageHeader";
import { useProviderSession } from "../useProviderSession";
import { EntitlementsPanel } from "./EntitlementsPanel";
import { IngestionVelocityChart } from "./IngestionVelocityChart";
import { PlanGovernancePanel } from "./PlanGovernancePanel";
import { PlanSummaryCards } from "./PlanSummaryCards";
import { TierRecommendationCard } from "./TierRecommendationCard";
import { UpcomingInvoiceCard } from "./UpcomingInvoiceCard";

interface OverviewTabProps {
  data: BillingOverviewData;
  tabs: ReactNode;
  onChangePlan: (initial?: PlanId | null) => void;
  onManageSeats: () => void;
}

/** "Subscription & Entitlements": plan, seats, throughput and payment at a glance, then entitlements and the upcoming invoice. */
export function OverviewTab({ data, tabs, onChangePlan, onManageSeats }: OverviewTabProps) {
  const { canManage, providerAvailable, busy } = useBillingActions();
  const openPortal = useProviderSession("portal");
  const live = data.subscription && data.subscription.status !== "cancelled" ? data.subscription : null;

  return (
    <>
      <BillingPageHeader
        crumb="Billing & Subscriptions"
        title="Subscription & Entitlements"
        description={
          <>
            Manage plan tier, seat allocations, monthly event throughput, and payment methods for{" "}
            <span className="text-foreground font-medium">{data.organizationName}</span>.
          </>
        }
        actions={
          <>
            <Button
              type="button"
              variant="surface"
              size="sm"
              disabled={!canManage || busy}
              title={canManage ? undefined : OWNER_ONLY_HINT}
              onClick={() => onChangePlan()}
              className="font-mono"
            >
              {live ? "Change plan" : "Choose plan"}
              <ChevronDown aria-hidden className="text-foreground-subtle" />
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canManage || !providerAvailable}
              title={!canManage ? OWNER_ONLY_HINT : providerAvailable ? undefined : PROVIDER_HINT}
              onClick={openPortal}
              className="font-mono font-semibold"
            >
              Manage in billing portal
              <ExternalLink aria-hidden />
            </Button>
          </>
        }
      />

      {tabs}

      <PlanSummaryCards data={data} onManageSeats={onManageSeats} onChoosePlan={() => onChangePlan()} />

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-7 xl:col-span-8">
          <EntitlementsPanel data={data} />
          <IngestionVelocityChart usage={data.usage} />
        </div>
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-5 xl:col-span-4">
          <UpcomingInvoiceCard data={data} onChoosePlan={() => onChangePlan()} />
          {data.recommendation && <TierRecommendationCard recommendation={data.recommendation} onUpgrade={(plan) => onChangePlan(plan)} />}
        </div>
      </div>

      <PlanGovernancePanel subscription={data.subscription} onChoosePlan={() => onChangePlan()} />
    </>
  );
}
