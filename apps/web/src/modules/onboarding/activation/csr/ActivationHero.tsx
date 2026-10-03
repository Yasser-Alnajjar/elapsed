import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  LockKeyhole,
  Network,
  Ticket,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OnboardingStatus } from "@/lib/types/onboarding";
import { DESCRIPTION_CLASS } from "./constants";

function HeroCount({
  icon: Icon,
  iconClass,
  children,
  value,
}: {
  icon: LucideIcon;
  iconClass: string;
  children: ReactNode;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={`size-4 ${iconClass} shrink-0`} />
      <span>
        {children}{" "}
        <strong className="font-mono-metric-md text-mono-metric-md text-on-surface">
          {value.toLocaleString()}
        </strong>
      </span>
    </div>
  );
}

/** "Setup complete" banner: what is now paired, the headline counts, and where to go next. */
export function ActivationHero({
  status,
  sourceLabel,
  trackerLabel,
  ticketNoun,
}: {
  status: OnboardingStatus;
  sourceLabel: string;
  trackerLabel: string | null;
  ticketNoun: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-surface-container shadow-2xl">
      <div className="h-1 w-full bg-gradient-to-r from-primary via-tertiary to-primary" />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 inset-e-0 size-72 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative flex flex-col gap-6 p-6 md:p-8 xl:flex-row xl:items-center xl:justify-between">
        <div className="max-w-2xl space-y-4">
          <span className="font-label-caps text-label-caps inline-flex items-center gap-1.5 rounded bg-primary/10 px-2.5 py-1 uppercase text-primary">
            <LockKeyhole className="size-4 shrink-0" />
            Deterministic verification pass
          </span>
          <h1 className="font-headline-lg text-headline-lg leading-tight text-on-surface">
            Zero-config setup complete —{" "}
            <span className="text-primary">live SLA tracking</span> is online
          </h1>
          <p className={`${DESCRIPTION_CLASS} max-w-xl`}>
            {trackerLabel !== null
              ? `${sourceLabel} and ${trackerLabel} are deterministically paired. The continuous customer SLA clock is running across every open commitment, including handoffs between support and engineering.`
              : `${sourceLabel} is connected and the customer SLA clock is running across every open commitment. Engineering time appears once a tracker is connected.`}
          </p>
          <div className="font-label-caps text-label-caps flex flex-wrap items-center gap-6 pt-1 text-on-surface-variant">
            <HeroCount
              icon={Ticket}
              iconClass="text-primary"
              value={status.ticketsFetched}
            >
              {ticketNoun.charAt(0).toUpperCase() + ticketNoun.slice(1)}{" "}
              ingested:
            </HeroCount>
            {trackerLabel !== null && (
              <HeroCount
                icon={Workflow}
                iconClass="text-primary"
                value={status.escalatedCases}
              >
                Escalated to {trackerLabel}:
              </HeroCount>
            )}
            {trackerLabel !== null && status.linkedIssues > 0 && (
              <HeroCount
                icon={Network}
                iconClass="text-tertiary"
                value={status.linkedIssues}
              >
                Linked issues:
              </HeroCount>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row xl:flex-col">
          <Button asChild size="lg">
            <Link href="/dashboard">
              Launch live operations dashboard
              <ArrowRight className="size-[18px] shrink-0" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/settings/integrations">
              Confirm SLA policies &amp; connect Slack
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
