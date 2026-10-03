import Link from "next/link";
import type { ReactNode } from "react";
import { ListChecks } from "lucide-react";

import { Button } from "@/components/ui/button";

import { DESCRIPTION_CLASS } from "./constants";

/** Step 3's top ribbon: the step marker and how many cases the linked source brought in. */
export function TrackerStepRibbon({
  sourceLabel,
  ticketsFetched,
  caseNoun,
}: {
  sourceLabel: string;
  ticketsFetched: number;
  caseNoun: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 rounded-lg bg-surface-container px-3 py-1.5 shadow-sm">
        <span className="font-label-caps text-label-caps text-primary tracking-widest">
          STEP 03 // 03
        </span>
        <span className="size-1.5 rounded-full bg-outline-variant" />
        <span className="font-code-audit text-code-audit text-on-surface-variant">
          RECONSTRUCT_CLOCK_CONTINUITY
        </span>
      </div>
      <div className="flex items-center gap-2 rounded bg-surface-container-low px-3 py-1.5 text-tertiary shadow-sm">
        <span className="size-2 rounded-full bg-tertiary animate-ping" />
        <span className="font-code-audit text-code-audit font-semibold uppercase">
          {sourceLabel} linked ({ticketsFetched.toLocaleString()} {caseNoun})
        </span>
      </div>
    </div>
  );
}

/** A one-line nudge toward the SLA-policy step, with its call to action. */
function PolicyCallout({
  children,
  action,
}: {
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg bg-surface-container-low p-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2.5">
        <ListChecks className="size-[18px] shrink-0 text-primary" />
        <p className={DESCRIPTION_CLASS}>{children}</p>
      </div>
      {action}
    </div>
  );
}

/** Imported policies are waiting for (or have had) a review. */
export function ReviewPoliciesCallout({ reviewed }: { reviewed: boolean }) {
  return (
    <PolicyCallout
      action={
        <Button variant={reviewed ? "outline" : "default"} asChild>
          <Link href="/onboarding/review-policies">
            {reviewed ? "Review again" : "Review policies"}
          </Link>
        </Button>
      }
    >
      {reviewed
        ? "Your SLA policies have been imported and reviewed."
        : "Your SLA policies have been imported — review what matched before connecting your issue tracker."}
    </PolicyCallout>
  );
}

/** The source imports no policies (D9): offer a first native one, never blocking the flow. */
export function CreatePolicyCallout({ sourceLabel }: { sourceLabel: string }) {
  return (
    <PolicyCallout
      action={
        <Button variant="default" asChild>
          <Link href="/settings/sla/configuration">
            Create your first policy
          </Link>
        </Button>
      }
    >
      {sourceLabel} has no SLA policies to import — create your first native
      policy so every case gets First Response and Resolution commitments.
    </PolicyCallout>
  );
}
