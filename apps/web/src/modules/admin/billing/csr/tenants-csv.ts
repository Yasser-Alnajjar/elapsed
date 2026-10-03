import { buildCsv } from "@/lib/csv";
import { formatBillingDate, formatMoney, formatRate } from "@/lib/billing-format";
import { BILLING_PLAN_TIER_LABELS, type AdminBillingTenantRow } from "@/lib/types/admin-billing";
import { SUBSCRIPTION_STATUS_LABELS } from "@/lib/types/billing";

/** The directory as filtered and sorted, one row per tenant. */
export function tenantsToCsv(rows: AdminBillingTenantRow[]): string {
  return buildCsv(
    ["Tenant", "Organization id", "Owner", "Plan", "Status", "Seats used", "Seats licensed", "Rate", "MRR (USD)", "Next billing", "Open balance"],
    rows.map((row) => [
      row.name,
      row.id,
      row.ownerEmail ?? "",
      BILLING_PLAN_TIER_LABELS[row.tier],
      SUBSCRIPTION_STATUS_LABELS[row.status],
      row.seats.used,
      row.seats.licensed,
      row.rateCents === null ? "" : formatRate(row.rateCents, "month"),
      (row.mrrCents / 100).toFixed(2),
      formatBillingDate(row.nextBillingAt),
      formatMoney(row.openCents),
    ]),
  );
}
