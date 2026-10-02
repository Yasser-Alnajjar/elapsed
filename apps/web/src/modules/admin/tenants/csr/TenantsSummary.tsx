import { AdminPanel, PanelHeading, TONE_TEXT } from "@/components/admin/admin-ui";
import { planStatusTone } from "@/components/admin/tenant-badges";
import { PLAN_STATUSES, PLAN_STATUS_LABELS, type AdminTenantsData } from "@/lib/types/admin";
import { cn } from "@/lib/utils";

/** The two aggregate cards above the list: plan status counts and provider pairs. Counts only, never customer names. */
export function TenantsSummary({ data }: { data: Pick<AdminTenantsData, "planStatusCounts" | "planNotRecorded" | "providerPairCounts"> }) {
  // On a phone the list is what you came for, so the aggregates go below it (`max-md:order-last`).
  return (
    <section aria-label="Summary" className="grid gap-3 max-md:order-last xl:grid-cols-12">
      <AdminPanel className="flex flex-col gap-3 p-4 xl:col-span-7">
        <PanelHeading aside={<span className="text-foreground-subtle font-mono text-[10px]">Recorded by hand</span>}>
          Plan status breakdown
        </PanelHeading>
        <ul className="flex flex-wrap gap-2">
          {PLAN_STATUSES.map((status) => {
            const count = data.planStatusCounts[status];
            return (
              <li
                key={status}
                className={cn("bg-surface-raised flex items-center gap-2 rounded px-2.5 py-1", count === 0 && "opacity-55")}
              >
                <span className={cn("font-mono text-[10px] font-semibold tracking-[0.06em] uppercase", TONE_TEXT[count === 0 ? "neutral" : planStatusTone(status)])}>
                  {PLAN_STATUS_LABELS[status]}
                </span>
                <span className="text-foreground font-mono text-sm font-bold tabular-nums">{count}</span>
              </li>
            );
          })}
          <li className={cn("bg-surface-raised flex items-center gap-2 rounded px-2.5 py-1", data.planNotRecorded === 0 && "opacity-55")}>
            <span className="text-muted-foreground font-mono text-[10px] font-semibold tracking-[0.06em] uppercase">Not recorded</span>
            <span className="text-foreground font-mono text-sm font-bold tabular-nums">{data.planNotRecorded}</span>
          </li>
        </ul>
      </AdminPanel>

      <AdminPanel className="flex flex-col gap-3 p-4 xl:col-span-5">
        <PanelHeading tone="primary" aside={<span className="text-success font-mono text-[10px] font-semibold tracking-[0.06em]">COUNTS ONLY</span>}>
          Provider pairs
        </PanelHeading>
        {data.providerPairCounts.length === 0 ? (
          <p className="text-foreground-subtle text-xs">No organizations yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {data.providerPairCounts.map((row) => (
              <li key={row.pair} className="bg-surface-raised flex items-center gap-2 rounded px-2.5 py-1">
                <span className={cn("font-mono text-xs", row.pair === "No integrations" ? "text-muted-foreground" : "text-foreground")}>{row.pair}</span>
                <span className="bg-primary/15 text-primary rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums">{row.tenants}</span>
              </li>
            ))}
          </ul>
        )}
      </AdminPanel>
    </section>
  );
}
