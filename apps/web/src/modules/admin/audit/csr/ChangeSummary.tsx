import { ArrowRight } from "lucide-react";
import { describeAuditChange } from "@/lib/admin-audit-delta";
import type { AdminAuditRow } from "@/lib/types/admin";

const dash = "—";

/**
 * A row's change at a glance: fields as `before → after` (the old value struck
 * through), or plain facts like the provider. Rows with nothing to decode show
 * a quiet dash; the raw payload is one click away in the drawer.
 */
export function ChangeSummary({ row }: { row: AdminAuditRow }) {
  const { entries, facts } = describeAuditChange(row);

  if (row.action === "view_tenant") {
    return (
      <span className="text-foreground-subtle font-mono text-xs">
        Opened the tenant detail
      </span>
    );
  }
  if (entries.length === 0 && facts.length === 0)
    return (
      <span className="text-foreground-subtle font-mono text-xs">{dash}</span>
    );

  return (
    <ul className="flex flex-wrap gap-1.5">
      {entries.map((entry) => (
        <li
          key={entry.field}
          className="bg-surface-raised flex items-center gap-1.5 rounded px-2 py-1 font-mono text-xxs"
        >
          <span className="text-foreground-subtle">{entry.field}</span>
          <span className="text-error line-through decoration-1">
            {entry.before ?? dash}
          </span>
          <ArrowRight className="text-foreground-subtle size-3" aria-hidden />
          <span className="text-success font-semibold">
            {entry.after ?? dash}
          </span>
        </li>
      ))}
      {facts.map((fact) => (
        <li
          key={fact.label}
          className="bg-surface-raised flex items-center gap-1.5 rounded px-2 py-1 font-mono text-xxs"
        >
          <span className="text-foreground-subtle">{fact.label}</span>
          <span className="text-foreground max-w-40 truncate">
            {fact.value}
          </span>
        </li>
      ))}
    </ul>
  );
}
