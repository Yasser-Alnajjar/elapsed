import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@sla/db";
import { runIntercomBackfill, WATERMARK_LOOKBACK_SECONDS } from "../src/backfill";

vi.mock("../src/tokenLifecycle", () => ({
  loadFreshIntercomCredentials: vi.fn().mockResolvedValue({ accessToken: "token", workspaceId: "ws" }),
  markReauthRequired: vi.fn(),
  recordIntercomWorkspaceId: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const stateParts = [
  { id: "p1", part_type: "ticket_state_updated_by_admin", created_at: 100, author: { type: "admin", id: "a1" } },
  { id: "p2", part_type: "comment", created_at: 110, author: { type: "admin", id: "a1" }, body: "<p>hi</p>" },
];

/** Runs one backfill over `conversation`, answering `GET /tickets/*` with `ticketResponse`. */
async function backfill(conversation: Record<string, unknown>, ticketResponse?: () => Response) {
  const requested: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = input.replace("https://api.intercom.io", "");
      requested.push(path);
      if (path === "/conversations/search") {
        return json(200, { conversations: [{ id: "c1" }], pages: { total_pages: 1 }, total_count: 1 });
      }
      if (path === "/conversations/c1") return json(200, conversation);
      if (path.startsWith("/tickets/")) return ticketResponse?.() ?? json(404, {});
      if (path.startsWith("/companies")) return json(200, { data: [], pages: { page: 1, per_page: 50, total_pages: 1 }, total_count: 0 });
      if (path === "/admins") return json(200, { type: "admin.list", admins: [] });
      throw new Error(`unexpected request ${init?.method ?? "GET"} ${path}`);
    }),
  );
  const written: string[] = [];
  const payloads = new Map<string, unknown>();
  const prisma = {
    integration: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ cursor: null }),
      update: vi.fn().mockResolvedValue({}),
    },
    rawEvent: {
      createMany: vi.fn(async ({ data }: { data: { providerEventId: string; payload: unknown }[] }) => {
        for (const row of data) {
          written.push(row.providerEventId);
          payloads.set(row.providerEventId, row.payload);
        }
        return { count: data.length };
      }),
    },
  } as unknown as PrismaClient;

  await runIntercomBackfill(prisma, "integration-1");
  return { requested, written, payloads, prisma };
}

const ticketConversation = {
  id: "c1",
  created_at: 1,
  updated_at: 2,
  state: "open",
  ticket: { id: "c1", state: "waiting_on_customer" },
  conversation_parts: { conversation_parts: stateParts, total_count: 2 },
};

describe("runIntercomBackfill ticket state parts", () => {
  it("fetches the ticket for a conversation with a state-change part and stores only its state parts", async () => {
    const { requested, written, payloads } = await backfill(ticketConversation, () =>
      json(200, {
        id: "c1",
        ticket_parts: {
          ticket_parts: [
            { id: "p1", part_type: "ticket_state_updated_by_admin", created_at: 100, previous_ticket_state: "in_progress", ticket_state: "waiting_on_customer" },
            { id: "p2", part_type: "comment", created_at: 110 },
          ],
        },
      }),
    );

    expect(requested).toContain("/tickets/c1");
    expect(written.filter((id) => id.startsWith("ticket_part:"))).toEqual(["ticket_part:c1:p1"]);
    expect(payloads.get("ticket_part:c1:p1")).toMatchObject({ previous_ticket_state: "in_progress", ticket_state: "waiting_on_customer" });
    expect(written).toContain("conversation_part:c1:p1");
  });

  it("does not call the ticket API for a plain conversation or a ticket with no state-change part", async () => {
    const plain = await backfill({ ...ticketConversation, ticket: null });
    expect(plain.requested.some((path) => path.startsWith("/tickets/"))).toBe(false);

    const noStateChange = await backfill({
      ...ticketConversation,
      conversation_parts: { conversation_parts: [stateParts[1]], total_count: 1 },
    });
    expect(noStateChange.requested.some((path) => path.startsWith("/tickets/"))).toBe(false);
  });

  it("completes the sync when the ticket API refuses (403) or is missing (404), writing no ticket parts", async () => {
    for (const status of [403, 404]) {
      const { written } = await backfill(ticketConversation, () => json(status, { type: "error.list", errors: [] }));
      expect(written.some((id) => id.startsWith("conversation:c1:"))).toBe(true);
      expect(written.some((id) => id.startsWith("ticket_part:"))).toBe(false);
    }
  });
});

describe("runIntercomBackfill watermark", () => {
  it("advances the search watermark to the run start less the look-back, so a lagging search index cannot skip an update", async () => {
    const now = new Date("2026-10-05T14:40:00Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    try {
      const { prisma } = await backfill(ticketConversation);
      const cursors = vi.mocked(prisma.integration.update).mock.calls.map(
        ([args]) => (args.data.cursor as { conversations?: { updatedSince: number } }).conversations?.updatedSince,
      );
      const runStartedAt = Math.floor(now.getTime() / 1000);
      expect(WATERMARK_LOOKBACK_SECONDS).toBe(300);
      expect(cursors.filter((value) => value !== undefined).at(-1)).toBe(runStartedAt - 300);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never moves the watermark backwards past the filter the run itself used", async () => {
    const { prisma } = await backfill(ticketConversation);
    const updatedSinceValues = vi.mocked(prisma.integration.update).mock.calls.map(
      ([args]) => (args.data.cursor as { conversations?: { updatedSince: number } }).conversations?.updatedSince,
    );
    const defined = updatedSinceValues.filter((value): value is number => value !== undefined);
    expect(defined.at(-1)!).toBeGreaterThanOrEqual(defined[0]!);
  });
});
