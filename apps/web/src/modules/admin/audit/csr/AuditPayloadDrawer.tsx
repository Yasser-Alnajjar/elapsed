"use client";

import { ArrowRight, Check, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Fact, MonoLabel } from "@/components/admin/admin-ui";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { describeAuditChange, type AuditChange } from "@/lib/admin-audit-delta";
import { formatUtcTimestamp } from "@/lib/admin-format";
import type { AdminAuditRow } from "@/lib/types/admin";
import { cn } from "@/lib/utils";
import { ActionBadge } from "./ActionBadge";

type Tab = "decoded" | "raw";

/**
 * One entry in full: who, when, what, and the exact stored payload. Read-only.
 * The payload is what was written at the time, so what you read here is what
 * the log holds, not a re-derivation.
 */
export function AuditPayloadDrawer({
  row,
  onClose,
}: {
  row: AdminAuditRow | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("decoded");

  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl"
      >
        {row && <DrawerBody row={row} tab={tab} onTab={setTab} />}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({
  row,
  tab,
  onTab,
}: {
  row: AdminAuditRow;
  tab: Tab;
  onTab: (tab: Tab) => void;
}) {
  const change = describeAuditChange(row);
  const raw = JSON.stringify(
    {
      id: row.id,
      recordedAt: row.createdAt,
      operator: row.actorEmail,
      action: row.action,
      organizationId: row.organizationId,
      integrationId: row.integrationId,
      metadata: row.metadata ?? null,
    },
    null,
    2,
  );

  return (
    <>
      <div className="border-border flex flex-col gap-3 border-b px-5 pt-5 pb-4 pr-12">
        <MonoLabel>Audit entry</MonoLabel>
        <SheetTitle className="font-mono text-xl font-semibold break-all">
          {row.action}
        </SheetTitle>
        <SheetDescription className="sr-only">
          The stored details of one audit log entry.
        </SheetDescription>
        <div>
          <ActionBadge action={row.action} />
        </div>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Fact label="Recorded at" mono>
            {formatUtcTimestamp(row.createdAt)}
          </Fact>
          <Fact label="Operator" mono>
            {row.actorEmail}
          </Fact>
          <Fact label="Target">
            {row.organizationId ? (
              row.organizationName ? (
                <Link
                  href={`/admin/tenants/${row.organizationId}`}
                  className="text-primary inline-flex items-center gap-1 hover:underline"
                >
                  {row.organizationName}
                  <ArrowRight className="size-3" aria-hidden />
                </Link>
              ) : (
                <span className="text-foreground-subtle">
                  Deleted organization
                </span>
              )
            ) : (
              <span className="text-foreground-subtle">Platform</span>
            )}
          </Fact>
          <Fact label="Entry id" mono>
            {row.id}
          </Fact>
        </dl>
      </div>

      <div
        role="tablist"
        aria-label="Entry view"
        className="border-border flex border-b px-5"
      >
        {(
          [
            ["decoded", "Decoded change"],
            ["raw", "Raw payload"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => onTab(value)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2.5 font-mono text-xxs font-semibold tracking-[0.04em] uppercase transition-colors",
              tab === value
                ? "border-primary text-primary"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4 p-5">
        {tab === "decoded" ? (
          <Decoded change={change} action={row.action} />
        ) : (
          <RawPayload raw={raw} />
        )}
      </div>
    </>
  );
}

function Decoded({
  change: { entries, facts },
  action,
}: {
  change: AuditChange;
  action: string;
}) {
  if (entries.length === 0 && facts.length === 0) {
    return (
      <p className="text-muted-foreground text-sm leading-5">
        {action === "view_tenant"
          ? "This entry records that the operator opened the tenant detail. Nothing was changed."
          : "There is nothing to decode for this entry. The raw payload is the full record."}
      </p>
    );
  }

  return (
    <>
      {facts.length > 0 && (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {facts.map((fact) => (
            <Fact key={fact.label} label={fact.label} mono>
              {fact.value}
            </Fact>
          ))}
        </dl>
      )}
      {entries.length > 0 && (
        <div className="border-border overflow-hidden rounded border">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-surface-raised">
                <th className="px-3 py-2">
                  <MonoLabel>Field</MonoLabel>
                </th>
                <th className="px-3 py-2">
                  <MonoLabel>Before</MonoLabel>
                </th>
                <th className="px-3 py-2">
                  <MonoLabel>After</MonoLabel>
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {entries.map((entry) => (
                <tr key={entry.field}>
                  <td className="text-foreground px-3 py-2.5 font-mono text-xs">
                    {entry.field}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs">
                    <span className="text-error line-through decoration-1">
                      {entry.before ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs">
                    <span className="text-success font-semibold">
                      {entry.after ?? "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function RawPayload({ raw }: { raw: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the text is on screen to select by hand.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <MonoLabel>Stored payload (JSON)</MonoLabel>
        <button
          type="button"
          onClick={() => void copy()}
          className="border-border text-muted-foreground hover:border-primary hover:text-primary inline-flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-xxs font-semibold uppercase transition-colors"
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="bg-background border-border text-foreground max-h-[60vh] overflow-auto rounded border p-3.5 font-mono text-xs leading-5 whitespace-pre-wrap break-words">
        {raw}
      </pre>
    </div>
  );
}
