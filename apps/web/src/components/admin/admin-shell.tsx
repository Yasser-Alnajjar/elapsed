"use client";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AdminOperatorProvider } from "./admin-operator-context";
import { AdminSidebar } from "./admin-sidebar";
import { AdminTopbar } from "./admin-topbar";
import type { IUser } from "@/lib/types/user";

/**
 * Frame for every `/admin` page, built on the app's shadcn `Sidebar`: the
 * admin navigation on the left (collapsible to icons, a sheet on a phone), a
 * sticky top bar (tenant search, UTC clock, theme, the signed-in operator) and
 * the page. Deliberately not the tenant app's shell, so nothing about it can
 * leak into a customer's UI.
 */
export function AdminShell({
  user,
  children,
}: {
  user: IUser;
  children: React.ReactNode;
}) {
  return (
    <AdminOperatorProvider actorEmail={user.email?.toLowerCase() ?? "-"}>
      <SidebarProvider defaultOpen={false}>
        <AdminSidebar user={user} />
        {/* `SidebarInset` is the page's <main> landmark. */}
        <SidebarInset>
          <AdminTopbar user={user} />
          <div className="mx-auto w-full max-w-[1680px] min-w-0 flex-1 px-4 py-5 lg:px-6 lg:py-6">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </AdminOperatorProvider>
  );
}
