import { BellRing, Timer, Users } from "lucide-react";
import Link from "next/link";
import { SectionTitle, StatTile, Tag } from "@/components/admin/admin-ui";
import { DataTableCard } from "@/components/shared/data-table/data-table-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatUtcShort } from "@/lib/admin-format";
import type { AdminUsageData } from "@/lib/types/admin";
import { cn } from "@/lib/utils";

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** "23 min", "4.5 h", "2.1 d": whichever unit keeps the number short. */
function formatDuration(minutes: number): string {
  if (minutes < 90) return `${Math.round(minutes)} min`;
  if (minutes < 48 * 60) return `${Math.round((minutes / 60) * 10) / 10} h`;
  return `${Math.round((minutes / 1440) * 10) / 10} d`;
}

/**
 * The validation metrics (N5.7), measured from what the app records itself:
 * `User.lastSeenAt`, `Notification.openedAt` and `Organization.firstFindingsViewedAt`.
 * Organizations that have not been seen this week lead the table, because those
 * are the ones to ask why.
 */
export function UsageSection({ usage }: { usage: AdminUsageData }) {
  const { weeklyActiveOrganizations: active, organizationCount: total } = usage;

  return (
    <section aria-labelledby="usage" className="flex flex-col gap-3">
      <SectionTitle
        tone="primary"
        title={<span id="usage">Usage</span>}
        description={`Weekly activity, alert click-through (last ${usage.alertWindowDays} days) and time to first value, per organization.`}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Weekly active organizations"
          icon={Users}
          value={
            <>
              {active}
              <span className="text-foreground-subtle text-xl font-medium"> / {total}</span>
            </>
          }
          detail={`${usage.weeklyActiveUsers} member${usage.weeklyActiveUsers === 1 ? "" : "s"} seen in the last ${usage.activeWindowDays} days.`}
        />
        <StatTile
          label="Alert click-through"
          icon={BellRing}
          value={usage.alerts.clickThroughRatio === null ? "—" : percent(usage.alerts.clickThroughRatio)}
          detail={
            usage.alerts.sent === 0
              ? "No alerts delivered in this window."
              : `${usage.alerts.opened} of ${usage.alerts.sent} delivered alerts opened from their link.`
          }
        />
        <StatTile
          label="Median time to first value"
          icon={Timer}
          value={usage.timeToFirstValue.medianMinutes === null ? "—" : formatDuration(usage.timeToFirstValue.medianMinutes)}
          detail={`${usage.timeToFirstValue.organizations} of ${total} organization${total === 1 ? "" : "s"} have seen their findings.`}
        />
      </div>

      {usage.organizations.length > 0 && (
        <DataTableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organization</TableHead>
                <TableHead>Last seen (UTC)</TableHead>
                <TableHead>Alerts opened / sent</TableHead>
                <TableHead>Time to first value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.organizations.map((row) => (
                <TableRow key={row.organizationId}>
                  <TableCell>
                    <Link href={`/admin/tenants/${row.organizationId}`} className="text-foreground font-medium underline-offset-2 hover:underline">
                      {row.name}
                    </Link>{" "}
                    {!row.activeThisWeek && <Tag tone="warning">not seen this week</Tag>}
                  </TableCell>
                  <TableCell nowrap className="text-muted-foreground font-mono text-xs tabular-nums">
                    {row.lastSeenAt ? formatUtcShort(row.lastSeenAt) : "never"}
                  </TableCell>
                  <TableCell nowrap className={cn("font-mono text-xs tabular-nums", row.alertsSent30d > 0 && row.alertsOpened30d === 0 && "text-warning")}>
                    {row.alertsOpened30d} / {row.alertsSent30d}
                  </TableCell>
                  <TableCell nowrap className="text-muted-foreground font-mono text-xs tabular-nums">
                    {row.minutesToFirstValue === null ? "not yet" : formatDuration(row.minutesToFirstValue)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTableCard>
      )}
    </section>
  );
}
