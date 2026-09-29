"use client";

import { ExternalLink } from "lucide-react";

import {
  formatCaseLinkMethod,
  formatDateTime,
  formatNormalizedState,
  formatTicketSource,
} from "@/lib/format";
import type { CaseDetailData, CaseLinkDetail } from "@/lib/types/cases";

function systemLabel(s: CaseLinkDetail["system"] | string): string {
  switch (s) {
    case "zendesk": return "Zendesk";
    case "jira":    return "Jira Software";
    case "linear":  return "Linear";
    case "github":  return "GitHub";
    default:        return s;
  }
}

export function LinkedRecords({ data }: { data: CaseDetailData }) {
  const primaryJira = data.links.find((l) => l.system === "jira") ?? null;
  const extraLinks  = data.links.filter((l) => l !== primaryJira);

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-surface-container-low p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-leg-engineering-text">⬡</span>
          <h2 className="text-xl font-semibold tracking-tight text-on-surface">
            Deterministic Correlation &amp; Linked Records
          </h2>
        </div>

        {primaryJira ? (
          <span className="inline-flex items-center gap-1.5 rounded bg-tertiary-container px-2.5 py-1 font-mono text-xxs font-semibold uppercase tracking-wider text-on-tertiary-container">
            <span className="size-1.5 rounded-full bg-on-tertiary-container" />
            LINK {primaryJira.confidence.toUpperCase()}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded bg-surface-container-highest px-2.5 py-1 font-mono text-xxs text-outline">
            UNLINKED
          </span>
        )}
      </div>

      {/* Side-by-side ZD ↔ Jira cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Zendesk card */}
        <div className="flex flex-col gap-2 rounded-lg bg-surface-container p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xxs font-semibold uppercase tracking-wider text-outline">
              Primary Customer Ticket
            </span>
            <span className="rounded bg-primary-container/20 px-2 py-0.5 font-mono text-xxs text-primary">
              {formatTicketSource(data.case.system)}
            </span>
          </div>

          {data.case.ticketUrl ? (
            <a
              href={data.case.ticketUrl}
              target="_blank"
              rel="noreferrer"
              className="group inline-flex items-center gap-1 text-on-surface hover:text-primary"
            >
              <span className="font-mono text-base font-semibold">
                #{data.case.externalId}
              </span>
              <ExternalLink className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </a>
          ) : (
            <span className="font-mono text-base font-semibold text-on-surface">
              #{data.case.externalId}
            </span>
          )}

          {data.case.openedAt && (
            <span className="text-sm text-outline">
              Created: {formatDateTime(data.case.openedAt)}
            </span>
          )}

          <div className="mt-2 flex justify-between border-t border-surface-container-high/40 pt-2 font-mono text-xxs text-outline">
            {data.case.priority && (
              <span>Priority: {data.case.priority}</span>
            )}
            {data.case.status && (
              <span className="text-on-surface">
                Status: {formatNormalizedState(data.case.status)}
              </span>
            )}
          </div>
        </div>

        {/* Engineering / Jira card */}
        {primaryJira ? (
          <div className="flex flex-col gap-2 rounded-lg bg-surface-container p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xxs font-semibold uppercase tracking-wider text-outline">
                Linked Engineering Issue
              </span>
              <span className="rounded bg-leg-engineering/20 px-2 py-0.5 font-mono text-xxs text-leg-engineering-text">
                {systemLabel(primaryJira.system)}
              </span>
            </div>

            {primaryJira.url ? (
              <a
                href={primaryJira.url}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex items-center gap-1 text-on-surface hover:text-primary"
              >
                <span className="font-mono text-base font-semibold">
                  {primaryJira.externalId}
                </span>
                <ExternalLink className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
              </a>
            ) : (
              <span className="font-mono text-base font-semibold text-on-surface">
                {primaryJira.externalId}
              </span>
            )}

            <span className="text-sm text-outline">
              Method: {formatCaseLinkMethod(primaryJira.method)}
            </span>

            <div className="mt-2 flex justify-between border-t border-surface-container-high/40 pt-2 font-mono text-xxs">
              <span className="text-outline">
                Confidence: {primaryJira.confidence}
              </span>
              {primaryJira.statusName && (
                <span className="font-medium text-on-surface">
                  Status: {primaryJira.statusName}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-border bg-surface-container p-4 text-center">
            <div>
              <span className="block font-mono text-xxs font-semibold uppercase tracking-wider text-outline">
                Engineering
              </span>
              <span className="mt-2 block text-sm text-on-surface-variant">
                No linked issue
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Link method footer */}
      {primaryJira && (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-container px-4 py-3 text-sm text-outline">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-on-surface">
              Link Method: {formatCaseLinkMethod(primaryJira.method)}
            </span>
          </div>
          <p className="font-mono text-xxs text-outline-variant">
            {primaryJira.externalId} correlated to #{data.case.externalId} via{" "}
            {formatCaseLinkMethod(primaryJira.method)}. Confidence:{" "}
            <span className="text-on-surface">{primaryJira.confidence}</span>.
          </p>
        </div>
      )}

      {/* Extra links */}
      {extraLinks.length > 0 && (
        <div>
          <p className="mb-2 font-mono text-xxs font-semibold uppercase tracking-wider text-outline">
            Additional Links
          </p>
          <ul className="space-y-2">
            {extraLinks.map((link, i) => (
              <li
                key={`${link.system}-${link.externalId}-${i}`}
                className="rounded-lg border border-border bg-surface-container p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="block font-mono text-xxs text-outline">
                      {systemLabel(link.system)}
                    </span>
                    <span className="block font-mono text-sm font-semibold text-on-surface">
                      {link.externalId}
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="rounded bg-surface-container-high px-1.5 py-0.5 font-mono text-xxs text-outline">
                        {formatCaseLinkMethod(link.method)}
                      </span>
                      <span className="rounded bg-surface-container-high px-1.5 py-0.5 font-mono text-xxs text-outline">
                        {link.confidence}
                      </span>
                      {link.statusName && (
                        <span className="rounded bg-surface-container-high px-1.5 py-0.5 font-mono text-xxs text-outline">
                          {link.statusName}
                        </span>
                      )}
                    </div>
                  </div>
                  {link.url && (
                    <a href={link.url} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-3.5 text-outline hover:text-on-surface" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!primaryJira && data.links.length === 0 && !data.case.ticketUrl && (
        <p className="py-4 text-center text-sm text-on-surface-variant">
          No linked records.
        </p>
      )}
    </div>
  );
}
