import { Activity, Building2, Radar, ReceiptText, ScrollText } from "lucide-react";
import type { NavLink } from "@/components/layout/nav-items";

/**
 * The platform admin's own navigation (N4.1). It lives here, not in the
 * tenant `nav-items.ts`, so a tenant user's sidebar never carries any of it.
 */
export const ADMIN_NAV_ITEMS: NavLink[] = [
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
    href: "/admin/billing",
    label: "Billing operations",
    icon: ReceiptText,
    description: "Revenue, subscriptions and payment risk across every tenant.",
  },
  {
    href: "/admin/audit",
    label: "Audit log",
    icon: ScrollText,
    description: "Everything an operator did or looked at.",
  },
];
