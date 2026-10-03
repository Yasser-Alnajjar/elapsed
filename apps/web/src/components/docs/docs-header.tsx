import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function DocsHeader() {
  const session = await getServerSession(authOptions);
  const isAuthenticated = !!session?.user;
  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/60">
      <SidebarTrigger className="-ml-1" />

      <Separator orientation="vertical" className="mr-2 h-4" />

      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-semibold">Documentation</span>

        <span className="hidden text-sm text-muted-foreground sm:inline">
          Elapsed
        </span>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        {isAuthenticated ? (
          <Button asChild size="sm" variant={"ghost"}>
            <Link href="/dashboard">Dashboard</Link>
          </Button>
        ) : (
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/sign-in">Sign in</Link>
            </Button>

            <Button asChild size="sm">
              <Link href="/sign-up">Get started</Link>
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
