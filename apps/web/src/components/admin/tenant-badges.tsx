import { Unplug } from "lucide-react";
import {
  PLAN_LABELS,
  PLAN_PRICE_LABELS,
  PLAN_STATUS_LABELS,
  type AdminTenantIntegrationRow,
  type AdminTenantRow,
  type PlanId,
  type PlanStatus,
  type TenantHealth,
} from "@/lib/types/admin";
import type { LinkCoverage } from "@/lib/types/link-coverage";
import { INTEGRATION_PROVIDER_LABELS } from "@/lib/types/integrations";
import { cn } from "@/lib/utils";
import { StatusDot, Tag, TONE_SURFACE, TONE_TEXT } from "./admin-ui";

type Tone = "neutral" | "primary" | "success" | "warning" | "danger";

const HEALTH: Record<
  TenantHealth,
  { label: string; glyph: string | null; tone: Tone }
> = {
  healthy: { label: "Healthy", glyph: "●", tone: "success" },
  attention: { label: "Needs a look", glyph: "▲", tone: "warning" },
  unhealthy: { label: "Unhealthy", glyph: "✕", tone: "danger" },
  none: { label: "No integrations", glyph: null, tone: "neutral" },
};

/** One word and a colour per tenant. The glyph carries the meaning too, so it is not colour alone. */
export function HealthBadge({
  health,
  className,
}: {
  health: TenantHealth;
  className?: string;
}) {
  const { label, glyph, tone } = HEALTH[health];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-xxs leading-4 font-bold tracking-[0.04em] whitespace-nowrap uppercase",
        TONE_SURFACE[tone],
        className,
      )}
    >
      {glyph ? (
        <span aria-hidden className="text-[10px]">
          {glyph}
        </span>
      ) : (
        <Unplug aria-hidden className="size-3" />
      )}
      {label}
    </span>
  );
}

/** The glyph and tone of a health value, for filter chips that carry their own label and count. */
export function healthPresentation(health: TenantHealth) {
  return HEALTH[health];
}

const PLAN_STATUS_TONE: Record<PlanStatus, Tone> = {
  trial: "primary",
  active: "success",
  past_due: "warning",
  cancelled: "danger",
  internal: "neutral",
};

export function planStatusTone(status: PlanStatus): Tone {
  return PLAN_STATUS_TONE[status];
}

export function PlanStatusBadge({ status }: { status: PlanStatus }) {
  return (
    <Tag tone={PLAN_STATUS_TONE[status]}>{PLAN_STATUS_LABELS[status]}</Tag>
  );
}

/** "TEAM $149", or an italic "Not recorded". */
export function PlanChip({ plan }: { plan: string | null }) {
  if (plan === null)
    return (
      <span className="text-foreground-subtle font-mono text-xxs italic">
        Not recorded
      </span>
    );
  const price = PLAN_PRICE_LABELS[plan as PlanId];
  return (
    <Tag className="bg-surface-hover text-foreground border-transparent">
      {formatPlan(plan)}
      {price && <span className="text-muted-foreground">{price}</span>}
    </Tag>
  );
}

/** The plan's display name; "Not recorded" for a tenant whose plan has not been filled in yet. */
export function formatPlan(plan: string | null): string {
  if (plan === null) return "Not recorded";
  return PLAN_LABELS[plan as PlanId] ?? plan;
}

/** "62% (31 of 50)", or "No cases" when there is nothing to measure. */
export function formatLinkCoverage(coverage: LinkCoverage): string {
  if (coverage.ratio === null) return "No recent cases";
  return `${Math.round(coverage.ratio * 100)}% (${coverage.linkedCases} of ${coverage.cases})`;
}

/** What an operator needs to know about one integration in one word and a colour. */
export function integrationState(
  row: Pick<
    AdminTenantIntegrationRow,
    "status" | "failingSince" | "lastSyncError" | "pollingPausedAt" | "stale"
  >,
): { label: string; tone: Tone } {
  if (row.status === "disconnected")
    return { label: "Disconnected", tone: "neutral" };
  if (row.status === "reauth_required")
    return { label: "Needs reconnect", tone: "danger" };
  if (row.status === "permission_denied")
    return { label: "Access lost", tone: "danger" };
  if (row.pollingPausedAt) return { label: "Paused", tone: "neutral" };
  if (row.failingSince) return { label: "Failing", tone: "danger" };
  if (row.stale) return { label: "Stale", tone: "warning" };
  return { label: "Syncing", tone: "success" };
}

/** `● Zendesk  SYNCING`: one integration's provider and state on one line. */
export function IntegrationChip({
  row,
  className,
  children,
}: {
  row: AdminTenantIntegrationRow;
  className?: string;
  children?: React.ReactNode;
}) {
  const { label, tone } = integrationState(row);
  return (
    <div
      title={row.lastSyncError ?? undefined}
      className={cn(
        "flex items-center justify-between gap-3 rounded px-2 py-1 text-xxs",
        tone === "danger"
          ? "bg-error/10"
          : tone === "warning"
            ? "bg-warning/10"
            : "bg-background/60",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <StatusDot tone={tone} pulse={tone === "danger"} />
        <span className="text-foreground truncate font-medium">
          {INTEGRATION_PROVIDER_LABELS[row.provider]}
        </span>
        <span
          className={cn(
            "font-mono text-[10px] font-semibold tracking-[0.06em] uppercase",
            TONE_TEXT[tone],
          )}
        >
          {label}
        </span>
      </span>
      {children}
    </div>
  );
}

/** Up to two short reasons behind a tenant's health word, worst first. Never customer content. */
export function tenantHealthReasons(
  tenant: Pick<
    AdminTenantRow,
    "health" | "integrations" | "notificationsFailed24h"
  >,
): string[] {
  if (tenant.health === "none") return ["Nothing connected"];
  const reasons: string[] = [];
  for (const integration of tenant.integrations) {
    const { label, tone } = integrationState(integration);
    if (tone !== "success" && integration.status !== "disconnected") {
      reasons.push(
        `${INTEGRATION_PROVIDER_LABELS[integration.provider]} · ${label.toLowerCase()}`,
      );
    }
  }
  if (tenant.notificationsFailed24h > 0) {
    reasons.push(
      `${tenant.notificationsFailed24h} alert deliver${tenant.notificationsFailed24h === 1 ? "y" : "ies"} failing`,
    );
  }
  if (reasons.length === 0) return ["Every integration is syncing"];
  return reasons.slice(0, 2);
}
