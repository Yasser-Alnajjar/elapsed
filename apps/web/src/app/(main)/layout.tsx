import type { Metadata } from "next";
import { Search } from "lucide-react";

import { getEntitlementNotice, getPrismaClient, withPerfScope } from "@sla/db";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Actions } from "@/actions";
import { getRequestContext } from "@/lib/request-context";
import { getAlertSummary } from "@/lib/alert-summary-data";
import { isPlatformOperator } from "@/lib/authz";
import { LiveStatusBadge } from "@/components/shared/LiveStatusBadge";
import { AlertsPopover } from "@/components/layout/alerts-popover";
import { UserMenu } from "@/components/layout/user-menu";
import { Input } from "@/components/ui/input";
import { LiveDataProvider } from "@/components/shared/LiveDataProvider";
import { getStaleIntegrationData } from "@/lib/freshness-data";
import { StaleDataBanner } from "@/components/shared/stale-data-banner";
import { PlanNoticeBanner } from "@/components/shared/plan-notice-banner";
import { providerRole } from "@/lib/providers";

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
  const { session, organizationId } = await getRequestContext();

  const [user, integrations, alertSummary, staleIntegrations, entitlementNotice] =
    await withPerfScope("layout", () =>
      Promise.all([
        // Read fresh from the database rather than the JWT session: name and
        // avatar are editable on the Profile page and must show up here on the
        // next `router.refresh()`, not after the next sign-in.
        Actions.Profile.getData(),
        Actions.Integrations.getData(),
        getAlertSummary(getPrismaClient(), organizationId),
        getStaleIntegrationData(getPrismaClient(), organizationId),
        // One settings read while enforcement is off (the default).
        getEntitlementNotice(getPrismaClient(), organizationId, {
          roleOf: providerRole,
        }),
      ]),
    );

  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar isPlatformOperator={isPlatformOperator(session)} />
      <SidebarInset>
        <header className="border-border bg-surface-container-lowest sticky top-0 z-40 flex h-14 items-center gap-3 border-b px-4 backdrop-blur-xl">
          <SidebarTrigger />

          <LiveStatusBadge />

          {/* Global search (⌘K) is Stitch's visual affordance for a
              capability this app doesn't have yet (no omnibar search
              exists) — shown disabled rather than wired to nothing, per the
              rule against faking a genuinely-missing capability. */}
          <div className="mx-auto hidden max-w-md flex-1 lg:block">
            <div className="relative flex items-center">
              <Search className="text-outline pointer-events-none absolute inset-s-3 size-4" />
              <Input
                disabled
                readOnly
                placeholder="Search coming soon…"
                className="bg-surface-container-low border-border-subtle text-on-surface placeholder:text-outline h-auto rounded py-1.5 ps-9 pe-3 text-sm md:text-sm"
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

          <AlertsPopover items={alertSummary.rows} />

          <UserMenu user={user} />
        </header>
        <main className="mx-auto min-w-0 w-full flex-1 px-4 py-4">
          <PlanNoticeBanner
            notice={{
              trialExpiredAt:
                entitlementNotice.trialExpired?.trialEndedAt.toISOString() ??
                null,
              trialRestricted: entitlementNotice.trialExpired?.restricted,
              overLimit: entitlementNotice.overLimit,
            }}
          />
          <StaleDataBanner integrations={staleIntegrations} />
          {children}
          {/* Mounted once here, not per page, so every page under this layout
              refreshes when its organization's data actually changes. */}
          <LiveDataProvider />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
