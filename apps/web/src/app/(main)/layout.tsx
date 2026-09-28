import type { Metadata } from "next";
import { Search } from "lucide-react";
import { getServerSession } from "next-auth";

import { withPerfScope } from "@sla/db";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Actions } from "@/actions";
import { authOptions } from "@/lib/auth";
import { isPlatformOperator } from "@/lib/authz";
import { SlaAutoRefreshProvider } from "@/components/shared/SlaAutoRefreshProvider";
import { AlertsPopover } from "@/components/layout/alerts-popover";
import { UserMenu } from "@/components/layout/user-menu";
import { Input } from "@/components/ui/input";

interface AppLayoutProps {
  children: React.ReactNode;
}

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AppLayout({ children }: AppLayoutProps) {
  // Read fresh from the database rather than the JWT session: name and
  // avatar are user-editable from the Profile page (@modules/settings/profile)
  // and must show up here immediately via `router.refresh()`, not just after
  // the next sign-in.
  const [user, integrations, worker, atRisk, session] = await withPerfScope(
    "layout",
    () =>
      Promise.all([
        Actions.Profile.getData(),
        Actions.Integrations.getData(),
        Actions.WorkerSettings.getData(),
        Actions.AtRisk.getData(),
        getServerSession(authOptions),
      ]),
  );

  const alerts = atRisk
    .filter((r) => r.status === "at_risk" || r.status === "breached")
    .map((r) => ({
      commitmentId: r.commitmentId,
      caseId: r.caseId,
      externalId: r.externalId,
      subject: r.subject,
      status: r.status as "at_risk" | "breached",
      remainingMinutes: r.remainingMinutes,
    }));

  // Real per-integration connection state (Elapsed reconstruction's header
  // sync pill and alert-channel indicator) — never a static "Sync Active"
  // label, since that would fabricate a connection the org may not have.
  const ticketSourceConnected = integrations.zendesk.connected;
  const engineeringSourceConnected = integrations.jira.connected;
  const anySynced = ticketSourceConnected || engineeringSourceConnected;

  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar
        autoSyncSeconds={Math.round(worker.activePollIntervalMs / 1000)}
        isPlatformOperator={isPlatformOperator(session)}
      />
      <SidebarInset>
        <header className="border-border bg-surface-container-lowest/95 sticky top-0 z-40 flex h-14 items-center gap-3 border-b px-4 backdrop-blur-xl">
          <SidebarTrigger />

          <div
            className="flex items-center gap-1.5 rounded border border-border-subtle bg-surface-container px-2.5 py-1"
            title={
              anySynced
                ? [
                    ticketSourceConnected && "Zendesk",
                    engineeringSourceConnected && "Jira",
                  ]
                    .filter(Boolean)
                    .join(" • ")
                : "No ticket source connected yet"
            }
          >
            <span
              className={`size-1.5 rounded-full ${anySynced ? "bg-success animate-pulse" : "bg-outline"}`}
              aria-hidden
            />
            <span className="font-mono text-xxs font-semibold uppercase tracking-wider text-foreground">
              {anySynced ? "Sync active" : "Not connected"}
            </span>
          </div>

          {/* Global search (⌘K) is Stitch's visual affordance for a
              capability this app doesn't have yet (no omnibar search
              exists) — shown disabled rather than wired to nothing, per the
              rule against faking a genuinely-missing capability. */}
          <div className="mx-auto hidden max-w-md flex-1 lg:block">
            <div className="relative flex items-center">
              <Search className="text-outline pointer-events-none absolute left-3 size-4" />
              <Input
                disabled
                readOnly
                placeholder="Search coming soon…"
                className="bg-surface-container-low border-border-subtle text-on-surface placeholder:text-outline h-auto rounded py-1.5 pl-9 pr-3 text-sm md:text-sm"
              />
            </div>
          </div>

          <div className="flex-1 lg:flex-none" />

          <div className="hidden items-center gap-1.5 rounded border border-border-subtle bg-surface-container-low px-2.5 py-1 font-mono text-xxs font-medium uppercase tracking-wider text-muted-foreground md:flex">
            Last 30 days (fixed)
          </div>

          <div
            className="hidden items-center gap-1.5 rounded border border-border-subtle bg-surface-container-low px-2.5 py-1 sm:flex"
            title={
              integrations.slack.connected
                ? `Slack #${integrations.slack.channelName ?? "channel"} connected`
                : "Slack alerts not connected"
            }
          >
            <span
              className={`size-1.5 rounded-full ${integrations.slack.connected ? "bg-success" : "bg-outline"}`}
              aria-hidden
            />
            <span className="font-mono text-xxs text-muted-foreground">
              {integrations.slack.connected
                ? `#${integrations.slack.channelName ?? "slack"}`
                : "#alerts"}
            </span>
            <span
              className={`text-xxs font-semibold ${integrations.slack.connected ? "text-success" : "text-outline"}`}
            >
              {integrations.slack.connected ? "connected" : "not connected"}
            </span>
          </div>

          <AlertsPopover items={alerts} />

          <UserMenu user={user} />
        </header>
        <main className="mx-auto min-w-0 w-full flex-1 px-4 py-4">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
