"use client";

import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/shared/brand-logo";
import { isNavItemActive } from "@/components/layout/nav-items";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { MonoLabel, StatusDot } from "./admin-ui";
import { ADMIN_NAV_ITEMS } from "./admin-nav-items";
import { IUser } from "@/lib/types/user";

/** The mono, left-barred active state of the admin menu, on top of the shadcn menu button's own. */
const MENU_BUTTON =
  "h-9 rounded font-mono text-sm data-[active=true]:shadow-[inset_2px_0_0_var(--primary)] data-[active=true]:font-semibold";

/**
 * The admin navigation, on the app's shadcn `Sidebar`: collapsible to icons
 * (with tooltips), a sheet on a phone, and `⌘B` to toggle, all from the
 * component. Only the content is ours.
 */
export function AdminSidebar({ user }: { user: IUser }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  /** A link inside the phone sheet should close it, or it stays over the page that just loaded. */
  const closeSheet = () => setOpenMobile(false);

  return (
    <Sidebar side="left" collapsible="icon">
      <SidebarHeader className="gap-0 p-0">
        <div className="bg-surface-raised border-sidebar-border flex h-14 items-center justify-between border-b px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <Link
            href="/admin"
            onClick={closeSheet}
            aria-label="Platform admin home"
            className="flex items-center gap-2.5"
          >
            <BrandLogo className="size-6" />
            <span className="text-foreground font-mono text-base font-bold tracking-tight group-data-[collapsible=icon]:hidden">
              ELAPSED
            </span>
          </Link>
          <span className="border-primary/30 bg-primary/10 text-primary rounded border px-1.5 py-0.5 font-mono text-[10px] leading-3 font-semibold tracking-[0.06em] group-data-[collapsible=icon]:hidden">
            OPS
          </span>
        </div>

        <div className="border-sidebar-border border-b bg-warning/8 px-4 py-2 group-data-[collapsible=icon]:hidden">
          <span className="text-warning-text font-mono text-[10px] font-semibold tracking-[0.08em] uppercase">
            Internal · Platform admin
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="Customer application"
                  className={`${MENU_BUTTON} text-sidebar-foreground/70 text-xs`}
                >
                  <Link href="/dashboard" onClick={closeSheet}>
                    <ArrowLeft />
                    <span>Customer application</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="pt-0">
          <SidebarGroupLabel className="font-mono text-[10px] font-semibold tracking-[0.08em] uppercase">
            Platform
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu aria-label="Platform admin">
              {ADMIN_NAV_ITEMS.map((item) => {
                const active = isNavItemActive(pathname, item.href, item.exact);
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      className={MENU_BUTTON}
                    >
                      <Link
                        href={item.href}
                        onClick={closeSheet}
                        aria-current={active ? "page" : undefined}
                        title={item.description}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="bg-surface-raised border-sidebar-border border-t p-4 group-data-[collapsible=icon]:hidden">
        <div className="flex items-center justify-between">
          <MonoLabel>Signed in</MonoLabel>
          <span className="text-success flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.06em]">
            <StatusDot tone="success" pulse />
            OPERATOR
          </span>
        </div>
        <p
          className="text-foreground truncate font-mono text-xs"
          title={user.email}
        >
          {user.email}
        </p>
        <p className="text-foreground-subtle flex items-start gap-1.5 text-xxs leading-4">
          <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
          Writes and tenant views on this console are recorded in the audit log.
        </p>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
