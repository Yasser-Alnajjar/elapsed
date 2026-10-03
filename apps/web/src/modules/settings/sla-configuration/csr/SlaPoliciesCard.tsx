"use client";

import { Plus, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  BusinessCalendarOption,
  CustomerCalendarSummary,
  SlaPolicySummary,
} from "@/lib/types/sla-configuration";
import { ArchivedPolicies } from "./ArchivedPolicies";
import { NativePolicyDialog } from "./NativePolicyDialog";
import { PolicyRow } from "./PolicyRow";
import { SlaSection } from "./SlaSection";

export function SlaPoliciesCard({
  policies,
  businessCalendars,
  customers,
  defaultCalendarId,
}: {
  policies: SlaPolicySummary[];
  businessCalendars: BusinessCalendarOption[];
  customers: CustomerCalendarSummary[];
  defaultCalendarId: string | null;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);

  const activePolicies = policies.filter((policy) => policy.active);
  const archivedPolicies = policies.filter((policy) => !policy.active);

  return (
    <SlaSection
      delay={0.05}
      icon={<SlidersHorizontal className="size-5" />}
      title="SLA Policies & Metric Matrix"
      meta={`${activePolicies.length} published`}
      metaClassName="text-success"
      subtitle="Imported (Zendesk) policies are matched first; native policies only when none match (D12). Every edit creates a new version."
      action={
        <Button
          type="button"
          size="sm"
          onClick={() => setCreateOpen(true)}
          disabled={businessCalendars.length === 0}
          title={
            businessCalendars.length === 0
              ? "No business calendar available yet"
              : undefined
          }
        >
          <Plus />
          New native policy
        </Button>
      }
    >
      {policies.length === 0 ? (
        <p className="text-on-surface-variant text-sm">
          No SLA policies yet — import from Zendesk or create a native policy.
        </p>
      ) : (
        <div className="space-y-4">
          {/* Active policies */}
          {activePolicies.length > 0 && (
            <div className="space-y-3">
              {activePolicies.map((policy) => (
                <PolicyRow
                  key={policy.id}
                  policy={policy}
                  businessCalendars={businessCalendars}
                  customers={customers}
                  defaultCalendarId={defaultCalendarId}
                  onSaved={() => router.refresh()}
                />
              ))}
            </div>
          )}

          {/* Archived policies */}
          {archivedPolicies.length > 0 && (
            <ArchivedPolicies
              policies={archivedPolicies}
              businessCalendars={businessCalendars}
              customers={customers}
              defaultCalendarId={defaultCalendarId}
              onSaved={() => router.refresh()}
            />
          )}
        </div>
      )}

      <NativePolicyDialog
        mode="create"
        businessCalendars={businessCalendars}
        customers={customers}
        defaultCalendarId={defaultCalendarId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => {
          setCreateOpen(false);
          router.refresh();
        }}
      />
    </SlaSection>
  );
}
