import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  GitBranch,
  GitPullRequest,
  LifeBuoy,
  ShieldCheck,
  Ticket,
  Workflow,
} from "lucide-react";
import { Reveal } from "@/components/shared/reveal";
import { formatLongDateTime } from "@/lib/format";
import type { IntegrationProvider } from "@/lib/types/integrations";
import {
  descriptionClass,
  iconWrapper,
  labelClass,
  StatusPill,
} from "./detail-primitives";

const PROVIDER_ICONS: Record<IntegrationProvider, ReactNode> = {
  zendesk: <Ticket className="size-4" />,
  jira: <GitBranch className="size-4" />,
  linear: <Workflow className="size-4" />,
  intercom: <LifeBuoy className="size-4" />,
  github: <GitPullRequest className="size-4" />,
};

/** Back link and ingress ID bar, then the provider's name, connection date and status pills. */
export function IntegrationDetailHeader({
  provider,
  label,
  integrationId,
  connectedAt,
  disconnectedAt,
  reauthRequired,
  permissionDenied,
}: {
  provider: IntegrationProvider;
  label: string;
  integrationId: string;
  connectedAt: Date;
  /** Set while disconnected: the page stays reachable, with its imported data retained. */
  disconnectedAt: Date | null;
  reauthRequired: boolean;
  permissionDenied: boolean;
}) {
  return (
    <>
      <div className="w-full flex flex-wrap items-center justify-between gap-4 bg-surface-container-low px-6 py-2 rounded-xl">
        <Link
          href="/settings/integrations"
          className="inline-flex items-center gap-1.5 font-mono text-xs text-primary transition-colors hover:text-primary-fixed"
        >
          <ArrowLeft className="size-4" />
          Back to Integrations
        </Link>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className={labelClass}>Ingress ID:</span>
          <span className="bg-surface-container text-on-surface max-w-56 truncate rounded px-2 py-0.5 font-mono text-xs">
            {integrationId}
          </span>
        </div>
      </div>

      <Reveal>
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-3">
              <span className={iconWrapper}>{PROVIDER_ICONS[provider]}</span>
              <h1 className="font-display text-on-surface text-3xl font-semibold tracking-tight">
                {label}
              </h1>
            </div>
            <p className={descriptionClass}>
              {disconnectedAt
                ? `Disconnected ${formatLongDateTime(disconnectedAt)} — imported data is retained`
                : `Connected ${formatLongDateTime(connectedAt)} via read-only access`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <StatusPill
              tone={
                disconnectedAt
                  ? "neutral"
                  : reauthRequired || permissionDenied
                    ? "warning"
                    : "success"
              }
              pulse={!disconnectedAt && !reauthRequired && !permissionDenied}
            >
              {disconnectedAt
                ? "Disconnected"
                : reauthRequired
                  ? "Needs reconnect"
                  : permissionDenied
                    ? "Access restricted"
                    : "Connected"}
            </StatusPill>
            <span className="bg-surface-container text-on-surface-variant inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xxs font-semibold uppercase tracking-wider shadow-sm">
              <ShieldCheck className="size-3.5" />
              Read-only ingestion
            </span>
          </div>
        </div>
      </Reveal>
    </>
  );
}
