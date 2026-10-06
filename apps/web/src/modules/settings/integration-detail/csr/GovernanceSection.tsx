"use client";

import { ExternalLink, Link2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { IntegrationDetailData } from "@/lib/types/integrations";
import { DisconnectButton } from "../../integrations/csr/DisconnectButton";
import { CleanupDataButton } from "../../data/csr/CleanupDataButton";
import { labelClass, SectionBadge, SectionCard } from "./detail-primitives";

/** Where an admin manages this provider's OAuth app / developer account — shown always, not just while unconfigured, so it's easy to find again later. */
function providerAppUrl({
  provider,
  subdomain,
  repo,
}: Pick<IntegrationDetailData, "provider" | "subdomain" | "repo">): string {
  switch (provider) {
    case "zendesk":
      return `https://${subdomain}.zendesk.com`;
    case "jira":
      return `https://${subdomain}.atlassian.net/jira`;
    case "linear":
      return "https://linear.app";
    case "intercom":
      return "https://intercom.com";
    case "github":
      return repo ? `https://github.com/${repo}` : "https://github.com";
  }
}

/** Provider console link, the zero write-back promise, and the disconnect control. */
export function GovernanceSection({
  provider,
  label,
  subdomain,
  repo,
  disconnected,
  importedData,
}: Pick<
  IntegrationDetailData,
  "provider" | "subdomain" | "repo" | "disconnected" | "importedData"
> & {
  label: string;
}) {
  return (
    <SectionCard
      icon={<Link2 className="size-4" />}
      title="Provider app & governance"
      description={`${label} integration settings and mutation safety covenant`}
      badge={
        <SectionBadge
          tone="primary"
          icon={<ShieldCheck className="size-3.5" />}
        >
          External registered
        </SectionBadge>
      }
    >
      {!disconnected && (
        <div className="bg-surface-container flex flex-col justify-between gap-3 rounded-lg p-4 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-1">
            <span className={labelClass}>{label} console</span>
            <span className="text-on-surface font-mono text-sm font-medium">
              Manage the OAuth app and access in {label}
            </span>
          </div>
          <Button variant="surface" size="sm" className="self-start" asChild>
            <a
              href={providerAppUrl({ provider, subdomain, repo })}
              target="_blank"
              rel="noreferrer"
            >
              Open {label}
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        </div>
      )}

      <div className="bg-surface-container flex items-start gap-3 rounded-lg p-4">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-tertiary/10 text-tertiary">
          <ShieldCheck className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xxs font-semibold uppercase text-tertiary">
            Zero write-back guarantee
          </span>
          <p className="text-xs leading-relaxed text-on-surface-variant">
            Elapsed does not request or store write credentials. Everything in
            your {label} instance remains strictly immutable — events are
            ingested passively via read-only access.
          </p>
        </div>
      </div>

      {!disconnected && (
        <div className="bg-error-container/10 flex flex-col justify-between gap-3 rounded-lg p-4 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-xxs font-semibold uppercase text-error">
              Integration severing control
            </span>
            <p className="text-xs text-on-surface-variant">
              Disconnecting halts all ingestion from {label}. Existing cases and
              history remain unchanged.
            </p>
          </div>
          <DisconnectButton provider={provider} providerLabel={label} />
        </div>
      )}

      <div className="bg-error-container/10 flex flex-col justify-between gap-3 rounded-lg p-4 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xxs font-semibold uppercase text-error">
            Imported data cleanup
          </span>
          <p className="text-xs text-on-surface-variant">
            {disconnected
              ? `Permanently delete the data imported from ${label}. Disconnecting never does this.`
              : `Disconnect ${label} first to clean up the data it imported.`}
          </p>
        </div>
        <CleanupDataButton
          provider={provider}
          providerLabel={label}
          counts={importedData}
          disabled={!disconnected}
        />
      </div>
    </SectionCard>
  );
}
