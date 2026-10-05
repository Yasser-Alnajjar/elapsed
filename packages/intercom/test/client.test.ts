import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildIntercomConversationUrl,
  IntercomApiError,
  IntercomClient,
  IntercomPermissionDeniedError,
} from "../src/client";
import type { IntercomCredentials } from "../src/types";

const baseCredentials: IntercomCredentials = { accessToken: "token" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IntercomClient 403 handling", () => {
  it("throws IntercomPermissionDeniedError on a 403 without attempting a token refresh", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { type: "error.list", errors: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const onUnauthorized = vi.fn();
    const client = new IntercomClient(baseCredentials, { onUnauthorized });

    const error = await client.fetchContact("contact-1").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IntercomPermissionDeniedError);
    expect(error).toBeInstanceOf(IntercomApiError);
    expect((error as IntercomApiError).status).toBe(403);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves other failures as a plain IntercomApiError, after exhausting the shared retry budget on a 500", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { type: "error.list", errors: [] })));
      const client = new IntercomClient(baseCredentials);

      const pending = client.fetchContact("contact-1").catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      const error = await pending;

      expect(error).toBeInstanceOf(IntercomApiError);
      expect(error).not.toBeInstanceOf(IntercomPermissionDeniedError);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("workspace links", () => {
  it("reads the workspace id from GET /me", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { type: "admin", app: { id_code: "v9jrtlg9" } }));
    vi.stubGlobal("fetch", fetchMock);

    const me = await new IntercomClient(baseCredentials).fetchMe();

    expect(me.app?.id_code).toBe("v9jrtlg9");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.intercom.io/me");
  });

  it("builds an inbox link to a conversation", () => {
    expect(buildIntercomConversationUrl("v9jrtlg9", "215475963006992")).toBe(
      "https://app.intercom.com/a/apps/v9jrtlg9/conversations/215475963006992",
    );
  });
});

describe("fetchTicket", () => {
  it("reads GET /tickets/{id} with the pinned API version", async () => {
    const body = { id: "42", ticket_state: "waiting_on_customer", ticket_parts: { ticket_parts: [] } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal("fetch", fetchMock);

    const ticket = await new IntercomClient(baseCredentials).fetchTicket("42");

    expect(ticket).toEqual(body);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.intercom.io/tickets/42");
    expect((init.headers as Record<string, string>)["Intercom-Version"]).toBe("2.11");
  });
});
