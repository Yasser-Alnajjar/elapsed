import { describe, expect, it, vi } from "vitest";
import { editTicketsRequest } from "@/lib/custom-provider/wizard";

const unconfirmed = vi.hoisted(() => ({ endpoints: [] as string[] }));
const opened = vi.hoisted(() => vi.fn());

vi.mock("@sla/custom-ticket", () => ({
  DraftNotReadyError: class extends Error {},
  loadReadyDraft: async () => ({ config: {}, secrets: {} }),
  openOutboundSession: (...args: unknown[]) => {
    opened(...args);
    return { dispose: async () => {} };
  },
  unconfirmedPostEndpoints: () => unconfirmed.endpoints,
}));
vi.mock("@/lib/custom-provider/route-guard", async () => {
  const { NextResponse } = await import("next/server");
  return {
    ownerGuard: async () => ({ ok: true, ctx: { prisma: {}, organizationId: "org", release: () => {} } }),
    failure: (code: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ error: code, code, ...extra }, { status }),
  };
});

describe("wizard: the read-only confirmation belongs to the endpoint that was confirmed", () => {
  const confirmed = { method: "POST", path: "/v2/search", body: { q: "x" }, query: { a: "1" }, readOnlySearch: true };

  it.each([
    ["the method", { method: "GET" }],
    ["the path", { path: "/v2/other" }],
    ["the body", { body: { q: "y" } }],
    ["the query", { query: { a: "2" } }],
  ])("changing %s clears the confirmation", (_what, patch) => {
    expect(editTicketsRequest(confirmed, patch)).not.toHaveProperty("readOnlySearch");
  });

  it("switching to GET drops the body and the confirmation, and switching back to POST starts unconfirmed", () => {
    const get = editTicketsRequest(confirmed, { method: "GET" });
    expect(get).toEqual({ method: "GET", path: "/v2/search", query: { a: "1" } });
    const post = editTicketsRequest(get, { method: "POST" });
    expect(post.method).toBe("POST");
    expect(post).not.toHaveProperty("readOnlySearch");
  });

  it("a GET edit is unchanged: the other fields are kept and an emptied value is removed", () => {
    const get = { method: "GET", path: "/tickets", query: { a: "1" }, headers: { "X-A": "b" } };
    expect(editTicketsRequest(get, { path: "/v2/tickets" })).toEqual({ ...get, path: "/v2/tickets" });
    expect(editTicketsRequest(get, { query: undefined })).toEqual({ method: "GET", path: "/tickets", headers: { "X-A": "b" } });
    expect(editTicketsRequest(get, { path: "" })).not.toHaveProperty("path");
  });
});

describe("test, sample and preview routes run before full validation", () => {
  it("refuse an unconfirmed POST with 422 and never open a session", async () => {
    const { withOutboundSession } = await import("@/lib/custom-provider/outbound-route");
    unconfirmed.endpoints = ["tickets.request"];
    const run = vi.fn(async () => ({ classification: "ok" }));
    const response = await withOutboundSession(run);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "post_requires_read_only_designation", endpoints: ["tickets.request"] });
    expect(opened).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("run as before for a GET or a confirmed POST", async () => {
    const { withOutboundSession } = await import("@/lib/custom-provider/outbound-route");
    unconfirmed.endpoints = [];
    const run = vi.fn(async () => ({ classification: "ok" }));
    const response = await withOutboundSession(run);
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
