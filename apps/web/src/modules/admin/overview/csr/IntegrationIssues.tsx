import {
  ArrowRight,
  CircleAlert,
  Clock,
  PauseCircle,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import {
  AdminPanel,
  Fact,
  Tag,
  TONE_SURFACE,
} from "@/components/admin/admin-ui";
import { describeIntegrationIssue } from "@/lib/admin-integration-issue";
import { shortId } from "@/lib/admin-format";
import { INTEGRATION_PROVIDER_LABELS } from "@/lib/types/integrations";
import type { OperatorIntegrationHealthRow } from "@/lib/types/operator";
import { cn } from "@/lib/utils";

interface TenantIssues {
  organizationId: string;
  organizationName: string | null;
  rows: OperatorIntegrationHealthRow[];
}

/** Groups rows by organization, keeping the order they arrived in, so one outage reads as one problem. */
export function groupIssuesByTenant(
  rows: OperatorIntegrationHealthRow[],
): TenantIssues[] {
  const groups = new Map<string, TenantIssues>();
  for (const row of rows) {
    const group = groups.get(row.organizationId) ?? {
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      rows: [],
    };
    group.rows.push(row);
    groups.set(row.organizationId, group);
  }
  return [...groups.values()];
}

export function IntegrationIssues({
  rows,
}: {
  rows: OperatorIntegrationHealthRow[];
}) {
  return (
    <ul className="flex flex-col gap-3">
      {groupIssuesByTenant(rows).map((group) => (
        <li key={group.organizationId}>
          <AdminPanel className="overflow-hidden">
            <div className="bg-surface-raised border-border flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-foreground text-base font-semibold">
                  {group.organizationName ?? "Unnamed organization"}
                </span>
                <Tag title={group.organizationId} className="text-primary">
                  {shortId(group.organizationId)}
                </Tag>
                {group.rows.length > 1 && (
                  <span className="text-foreground-subtle font-mono text-xxs">
                    {group.rows.length} integrations affected
                  </span>
                )}
              </div>
              <Link
                href={`/admin/tenants/${group.organizationId}`}
                className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex items-center gap-1.5 rounded px-3 py-1.5 font-mono text-xxs font-semibold tracking-[0.04em] uppercase transition-colors"
              >
                Inspect tenant
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            </div>
            <ul className="divide-border divide-y">
              {group.rows.map((row) => (
                <IssueBlock
                  key={`${row.organizationId}:${row.provider}`}
                  row={row}
                />
              ))}
            </ul>
          </AdminPanel>
        </li>
      ))}
    </ul>
  );
}

function IssueBlock({ row }: { row: OperatorIntegrationHealthRow }) {
  const issue = describeIntegrationIssue(row);
  const Icon = row.pollingPausedAt
    ? PauseCircle
    : issue.label === "Stale"
      ? Clock
      : CircleAlert;

  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded border",
            TONE_SURFACE[issue.tone],
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-foreground text-sm font-semibold">
              {INTEGRATION_PROVIDER_LABELS[row.provider]}
            </h3>
            <Tag tone={issue.tone}>{issue.label}</Tag>
          </div>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {issue.headline}
          </p>
          {issue.note && (
            <p className="text-foreground-subtle mt-0.5 text-xs leading-4">
              {issue.note}
            </p>
          )}
        </div>
      </div>

      <dl className="bg-background/60 border-border grid gap-x-6 gap-y-3 rounded border px-3.5 py-3 sm:grid-cols-2 lg:grid-cols-3">
        {issue.facts.map((fact) => (
          <Fact key={fact.label} label={fact.label} mono tone={fact.tone}>
            {fact.value}
          </Fact>
        ))}
      </dl>

      {issue.error && (
        <div className="border-error/30 bg-error/[0.07] flex items-start gap-2.5 rounded border px-3.5 py-2.5">
          <Terminal
            className="text-error mt-0.5 size-3.5 shrink-0"
            aria-hidden
          />
          <div className="min-w-0">
            <span className="text-error font-mono text-[10px] font-semibold tracking-[0.08em] uppercase">
              Last error
            </span>
            <p className="text-foreground mt-0.5 font-mono text-xs leading-5 break-words">
              {issue.error}
            </p>
          </div>
        </div>
      )}
    </li>
  );
}
