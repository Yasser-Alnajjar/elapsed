import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Book,
  Building2,
  CreditCard,
  Home,
  LayoutDashboard,
  ListChecks,
  Radar,
  Settings,
  Settings2,
  Timer,
  TriangleAlert,
  UserRound,
  Users,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description?: string;
  items?: NavItem[];
  /** Active only on this exact path — for a child whose href is also the prefix of a sibling (e.g. `/admin` vs `/admin/tenants`). */
  exact?: boolean;
}

export const SETTINGS_NAV_ITEMS: NavItem[] = [
  {
    href: "/billing",
    label: "Billing & usage",
    icon: CreditCard,
    description: "Plan, seats, usage, invoices and payment details.",
  },
  {
    href: "/settings/sla/configuration",
    label: "SLA",
    icon: Timer,
    description: "Configure SLA policies, targets, and escalation timers.",
  },
  {
    href: "/settings/integrations",
    label: "Integrations",
    icon: Settings2,
    description: "Connect and manage third-party services like Zendesk.",
  },
  {
    href: "/settings/notifications",
    label: "Notifications",
    icon: Bell,
    description: "Configure how and when you're notified of SLA events.",
  },
  {
    href: "/settings/members",
    label: "Members",
    icon: Users,
    description: "Invite people to this organization.",
  },
  {
    href: "/settings/organization",
    label: "Organization",
    icon: Building2,
    description: "Manage this organization's name and display timezone.",
  },
  {
    href: "/settings/profile",
    label: "Profile",
    icon: UserRound,
    description: "Manage your personal profile and appearance preferences.",
  },
];
export type NavLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  description?: string;
};
export type NavGroup = { label: string; items: NavLink[] };
export type NavSection = NavLink | NavGroup;
export const NAV_ITEMS: NavSection[] = [
  {
    label: "Main",
    items: [
      { href: "/", label: "Home", icon: Home, exact: true },
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { href: "/cases", label: "All cases", icon: ListChecks },
      { href: "/at-risk", label: "At Risk", icon: TriangleAlert },
    ],
  },
  { label: "Configuration", items: SETTINGS_NAV_ITEMS },
];
/** * The platform admin area (`/admin`, N4.1) has its own shell and navigation * (`components/admin/admin-nav-items.ts`); nothing of it lives in the tenant * sidebar except this single way in, shown only to a platform operator * (see `isPlatformOperator` in `@/lib/authz`). * * Hiding the link is not the authorization boundary: * every `/admin` route enforces it server-side. */ export function buildNavItems(
  isPlatformOperator: boolean,
): NavSection[] {
  if (!isPlatformOperator) {
    return NAV_ITEMS;
  }
  return [
    ...NAV_ITEMS,
    {
      label: "Administration",
      items: [
        {
          href: "/admin",
          label: "Platform admin",
          icon: Radar,
          description: "Tenants, plans and health across every organization.",
        },
        { href: "/docs", label: "Documentation", icon: Book },
      ],
    },
  ];
}
export function isNavItemActive(
  pathname: string,
  href: string,
  exact = false,
): boolean {
  return pathname === href || (!exact && pathname.startsWith(`${href}/`));
}
