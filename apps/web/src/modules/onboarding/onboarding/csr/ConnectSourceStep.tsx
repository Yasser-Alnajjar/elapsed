"use client";

import { History, Hourglass, KeyRound, Lock, Shield } from "lucide-react";

import { EngineStateChip } from "@/components/shared/engine-state-chip";
import { OnboardingShell } from "@/components/shared/onboarding-shell";
import { Reveal } from "@/components/shared/reveal";
import type { ProviderOnboardingStatus } from "@/lib/types/onboarding";
import { providerPresentation } from "@modules/settings/integrations/csr/provider-presentation";

import {
  AlternativeConnectorCard,
  PrimaryConnectorCard,
} from "./ConnectorCards";
import { Soc2Badge, StatStrip, TrustList } from "./OnboardingPanels";
import { DESCRIPTION_CLASS } from "./constants";

/** Step 1: no ticket source yet — the primary source's connect card, the alternatives, and the trust rail. */
export function ConnectSourceStep({
  ticketSources,
  currentStep,
  onConfigured,
}: {
  ticketSources: ProviderOnboardingStatus[];
  currentStep: 1 | 2 | 3 | null;
  onConfigured: () => void;
}) {
  const [primarySource, ...otherSources] = ticketSources;
  const primary = primarySource
    ? providerPresentation(primarySource.provider)
    : null;

  return (
    <OnboardingShell
      title="Connect your support helpdesk in 30 seconds"
      description="Elapsed ingests read-only ticket timestamps to uncover unmonitored SLA time. Zero write access, zero agent plugins, zero workflow changes required."
      currentStep={currentStep}
      wide
      headerAside={
        <EngineStateChip label="Engine state" value="AWAITING_INGESTION_SRC" />
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="flex flex-col gap-5 lg:col-span-7">
          {primarySource && primary && (
            <Reveal>
              <PrimaryConnectorCard
                provider={primarySource}
                onConfigured={onConfigured}
                description={`Connect ${primarySource.label} to pull your last 90 days of ${primary.caseNoun}${
                  primarySource.capabilities.policyImport
                    ? ", SLA policies, and organizations"
                    : ""
                }, read-only, one click.`}
                footer={
                  <StatStrip
                    stats={[
                      {
                        label: "Backfill horizon",
                        value: "90",
                        unit: "days historical",
                      },
                      {
                        label: "Sync mode",
                        value: "Read",
                        unit: "-only, incremental",
                      },
                    ]}
                  />
                }
              />
            </Reveal>
          )}

          {otherSources.map((provider) => (
            <Reveal key={provider.provider}>
              <AlternativeConnectorCard
                provider={provider}
                onConfigured={onConfigured}
              />
            </Reveal>
          ))}
        </div>

        <div className="flex flex-col gap-5 lg:col-span-5">
          <Reveal>
            <div className="flex flex-col gap-4 rounded-xl bg-surface-container-lowest p-6 shadow-elevated">
              <div className="flex items-center justify-between">
                <span className="font-label-caps text-label-caps uppercase tracking-wider text-primary">
                  Trust & safety
                </span>
                <Shield className="size-5 text-primary shrink-0" />
              </div>

              <TrustList
                items={[
                  {
                    icon: Lock,
                    title: "Zero write permissions",
                    description:
                      "Credentials run under a read-only OAuth scope — Elapsed can't touch your tickets.",
                  },
                  {
                    icon: Hourglass,
                    title: "Continuous SLA clock",
                    description:
                      "Raw ticket timestamps build the uncompromised clock across support and engineering handoffs.",
                  },
                  {
                    icon: History,
                    title: "Fixed 90-day backfill",
                    description:
                      "An instant historical baseline starts as soon as you're authenticated — no waiting on new tickets.",
                  },
                ]}
              />
            </div>
          </Reveal>

          <Reveal>
            <Soc2Badge />
          </Reveal>
        </div>
      </div>

      <Reveal>
        <div className="mt-2 flex flex-col items-center gap-3 rounded-xl bg-surface-container-low p-5 shadow-lg sm:flex-row sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-primary">
              <KeyRound className="size-5 shrink-0" />
            </div>
            <div className="flex flex-col">
              <span className="font-headline-sm text-headline-sm text-on-surface">
                Ready to begin your SLA backfill
              </span>
              <span className={DESCRIPTION_CLASS}>
                Step 1 of 3 — connect{" "}
                {ticketSources.map((p) => p.label).join(" or ")} to calculate
                continuous resolution times
              </span>
            </div>
          </div>
        </div>
      </Reveal>
    </OnboardingShell>
  );
}
