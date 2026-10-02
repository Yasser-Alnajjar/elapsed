import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";
import { requirePlatformAdminPage } from "@/lib/admin-auth";

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
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { actorEmail } = await requirePlatformAdminPage();

  return <AdminShell actorEmail={actorEmail}>{children}</AdminShell>;
}
