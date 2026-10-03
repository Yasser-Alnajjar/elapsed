"use client";

import { History, ShieldCheck } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type {
  BusinessCalendarOption,
  CustomerCalendarSummary,
  SlaPolicySummary,
} from "@/lib/types/sla-configuration";
import { PolicyRow, policyChip } from "./PolicyRow";

/** Collapsed log of inactive / superseded policy versions. */
export function ArchivedPolicies({
  policies,
  businessCalendars,
  customers,
  defaultCalendarId,
  onSaved,
}: {
  policies: SlaPolicySummary[];
  businessCalendars: BusinessCalendarOption[];
  customers: CustomerCalendarSummary[];
  defaultCalendarId: string | null;
  onSaved: () => void;
}) {
  return (
    <Accordion
      type="single"
      collapsible
      className="bg-surface-container overflow-hidden rounded-lg"
    >
      <AccordionItem value="archived" className="border-0">
        <AccordionTrigger className="px-4 hover:no-underline">
          <div className="flex items-center gap-2">
            <History className="text-outline size-4" />
            <span className="text-sm font-medium">
              Archived &amp; superseded policies ({policies.length})
            </span>
            <span className={`${policyChip} text-secondary`}>
              IMMUTABLE LOG
            </span>
          </div>
        </AccordionTrigger>

        <AccordionContent className="px-4">
          <div className="space-y-3 pt-2">
            <div className="bg-surface-container-lowest text-on-surface-variant flex items-start gap-2 rounded p-3 text-xs">
              <ShieldCheck className="text-secondary mt-0.5 size-4 shrink-0" />
              Every edit creates an immutable new policy version. Existing
              commitments stay tied to the version they were created under.
            </div>
            {policies.map((policy) => (
              <PolicyRow
                key={policy.id}
                policy={policy}
                businessCalendars={businessCalendars}
                customers={customers}
                defaultCalendarId={defaultCalendarId}
                onSaved={onSaved}
              />
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
