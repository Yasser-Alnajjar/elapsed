import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Escalation dispatch history for the case. The case-detail data contract
 * carries no dispatch records yet, so this states that plainly instead of
 * showing an empty list.
 */
export function EscalationDispatchLog() {
  return (
    <div className="mt-4 rounded-xl bg-surface-container-low p-6 shadow-sm flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="size-5.5 text-error" />
          <h2 className="text-xl font-medium tracking-tight text-on-surface">
            Escalation Dispatch Log
          </h2>
        </div>
        <span className="font-mono text-xs leading-4 text-outline">
          0 Dispatches
        </span>
      </div>

      <div className="rounded-lg bg-surface-container p-3 flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Bell className="size-4.5 text-outline mt-0.5" />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-on-surface">
              No escalation dispatch records
            </span>
            <span className="text-xs leading-4.5 text-outline">
              Dispatch history is not included in the current case-detail data
              contract.
            </span>
          </div>
        </div>
        <span className="font-mono text-xs leading-4 text-outline">
          NOT AVAILABLE
        </span>
      </div>

      <Button
        type="button"
        variant="bare"
        size="bare"
        disabled
        className="bg-surface-container text-outline w-full cursor-not-allowed gap-1.5 rounded px-4 py-2 text-xs leading-4.5 font-medium disabled:opacity-60"
      >
        <Bell className="size-4" />
        Re-trigger Escalation Ping to Eng On-Call
      </Button>
    </div>
  );
}
