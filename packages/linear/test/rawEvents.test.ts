import { describe, expect, it } from "vitest";
import { mapAttachmentToRawEvent, mapHistoryEntryToRawEvent, mapIssueToRawEvent } from "../src/rawEvents";
import type { LinearAttachment, LinearHistoryEntry, LinearIssue } from "../src/types";

const issue: LinearIssue = {
  id: "issue-1",
  identifier: "SUP-42",
  title: "Customer escalation",
  url: "https://linear.app/acme/issue/SUP-42",
  priority: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  state: { id: "state-1", name: "In Progress", type: "started" },
  team: { id: "team-1", key: "SUP", name: "Support" },
  creator: { id: "user-1", name: "Alice" },
  assignee: null,
};

describe("mapIssueToRawEvent", () => {
  it("folds the content hash into the provider event id", () => {
    const result = mapIssueToRawEvent(issue);
    expect(result.providerEventId).toBe(`issue:issue-1:${result.sourceHash}`);
  });

  it("produces a different provider event id when the issue changes", () => {
    const before = mapIssueToRawEvent(issue);
    const after = mapIssueToRawEvent({
      ...issue,
      state: { id: "state-2", name: "Done", type: "completed" },
    });
    expect(after.providerEventId).not.toBe(before.providerEventId);
  });

  it("produces the same provider event id for an unchanged re-fetch", () => {
    const first = mapIssueToRawEvent(issue);
    const second = mapIssueToRawEvent({ ...issue });
    expect(second.providerEventId).toBe(first.providerEventId);
  });
});

describe("mapHistoryEntryToRawEvent", () => {
  const entry: LinearHistoryEntry = {
    id: "history-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    actor: { id: "user-1", name: "Alice" },
    fromState: { id: "state-1", name: "Todo", type: "unstarted" },
    toState: { id: "state-2", name: "In Progress", type: "started" },
  };

  it("keys by issue id, entry id, and content hash", () => {
    const result = mapHistoryEntryToRawEvent("issue-1", entry);
    expect(result.providerEventId).toBe(`issue_history:issue-1:history-1:${result.sourceHash}`);
    expect(result.payload).toBe(entry);
  });

  it("produces a distinct provider event id when Linear rewrites an entry in place", () => {
    const before = mapHistoryEntryToRawEvent("issue-1", entry);
    const after = mapHistoryEntryToRawEvent("issue-1", {
      ...entry,
      toState: { id: "state-3", name: "Done", type: "completed" },
    });
    expect(after.providerEventId).not.toBe(before.providerEventId);
  });

  it("keeps a state that returns to an earlier value distinct from its first occurrence (A → B → A)", () => {
    const stateA = { id: "state-2", name: "In Progress", type: "started" };
    const stateB = { id: "state-3", name: "Done", type: "completed" };
    // Linear rewrites the one entry in place: id, createdAt and fromState stay, toState and updatedAt move.
    const first = mapHistoryEntryToRawEvent("issue-1", { ...entry, toState: stateA, updatedAt: "2026-01-01T00:10:00.000Z" });
    const second = mapHistoryEntryToRawEvent("issue-1", { ...entry, toState: stateB, updatedAt: "2026-01-01T00:20:00.000Z" });
    const third = mapHistoryEntryToRawEvent("issue-1", { ...entry, toState: stateA, updatedAt: "2026-01-01T00:30:00.000Z" });
    expect(new Set([first, second, third].map((r) => r.providerEventId)).size).toBe(3);
  });

  it("produces the same provider event id for an unchanged re-fetch", () => {
    expect(mapHistoryEntryToRawEvent("issue-1", { ...entry }).providerEventId).toBe(
      mapHistoryEntryToRawEvent("issue-1", entry).providerEventId,
    );
  });
});

describe("mapAttachmentToRawEvent", () => {
  it("keys by issue id, attachment id, and content hash", () => {
    const attachment: LinearAttachment = {
      id: "attachment-1",
      url: "https://acme.zendesk.com/agent/tickets/42",
      title: "ZD-42",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const result = mapAttachmentToRawEvent("issue-1", attachment);
    expect(result.providerEventId).toBe(`attachment:issue-1:attachment-1:${result.sourceHash}`);
  });

  it("produces a different provider event id when the attachment changes", () => {
    const before = mapAttachmentToRawEvent("issue-1", {
      id: "attachment-1",
      url: "https://acme.zendesk.com/agent/tickets/42",
      title: "ZD-42",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const after = mapAttachmentToRawEvent("issue-1", {
      id: "attachment-1",
      url: "https://acme.zendesk.com/agent/tickets/42",
      title: "ZD-42 (renamed)",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(after.providerEventId).not.toBe(before.providerEventId);
  });
});
