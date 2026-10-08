import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";
import { OrgTimezoneProvider } from "@/components/shared/org-timezone-provider";
import { requirePlatformAdminPage } from "@/lib/admin-auth";
import { getOrganizationTimezone } from "@/lib/organization-timezone";

export const metadata: Metadata = {
  title: "Platform admin",
  robots: { index: false, follow: false },
};

/**
 * The platform operator's own shell (N4.1), outside the `(main)` tenant shell
 * and its sidebar. A non-operator gets `notFound()` here, before anything
 * renders; every admin page and read re-checks it too (`AdminActions`), since a
 * layout is not re-run on every client navigation.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requirePlatformAdminPage();

  // The operator's own organization's display timezone, for the top-bar clock.
  // Everything else in the console stays UTC (see `@/lib/admin-format`).
  const timezone = await getOrganizationTimezone();

  return (
    <OrgTimezoneProvider timezone={timezone}>
      <AdminShell user={user}>{children}</AdminShell>
    </OrgTimezoneProvider>
  );
}
