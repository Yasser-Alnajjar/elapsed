"use client";

import { ExternalLink, Link2 } from "lucide-react";

import {
  formatCaseLinkMethod,
  formatDateTime,
  formatNormalizedState,
  formatTicketSource,
} from "@/lib/format";
import type { CaseDetailData } from "@/lib/types/cases";

export function LinkedRecords({ data }: { data: CaseDetailData }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-surface-container-low p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link2 size={16} className="text-leg-engineering-text" />

          <h2 className="text-xl font-semibold tracking-tight text-on-surface">
            Deterministic Correlation &amp; Linked Records
          </h2>
        </div>

        {data.links.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded bg-tertiary-container px-2.5 py-1 font-mono text-xxs font-semibold uppercase tracking-wider text-on-tertiary-container">
            <span className="size-1.5 rounded-full bg-on-tertiary-container" />
            {data.links.length} LINK{data.links.length !== 1 ? "S" : ""}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded bg-surface-container-highest px-2.5 py-1 font-mono text-xxs text-outline">
            UNLINKED
          </span>
        )}
      </div>

      <div className="rounded-lg bg-surface-container p-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xxs font-semibold uppercase tracking-wider text-outline">
              Customer Ticket
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
            {data.case.priority && <span>Priority: {data.case.priority}</span>}

            {data.case.status && (
              <span className="text-on-surface">
                Status: {formatNormalizedState(data.case.status)}
              </span>
            )}
          </div>
        </div>
      </div>

      {data.links.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {data.links.map((link, index) => (
            <div
              key={`${link.system}-${link.externalId}-${index}`}
              className="flex flex-col gap-2 rounded-lg bg-surface-container p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xxs font-semibold uppercase tracking-wider text-outline">
                  Linked Record
                </span>

                <span className="rounded bg-leg-engineering/20 px-2 py-0.5 font-mono text-xxs font-semibold uppercase tracking-wider text-leg-engineering-text">
                  {link.system}
                </span>
              </div>

              {link.url ? (
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex items-center gap-1 text-on-surface hover:text-primary"
                >
                  <span className="font-mono text-base font-semibold">
                    {link.externalId}
                  </span>

                  <ExternalLink className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                </a>
              ) : (
                <span className="font-mono text-base font-semibold text-on-surface">
                  {link.externalId}
                </span>
              )}

              <span className="text-sm text-outline">
                Method: {formatCaseLinkMethod(link.method)}
              </span>

              <div className="mt-2 flex items-center justify-between gap-3 border-t border-surface-container-high/40 pt-2 font-mono text-xxs">
                <span className="text-outline">
                  Confidence: {link.confidence}
                </span>

                {link.statusName && (
                  <span className="font-medium text-on-surface">
                    Status: {link.statusName}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-border bg-surface-container p-6 text-center">
          <div>
            <span className="block font-mono text-xxs font-semibold uppercase tracking-wider text-outline">
              Linked Records
            </span>

            <span className="mt-2 block text-sm text-on-surface-variant">
              No linked records
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
