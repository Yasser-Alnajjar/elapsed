import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bell,
  Book,
  Building2,
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
  /** Active only on this exact path — for a child whose href is also the prefix of a sibling (e.g. `/operator` vs `/operator/monitoring`). */
  exact?: boolean;
}

export const SETTINGS_NAV_ITEMS: NavItem[] = [
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

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/cases", label: "All cases", icon: ListChecks },
  { href: "/at-risk", label: "At Risk", icon: TriangleAlert },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    items: SETTINGS_NAV_ITEMS,
  },
];

export const OPERATOR_NAV_ITEMS: NavItem[] = [
  {
    href: "/operator",
    label: "Overview",
    icon: Radar,
    exact: true,
    description: "Failed webhooks and syncs across every organization.",
  },
  {
    href: "/operator/monitoring",
    label: "Monitoring",
    icon: Activity,
    description: "Monitor worker health and adjust polling intervals.",
  },
];

/**
 * `/operator` and its children (roadmap 7.5) only exist for
 * `PLATFORM_ADMIN_EMAILS` — see `isPlatformOperator` in `@/lib/authz`. Kept
 * out of `NAV_ITEMS` itself so a non-operator's sidebar never renders a link
 * into a page that would `notFound()` on them. Hiding the links is not the
 * gate: each operator route enforces it server-side.
 */
export function buildNavItems(isPlatformOperator: boolean): NavItem[] {
  if (!isPlatformOperator) return NAV_ITEMS;
  return [
    ...NAV_ITEMS,
    {
      href: "/operator",
      label: "Operator",
      icon: Radar,
      description: "Failed webhooks and syncs across every organization.",
      items: OPERATOR_NAV_ITEMS,
    },
    { href: "/docs", label: "Documentation", icon: Book },
  ];
}

export function isNavItemActive(
  pathname: string,
  href: string,
  exact = false,
): boolean {
  return pathname === href || (!exact && pathname.startsWith(`${href}/`));
}
