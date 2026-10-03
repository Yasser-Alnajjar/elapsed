"use client";

import { ArrowRight, Check, Zap } from "lucide-react";
import type { PlanId } from "@sla/db/plans";
import { BillingCaption, BillingCard } from "@/components/billing/billing-ui";
import { Button } from "@/components/ui/button";
import { getUpgradeCta } from "@/lib/upgrade-cta";
import type { TierRecommendation } from "@/lib/types/billing";
import { OWNER_ONLY_HINT, useBillingActions } from "../billing-actions-context";

/** The next tier up, what it adds, and a way to switch to it (or to ask for it, when it is priced by contract). */
export function TierRecommendationCard({ recommendation, onUpgrade }: { recommendation: TierRecommendation; onUpgrade: (plan: PlanId) => void }) {
  const { canManage, busy } = useBillingActions();
  const contact = getUpgradeCta();

  return (
    <BillingCard aria-labelledby="tier-recommendation-title" className="flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <BillingCaption className="text-tertiary">Tier recommendation</BillingCaption>
        <Zap aria-hidden className="text-tertiary size-4.5" />
      </div>
      <div className="flex flex-col gap-1">
        <h3 id="tier-recommendation-title" className="text-foreground text-lg font-semibold tracking-tight sm:text-xl">
          Upgrade to {recommendation.planName}
        </h3>
        <p className="text-muted-foreground text-xs">{recommendation.pitch}</p>
      </div>
      <ul className="text-on-surface-variant flex flex-col gap-2 font-mono text-[10px] leading-4 tracking-[0.04em]">
        {recommendation.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <Check aria-hidden className="text-primary mt-0.5 size-3.5 shrink-0" />
            {feature}
          </li>
        ))}
      </ul>
      {recommendation.selfServe ? (
        <Button
          type="button"
          size="sm"
          disabled={!canManage || busy}
          title={canManage ? undefined : OWNER_ONLY_HINT}
          onClick={() => onUpgrade(recommendation.planId)}
          className="mt-1 w-full font-mono font-semibold"
        >
          {recommendation.ctaLabel}
          <ArrowRight aria-hidden />
        </Button>
      ) : contact.href ? (
        <Button asChild size="sm" className="mt-1 w-full font-mono font-semibold">
          <a href={contact.href}>
            {recommendation.ctaLabel}
            <ArrowRight aria-hidden />
          </a>
        </Button>
      ) : (
        <p className="text-muted-foreground mt-1 text-center font-mono text-[11px]">{contact.label}</p>
      )}
    </BillingCard>
  );
}
