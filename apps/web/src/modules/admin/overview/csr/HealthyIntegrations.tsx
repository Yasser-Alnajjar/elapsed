"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { AdminPanel, CountBadge } from "@/components/admin/admin-ui";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { formatUtcShort } from "@/lib/admin-format";
import { INTEGRATION_PROVIDER_LABELS } from "@/lib/types/integrations";
import type { OperatorHealthyIntegrationRow } from "@/lib/types/operator";

/** What "fine" looks like: every integration syncing cleanly, collapsed by default once there are many. */
export function HealthyIntegrations({
  rows,
  total,
}: {
  rows: OperatorHealthyIntegrationRow[];
  total: number;
}) {
  return (
    <AdminPanel>
      <Accordion
        type="single"
        collapsible
        defaultValue={total <= 12 ? "healthy" : undefined}
      >
        <AccordionItem value="healthy" className="border-b-0">
          <AccordionTrigger
            icon={null}
            className="w-full items-center justify-between gap-3 rounded-none border-0 px-4 py-3 text-base font-normal hover:no-underline"
          >
            <span className="flex items-center gap-2.5">
              <ChevronDown
                className="text-muted-foreground size-4 transition-transform group-data-[state=closed]/accordion-trigger:-rotate-90"
                aria-hidden
              />
              <span className="text-foreground text-lg font-semibold tracking-tight">
                Healthy integrations
              </span>
              <CountBadge count={total} tone="success">
                syncing cleanly
              </CountBadge>
            </span>
          </AccordionTrigger>

          <AccordionContent className="border-border border-t p-4">
            {rows.length === 0 ? (
              <p className="text-foreground-subtle text-sm">
                No integration is connected yet.
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {rows.map((row) => (
                  <li
                    key={`${row.organizationId}:${row.provider}`}
                    className="bg-background/60 border-border flex flex-col gap-2 rounded border px-3.5 py-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/admin/tenants/${row.organizationId}`}
                        className="text-foreground hover:text-primary truncate text-sm font-semibold"
                      >
                        {row.organizationName ?? "Unnamed organization"}
                      </Link>
                      <span className="text-success font-mono text-[10px] font-semibold tracking-[0.06em]">
                        ● SYNCING
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 font-mono text-xxs">
                      <span className="text-muted-foreground">
                        {INTEGRATION_PROVIDER_LABELS[row.provider]}
                      </span>
                      <span
                        className="text-foreground-subtle"
                        title="Last successful sync (UTC)"
                      >
                        {formatUtcShort(row.lastSuccessfulSyncAt)}
                      </span>
                    </div>
                    <div className="bg-success h-0.5 w-full rounded-full" />
                  </li>
                ))}
              </ul>
            )}
            {total > rows.length && (
              <p className="text-foreground-subtle mt-3 font-mono text-xxs">
                +{total - rows.length} more not shown.
              </p>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </AdminPanel>
  );
}
