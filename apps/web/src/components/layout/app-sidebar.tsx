"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import { BrandMark } from "../shared/brand-mark";
import {
  buildNavGroups,
  isNavItemActive,
  NAV_MENU_BUTTON_CLASS,
  type NavLink,
} from "./nav-items";

export function AppSidebar({
  isPlatformOperator = false,
}: {
  /** Adds the operator-only link into `/admin`. */
  isPlatformOperator?: boolean;
}) {
  const pathname = usePathname();

  return (
    <Sidebar side="left" collapsible="icon">
      <SidebarHeader>
        <Link href="/dashboard" aria-label="dashboard">
          <BrandMark logoClassName="size-8" />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {buildNavGroups(isPlatformOperator).map((group) => (
          <SidebarGroup key={group.label} className="py-1">
            <SidebarGroupLabel className="mb-1 px-2 font-mono text-xxs font-semibold uppercase tracking-[0.14em] text-muted-foreground/60 group-data-[collapsible=icon]:hidden">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <NavLinkItem
                    key={item.href}
                    item={item}
                    pathname={pathname}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}

function NavLinkItem({ item, pathname }: { item: NavLink; pathname: string }) {
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isNavItemActive(pathname, item.href, item.exact)}
        tooltip={item.label}
        className={NAV_MENU_BUTTON_CLASS}
      >
        <Link href={item.href}>
          <Icon /> <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
