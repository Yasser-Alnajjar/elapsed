/**
 * Ticket #45 regression (Case D): a commitment whose clock is paused must not
 * show its nominal `Commitment.dueAt` (startedAt + target, blind to pauses)
 * as the deadline on the case detail page. The paused commitment is a
 * resolution one: first response never pauses (clock-rules.ts in @sla/core).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@sla/db";
import { describe, expect, it } from "vitest";
import { CommitmentCard } from "@modules/cases/case-detail/csr/CommitmentCard";
import { getCaseDetailData } from "@/lib/case-detail-data";
import { formatDateTimeWithOffset } from "@/lib/format";

const OPENED = new Date("2026-09-17T09:19:30.000Z");
const NOMINAL_DUE = new Date("2026-09-17T09:21:30.000Z");
const PAUSED = new Date("2026-09-17T09:20:04.000Z");
const AS_OF = new Date("2026-09-17T09:23:00.000Z");

function fakePrisma(
  events: {
    type: string;
    occurredAt: Date;
    fromState: string | null;
    toState: string;
  }[],
  kind: "first_response" | "resolution" = "resolution",
) {
  const commitment = {
    id: "commitment-45",
    caseId: "case-45",
    kind,
    policyVersionId: "pv-6",
    calendarVersionId: "cal-24-7",
    startedAt: OPENED,
    targetMinutes: 2,
    dueAt: NOMINAL_DUE,
    status: "on_track" as const,
    closedAt: null,
    createdAt: OPENED,
  };
  return {
    case: {
      findFirst: async () => ({
        id: "case-45",
        organizationId: "org-1",
        externalId: "45",
        system: "zendesk",
        subject: "ticket#45",
        priority: "urgent",
        tier: null,
        channel: "web",
        openedAt: OPENED,
        closedAt: null,
        customer: null,
        caseLinks: [],
        commitments: [commitment],
      }),
    },
    normalizedEvent: {
      findMany: async () =>
        events.map((e, index) => ({
          id: `evt-${index}`,
          caseId: "case-45",
          actor: "customer",
          system: "zendesk",
          sourceRawEventId: "raw-audit",
          ...e,
        })),
    },
    integration: { findMany: async () => [] },
    organization: {
      findUnique: async () => ({ engineeringLegTargetMinutes: null }),
    },
    sLAPolicyVersion: {
      findMany: async () => [
        {
          id: "pv-6",
          policyId: "policy",
          policy: { name: "Urgent SLA" },
          version: 6,
          match: { priority: ["urgent"] },
          targets: [
            { kind: "first_response", minutes: 2 },
            { kind: "resolution", minutes: 2 },
          ],
          pauseOnStates: ["pending_customer"],
          calendarVersionId: "cal-24-7",
          warnAtPercent: [50, 80, 95],
          effectiveFrom: new Date("2026-09-17T09:14:41.625Z"),
        },
      ],
    },
    businessCalendarVersion: {
      findMany: async () => [
        {
          id: "cal-24-7",
          version: 1,
          timezone: "UTC",
          weekly: [],
          holidays: [],
          alwaysOpen: true,
        },
      ],
    },
    commitmentPolicyChange: { findMany: async () => [] },
    notification: { findMany: async () => [] },
  } as unknown as PrismaClient;
}

const created = {
  type: "case_created",
  occurredAt: OPENED,
  fromState: null,
  toState: "open",
};
const pending = {
  type: "state_changed",
  occurredAt: PAUSED,
  fromState: "open",
  toState: "pending_customer",
};

async function renderCommitment(
  events: (typeof created | typeof pending)[],
  kind: "first_response" | "resolution" = "resolution",
) {
  const data = await getCaseDetailData(
    fakePrisma(events, kind),
    "org-1",
    "case-45",
    AS_OF,
  );
  const commitment = data!.commitments[0]!;
  const html = renderToStaticMarkup(
    createElement(CommitmentCard, { commitment }),
  );
  return {
    commitment,
    text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
  };
}

describe("case detail commitment deadline (ticket #45)", () => {
  it("Case D: a paused commitment shows Paused and its exact remaining time, never the nominal Due", async () => {
    const { commitment, text } = await renderCommitment([created, pending]);

    expect(commitment).toMatchObject({
      status: "on_track",
      clockState: "paused",
      pausedSince: PAUSED.toISOString(),
      effectiveDueAt: null,
      elapsedSeconds: 34,
      remainingSeconds: 86,
    });
    expect(commitment).not.toHaveProperty("dueAt");

    expect(text).toContain("On track");
    expect(text).toContain("Paused");
    expect(text).toContain("1m 26s remaining");
    expect(text).toContain(
      `Paused since ${formatDateTimeWithOffset(PAUSED.toISOString(), "UTC")}`,
    );
    expect(text).not.toContain("Due ");
    expect(text).not.toContain(
      formatDateTimeWithOffset(NOMINAL_DUE.toISOString(), "UTC"),
    );
  });

  it("a running commitment shows Running and its pause-aware due time", async () => {
    const asOfBeforeDue = new Date("2026-09-17T09:20:00.000Z");
    const data = await getCaseDetailData(
      fakePrisma([created]),
      "org-1",
      "case-45",
      asOfBeforeDue,
    );
    const commitment = data!.commitments[0]!;
    const text = renderToStaticMarkup(
      createElement(CommitmentCard, { commitment }),
    ).replace(/<[^>]+>/g, " ");

    expect(commitment).toMatchObject({
      clockState: "running",
      effectiveDueAt: NOMINAL_DUE.toISOString(),
    });
    expect(text).toContain("Running");
    expect(text).toContain("1m 30s remaining");
    expect(text).toContain(
      `Due ${formatDateTimeWithOffset(NOMINAL_DUE.toISOString(), "UTC")}`,
    );
  });

  it("shows each commitment's own pause states, not the policy's", async () => {
    const resolution = await renderCommitment([created, pending], "resolution");
    // D3: resolution also pauses on `resolved` (a solve-to-reopen interval
    // never counts), on top of the policy's own pause states.
    expect(resolution.commitment.pauseOnStates).toEqual([
      "pending_customer",
      "resolved",
    ]);
    expect(resolution.commitment.policyVersion).not.toHaveProperty(
      "pauseOnStates",
    );

    const firstResponse = await renderCommitment(
      [created, pending],
      "first_response",
    );
    expect(firstResponse.commitment).toMatchObject({
      pauseOnStates: [],
      status: "breached",
      clockState: "running",
      pausedSince: null,
      elapsedSeconds: 210,
      breachedBySeconds: 90,
    });
    expect(firstResponse.text).not.toContain("Paused");
  });

  it("shades the timeline with the shading commitment's own pause states", async () => {
    const firstResponseOnly = await getCaseDetailData(
      fakePrisma([created, pending], "first_response"),
      "org-1",
      "case-45",
      AS_OF,
    );
    expect(firstResponseOnly!.pausedIntervals).toEqual([]);

    const resolution = await getCaseDetailData(
      fakePrisma([created, pending], "resolution"),
      "org-1",
      "case-45",
      AS_OF,
    );
    expect(resolution!.pausedIntervals).toEqual([
      {
        start: PAUSED.toISOString(),
        end: AS_OF.toISOString(),
        cause: "pending_customer",
      },
    ]);
  });
});
