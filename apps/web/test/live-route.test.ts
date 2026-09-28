/**
 * `GET /api/live` — the SSE endpoint `LiveDataProvider` connects to.
 * Pattern A, fully mocked (`next-auth`, `@/lib/auth`, `@/lib/live-data-bus`):
 * no real Postgres or SSE plumbing needed to prove the route's own contract —
 * authenticated-only, organization-scoped server-side (never from anything
 * the client supplies), and that it relays exactly what the bus hands it.
 */
import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveDataEvent } from "@sla/db";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
const bus = vi.hoisted(() => {
  const listenersByOrg = new Map<string, (event: LiveDataEvent) => void>();
  const unsubscribe = vi.fn();
  const subscribe = vi.fn(
    (organizationId: string, listener: (event: LiveDataEvent) => void) => {
      listenersByOrg.set(organizationId, listener);
      return unsubscribe;
    },
  );
  const unsubscribeStatus = vi.fn();
  let statusListener: ((status: { state: string }) => void) | null = null;
  const subscribeToStatus = vi.fn((listener: (status: { state: string }) => void) => {
    statusListener = listener;
    return unsubscribeStatus;
  });
  const getStatus = vi.fn(
    (): { state: "connected" | "reconnecting" | "offline" } => ({ state: "connected" }),
  );
  return {
    listenersByOrg,
    unsubscribe,
    subscribe,
    unsubscribeStatus,
    subscribeToStatus,
    getStatus,
    emitStatus: (status: { state: string }) => statusListener?.(status),
  };
});

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => auth.session) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/live-data-bus", () => ({ getLiveDataBus: () => bus }));

function sessionFor(organizationId: string): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: {
      id: "user-1",
      organizationId,
      email: "a@x.com",
      emailVerifiedAt: new Date(),
      name: null,
      image: null,
      role: "owner",
      createdAt: new Date(),
    },
  };
}

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const { value, done } = await reader.read();
  if (done || !value) return "";
  return new TextDecoder().decode(value);
}

beforeEach(() => {
  vi.resetModules();
  auth.session = null;
  bus.listenersByOrg.clear();
  bus.unsubscribe.mockClear();
  bus.subscribe.mockClear();
  bus.unsubscribeStatus.mockClear();
  bus.subscribeToStatus.mockClear();
  bus.getStatus.mockClear();
  bus.getStatus.mockReturnValue({ state: "connected" });
});

describe("GET /api/live", () => {
  it("rejects an unauthenticated client without subscribing to the bus", async () => {
    const { GET } = await import("../src/app/api/live/route");
    const response = await GET(new NextRequest("http://localhost/api/live"));

    expect(response.status).toBe(401);
    expect(bus.subscribe).not.toHaveBeenCalled();
  });

  it("subscribes using the session's own organization, never a client-supplied one", async () => {
    auth.session = sessionFor("org-1");
    const { GET } = await import("../src/app/api/live/route");
    // Even if a client tried to pass a different org id, the route has no
    // parameter for one — it can only ever read `session.user.organizationId`.
    const response = await GET(
      new NextRequest("http://localhost/api/live?organizationId=org-evil"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(bus.subscribe).toHaveBeenCalledWith("org-1", expect.any(Function));

    const reader = response.body!.getReader();
    await reader.cancel();
  });

  it("relays a data.updated event from the bus to the stream", async () => {
    auth.session = sessionFor("org-1");
    const { GET } = await import("../src/app/api/live/route");
    const response = await GET(new NextRequest("http://localhost/api/live"));
    const reader = response.body!.getReader();

    // Initial "connected" comment, sent synchronously on stream start.
    const first = await readChunk(reader);
    expect(first).toContain(": connected");

    // Then the current listener-status snapshot, also sent immediately.
    const statusChunk = await readChunk(reader);
    expect(statusChunk).toContain("event: listener.status");

    const listener = bus.listenersByOrg.get("org-1")!;
    listener({ type: "data.updated", organizationId: "org-1" });

    const next = await readChunk(reader);
    expect(next).toContain("event: data.updated");
    expect(next).toContain(JSON.stringify({ type: "data.updated", organizationId: "org-1" }));

    await reader.cancel();
  });

  it("sends the current listener status immediately, without waiting for a change", async () => {
    auth.session = sessionFor("org-1");
    bus.getStatus.mockReturnValue({ state: "offline" });
    const { GET } = await import("../src/app/api/live/route");
    const response = await GET(new NextRequest("http://localhost/api/live"));
    const reader = response.body!.getReader();

    await readChunk(reader); // ": connected" comment
    const statusChunk = await readChunk(reader);

    expect(statusChunk).toContain("event: listener.status");
    expect(statusChunk).toContain(JSON.stringify({ state: "offline" }));

    await reader.cancel();
  });

  it("pushes a status update to the stream when the bus reports a transition, and never leaks the raw error message", async () => {
    auth.session = sessionFor("org-1");
    const { GET } = await import("../src/app/api/live/route");
    const response = await GET(new NextRequest("http://localhost/api/live"));
    const reader = response.body!.getReader();

    await readChunk(reader); // ": connected"
    await readChunk(reader); // initial listener.status snapshot

    bus.emitStatus({
      state: "reconnecting",
      lastErrorMessage: "password authentication failed for user \"sla\"",
    } as never);

    const chunk = await readChunk(reader);
    expect(chunk).toContain("event: listener.status");
    expect(chunk).toContain(JSON.stringify({ state: "reconnecting" }));
    expect(chunk).not.toContain("password");

    await reader.cancel();
  });

  it("unsubscribes from status updates when the client disconnects", async () => {
    auth.session = sessionFor("org-1");
    const { GET } = await import("../src/app/api/live/route");
    const response = await GET(new NextRequest("http://localhost/api/live"));
    const reader = response.body!.getReader();
    await readChunk(reader);
    await readChunk(reader);

    await reader.cancel();

    expect(bus.unsubscribeStatus).toHaveBeenCalledTimes(1);
  });

  it("never delivers another organization's event to this subscriber", async () => {
    auth.session = sessionFor("org-1");
    const { GET } = await import("../src/app/api/live/route");
    await GET(new NextRequest("http://localhost/api/live"));

    // The bus only hands this route its own organization's listener slot —
    // there is no listener registered for "org-2" to even call.
    expect(bus.listenersByOrg.has("org-2")).toBe(false);
    expect(bus.subscribe).toHaveBeenCalledTimes(1);
    expect(bus.subscribe).toHaveBeenCalledWith("org-1", expect.any(Function));
  });

  it("unsubscribes from the bus when the client disconnects", async () => {
    auth.session = sessionFor("org-1");
    const { GET } = await import("../src/app/api/live/route");
    const response = await GET(new NextRequest("http://localhost/api/live"));
    const reader = response.body!.getReader();
    await readChunk(reader); // drain the initial comment
    await readChunk(reader); // drain the initial listener-status snapshot

    await reader.cancel();

    expect(bus.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
