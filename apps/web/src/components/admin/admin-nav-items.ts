import { Activity, Building2, Radar, ScrollText } from "lucide-react";
import type { NavItem } from "@/components/layout/nav-items";

/**
 * The platform admin's own navigation (N4.1). It lives here, not in the
 * tenant `nav-items.ts`, so a tenant user's sidebar never carries any of it.
 */
export const ADMIN_NAV_ITEMS: NavItem[] = [
  {
    href: "/admin",
    label: "Overview",
    icon: Radar,
    exact: true,
    description: "Failed webhooks and syncs across every organization.",
  },
  {
    href: "/admin/tenants",
    label: "Tenants",
    icon: Building2,
    description: "Every customer: plan, status, integrations and health.",
  },
  {
    href: "/admin/monitoring",
    label: "Monitoring",
    icon: Activity,
    description: "Monitor worker health and adjust polling intervals.",
  },
  {
    href: "/admin/audit",
    label: "Audit log",
    icon: ScrollText,
    description: "Everything an operator did or looked at.",
  },
];
