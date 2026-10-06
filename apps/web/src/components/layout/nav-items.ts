import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Blocks,
  Book,
  Building2,
  CreditCard,
  Home,
  LayoutDashboard,
  ListChecks,
  Radar,
  Timer,
  TriangleAlert,
  UserRound,
  Users,
  Database,
} from "lucide-react";

export interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  description?: string;
  /** Active only on this exact path — for a child whose href is also the prefix of a sibling (e.g. `/admin` vs `/admin/tenants`). */
  exact?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavLink[];
}

/** The mono, left-barred active state shared by the app and admin sidebars, on top of the shadcn menu button's own. */
export const NAV_MENU_BUTTON_CLASS =
  "h-9 rounded text-sm data-[active=true]:shadow-[inset_2px_0_0_var(--primary)] data-[active=true]:font-semibold";

export const SETTINGS_NAV_ITEMS: NavLink[] = [
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
    icon: Blocks,
    description: "Connect and manage third-party services like Zendesk.",
  },
  {
    href: "/settings/data",
    label: "Data",
    icon: Database,
    description: "Back up and clean up the data your integrations have stored.",
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

const NAV_GROUPS: NavGroup[] = [
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

/**
 * The platform admin area (`/admin`) has its own shell and navigation
 * (`components/admin/admin-nav-items.ts`); nothing of it lives in the tenant
 * sidebar except this single way in, shown only to a platform operator.
 * Hiding the link is not the authorization boundary: every `/admin` route
 * enforces it server-side.
 */
export function buildNavGroups(isPlatformOperator: boolean): NavGroup[] {
  if (!isPlatformOperator) {
    return NAV_GROUPS;
  }
  return [
    ...NAV_GROUPS,
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
