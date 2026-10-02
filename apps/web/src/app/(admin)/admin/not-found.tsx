import { SearchX } from "lucide-react";
import Link from "next/link";
import { AdminPanel, MonoLabel } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";

/** Inside the admin shell: an unknown tenant id. (A non-operator never reaches this; they get the root not-found.) */
export default function AdminNotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-10">
      <AdminPanel className="flex flex-col items-start gap-4 p-6">
        <span className="bg-surface-raised border-border text-muted-foreground flex size-11 items-center justify-center rounded border">
          <SearchX className="size-5" aria-hidden />
        </span>
        <div>
          <MonoLabel>404 · Not found</MonoLabel>
          <h1 className="text-foreground mt-0.5 text-2xl font-semibold tracking-tight">There is no such organization</h1>
          <p className="text-muted-foreground mt-1 text-sm leading-5">
            It may have been deleted, or the id in the address is wrong. The audit log keeps its history either way.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild className="font-mono text-xs">
            <Link href="/admin/tenants">All tenants</Link>
          </Button>
          <Button asChild variant="outline" className="font-mono text-xs">
            <Link href="/admin/audit">Audit log</Link>
          </Button>
        </div>
      </AdminPanel>
    </div>
  );
}
