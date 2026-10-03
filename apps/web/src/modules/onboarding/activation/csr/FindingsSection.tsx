import Link from "next/link";
import { Sparkles, Workflow } from "lucide-react";
import { DataTableCard } from "@/components/shared/data-table/data-table-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMinutes } from "@/lib/format";
import type { FindingsData } from "@/lib/types/findings";

/** Shown wherever engineering time would be, until a tracker is connected: a neutral "not yet", never a zero presented as a fact (N5.2). */
function NoTrackerNotice({ description }: { description: string }) {
  return (
    <EmptyState
      icon={Workflow}
      title="Engineering time appears once a tracker is connected"
      description={description}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/settings/integrations">Connect a work tracker</Link>
        </Button>
      }
    />
  );
}

function TopAccountsTable({
  accounts,
}: {
  accounts: FindingsData["topAccounts"];
}) {
  return (
    <div>
      <h3 className="font-label-caps text-label-caps mb-3 uppercase tracking-wider text-on-surface-variant">
        Top affected accounts
      </h3>
      <DataTableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead align="end">Escalations</TableHead>
              <TableHead align="end">Exceeded target</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => (
              <TableRow key={account.customerName}>
                <TableCell className="font-medium">
                  {account.customerName}
                </TableCell>
                <TableCell align="end" className="tabular-nums">
                  {account.escalatedCases}
                </TableCell>
                <TableCell align="end" className="tabular-nums">
                  {account.breachedCases}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTableCard>
    </div>
  );
}

/** What the 90-day backfill actually found — folded in from the old standalone "findings" page instead of a second screen. */
export function FindingsSection({
  findings,
  trackerLabel,
}: {
  findings: FindingsData;
  /** Null without a connected tracker: escalations cannot be counted yet. */
  trackerLabel: string | null;
}) {
  if (trackerLabel === null) {
    return (
      <NoTrackerNotice description="Support-side commitments are tracked already. Connect Jira, Linear or another tracker to see which tickets were escalated and how long they waited in engineering." />
    );
  }

  const hasFindings = findings.totalEscalated > 0;

  if (!hasFindings) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No escalations yet"
        description={`No tickets have been escalated to ${trackerLabel} in the last ${findings.periodDays} days. Once cases escalate and issues get linked, findings will appear here automatically — nothing to configure.`}
      />
    );
  }

  return (
    <div className="space-y-5 rounded-xl bg-surface-container p-6 shadow-elevated">
      <p className="font-body-md text-body-md text-on-surface">
        Over the last {findings.periodDays} days,{" "}
        <strong className="text-primary">{findings.totalEscalated}</strong>{" "}
        ticket{findings.totalEscalated === 1 ? " was" : "s were"} escalated to{" "}
        {trackerLabel}.{" "}
        <strong className="text-error">{findings.exceededTarget}</strong> of{" "}
        {findings.exceededTarget === 1 ? "it" : "them"} exceeded{" "}
        {findings.exceededTarget === 1 ? "its" : "their"} customer resolution
        target.
        {findings.avgEngineeringMinutes !== null && (
          <>
            {" "}
            Escalated tickets spent an average of{" "}
            <strong>
              {formatMinutes(findings.avgEngineeringMinutes)}
            </strong>{" "}
            waiting to be picked up in {trackerLabel}.
          </>
        )}
      </p>

      {findings.topAccounts.length > 0 && (
        <TopAccountsTable accounts={findings.topAccounts} />
      )}
    </div>
  );
}
