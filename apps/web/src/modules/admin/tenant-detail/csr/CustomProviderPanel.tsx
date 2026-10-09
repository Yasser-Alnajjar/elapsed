"use client";

import { Plug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AdminClientActions } from "@/actions/admin-client";
import { AdminPanel, MonoLabel } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";

/**
 * The operator's Beta flag for Custom REST (N9). Off by default; turning it off
 * also pauses polling for the custom integration, and turning it back on does
 * not resume it (use the integration's own resume control). Audited.
 */
export function CustomProviderPanel({ organizationId, enabled }: { organizationId: string; enabled: boolean }) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setWorking(true);
    setError(null);
    const { ok, body } = await AdminClientActions.setCustomProviderFlag(organizationId, !enabled);
    setWorking(false);
    if (!ok) {
      setError(body.error ?? "The change failed");
      return;
    }
    router.refresh();
  }

  return (
    <AdminPanel className="overflow-hidden">
      <div className="bg-surface-raised border-border flex items-center justify-between gap-2 border-b px-4 py-3">
        <span className="flex items-center gap-2.5">
          <Plug className="text-primary size-4" aria-hidden />
          <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">Custom REST (Beta)</h2>
        </span>
        <span className="border-border text-foreground-subtle rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.06em] uppercase">
          {enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-muted-foreground text-xs">
          Lets this organization&apos;s owner connect a helpdesk through a configured REST API. Disabling stops all outbound requests and pauses polling; data stays visible.
          Re-enabling does not resume a pause.
        </p>
        <MonoLabel>Audited in the platform log</MonoLabel>
        {error && <p className="text-destructive text-xs">{error}</p>}
        <Button type="button" size="sm" variant={enabled ? "outline" : "default"} disabled={working} onClick={toggle} className="self-start">
          {enabled ? "Disable for this organization" : "Enable for this organization"}
        </Button>
      </div>
    </AdminPanel>
  );
}
