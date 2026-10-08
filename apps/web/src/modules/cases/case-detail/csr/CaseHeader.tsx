"use client";

import { Check, Copy, ExternalLink, Link2, RefreshCw } from "lucide-react";
import { useOrgTimezone } from "@/components/shared/org-timezone-provider";
import { useRouter } from "next/navigation";

import { PriorityTierChip } from "@/components/shared/priority-tier-chip";
import { Reveal } from "@/components/shared/reveal";
import {
  formatCaseKey,
  formatDateTime,
  formatLeg,
  formatPriorityTier,
  formatPriorityTierName,
  formatTicketSource,
} from "@/lib/format";
import type { CaseDetailData } from "@/lib/types/cases";

import { CaseRunwayHero, pickHeroCommitment } from "./CaseRunwayHero";
import { Button } from "@/components/ui/button";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";

/**
 * Customer (account/company) and Requester (the individual who submitted
 * the ticket) are distinct concepts and must never be merged.
 */
export function formatCaseIdentity(
  customerName: string | null,
  requesterName: string | null,
): string {
  if (customerName && requesterName)
    return `${customerName} · Requester: ${requesterName}`;
  if (customerName) return customerName;
  if (requesterName) return `Requester: ${requesterName}`;
  return "—";
}

/** Copyable dual-key chip — "ZD-8921" or "ZD-8921 / ENG-4102" (the case key carries its own ticket source's prefix) */
function CopyKeysButton({ reference }: { reference: string }) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <Button
      type="button"
      variant="bare"
      size="compact"
      onClick={() => copy(reference)}
      className="bg-surface-container-high text-on-surface hover:bg-surface-container-highest font-mono text-xs font-normal"
    >
      {copied ? (
        <Check className="size-3.5 text-tertiary" />
      ) : (
        <Copy className="size-3.5 text-outline" />
      )}
      Copy Keys
    </Button>
  );
}

export function CaseHeader({ data }: { data: CaseDetailData }) {
  const timeZone = useOrgTimezone();
  const { case: c, currentLeg } = data;
  const router = useRouter();

  const primaryLink = data.links[0] ?? null;
  const caseKey = formatCaseKey(c.system, c.externalId);
  const engKey = primaryLink?.externalId ?? null;
  const caseReference = engKey ? `${caseKey} / ${engKey}` : caseKey;

  const heroCommitment = pickHeroCommitment(data.commitments);

  const priorityTier = formatPriorityTier(c.priority);
  const identity = formatCaseIdentity(c.customerName, c.requesterName);

  return (
    <Reveal delay={0.05}>
      <div className="w-full flex flex-wrap items-center justify-between gap-4 bg-surface-container-low px-6 py-2 rounded-xl">
        <div className="flex items-center gap-1 font-mono text-sm leading-4.5">
          <span className="text-outline">Cases</span>
          <span className="text-muted-foreground">/</span>
          {(c.customerName ?? c.requesterName) && (
            <>
              <span className="text-outline">
                {c.customerName ?? c.requesterName}
              </span>
              <span className="text-muted-foreground">/</span>
            </>
          )}
          <span className="font-medium text-primary">
            {caseKey}
            {engKey && (
              <>
                {" ↔ "}
                <span className="text-leg-engineering-text">{engKey}</span>
              </>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-nowrap flex items-center gap-1.5 rounded bg-surface-container-high px-2.5 py-1 font-mono text-xxs font-semibold uppercase tracking-wider text-tertiary">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-tertiary opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-tertiary" />
            </span>
            LIVE TELEMETRY STREAM
          </div>

          <CopyKeysButton reference={caseReference} />

          <Button
            type="button"
            variant="tonal"
            size="compact"
            onClick={() => router.refresh()}
          >
            <RefreshCw className="size-4" />
            Recalculate Run
          </Button>

          {c.ticketUrl && (
            <Button asChild variant="tonal" size="compact">
              <a href={c.ticketUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" />
                Open in {formatTicketSource(c.system)}
              </a>
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-col justify-between gap-6 rounded-xl bg-surface-container-low p-6 shadow-sm lg:flex-row lg:items-center">
        {/* Left: identity */}
        <div className="flex max-w-3xl flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {priorityTier && (
              <PriorityTierChip priority={c.priority} className="px-2">
                {priorityTier} — {formatPriorityTierName(priorityTier)}
              </PriorityTierChip>
            )}

            <span className="rounded bg-surface-container-highest px-2 py-0.5 font-mono text-xs text-primary">
              {caseKey}
            </span>

            {engKey && (
              <>
                <span className="text-sm text-outline">↔</span>
                <span className="rounded bg-surface-container-highest px-2 py-0.5 font-mono text-xs text-leg-engineering-text">
                  {engKey}
                </span>
              </>
            )}

            {primaryLink && (
              <span className="inline-flex items-center gap-1 rounded bg-tertiary-container px-2 py-0.5 font-mono text-xxs font-semibold uppercase tracking-wider text-on-tertiary-container">
                <Link2 className="size-3" />
                LINKED — {primaryLink.confidence.toUpperCase()}
              </span>
            )}

            {(c.customerName ?? c.tier) && (
              <span className="text-sm text-outline">
                {c.customerName}
                {c.tier && ` • ${c.tier}`}
              </span>
            )}
          </div>

          <h1 className="font-semibold tracking-tight text-3xl leading-9 text-on-surface">
            {c.subject ?? identity}
          </h1>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-outline">
            <span>
              Source:{" "}
              <strong className="text-on-surface">
                {formatTicketSource(c.system)}
              </strong>
            </span>
            {c.assigneeName && (
              <>
                <span>•</span>
                <span>
                  Support Assignee:{" "}
                  <strong className="text-on-surface">{c.assigneeName}</strong>
                </span>
              </>
            )}
            <span>•</span>
            <span>
              {c.closedAt
                ? `Resolved ${formatDateTime(c.closedAt, timeZone)}`
                : `Currently in ${formatLeg(currentLeg)}`}
            </span>
          </div>
        </div>

        {/* Right: hero runway callout */}
        {heroCommitment && (
          <CaseRunwayHero
            commitment={heroCommitment}
            currentLeg={currentLeg}
            linkedIssueLabel={engKey}
          />
        )}
      </div>
    </Reveal>
  );
}
