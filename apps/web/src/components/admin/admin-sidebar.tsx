"use client";

import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavItemActive, NAV_MENU_BUTTON_CLASS } from "@/components/layout/nav-items";
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
import type { IUser } from "@/lib/types/user";
import { BrandMark } from "../shared/brand-mark";

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
      <SidebarHeader>
        <Link href="/dashboard" aria-label="dashboard">
          <BrandMark logoClassName="size-8" />
        </Link>
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
                  className={NAV_MENU_BUTTON_CLASS}
                >
                  <Link
                    href="/dashboard"
                    onClick={closeSheet}
                    className="shrink-0"
                  >
                    <ArrowLeft className="size-4 shrink-0" />
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
                      className={NAV_MENU_BUTTON_CLASS}
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
