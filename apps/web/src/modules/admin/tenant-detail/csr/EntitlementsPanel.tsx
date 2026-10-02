import { Gauge } from "lucide-react";
import { AdminPanel, MonoLabel } from "@/components/admin/admin-ui";
import { formatUtcTimestamp } from "@/lib/admin-format";
import type { AdminEntitlements } from "@/lib/types/admin";
import { LIMITED_RESOURCES, RESOURCE_LABELS } from "@sla/db/plans";
import { cn } from "@/lib/utils";

const EVENT_LABELS = {
  limit_warned: "Over plan limit (warned)",
  creation_blocked: "Creation blocked (trial ended)",
  trial_expired: "Trial ended",
} as const;

/** What this tenant uses against its plan (N6.2), and what the entitlement checks recorded (N6.3, N6.4). Never edits anything. */
export function EntitlementsPanel({ entitlements }: { entitlements: AdminEntitlements }) {
  const { usage, limits, events } = entitlements;

  return (
    <AdminPanel className="overflow-hidden">
      <div className="bg-surface-raised border-border flex items-center justify-between gap-2 border-b px-4 py-3">
        <span className="flex items-center gap-2.5">
          <Gauge className="text-primary size-4" aria-hidden />
          <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">Usage vs plan</h2>
        </span>
        <span className="border-border text-foreground-subtle rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.06em] uppercase">
          {entitlements.enforced ? "Checks on" : "Checks off"}
        </span>
      </div>

      <dl className="flex flex-col gap-2 p-4">
        {LIMITED_RESOURCES.map((resource) => {
          const limit = limits ? limits[resource] : null;
          const over = limit !== null && usage[resource] > limit;
          return (
            <div key={resource} className="flex items-baseline justify-between gap-3 text-sm">
              <dt className="text-muted-foreground capitalize">{RESOURCE_LABELS[resource]}</dt>
              <dd className={cn("font-mono tabular-nums", over && "text-warning-text font-semibold")}>
                {usage[resource]}
                <span className="text-foreground-subtle"> / {limits === null ? "no plan" : limit === null ? "unlimited" : limit}</span>
              </dd>
            </div>
          );
        })}
        {entitlements.trialExpired && <p className="text-warning-text mt-1 text-xs">Trial has ended. New configuration is blocked; monitoring continues.</p>}
      </dl>

      <div className="border-border border-t p-4">
        <MonoLabel>Recorded checks</MonoLabel>
        {events.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-xs">Nothing recorded.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {events.map((event) => (
              <li key={event.id} className="text-xs">
                <span className="text-foreground font-medium">{EVENT_LABELS[event.kind]}</span>
                {event.resource && <span className="text-muted-foreground"> · {RESOURCE_LABELS[event.resource]}</span>}
                {event.used !== null && event.limit !== null && <span className="text-muted-foreground"> · {event.used}/{event.limit}</span>}
                <span className="text-foreground-subtle block">
                  {formatUtcTimestamp(event.createdAt)}
                  {event.kind === "trial_expired" && (event.notifiedAt ? " · owner emailed" : " · owner not emailed yet")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminPanel>
  );
}
