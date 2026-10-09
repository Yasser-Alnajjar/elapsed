"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/** `custom` has no OAuth app: connecting it means opening its guided wizard (N9). */
export function CustomConnectLink() {
  return (
    <Button size="sm" asChild>
      <Link href="/settings/integrations/custom">Set up Custom REST</Link>
    </Button>
  );
}
