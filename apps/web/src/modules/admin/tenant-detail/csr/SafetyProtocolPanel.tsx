import { ShieldCheck } from "lucide-react";
import { AdminPanel } from "@/components/admin/admin-ui";

/** What the two integration controls do and do not touch, in one place, so an operator does not have to remember. */
export function SafetyProtocolPanel() {
  return (
    <AdminPanel className="border-primary/25 bg-primary/[0.05] p-4">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="text-primary size-4" aria-hidden />
        <h2 className="text-foreground text-sm font-semibold">Operational safety</h2>
      </div>
      <dl className="mt-3 flex flex-col gap-3 text-sm leading-5">
        <div>
          <dt className="text-foreground font-semibold">Pause polling</dt>
          <dd className="text-muted-foreground">Stops fetching new data for one integration. The customer sees it as stale and breach alerts for its cases are held.</dd>
        </div>
        <div>
          <dt className="text-foreground font-semibold">Re-normalize</dt>
          <dd className="text-muted-foreground">
            Rebuilds cases from raw events already stored. It fetches nothing from the provider and edits no tenant data.
          </dd>
        </div>
      </dl>
    </AdminPanel>
  );
}
