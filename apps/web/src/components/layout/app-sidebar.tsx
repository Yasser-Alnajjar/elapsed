"use client";
import { ShieldCheck } from "lucide-react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail,
} from "@/components/ui/sidebar";
import { BrandMark } from "../shared/brand-mark";
import {
  buildNavItems,
  isNavItemActive,
  type NavGroup,
  type NavLink,
  type NavSection,
} from "./nav-items";
const MENU_BUTTON =
  "h-9 rounded font-mono text-sm data-[active=true]:shadow-[inset_2px_0_0_var(--primary)] data-[active=true]:font-semibold";
function isNavGroup(item: NavSection): item is NavGroup {
  return "items" in item;
}
export function AppSidebar({
  autoSyncSeconds,
  isPlatformOperator = false,
}: {
  /** The worker's active poll interval, for the footer's real sync cadence. */ autoSyncSeconds?: number;
  /** Adds the operator-only link into `/admin`. */ isPlatformOperator?: boolean;
}) {
  const pathname = usePathname();
  const navItems = buildNavItems(isPlatformOperator);
  return (
    <Sidebar side="left" collapsible="icon">
      <SidebarHeader>
        <Link href="/dashboard" aria-label="dashboard">
          <BrandMark logoClassName="size-8" />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {navItems.map((item) => {
          if (isNavGroup(item)) {
            return (
              <NavGroupItem key={item.label} item={item} pathname={pathname} />
            );
          }
          return (
            <NavLinkItem key={item.href} item={item} pathname={pathname} />
          );
        })}
      </SidebarContent>
      <SidebarFooter className="group-data-[collapsible=icon]:hidden">
        <div className="text-outline flex flex-col gap-1.5 border-t border-border-subtle px-2 pt-3 font-mono text-xxs">
          <div className="flex items-center justify-between uppercase tracking-wider">
            <span>Tracking engine</span>
            {autoSyncSeconds !== undefined && (
              <span className="text-tertiary font-semibold">
                Auto-sync {autoSyncSeconds}s
              </span>
            )}
          </div>
          <div className="text-muted-foreground flex items-center gap-1">
            <ShieldCheck className="text-tertiary size-3.5" />
            <span>Zendesk ↔ Jira deterministic</span>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
function NavGroupItem({
  item,
  pathname,
}: {
  item: NavGroup;
  pathname: string;
}) {
  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel className=" mb-1 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60 group-data-[collapsible=icon]:hidden ">
        {item.label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {item.items.map((child) => (
            <NavLinkItem key={child.href} item={child} pathname={pathname} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
function NavLinkItem({ item, pathname }: { item: NavLink; pathname: string }) {
  const active = isNavItemActive(pathname, item.href, item.exact);
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={item.label}
        className={MENU_BUTTON}
      >
        <Link href={item.href}>
          <Icon /> <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
