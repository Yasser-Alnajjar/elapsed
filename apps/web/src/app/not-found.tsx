import { SearchX } from "lucide-react";
import Link from "next/link";
import { RouteStatus } from "@/components/shared/route-status";
import { Button } from "@/components/ui/button";
import { noIndexMetadata } from "@/lib/seo/metadata";

export const metadata = noIndexMetadata("Page not found");

export default function RootNotFound() {
  return (
    <RouteStatus
      standalone
      icon={SearchX}
      title="Page not found"
      description="The page you're looking for doesn't exist or has moved."
      actions={
        <>
          <Button size="sm" asChild>
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/">Go home</Link>
          </Button>
        </>
      }
    />
  );
}
